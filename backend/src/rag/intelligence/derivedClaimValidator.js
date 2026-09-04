const DERIVED_STATUS = Object.freeze({
    SUPPORTED: 'SUPPORTED_DERIVED',
    NOT_PROVEN: 'NOT_PROVEN'
});

const CURRENT = /(?:اليوم|الان|حاليا|هسا|today|now|currently)/iu;
// Match Arabic derivational families rather than one nominal surface form:
// خفض/تخفيض/ينخفض and زاد/زيادة, plus the common ارتفاع family.
const DISCOUNT = /(?:خصم|خف(?:ا)?[ضظ]|تخفيض|discount)/iu;
const INCREASE = /(?:زياد|يزيد|تزيد|ارتفا|يرتفع|ترتفع|اضاف|increase|markup)/iu;
const ADD = /(?:المجموع|الاجمالي|جمع|زائد|\+|total|sum|plus)/iu;
const SUBTRACT = /(?:الفرق|ناقص|طرح|-|difference|minus)/iu;
const MULTIPLY = /(?:ضرب|مرات|×|\*|multiply|times)/iu;
const DIVIDE = /(?:قسم|تقسيم|÷|\/|divide)/iu;
const SCOPE_LINK = /(?:على|لـ|ل|بنسبه|نسبه|يطبق|ينطبق|يشمل|خاص\s+ب|appl(?:y|ies)|for)/iu;

function normalize(text) {
    return String(text || '').normalize('NFKC').toLowerCase()
        .replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[إأآٱ]/g, 'ا')
        .replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
        .replace(/[^\p{L}\p{N}%+*/.-]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function unit(raw = '') {
    const value = normalize(raw);
    if (/%|بالمئ/.test(value)) return 'PERCENT';
    if (/شيكل|شيقل|شواكل|شواقل|ils/.test(value)) return 'ILS';
    if (/دولار|usd/.test(value)) return 'USD';
    if (/ساع/.test(value)) return 'HOUR';
    if (/دقيق/.test(value)) return 'MINUTE';
    if (/يوم|ايام/.test(value)) return 'DAY';
    return 'UNSPECIFIED';
}

function quantities(text) {
    const source = normalize(text);
    const pattern = /(?<![\p{L}\p{N}])(\d+(?:[.,]\d+)?)\s*(%|بالمئه|بالمائه|شيكل|شيقل|شواكل|شواقل|ils|دولار|دولارات|usd|ساعه|ساعات|دقيقه|دقائق|يوم|ايام)?(?![\p{L}\p{N}])/giu;
    return [...source.matchAll(pattern)].map(match => ({
        value: Number(match[1].replace(',', '.')),
        unit: unit(match[2]),
        index: match.index
    })).filter(item => Number.isFinite(item.value));
}

const GENERIC = new Set(['اذا', 'كان', 'كانت', 'كم', 'قديش', 'بصير', 'يصبح', 'السعر', 'قيمه', 'بعد', 'مع', 'عندي', 'هو', 'هي', 'من', 'في', 'على', 'فقط']);
function scopeTokens(text) {
    return normalize(text).split(/\s+/).map(token => {
        let value = token.startsWith('ال') && token.length > 4 ? token.slice(2) : token;
        if (value.endsWith('ات') && value.length > 4) value = value.slice(0, -2);
        if (value.endsWith('ه') && value.length > 3) value = value.slice(0, -1);
        return value;
    }).filter(token => token.length > 2
        && !GENERIC.has(token) && !/^\d/.test(token)
        && !['شيقل', 'شيكل', 'دولار', 'خصم', 'تخفيض', 'زياده'].includes(token));
}

function chunkId(chunk) { return String(chunk?.id || chunk?.chunkId || '').trim(); }
function chunkTenant(chunk) { return String(chunk?.tenantId || chunk?.payload?.tenantId || '').trim(); }

function temporallyValid(chunk, question, now = new Date()) {
    if (!CURRENT.test(normalize(question))) return true;
    const from = chunk.validFrom || chunk.payload?.validFrom;
    const to = chunk.validTo || chunk.payload?.validTo;
    if (!from && !to) return true;
    const instant = now instanceof Date ? now : new Date(now);
    if (from && instant < new Date(`${from}T00:00:00Z`)) return false;
    if (to && instant > new Date(`${to}T23:59:59Z`)) return false;
    return true;
}

function trustedChunks(chunks, tenantId, question, now) {
    if (!Array.isArray(chunks) || !chunks.length) return [];
    const owners = new Set(chunks.map(chunkTenant).filter(Boolean));
    if (owners.size > 1) return [];
    return chunks.filter(chunk => chunkId(chunk)
        && (!tenantId || chunkTenant(chunk) === String(tenantId))
        && temporallyValid(chunk, question, now));
}

function detectOperation(text) {
    if (DISCOUNT.test(text)) return 'PERCENT_DISCOUNT';
    // The claim may name the increase while the percentage itself lives only
    // in trusted evidence; validatePercent still requires and binds that rate.
    if (INCREASE.test(text)) return 'PERCENT_INCREASE';
    if (ADD.test(text)) return 'ADD';
    if (SUBTRACT.test(text)) return 'SUBTRACT';
    if (MULTIPLY.test(text)) return 'MULTIPLY';
    if (DIVIDE.test(text)) return 'DIVIDE';
    return null;
}

function close(left, right) { return Math.abs(left - right) <= 0.01; }

function validatePercent({ operation, claim, question, chunks }) {
    // A percentage may be mentioned after the resulting amount. Select the
    // last monetary result, not simply the last numeric token in the sentence.
    const output = quantities(claim).filter(item => ['ILS', 'USD'].includes(item.unit)).at(-1);
    if (!output) return null;
    const userValues = quantities(question).filter(item => item.unit === output.unit);
    const bases = [];
    for (const chunk of chunks) for (const value of quantities(chunk.text)) {
        if (value.unit === output.unit) bases.push({ ...value, source: 'EVIDENCE', evidenceId: chunkId(chunk), chunk });
    }
    for (const value of userValues) bases.push({ ...value, source: 'USER_INPUT', evidenceId: null });
    const targetTokens = new Set(scopeTokens(`${question} ${claim}`));
    const discounts = [];
    for (const chunk of chunks) {
        if (!(operation === 'PERCENT_DISCOUNT' ? DISCOUNT : INCREASE).test(chunk.text)) continue;
        if (!SCOPE_LINK.test(chunk.text)) continue;
        const evidenceTokens = new Set(scopeTokens(chunk.text));
        const scopeOverlap = [...targetTokens].some(token => evidenceTokens.has(token));
        if (!scopeOverlap) continue;
        for (const value of quantities(chunk.text).filter(item => item.unit === 'PERCENT')) {
            discounts.push({ ...value, evidenceId: chunkId(chunk), chunk });
        }
    }
    for (const base of bases) for (const percent of discounts) {
        if (base.source === 'EVIDENCE') {
            const baseTokens = new Set(scopeTokens(base.chunk.text));
            if (![...targetTokens].some(token => baseTokens.has(token))) continue;
        }
        const expected = operation === 'PERCENT_DISCOUNT'
            ? base.value * (1 - percent.value / 100)
            : base.value * (1 + percent.value / 100);
        if (!close(expected, output.value)) continue;
        const evidenceIds = [...new Set([base.evidenceId, percent.evidenceId].filter(Boolean))];
        return {
            operation,
            inputs: [
                { value: base.value, unit: base.unit, evidenceId: base.evidenceId, source: base.source, semanticRole: 'BASE_VALUE' },
                { value: percent.value, unit: 'PERCENT', evidenceId: percent.evidenceId, source: 'EVIDENCE', semanticRole: operation === 'PERCENT_DISCOUNT' ? 'DISCOUNT' : 'INCREASE' }
            ],
            scopeEvidenceIds: [percent.evidenceId], evidenceIds,
            expectedResult: { value: Number(expected.toFixed(2)), unit: output.unit }
        };
    }
    return null;
}

function validateBinary({ operation, claim, question, chunks }) {
    const output = quantities(claim).at(-1);
    if (!output) return null;
    const inputs = [];
    const targetTokens = new Set(scopeTokens(`${question} ${claim}`));
    for (const chunk of chunks) for (const value of quantities(chunk.text)) {
        const evidenceTokens = new Set(scopeTokens(chunk.text));
        if (![...targetTokens].some(token => evidenceTokens.has(token))) continue;
        if (value.unit === output.unit || value.unit === 'UNSPECIFIED') {
            inputs.push({ ...value, evidenceId: chunkId(chunk), source: 'EVIDENCE', chunk });
        }
    }
    for (const value of quantities(question)) {
        if (value.unit === output.unit || value.unit === 'UNSPECIFIED') {
            inputs.push({ ...value, evidenceId: null, source: 'USER_INPUT' });
        }
    }
    for (let i = 0; i < inputs.length; i++) for (let j = i + 1; j < inputs.length; j++) {
        const left = inputs[i], right = inputs[j];
        if (left.source === 'EVIDENCE' && right.source === 'EVIDENCE'
            && left.evidenceId === right.evidenceId && chunks.length > 1) continue;
        const compatible = ['ADD', 'SUBTRACT'].includes(operation)
            ? left.unit === output.unit && right.unit === output.unit
            : left.unit === output.unit && right.unit === 'UNSPECIFIED';
        if (!compatible) continue;
        let expected;
        if (operation === 'ADD') expected = left.value + right.value;
        if (operation === 'SUBTRACT') expected = left.value - right.value;
        if (operation === 'MULTIPLY') expected = left.value * right.value;
        if (operation === 'DIVIDE' && right.value !== 0) expected = left.value / right.value;
        if (!Number.isFinite(expected) || !close(expected, output.value)) continue;
        const evidenceIds = [...new Set([left.evidenceId, right.evidenceId].filter(Boolean))];
        return { operation, inputs: [left, right].map((item, index) => ({
            value: item.value, unit: item.unit, evidenceId: item.evidenceId,
            source: item.source, semanticRole: `OPERAND_${index + 1}`
        })), scopeEvidenceIds: [], evidenceIds,
        expectedResult: { value: Number(expected.toFixed(2)), unit: output.unit } };
    }
    return null;
}

function validateDerivedClaim({ claim, question = '', chunks = [], tenantId = '', now = new Date() }) {
    const operation = detectOperation(`${question} ${claim}`);
    if (!operation) return { status: DERIVED_STATUS.NOT_PROVEN, reason: 'not_derived' };
    const trusted = trustedChunks(chunks, tenantId, question, now);
    if (!trusted.length) return { status: DERIVED_STATUS.NOT_PROVEN, reason: 'untrusted_or_missing_provenance' };
    const provenance = operation.startsWith('PERCENT_')
        ? validatePercent({ operation, claim, question, chunks: trusted })
        : validateBinary({ operation, claim, question, chunks: trusted });
    if (!provenance || !provenance.evidenceIds.length) {
        return { status: DERIVED_STATUS.NOT_PROVEN, reason: 'premises_not_proven' };
    }
    return { status: DERIVED_STATUS.SUPPORTED, provenance };
}

module.exports = { DERIVED_STATUS, validateDerivedClaim };
