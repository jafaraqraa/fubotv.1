'use strict';

const { validateResponseContract } = require('../generation/responseContract');

function verifyClaims(response, selected) {
    const sourceMap = new Map(selected.map(source => [source.sourceId, source]));
    const contract = validateResponseContract(response, [...sourceMap.keys()]);
    const errors = [...contract.errors];
    for (const claim of response?.claims || []) {
        if (claim.support === 'unsupported') continue;
        if (!(claim.source_ids || []).length) errors.push(`material claim has no citation: ${claim.text || ''}`);
        for (const id of claim.source_ids || []) if (!sourceMap.get(id)?.originalText) errors.push(`citation has no evidence text: ${id}`);
    }
    return { valid: errors.length === 0, errors };
}

module.exports = { verifyClaims };
