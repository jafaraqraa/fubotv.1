'use strict';
function userTurns(messages, currentId) { return messages.filter(m => m.role === 'user' && m.id !== currentId); }
function recallConversation({ message, recentMessages = [], state = {}, currentMessageId }) {
    const users = userTurns(recentMessages, currentMessageId);
    const assistants = recentMessages.filter(m => m.role === 'assistant');
    const asksAnswer = /(?:what did you (?:say|tell)|شو (?:حكيت|قلت)(?:لي|لك)?)/iu.test(message);
    const asksTopic = /(?:talking about|ask about|عن شو|شو كنا نحكي)/iu.test(message);
    if (asksAnswer && assistants.length) return { kind:'last_assistant_answer', turn:assistants.at(-1), requires_rag:true };
    if (asksTopic && state.last_explicit_user_subject) return { kind:'last_explicit_topic', subject:state.last_explicit_user_subject, requires_rag:false };
    const questions = users.filter(m => /[?؟]/u.test(m.content || m.text || ''));
    const turn = questions.at(-1) || users.at(-1);
    return turn ? { kind:'last_user_question', turn, requires_rag:false } : { kind:'unavailable', requires_rag:false };
}
function recallResponse(result) {
    if (result.kind === 'last_explicit_topic') return `كنت تسأل عن ${result.subject.display_name || result.subject.canonical_name}.`;
    if (result.kind === 'last_user_question') return `آخر سؤال إلك كان: «${result.turn.content || result.turn.text}»`;
    if (result.kind === 'last_assistant_answer') return `أنا حكيت قبل: «${result.turn.content || result.turn.text}». هذا وصف للمحادثة، وأي معلومة حالية لازم نتحقق منها.`;
    return 'سجل المحادثة السابق مش متوفر عندي حاليًا.';
}
module.exports = { recallConversation, recallResponse };
