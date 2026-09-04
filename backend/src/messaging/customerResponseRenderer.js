const CUSTOMER_SAFE_NO_ANSWER = 'المعلومة مش متوفرة عندي حاليًا.';

const EXACT_NO_ANSWER = /^\s*NO[_ ]ANSWER(?:\s*[:：]\s*.*)?\s*$/isu;
const CLARIFY_PREFIX = /^\s*CLARIFY\s*[:：]\s*/iu;
const TECHNICAL_FALLBACK = /^\s*I couldn't verify this information from the available knowledge\.?\s*$/iu;
const ARABIC_TECHNICAL_FALLBACK = /^\s*لا تتوفر لدي معلومات مؤكدة حول هذا الموضوع حالياً?\.?\s*(?:يمكنك التواصل مع فريق الدعم للحصول على التفاصيل\.)?\s*$/iu;
const VERIFIED_EVIDENCE_MARKER = /(?:\[\s*)?VERIFIED_EVIDENCE(?:\s*\])?\s*[:：]?\s*/giu;
const INTERNAL_EVIDENCE_REFERENCE = /\s*\[(?:evidence|chunk|document)[_-]?(?:id)?\s*[:=]\s*[^\]]+\]/giu;

function sanitizeKnownInternalOutput(value) {
    const text = String(value || '').trim();
    if (EXACT_NO_ANSWER.test(text) || TECHNICAL_FALLBACK.test(text)
        || ARABIC_TECHNICAL_FALLBACK.test(text)) {
        return CUSTOMER_SAFE_NO_ANSWER;
    }

    return text
        .replace(CLARIFY_PREFIX, '')
        .replace(VERIFIED_EVIDENCE_MARKER, '')
        .replace(INTERNAL_EVIDENCE_REFERENCE, '')
        .trim();
}

function renderCustomerResponse({ decision, answer, clarificationQuestion } = {}) {
    const normalizedDecision = String(decision || '').trim().toUpperCase();

    if (normalizedDecision === 'NO_ANSWER') return CUSTOMER_SAFE_NO_ANSWER;

    if (normalizedDecision === 'CLARIFY') {
        const clarification = clarificationQuestion || answer;
        const rendered = sanitizeKnownInternalOutput(clarification);
        return rendered || CUSTOMER_SAFE_NO_ANSWER;
    }

    return sanitizeKnownInternalOutput(answer) || CUSTOMER_SAFE_NO_ANSWER;
}

module.exports = {
    CUSTOMER_SAFE_NO_ANSWER,
    renderCustomerResponse,
    sanitizeKnownInternalOutput
};
