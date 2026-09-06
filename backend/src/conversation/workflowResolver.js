'use strict';
function findCapability(intent, entities, capabilities = []) {
    const name = intent === 'PURCHASE_INTENT' ? 'purchase_request' : intent === 'BOOKING_INTENT' ? 'booking_request' : null;
    if (!name) return null;
    return capabilities.find(c => c.enabled !== false && c.capability === name && entities.some(e => {
        const typeAllowed=(c.supported_entity_types || []).includes(e.entity_type);
        const ids=c.supported_entity_ids || [];
        return typeAllowed && (!ids.length || ids.includes(e.entity_id)) && (e.authority!=='informational' || ids.includes(e.entity_id));
    })) || null;
}
function resolveWorkflow({ intent, entity, capabilities, previousAction }) {
    if (!['PURCHASE_INTENT','BOOKING_INTENT'].includes(intent)) return { pending_action:previousAction || null, required_slots:[], requires_business_action:false };
    if (!entity) return { pending_action:null, required_slots:['entity_id'], requires_business_action:false };
    const capability = findCapability(intent, [entity], capabilities);
    if (!capability) return { pending_action:{ type:intent, entity_id:entity.entity_id, execution_mode:'unsupported' }, required_slots:[], requires_business_action:false };
    const supplied = { entity_id:entity.entity_id, ...(previousAction?.slots || {}) };
    const required = (capability.required_slots || []).filter(slot => supplied[slot] == null);
    return { pending_action:{ type:intent, capability:capability.capability, entity_id:entity.entity_id,
        confirmation_required:capability.confirmation_required !== false, execution_mode:capability.execution_mode, slots:supplied },
        required_slots:required, requires_business_action:required.length === 0 };
}
module.exports = { findCapability, resolveWorkflow };
