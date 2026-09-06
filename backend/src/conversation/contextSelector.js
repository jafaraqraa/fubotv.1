'use strict';
function selectContext({ currentMessage, state, recentMessages = [], maxUserTurns=4, maxAssistantTurns=2 }) {
    const users=recentMessages.filter(m=>m.role==='user').slice(-maxUserTurns);
    const assistants=recentMessages.filter(m=>m.role==='assistant').slice(-maxAssistantTurns);
    return { current_message:currentMessage, structured_state:state, recent_user_turns:users,
        recent_assistant_turns:assistants, pending_workflow:state.pending_action || null,
        resolved_entities:state.active_entities || [] };
}
module.exports={ selectContext };
