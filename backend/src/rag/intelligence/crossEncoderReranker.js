/**
 * Modular pluggable interface for executing deep semantic rerank scoring.
 * Falls back gracefully to standard similarity candidates if no cross-encoder API is configured.
 */
async function rerankWithCrossEncoder(query, candidates) {
    if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
        return [];
    }

    const crossEncoderUrl = process.env.RAG_CROSS_ENCODER_URL;
    if (!crossEncoderUrl) {
        // Default back gracefully to standard candidates
        return candidates;
    }

    try {
        const response = await fetch(crossEncoderUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, documents: candidates.map(c => c.text) }),
            timeout: 2000 // 2 seconds timeout guard
        });

        if (response.ok) {
            const data = await response.json();
            if (data && Array.isArray(data.scores)) {
                return candidates.map((c, idx) => ({
                    ...c,
                    rerankScore: data.scores[idx] !== undefined ? data.scores[idx] : (c.semanticScore || c.score || 0)
                })).sort((a, b) => b.rerankScore - a.rerankScore);
            }
        }
    } catch (err) {
        console.warn('[RAG Cross-Encoder] Reranking microservice unreachable. Falling back safely:', err.message);
    }

    return candidates;
}

module.exports = {
    rerankWithCrossEncoder
};
