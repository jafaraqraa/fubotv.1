'use strict';

const RELATION = Object.freeze({
    NOT_APPLICABLE: 'NOT_APPLICABLE',
    SUPPORTED: 'SUPPORTED',
    BLOCK: 'BLOCK'
});

const OUTCOME_STOP = new Set([
    'اذا', 'عند', 'قبل', 'بعد', 'مده', 'قيمه', 'اقل', 'اكثر', 'يزيد', 'تزيد',
    'يقل', 'تقل', 'او', 'من', 'في', 'على', 'الي', 'الى', 'هو', 'هي', 'يتم',
    'ساعه', 'ساعات', 'يوم', 'ايام', 'دقيقه', 'دقائق', 'hour', 'hours', 'day',
    'days', 'if', 'when', 'then', 'the', 'a', 'an', 'to', 'for', 'and', 'or'
]);

function normalize(value) {
    return String(value || '').normalize('NFKC').toLowerCase()
        .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
        .replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
        .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
        .replace(/[^\p{L}\p{N}%]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function outcomeTokens(value) {
    return normalize(value).split(/\s+/).map(token => {
        if (/^(?:و|ف|ب|بت|فبت)?(?:سترد|تسترد|استرداد|استرجاع)$/u.test(token)) return 'استرداد';
        return token;
    }).filter(token => token.length > 2
        && !OUTCOME_STOP.has(token) && !/^\d/u.test(token));
}

function hasNegation(value) {
    if (/ما\s+بيرجع/u.test(normalize(value))) return true;
    const tokens = new Set(normalize(String(value || '').replace(/^\s*لا\s*[,،]\s*/, '')).split(/\s+/));
    return ['لا', 'ليس', 'ليست', 'غير', 'لن', 'لم', 'بدون', 'دون', 'يفقد', 'مش']
        .some(token => tokens.has(token));
}

function outcomeOverlap(claim, outcome) {
    if (hasNegation(claim) !== hasNegation(outcome)) return 0;
    const expected = new Set(outcomeTokens(outcome));
    const actual = new Set(outcomeTokens(claim));
    if (!expected.size || !actual.size) return 0;
    return [...expected].filter(token => actual.has(token)).length / expected.size;
}

function satisfies(value, operator, threshold) {
    if (operator === '>') return value > threshold;
    if (operator === '>=') return value >= threshold;
    if (operator === '<') return value < threshold;
    if (operator === '<=') return value <= threshold;
    return value === threshold;
}

function policySegments(text) {
    return String(text || '').split(/\n+|(?<=[.!?؟؛])\s+(?=(?:[-*]\s*)?(?:اذا|إذا|عند|when|if|قبل))/iu)
        .map(value => value.trim()).filter(Boolean);
}

// Relation scope is independent of units: cancellation and late return may
// both use hours but may never prove each other's outcome.
const POLICY_TOPICS = [
    ['cancellation', /الغاء|الغيت|تلغي|ملغي|cancel/iu],
    ['late_return', /تاخير|تاخرت|متاخر|تتاخر|late|overdue/iu],
    ['delivery', /توصيل|شحن|delivery|shipping/iu],
    ['discount', /خصم|discount/iu],
    ['capacity', /سعه|capacity/iu],
    ['operator', /تشغيل|تشغل|اشغل|يشغل|مشغل|operat/iu],
    ['renter', /مستاجر|استاجر|تستاجر|renter|renting/iu]
];
function policyTopics(text) {
    const value = normalize(text);
    return POLICY_TOPICS.filter(([, pattern]) => pattern.test(value)).map(([name]) => name);
}
function samePolicy(left, right) {
    const a = policyTopics(left), b = policyTopics(right);
    return !a.length || !b.length || a.some(topic => b.includes(topic));
}
function duration(quantity) {
    const scale = { MINUTE: 1, HOUR: 60 }[quantity.unit];
    return scale ? { ...quantity, value: quantity.value * scale, unit: 'DURATION' } : quantity;
}
function conditionQuantities(text, extractQuantities) {
    const normalized = String(text).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
        .replace(/بـ?(?=\d)/gu, 'ب ');
    const range = normalized.match(/(?:من\s+|بين\s+)?(\d+(?:\.\d+)?)\s*(?:ساعة|ساعات|دقيقة|دقائق|يوم|أيام|hours?|minutes?|days?)?\s*(?:[-–—]|إلى|الى|و)\s*(\d+(?:\.\d+)?)\s*(ساعة|ساعات|دقيقة|دقائق|يوم|أيام|hours?|minutes?|days?)/iu);
    if (range) {
        const unit = extractQuantities(`${range[2]} ${range[3]}`)[0]?.unit;
        if (unit) return [
            { value: Number(range[1]), unit, operator: '>=' },
            { value: Number(range[2]), unit, operator: '<=' }
        ];
    }
    return extractQuantities(normalized).filter(item => item.operator !== '=');
}
function extractBranches(chunks, { tenantId, extractQuantities }) {
    const branches = [];
    for (const chunk of chunks || []) {
        if (tenantId && chunk.tenantId && String(chunk.tenantId) !== String(tenantId)) continue;
        let heading = '';
        for (const segment of policySegments(chunk.text)) {
            if (/^(?:#{1,6}\s|\d+[.)]\s+[^\d])/u.test(segment)) {
                heading = segment.replace(/^(?:#{1,6}\s*)?(?:\d+[.)]\s*)?/u, '');
                continue;
            }
            const delimiter = segment.search(/[:：]/u);
            if (delimiter < 0) {
                if (segment.length < 120 && !extractQuantities(segment).length
                    && (!heading || policyTopics(segment).length)) heading = segment;
                continue;
            }
            const conditionText = segment.slice(0, delimiter);
            const outcome = segment.slice(delimiter + 1).trim();
            const conditions = conditionQuantities(conditionText, extractQuantities);
            if (!conditions.length && !outcome && (!heading || policyTopics(conditionText).length)) heading = conditionText;
            if (conditions.length && outcome) branches.push({
                conditions, outcome, conditionText, scope: `${heading} ${conditionText}`,
                evidenceId: chunk.id || chunk.chunkId || null,
                tenantId: chunk.tenantId || null
            });
        }
    }
    return branches;
}

function evaluateConditionalPolicy({ claim, question, chunks, tenantId, extractQuantities }) {
    if (typeof extractQuantities !== 'function') throw new TypeError('extractQuantities is required');
    const branches = extractBranches(chunks, { tenantId, extractQuantities });
    if (branches.length < 2) return { relation: RELATION.NOT_APPLICABLE, branches };
    let userValues = extractQuantities(question || '').filter(item => item.operator === '=');
    // Compound durations are one input (four hours and one minute), not two
    // alternative values. Only combine explicit conjunctions, never alternatives.
    if (/\d+\s*(?:ساعات?|hours?)\s*(?:و|and)\s*(?:دقيقه|دقيقة|\d+\s*(?:دقائق|minutes?))/iu.test(question || '')) {
        const durations = userValues.filter(item => ['HOUR', 'MINUTE'].includes(item.unit));
        const implicitMinute = /(?:و|and)\s*(?:دقيقه|دقيقة)(?=[^\p{L}]|$)/u.test(question || '') ? 1 : 0;
        userValues = [{ value: durations.reduce((sum, item) => sum + duration(item).value, implicitMinute), unit: 'MINUTE', operator: '=' }];
    }
    const relevantCandidates = branches.filter(branch => samePolicy(question, branch.scope) && branch.conditions.some(condition =>
        userValues.some(value => duration(value).unit === duration(condition).unit)));
    // Overlapping chunks can repeat the same branch. They are corroboration,
    // not conflicting alternatives. Preserve the first original source ID.
    const seenBranches = new Set();
    const relevant = relevantCandidates.filter(branch => {
        const key = JSON.stringify([branch.tenantId, policyTopics(branch.scope), branch.conditions, normalize(branch.outcome)]);
        if (seenBranches.has(key)) return false;
        seenBranches.add(key);
        return true;
    });
    if (relevant.length < 2) return { relation: RELATION.NOT_APPLICABLE, branches };
    if (relevant.some(branch => !branch.evidenceId)) {
        return { relation: RELATION.BLOCK, reason: 'MISSING_EVIDENCE_ID', branches: relevant };
    }
    const applicable = relevant.filter(branch => branch.conditions.every(condition =>
        userValues.some(value => duration(value).unit === duration(condition).unit
            && satisfies(duration(value).value, condition.operator, duration(condition).value))));
    if (applicable.length !== 1) return {
        relation: RELATION.BLOCK,
        reason: applicable.length > 1 ? 'AMBIGUOUS_BRANCHES' : 'UNRESOLVED_BRANCH',
        branches: relevant,
        applicable
    };
    const active = applicable[0];
    const claimTopics = policyTopics(claim);
    if (claimTopics.length && !samePolicy(claim, active.scope)) return {
        relation: RELATION.BLOCK, reason: 'WRONG_POLICY_RELATION', active
    };
    let echoedConditions = extractQuantities(claim).filter(item => ['HOUR', 'MINUTE', 'DAY'].includes(item.unit));
    if (/\d+\s*(?:ساعات?|hours?)\s*(?:و|and)\s*(?:دقيقه|دقيقة|\d+\s*(?:دقائق|minutes?))/iu.test(claim || '')
        && echoedConditions.every(item => item.operator === '=')) {
        const implicitMinute = /(?:و|and)\s*(?:دقيقه|دقيقة)(?=[^\p{L}]|$)/u.test(claim || '') ? 1 : 0;
        echoedConditions = [{value:echoedConditions.reduce((sum,item)=>sum+duration(item).value,implicitMinute),unit:'MINUTE',operator:'='}];
    }
    if (echoedConditions.some(actual => !userValues.some(input => actual.operator === '=' && duration(actual).unit === duration(input).unit && duration(actual).value === duration(input).value)
        && !active.conditions.some(condition => actual.unit === condition.unit && actual.operator === condition.operator && actual.value === condition.value)
        && !extractQuantities(active.outcome).some(value => actual.unit === value.unit && actual.value === value.value && actual.operator === value.operator))) return {
        relation: RELATION.BLOCK, reason: 'CLAIM_CONDITION_DIFFERS_FROM_INPUT', active
    };
    const actualQuantities = extractQuantities(claim).filter(item => ['PERCENT', 'ILS', 'USD'].includes(item.unit));
    const expectedQuantities = extractQuantities(active.outcome);
    if (actualQuantities.some(actual => !expectedQuantities.some(expected =>
        actual.unit === expected.unit && actual.value === expected.value && actual.operator === expected.operator))) return {
        relation: RELATION.BLOCK, reason: 'WRONG_BRANCH_VALUE', active
    };
    const full = /كامل|بالكامل|full|entire/iu;
    const expectedPartial = expectedQuantities.some(item => item.unit === 'PERCENT' && item.value < 100);
    if (full.test(claim) && expectedPartial && !hasNegation(claim)) return {
        relation: RELATION.BLOCK, reason: 'WRONG_BRANCH_OUTCOME', active
    };
    const activeScore = outcomeOverlap(claim, active.outcome);
    const wrong = relevant.filter(branch => branch !== active)
        .map(branch => ({ branch, score: outcomeOverlap(claim, branch.outcome) }))
        .sort((left, right) => right.score - left.score)[0];
    if (wrong?.score >= 0.34 && wrong.score > activeScore + 0.08) return {
        relation: RELATION.BLOCK, reason: 'WRONG_BRANCH_OUTCOME', active,
        claimedBranch: wrong.branch, evidenceIds: [active.evidenceId]
    };
    if (activeScore >= 0.2) return {
        relation: RELATION.SUPPORTED, reason: 'ACTIVE_BRANCH_OUTCOME', active,
        evidenceIds: [active.evidenceId]
    };
    return { relation: RELATION.BLOCK, reason: 'OUTCOME_NOT_BOUND_TO_ACTIVE_BRANCH', active };
}

module.exports = { RELATION, extractBranches, evaluateConditionalPolicy, samePolicy, policyTopics };
