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
        .replace(/[^\p{L}\p{N}%]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function outcomeTokens(value) {
    return normalize(value).split(/\s+/).filter(token => token.length > 2
        && !OUTCOME_STOP.has(token) && !/^\d/u.test(token));
}

function hasNegation(value) {
    const tokens = new Set(normalize(value).split(/\s+/));
    return ['لا', 'ليس', 'ليست', 'غير', 'لن', 'لم', 'بدون', 'دون', 'يفقد']
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

function extractBranches(chunks, { tenantId, extractQuantities }) {
    const branches = [];
    for (const chunk of chunks || []) {
        if (tenantId && chunk.tenantId && String(chunk.tenantId) !== String(tenantId)) continue;
        for (const segment of policySegments(chunk.text)) {
            const delimiter = segment.search(/[:：]/u);
            if (delimiter < 0) continue;
            const conditionText = segment.slice(0, delimiter);
            const outcome = segment.slice(delimiter + 1).trim();
            // Arabic may attach the preposition "بـ" directly to a boundary.
            // Normalize it inside this guard only, leaving baseline quantity
            // extraction untouched for ordinary identifiers and claims.
            const guardConditionText = conditionText.replace(/بـ?(?=\d)/gu, 'ب ');
            const conditions = extractQuantities(guardConditionText).filter(item => item.operator !== '=');
            if (conditions.length && outcome) branches.push({
                conditions, outcome, evidenceId: chunk.id || chunk.chunkId || null,
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
    const userValues = extractQuantities(question || '').filter(item => item.operator === '=');
    const relevant = branches.filter(branch => branch.conditions.some(condition =>
        userValues.some(value => value.unit === condition.unit)));
    if (relevant.length < 2) return { relation: RELATION.NOT_APPLICABLE, branches };
    if (relevant.some(branch => !branch.evidenceId)) {
        return { relation: RELATION.BLOCK, reason: 'MISSING_EVIDENCE_ID', branches: relevant };
    }
    const applicable = relevant.filter(branch => branch.conditions.every(condition =>
        userValues.some(value => value.unit === condition.unit
            && satisfies(value.value, condition.operator, condition.value))));
    if (applicable.length !== 1) return {
        relation: RELATION.BLOCK,
        reason: applicable.length > 1 ? 'AMBIGUOUS_BRANCHES' : 'UNRESOLVED_BRANCH',
        branches: relevant,
        applicable
    };
    const active = applicable[0];
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

module.exports = { RELATION, extractBranches, evaluateConditionalPolicy };
