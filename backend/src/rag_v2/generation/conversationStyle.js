'use strict';

const PALESTINIAN = /(?:بدي|بدنا|قديش|شو|هسا|هاد|هاي|عندكم|بتقدر|مش)/u;
const FORMAL_ARABIC = /(?:أريد|ماذا|هل يمكن|يرجى|من فضلك)/u;

function firstPhrase(text) { return String(text || '').trim().split(/[,،.!?؟\n]/u)[0].trim().slice(0, 60); }

function deriveConversationStyle(question, history = []) {
    const userTurns = [...history.filter(item => item?.role === 'user').map(item => String(item.content || '')), String(question || '')].slice(-6);
    const joined = userTurns.join(' ');
    const averageWords = userTurns.reduce((sum, item) => sum + item.trim().split(/\s+/u).filter(Boolean).length, 0) / Math.max(1, userTurns.length);
    const dialect = PALESTINIAN.test(joined) ? 'palestinian' : FORMAL_ARABIC.test(joined) ? 'formal_arabic' : 'neutral_arabic';
    return Object.freeze({
        dialect,
        verbosity: averageWords <= 7 ? 'very_short' : averageWords <= 16 ? 'short' : 'moderate',
        maxSentences: averageWords <= 7 ? 2 : 3,
        recentOpenings: history.filter(item => item?.role === 'assistant').slice(-4).map(item => firstPhrase(item.content)).filter(Boolean)
    });
}

function styleInstruction(style) {
    const dialect = style.dialect === 'palestinian' ? 'Use natural Palestinian everyday wording and mirror the user vocabulary without caricature.'
        : style.dialect === 'formal_arabic' ? 'Use clear modern Arabic matching the formal register.' : 'Use simple neutral conversational Arabic.';
    const avoided = style.recentOpenings.length ? `Do not begin with a recently used opening: ${style.recentOpenings.map(x => JSON.stringify(x)).join(', ')}.` : '';
    return `${dialect} Keep it ${style.verbosity.replace('_', ' ')} and normally within ${style.maxSentences} sentences. ${avoided} Do not append generic offers such as "هل ترغب بمساعدة أخرى؟". Do not pretend to be human or mention being an AI.`;
}

module.exports = { deriveConversationStyle, styleInstruction };
