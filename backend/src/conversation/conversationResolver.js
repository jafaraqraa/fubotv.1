'use strict';
const crypto=require('crypto');
const { validateInput,validateResolution }=require('./contracts');
const { resolveIntent }=require('./intentResolver');
const { trackEntities }=require('./entityTracker');
const { resolveReference,standalone,clarification }=require('./referenceResolver');
const { recallConversation,recallResponse }=require('./conversationRecall');
const { resolveWorkflow }=require('./workflowResolver');
const { reduceState }=require('./stateReducer');

function resolveConversation(input) {
    validateInput(input); const start=performance.now();
    const state=input.conversation_state || {}; const turnId=String(input.message_id || crypto.randomUUID());
    const classified=resolveIntent(input.current_message);
    const entities=classified.message_type==='casual' ? [...(state.active_entities||[])] : trackEntities({message:input.current_message,turnId,knownEntities:input.known_entities||[],previousEntities:state.active_entities||[]});
    const explicit=entities.find(e=>e.source==='explicit_user' && e.last_referenced_turn_id===turnId) || null;
    if (explicit && classified.message_type === 'follow_up') { classified.intent='PRODUCT_OR_SERVICE_INQUIRY'; classified.message_type='knowledge'; }
    const reference=explicit ? {selected:explicit,candidates:[explicit],ambiguous:false,unresolved:false,referenced_turn_ids:[turnId],reason:'explicit_user_subject'}
        : resolveReference({message:input.current_message,entities,state});
    let recall=null; if (classified.message_type==='conversation_recall') recall=recallConversation({message:input.current_message,recentMessages:input.recent_messages,state,currentMessageId:turnId});
    const workflow=resolveWorkflow({intent:classified.intent,entity:reference.selected,capabilities:input.available_business_capabilities||[],previousAction:state.pending_action});
    const needsReference=['transactional','follow_up','correction'].includes(classified.message_type) || /(?:\bit\b|منه|حقه|وضعه|اللي)/iu.test(input.current_message);
    const requiresClarification=(needsReference && (reference.ambiguous||reference.unresolved));
    const requiresRag=['knowledge','follow_up'].includes(classified.message_type) || (classified.message_type==='correction' && !!reference.selected) || !!recall?.requires_rag;
    let retrievalMessage=requiresRag?standalone(input.current_message,reference.selected):input.current_message;
    if(requiresRag&&reference.selected&&/(?:عندكم|عندك|do you (?:have|offer)|does (?:the )?(?:company|business) (?:have|offer))/iu.test(input.current_message))
        retrievalMessage=`هل تقدم الشركة ${reference.selected.canonical_name} كمنتج أو خدمة؟ ميّز بين وجوده ضمن عروض الشركة وبين المخزون اللحظي.`;
    const resolution={ message_type:requiresClarification?'clarification':classified.message_type,intent:requiresClarification?'CLARIFICATION_REQUIRED':classified.intent,
        original_message:input.current_message, standalone_message:retrievalMessage,
        active_topic:explicit||reference.selected||state.active_topic||null,resolved_entities:entities,referenced_turn_ids:reference.referenced_turn_ids||[],
        pending_action:workflow.pending_action,required_slots:workflow.required_slots,requires_rag:requiresRag,requires_business_action:workflow.requires_business_action,
        requires_clarification:requiresClarification,clarification_question:requiresClarification?clarification(reference.candidates):null,
        resolution_confidence:explicit||reference.selected||classified.message_type==='casual'||recall?'high':requiresClarification?'low':'medium',
        reason_codes:[reference.reason,classified.message_type, ...(recall?[`recall_${recall.kind}`]:[])],
        explicit_subject:explicit, recall_result:recall, direct_response:recall?recallResponse(recall):null };
    validateResolution(resolution);
    return { resolution, next_state:reduceState(state,resolution), trace:{ latency_ms:performance.now()-start, candidates:reference.candidates.map(x=>x.entity_id), selected:reference.selected?.entity_id||null } };
}
module.exports={ resolveConversation };
