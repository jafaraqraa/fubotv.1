'use strict';

function reciprocalRankFusion(rankedLists, { k = 60, limit = 40 } = {}) {
    const byId = new Map();
    rankedLists.forEach((list, sourceIndex) => (list || []).forEach((item, rank) => {
        const id = item.chunkId || item.id; if (!id) return;
        const entry = byId.get(id) || { ...item, chunkId: id, rrfScore: 0, ranks: {}, retrievalSources: [] };
        entry.rrfScore += 1 / (k + rank + 1); entry.ranks[sourceIndex] = rank + 1;
        entry.retrievalSources.push(item.retrievalSource || `list_${sourceIndex}`); byId.set(id, entry);
    }));
    return [...byId.values()].sort((a, b) => b.rrfScore - a.rrfScore || String(a.chunkId).localeCompare(String(b.chunkId))).slice(0, limit);
}

module.exports = { reciprocalRankFusion };
