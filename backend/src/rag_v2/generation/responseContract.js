'use strict';

const DECISIONS = new Set(['answer', 'partial_answer', 'clarify', 'abstain']);
const SUPPORT = new Set(['supported', 'partially_supported', 'unsupported']);

function validateResponseContract(value, allowedSources = []) {
    const errors = []; const allowed = new Set(allowedSources);
    if (!value || typeof value !== 'object') return { valid: false, errors: ['response must be an object'] };
    if (typeof value.answer !== 'string') errors.push('answer must be a string');
    if (!DECISIONS.has(value.decision)) errors.push('invalid decision');
    if (!Array.isArray(value.claims) || !Array.isArray(value.citations)) errors.push('claims and citations must be arrays');
    for (const claim of value.claims || []) {
        if (!SUPPORT.has(claim.support)) errors.push('invalid claim support');
        if (!Array.isArray(claim.source_ids)) errors.push('claim source_ids must be an array');
        for (const id of claim.source_ids || []) if (!allowed.has(id)) errors.push(`invented source id: ${id}`);
    }
    for (const citation of value.citations || []) if (!allowed.has(citation.source_id)) errors.push(`invented citation: ${citation.source_id}`);
    if (['answer', 'partial_answer'].includes(value.decision) && (value.claims || []).some(c => c.support === 'unsupported')) errors.push('answer contains unsupported claim');
    return { valid: errors.length === 0, errors };
}

module.exports = { validateResponseContract };
