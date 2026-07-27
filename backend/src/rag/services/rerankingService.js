const { normalizeArabic } = require('../processing/arabicNormalizer');

/**
 * Deterministically re-ranks candidate chunks based on final score, exact phrase matching, and token coverage.
 * Removes duplicate text contents while preserving the highest relevance order.
 */
function rerankCandidates(candidates, query, dynamicTopK, similarityThreshold) {
    if (!candidates || candidates.length === 0) {
        return [];
    }

    const normalizedQuery = normalizeArabic(query).toLowerCase();

    // 1. Calculate refined re-ranking score for each candidate
    const scored = candidates.map(c => {
        let phraseMatchBonus = 0;
        const normalizedChunk = normalizeArabic(c.text).toLowerCase();

        // Exact phrase match bonus
        if (normalizedQuery.length > 3 && normalizedChunk.includes(normalizedQuery)) {
            phraseMatchBonus = 0.15;
        }

        // Token coverage bonus based on keywordScore
        const coverageBonus = c.keywordScore * 0.10;

        const rerankScore = c.finalScore + phraseMatchBonus + coverageBonus;

        return {
            ...c,
            coverageScore: c.keywordScore,
            rerankScore: Math.min(1.5, rerankScore) // Bound gracefully
        };
    });

    // 2. Filter candidates by semantic similarity threshold
    let filtered = scored.filter(c => c.semanticScore >= similarityThreshold);

    // 3. Deterministic sort: descending by rerankScore, resolving ties by chunkId
    filtered.sort((a, b) => {
        if (b.rerankScore !== a.rerankScore) {
            return b.rerankScore - a.rerankScore;
        }
        return String(a.chunkId).localeCompare(String(b.chunkId));
    });

    // 4. Deduplicate text (exact & near-identical normalized content)
    const seenTexts = new Set();
    const deduplicated = [];

    for (const item of filtered) {
        const normText = normalizeArabic(item.text).toLowerCase().replace(/\s+/g, '');
        if (!seenTexts.has(normText)) {
            seenTexts.add(normText);
            deduplicated.push(item);
        }
    }

    // 5. Slice up to Dynamic Top-K
    return deduplicated.slice(0, dynamicTopK);
}

module.exports = {
    rerankCandidates
};
