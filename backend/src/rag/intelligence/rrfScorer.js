/**
 * Combines and scores multi-ranked query lists cleanly using Reciprocal Rank Fusion (RRF).
 */
function reciprocalRankFusion(lists, k = 60) {
    if (!lists || !Array.isArray(lists) || lists.length === 0) return [];

    const chunkMap = new Map();

    lists.forEach(list => {
        if (!Array.isArray(list)) return;

        list.forEach((chunk, rank) => {
            const id = chunk.chunkId || chunk.id || chunk.text;
            if (!id) return;

            // Reciprocal Rank Fusion formula: 1 / (k + rank + 1)
            const scoreContribution = 1.0 / (k + rank + 1);

            if (chunkMap.has(id)) {
                const existing = chunkMap.get(id);
                existing.rrfScore += scoreContribution;
                existing.listsIncluded++;
                // Retain max similarity/semantic score if available
                if (chunk.semanticScore > existing.semanticScore) {
                    existing.semanticScore = chunk.semanticScore;
                }
            } else {
                chunkMap.set(id, {
                    ...chunk,
                    chunkId: id,
                    rrfScore: scoreContribution,
                    listsIncluded: 1
                });
            }
        });
    });

    // Sort fused candidates descending by their accumulated RRF score
    return Array.from(chunkMap.values()).sort((a, b) => b.rrfScore - a.rrfScore);
}

module.exports = {
    reciprocalRankFusion
};
