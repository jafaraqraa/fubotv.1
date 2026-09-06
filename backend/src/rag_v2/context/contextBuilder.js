'use strict';

function estimateTokens(text) { return Math.ceil(String(text || '').length / 3.2); }
function sourceLabel(chunk, index) {
    const detail = [chunk.title, chunk.versionNumber != null ? `v${chunk.versionNumber}` : null, (chunk.sectionPath || []).join(' › ') || null, chunk.pageNumber != null ? `p.${chunk.pageNumber}` : null].filter(Boolean).join(' — ');
    return { sourceId: `S${index + 1}`, label: `[S${index + 1}] ${detail}` };
}

function buildContext(candidates, config) {
    const selected = []; const seen = new Set(); let usedTokens = 0;
    for (const candidate of candidates || []) {
        const identity = `${candidate.documentVersionId}:${candidate.contentChecksum || candidate.chunkId}`;
        if (seen.has(identity)) continue;
        const cost = estimateTokens(candidate.originalText);
        if (usedTokens + cost > config.contextTokenBudget) continue;
        const source = sourceLabel(candidate, selected.length);
        selected.push({ ...candidate, ...source }); seen.add(identity); usedTokens += cost;
        if (selected.length >= config.maximumContextChunks) break;
    }
    return { selected, usedTokens, text: selected.map(c => `${c.label}\n${c.originalText}`).join('\n\n') };
}

module.exports = { estimateTokens, buildContext };
