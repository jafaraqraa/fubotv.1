'use strict';
function reduceState(previous, resolution, now = new Date().toISOString()) {
    const state = { ...previous };
    state.active_entities = resolution.resolved_entities;
    if (resolution.message_type !== 'casual') state.last_user_intent = resolution.intent;
    if (resolution.active_topic) state.active_topic = resolution.active_topic;
    if (resolution.explicit_subject) state.last_explicit_user_subject = resolution.explicit_subject;
    if (resolution.pending_action) state.pending_action = resolution.pending_action;
    if (resolution.required_slots) state.pending_slots = resolution.required_slots;
    state.updated_at = now;
    return state;
}
module.exports = { reduceState };
