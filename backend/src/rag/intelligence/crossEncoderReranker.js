/**
 * Modular pluggable interface for executing deep semantic rerank scoring.
 * Falls back gracefully to standard similarity candidates if no cross-encoder API is configured.
 */
const {
    RETRIEVAL_MODE,
    RagFallbackError,
    enabled,
    recordFallback
} = require('../runtime/fallbackPolicy');

async function rerankWithCrossEncoderDetailed(query, candidates, options = {}) {
    if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
        return {
            candidates: [],
            metadata: { retrievalMode: RETRIEVAL_MODE.NORMAL, degraded: false }
        };
    }

    const crossEncoderUrl = process.env.RAG_CROSS_ENCODER_URL;
    if (!crossEncoderUrl) {
        return {
            candidates,
            metadata: { retrievalMode: RETRIEVAL_MODE.NORMAL, degraded: false, configured: false }
        };
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const abortParent = () => controller.abort();
    options.signal?.addEventListener('abort', abortParent, { once: true });
    try {
        const response = await fetch(crossEncoderUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, documents: candidates.map(c => c.text) }),
            signal: controller.signal
        });
        if (response.ok) {
            const data = await response.json();
            if (data && Array.isArray(data.scores)
                && data.scores.length === candidates.length) {
                return {
                    candidates: candidates.map((c, idx) => ({
                    ...c,
                    rerankScore: Number(data.scores[idx])
                    })).sort((a, b) => b.rerankScore - a.rerankScore),
                    metadata: { retrievalMode: RETRIEVAL_MODE.NORMAL, degraded: false, configured: true }
                };
            }
        }
        throw new Error(`Invalid reranker response (${response.status}).`);
    } catch (error) {
        if (!enabled('RAG_ENABLE_FALLBACK', true)
            || !enabled('RAG_ALLOW_RERANK_FALLBACK', true)) {
            throw new RagFallbackError('Reranker unavailable and fallback is disabled.', {
                code: 'RAG_RERANKER_UNAVAILABLE',
                dependency: 'reranker',
                retryable: true,
                cause: error
            });
        }

        const confidencePenalty = 0.18;
        const degradedCandidates = candidates.map(candidate => ({
            ...candidate,
            finalScore: Math.max(0,
                Number(candidate.finalScore ?? candidate.semanticScore ?? candidate.score ?? 0)
                * (1 - confidencePenalty)),
            rerankDegraded: true
        }));
        recordFallback({
            reason: error.name === 'AbortError' ? 'reranker_timeout' : 'reranker_unavailable',
            dependency: 'reranker',
            tenantId: options.tenantId,
            mode: RETRIEVAL_MODE.RERANK_DEGRADED,
            success: true,
            durationMs: Date.now() - startedAt
        });
        return {
            candidates: degradedCandidates,
            metadata: {
                retrievalMode: RETRIEVAL_MODE.RERANK_DEGRADED,
                degraded: true,
                degradedReasons: ['reranker_unavailable'],
                confidencePenalty
            }
        };
    } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', abortParent);
    }
}

async function rerankWithCrossEncoder(query, candidates, options = {}) {
    const result = await rerankWithCrossEncoderDetailed(query, candidates, options);
    return result.candidates;
}

module.exports = {
    rerankWithCrossEncoder,
    rerankWithCrossEncoderDetailed
};
