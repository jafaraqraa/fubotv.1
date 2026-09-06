'use strict';

const MESSAGE_TYPES = new Set(['casual','knowledge','follow_up','conversation_recall','correction','transactional','clarification','rejected']);
const CONFIDENCE = new Set(['high','medium','low']);
const ENTITY_TYPES = new Set(['product','service','plan','package','policy','location','person','department','order','appointment','document','custom']);

function requireString(value, name) { if (!String(value || '').trim()) throw new Error(`${name} is required`); return String(value); }
function validateInput(input) {
    for (const key of ['tenant_id','conversation_id','contact_id','channel']) requireString(input?.[key], key);
    if (!Array.isArray(input.recent_messages || [])) throw new Error('recent_messages must be an array');
    return input;
}
function validateEntity(entity) {
    for (const key of ['entity_id','canonical_name','display_name','source','introduced_turn_id','last_referenced_turn_id','status']) requireString(entity?.[key], key);
    if (!ENTITY_TYPES.has(entity.entity_type) && entity.entity_type !== 'custom') throw new Error('invalid entity_type');
    if (!Number.isFinite(entity.salience) || entity.salience < 0 || entity.salience > 1) throw new Error('invalid entity salience');
    return entity;
}
function validateResolution(output) {
    if (!MESSAGE_TYPES.has(output?.message_type)) throw new Error('invalid message_type');
    if (!CONFIDENCE.has(output?.resolution_confidence)) throw new Error('invalid resolution_confidence');
    for (const key of ['resolved_entities','referenced_turn_ids','required_slots','reason_codes']) if (!Array.isArray(output[key])) throw new Error(`${key} must be an array`);
    output.resolved_entities.forEach(validateEntity);
    return output;
}
module.exports = { MESSAGE_TYPES, CONFIDENCE, ENTITY_TYPES, validateInput, validateEntity, validateResolution };
