'use strict';
const { resolveConversation }=require('./conversationResolver');
const { ConversationStateRepository }=require('./conversationStateRepository');
const { EntityCatalogRepository }=require('./entityCatalogRepository');
const { CapabilityRegistry }=require('./capabilityRegistry');
const crypto=require('crypto');
const metrics=require('../observability/runtimeMetrics');
let shadowActive=0; const SHADOW_MAX=Number(process.env.CONVERSATION_RESOLVER_SHADOW_CONCURRENCY||2);
function implementation(){ const mode=String(process.env.CONVERSATION_RESOLVER_IMPLEMENTATION||'legacy').toLowerCase(); return ['legacy','shadow','v2'].includes(mode)?mode:'legacy'; }
function run(input, repository=new ConversationStateRepository()) {
    const scope={tenant_id:input.tenant_id,conversation_id:input.conversation_id,contact_id:input.contact_id,channel:input.channel};
    for(let attempt=0;attempt<3;attempt++) { const state=repository.get(scope); const result=resolveConversation({...input,conversation_state:state});
        try { const committed=repository.commit(scope,{messageId:input.message_id,eventType:'USER_RESOLVED',nextState:result.next_state,expectedVersion:state.state_version});
            repository.trace(scope,{message_id:input.message_id,message_type:result.resolution.message_type,intent:result.resolution.intent,latency_ms:result.trace.latency_ms,
                metadata:{state_version_before:state.state_version,state_version_after:committed.state.state_version,reason_codes:result.resolution.reason_codes,requires_rag:result.resolution.requires_rag,requires_action:result.resolution.requires_business_action}});
            metrics.increment('conversation_resolver_total',{message_type:result.resolution.message_type,intent:result.resolution.intent});
            metrics.observe('conversation_resolver_duration_milliseconds',result.trace.latency_ms);
            if(committed.duplicate) metrics.increment('conversation_resolver_duplicate_messages_total');
            if(result.resolution.requires_clarification) metrics.increment('conversation_resolver_clarifications_total');
            if(result.resolution.message_type==='follow_up'&&!result.resolution.requires_clarification) metrics.increment('conversation_resolver_followups_resolved_total');
            if(!result.resolution.requires_rag) metrics.increment('conversation_resolver_rag_calls_avoided_total');
            if(result.resolution.message_type==='transactional'&&result.resolution.active_topic) metrics.increment('conversation_resolver_transactional_continuations_total');
            return {...result,state:committed.state,duplicate:committed.duplicate};
        } catch(e){ if(e.code==='CONVERSATION_STATE_CONFLICT') metrics.increment('conversation_resolver_state_conflicts_total'); if(e.code!=='CONVERSATION_STATE_CONFLICT'||attempt===2) throw e; }
    }
}
function enrich(input,repository){let entities=input.known_entities,capabilities=input.available_business_capabilities;try{if(!entities)entities=new EntityCatalogRepository(repository.db).getActive(input.tenant_id,{allowedSourceIds:input.authorized_source_ids}).entities;if(!capabilities)capabilities=new CapabilityRegistry(repository.db).list(input.tenant_id);}catch(e){if(e.code!=='SQLITE_ERROR')throw e;}return {...input,known_entities:entities||[],available_business_capabilities:capabilities||[]};}
function shadowTrace(repository,input,result){const hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');const days=Math.max(1,Math.min(30,Number(process.env.CONVERSATION_RESOLVER_SHADOW_RETENTION_DAYS)||7));repository.db.transaction(()=>{repository.db.prepare(`INSERT INTO conversation_resolver_shadow_traces VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`).run(crypto.randomUUID(),input.tenant_id,hash(input.conversation_id),hash(input.contact_id),input.message_id||null,JSON.stringify({message_type:result.resolution.message_type,intent:result.resolution.intent,selected_entity_id:result.resolution.active_topic?.entity_id||null,requires_rag:result.resolution.requires_rag,requires_clarification:result.resolution.requires_clarification,reason_codes:result.resolution.reason_codes}),result.trace.latency_ms);repository.db.prepare(`DELETE FROM conversation_resolver_shadow_traces WHERE created_at < datetime('now',?)`).run(`-${days} days`);})();}
function dispatch(input, repository) {
    const mode=implementation(); if(mode==='legacy') return {mode,result:null}; repository=repository||new ConversationStateRepository(); input=enrich(input,repository);
    if(mode==='v2') return {mode,result:run(input,repository)};
    if(process.env.CONVERSATION_RESOLVER_SHADOW_KILL_SWITCH==='1'||shadowActive>=SHADOW_MAX) return {mode,skipped:true,result:null};
    shadowActive++; setImmediate(()=>{try{const state=repository.get({tenant_id:input.tenant_id,conversation_id:input.conversation_id,contact_id:input.contact_id,channel:input.channel});const result=resolveConversation({...input,conversation_state:state});shadowTrace(repository,input,result);}catch(_){metrics.increment('conversation_resolver_shadow_errors_total')}finally{shadowActive--}});return {mode,queued:true,result:null};
}
module.exports={ implementation,run,dispatch };
