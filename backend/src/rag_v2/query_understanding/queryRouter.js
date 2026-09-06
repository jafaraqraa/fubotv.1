'use strict';

const CASUAL = /^(?:مرحبا|اهلا|السلام عليكم|hello|hi)[!. ؟?]*$/iu;
const CONTEXT_DEPENDENT = /^(?:(?:و|طيب|طب|and|what about)|(?:قديش|بكم|كم|متى|وين|اين|كيف|ليش|هل)|(?:الخيارات|التفاصيل|احكي(?:لي)?\s+الخيارات|شو\s+الخيارات))[؟?!. ]*$|^و?(?:قديش|بكم|كم)\s+(?:سعر|حق)(?:ها|ه)[؟?!. ]*$|(?:هذا|هذه|هاد|هاي|اياه|اياها|الثاني|الاول|منه|منها|الها|اله)(?:[؟?!. ]|$)/iu;
const ATTRIBUTE_FOLLOWUP = /^(?:و؟?\s*)?(?:قديش|بكم|كم|شو)\s+(?:ال)?(?:سعر|حق|تركيب|رسوم|مدة|كفالة|ضمان|مقاس|لون)(?:ها|ه)?[؟?!. ]*$/iu;

function isContextDependent(value) { return CONTEXT_DEPENDENT.test(String(value || '').trim()); }

function priorTopic(history, current) {
    const items = [...history];
    if (items.at(-1)?.role === 'user' && String(items.at(-1).content || '').trim() === current) items.pop();
    return items.slice(-16).reverse().find(item => item?.role === 'user'
        && !CASUAL.test(String(item.content || '').trim())
        && !isContextDependent(item.content))?.content || null;
}

function routeQuery(question, history = []) {
    const value = String(question || '').trim();
    if (!value) return { decision: 'reject', confidence: 1, standaloneQuestion: '' };
    const casual = CASUAL.test(value);
    const ambiguous = /^(?:و)?(?:كم|قديش|متى|وين|هل هو|هل هي|شو عنها)(?:\s+(?:سعر|حق)(?:ها|ه))?[؟? ]*$/u.test(value);
    const injection = /(ignore (all|previous) instructions|تجاهل (كل|التعليمات)|system prompt|اكشف.*سر)/iu.test(value);
    if (injection) return { decision: 'reject', confidence: .99, standaloneQuestion: value };
    if (casual) return { decision: 'casual', confidence: .95, standaloneQuestion: value };
    const topic = priorTopic(history, value);
    if (ambiguous && !topic) return { decision: 'clarify', confidence: .9, standaloneQuestion: value };
    if (isContextDependent(value) && !topic) return { decision: 'clarify', confidence: .9, standaloneQuestion: value };
    const followUp = (isContextDependent(value) || ATTRIBUTE_FOLLOWUP.test(value)) && topic;
    return { decision: 'knowledge', confidence: followUp ? .75 : .85, isFollowUp: Boolean(followUp),
        contextTopic: followUp ? topic : null,
        standaloneQuestion: followUp ? `${topic} — ${value}` : value, originalQuestion: value };
}

module.exports = { routeQuery, isContextDependent, priorTopic };
