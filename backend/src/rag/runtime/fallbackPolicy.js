const { getConfig } = require('../config/ragConfig');

const RETRIEVAL_MODE = Object.freeze({
    NORMAL: 'NORMAL',
    RERANK_DEGRADED: 'RERANK_DEGRADED',
    CACHE_ONLY: 'CACHE_ONLY',
    REPLICA: 'REPLICA',
    DEGRADED: 'DEGRADED',
    FAILED: 'FAILED'
});

const metrics = {
    rag_fallback_total: 0,
    rag_fallback_by_reason: Object.create(null),
    rag_fallback_success_total: 0,
    rag_fallback_failure_total: 0,
    rag_degraded_mode_total: 0,
    rag_open_domain_blocked_total: 0
};

class RagFallbackError extends Error {
    constructor(message, options = {}) {
        super(message);
        this.name = 'RagFallbackError';
        this.code = options.code || 'RAG_PIPELINE_UNAVAILABLE';
        this.dependency = options.dependency || 'unknown';
        this.retryable = options.retryable === true;
        this.retrievalMode = RETRIEVAL_MODE.FAILED;
        if (options.cause) this.cause = options.cause;
    }
}

function enabled(name, fallback = false) {
    const value = getConfig(name);
    if (value === undefined || value === null || value === '') return fallback;
    return ['true', '1'].includes(String(value).toLowerCase());
}

function recordFallback({ reason, dependency, tenantId, mode, success, durationMs = 0 }) {
    metrics.rag_fallback_total++;
    metrics.rag_fallback_by_reason[reason] =
        (metrics.rag_fallback_by_reason[reason] || 0) + 1;
    if (success) metrics.rag_fallback_success_total++;
    else metrics.rag_fallback_failure_total++;
    if (mode !== RETRIEVAL_MODE.NORMAL && mode !== RETRIEVAL_MODE.CACHE_ONLY) {
        metrics.rag_degraded_mode_total++;
    }
    console.log('[RAG Fallback]', {
        trigger: reason,
        dependency,
        tenantId,
        retrievalMode: mode,
        durationMs: Number(Number(durationMs || 0).toFixed(1)),
        success: Boolean(success)
    });
}

function createMetadata(overrides = {}) {
    return {
        retrievalMode: overrides.retrievalMode || RETRIEVAL_MODE.NORMAL,
        degraded: overrides.degraded === true,
        degradedReasons: [...(overrides.degradedReasons || [])],
        confidencePenalty: Math.max(0, Math.min(1,
            Number(overrides.confidencePenalty) || 0)),
        cacheHit: overrides.cacheHit === true,
        confidence: Number.isFinite(Number(overrides.confidence))
            ? Number(overrides.confidence) : null
    };
}

function assertPromptGuardAvailable() {
    if (!enabled('RAG_INJECTION_GUARD_ENABLED', true)
        || !enabled('RAG_INJECTION_SCAN_ON_RETRIEVAL', true)) {
        if (!enabled('RAG_FAIL_OPEN_ON_PROMPT_GUARD', false)) {
            throw new RagFallbackError(
                'RAG Prompt Injection Guard is unavailable. Retrieval blocked.',
                { code: 'RAG_PROMPT_GUARD_UNAVAILABLE', dependency: 'prompt_guard' }
            );
        }
        recordFallback({
            reason: 'prompt_guard_fail_open',
            dependency: 'prompt_guard',
            mode: RETRIEVAL_MODE.DEGRADED,
            success: true
        });
    }
}

function shouldBlockOpenDomain({ knowledgeBaseOnly } = {}) {
    const kbOnly = knowledgeBaseOnly === undefined
        ? enabled('RAG_KNOWLEDGE_BASE_ONLY', true)
        : knowledgeBaseOnly === true;
    return kbOnly || !enabled('RAG_ALLOW_OPEN_DOMAIN', false);
}

function blockOpenDomain(tenantId, reason = 'insufficient_context') {
    metrics.rag_open_domain_blocked_total++;
    console.log('[RAG Open Domain] Blocked', { tenantId, reason });
    return 'لا تتوفر لدي معلومات مؤكدة حول هذا الموضوع حالياً. يمكنك التواصل مع فريق الدعم للحصول على التفاصيل.';
}

function validateWithPolicy({ answer, context, validator, tenantId }) {
    try {
        return validator(answer, context);
    } catch (error) {
        const failOpen = enabled('RAG_FAIL_OPEN_ON_VALIDATOR', false);
        recordFallback({
            reason: 'validator_unavailable',
            dependency: 'answer_validator',
            tenantId,
            mode: failOpen ? RETRIEVAL_MODE.DEGRADED : RETRIEVAL_MODE.FAILED,
            success: failOpen
        });
        if (failOpen) return answer;
        throw new RagFallbackError('Answer Validator unavailable. Response blocked.', {
            code: 'RAG_VALIDATOR_UNAVAILABLE',
            dependency: 'answer_validator',
            cause: error
        });
    }
}

function getMetrics() {
    return {
        ...metrics,
        rag_fallback_by_reason: { ...metrics.rag_fallback_by_reason }
    };
}

function resetForTests() {
    metrics.rag_fallback_total = 0;
    metrics.rag_fallback_success_total = 0;
    metrics.rag_fallback_failure_total = 0;
    metrics.rag_degraded_mode_total = 0;
    metrics.rag_open_domain_blocked_total = 0;
    Object.keys(metrics.rag_fallback_by_reason)
        .forEach(key => delete metrics.rag_fallback_by_reason[key]);
}

module.exports = {
    RETRIEVAL_MODE,
    RagFallbackError,
    enabled,
    recordFallback,
    createMetadata,
    assertPromptGuardAvailable,
    shouldBlockOpenDomain,
    blockOpenDomain,
    validateWithPolicy,
    getMetrics,
    resetForTests
};
