'use strict';

const crypto = require('crypto');
const { tokenize } = require('../retrieval/bm25Index');

function encodeSparse(text) {
    const counts = new Map();
    for (const token of tokenize(text)) {
        const index = crypto.createHash('sha256').update(token).digest().readUInt32BE(0) & 0x7fffffff;
        counts.set(index, (counts.get(index) || 0) + 1);
    }
    const entries = [...counts.entries()].sort((a, b) => a[0] - b[0]);
    const norm = Math.sqrt(entries.reduce((sum, [, value]) => sum + value * value, 0)) || 1;
    return { indices: entries.map(([index]) => index), values: entries.map(([, value]) => value / norm) };
}

module.exports = { encodeSparse };
