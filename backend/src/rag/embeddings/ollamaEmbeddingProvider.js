const { getConfig } = require('../config/ragConfig');
const { performance } = require('perf_hooks');
const {
    RagTransientError, RagPermanentError, RagCancelledError,
    withTimeout, retryOperation, runBoundedOrdered
} = require('../runtime/asyncControl');
const metrics = require('../runtime/ragMetrics');
const embeddingSemaphore = require('../runtime/embeddingSemaphore');

function configNumber(key, fallback) {
    const value = Number(getConfig(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function mapOllamaFailure(error, operation, context = {}) {
    if (error?.code?.startsWith('RAG_')) return error;
    const code = error?.cause?.code || error?.code;
    const transientCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT']);
    if (transientCodes.has(code)) {
        return new RagTransientError(`Ollama connection failed during ${operation}.`, {
            operation, code: 'RAG_OLLAMA_CONNECTION_FAILED', cause: error, ...context
        });
    }
    return error;
}

function validateEmbedding(vector, expectedDimension, context = {}) {
    if (!Array.isArray(vector) || vector.length === 0) {
        throw new RagPermanentError('Ollama returned an empty or malformed embedding.', {
            operation: 'embedding_validation', code: 'RAG_INVALID_EMBEDDING', ...context
        });
    }
    if (expectedDimension && vector.length !== expectedDimension) {
        throw new RagPermanentError(
            `Embedding dimension mismatch: expected ${expectedDimension}, received ${vector.length}.`,
            { operation: 'embedding_validation', code: 'RAG_EMBEDDING_DIMENSION_MISMATCH', ...context }
        );
    }
    if (vector.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
        throw new RagPermanentError('Embedding contains non-finite values.', {
            operation: 'embedding_validation', code: 'RAG_EMBEDDING_NON_FINITE', ...context
        });
    }
    if (vector.every(value => value === 0)) {
        throw new RagPermanentError('Ollama returned an all-zero embedding.', {
            operation: 'embedding_validation', code: 'RAG_EMBEDDING_ALL_ZERO', ...context
        });
    }
    return vector;
}

async function checkModelAvailability(options = {}) {
    const operation = 'ollama_health';
    try {
        const response = await withTimeout({
            operation,
            timeoutMs: configNumber('RAG_OLLAMA_HEALTH_TIMEOUT_MS', 5000),
            parentSignal: options.signal,
            errorCode: 'RAG_OLLAMA_HEALTH_TIMEOUT',
            fn: signal => fetch(`${getConfig('OLLAMA_BASE_URL')}/api/tags`, { signal })
        });
        if (!response.ok) return false;
        const data = await response.json();
        const modelName = getConfig('RAG_EMBEDDING_MODEL');
        return Array.isArray(data?.models)
            && data.models.some(model => model.name === modelName || model.name.startsWith(`${modelName}:`));
    } catch (error) {
        if (error.code === 'RAG_OLLAMA_HEALTH_TIMEOUT') metrics.increment('dependencyTimeoutsTotal');
        if (error instanceof RagCancelledError || error.code?.startsWith('RAG_')) throw error;
        throw mapOllamaFailure(error, operation);
    }
}

async function listModels(options = {}) {
    const response = await withTimeout({
        operation: 'ollama_health',
        timeoutMs: configNumber('RAG_OLLAMA_HEALTH_TIMEOUT_MS', 5000),
        parentSignal: options.signal,
        errorCode: 'RAG_OLLAMA_HEALTH_TIMEOUT',
        fn: signal => fetch(`${getConfig('OLLAMA_BASE_URL')}/api/tags`, { signal })
    });
    if (!response.ok) {
        throw new RagPermanentError(`Ollama models request failed (HTTP ${response.status}).`, {
            operation: 'ollama_health', code: `RAG_OLLAMA_HTTP_${response.status}`
        });
    }
    const data = await response.json();
    return Array.isArray(data?.models) ? data.models.map(model => model.name) : [];
}

async function generateOne(prompt, options = {}) {
    const operation = 'ollama_embedding';
    const context = {
        tenantId: options.tenantId,
        documentId: options.documentId,
        indexVersionId: options.indexVersionId
    };
    if (typeof prompt !== 'string' || !prompt.trim()) {
        throw new RagPermanentError('Embedding input is empty.', {
            operation, code: 'RAG_INVALID_EMBEDDING_INPUT', ...context
        });
    }
    const startedAt = performance.now();
    let succeeded = false;
    console.log('[RAG Ollama] Embedding started');
    const release = await embeddingSemaphore.acquire(
        configNumber('RAG_EMBEDDING_CONCURRENCY', 4),
        options.signal
    );
    try {
        const result = await retryOperation({
            operation,
            signal: options.signal,
            maxAttempts: configNumber('RAG_RETRY_MAX_ATTEMPTS', 3),
            baseDelayMs: configNumber('RAG_RETRY_BASE_DELAY_MS', 300),
            maxDelayMs: configNumber('RAG_RETRY_MAX_DELAY_MS', 3000),
            fn: async attempt => {
                if (attempt > 1) metrics.increment('dependencyRetriesTotal');
                try {
                    const response = await withTimeout({
                        operation,
                        timeoutMs: configNumber('RAG_OLLAMA_EMBED_TIMEOUT_MS', 30000),
                        parentSignal: options.signal,
                        errorCode: 'RAG_OLLAMA_TIMEOUT',
                        context,
                        fn: signal => fetch(`${getConfig('OLLAMA_BASE_URL')}/api/embeddings`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                model: getConfig('RAG_EMBEDDING_MODEL'),
                                prompt,
                                options: { keep_alive: '10m' }
                            }),
                            signal
                        })
                    });
                    if (response.status === 404) {
                        throw new RagPermanentError('Configured Ollama model is unavailable.', {
                            operation, code: 'RAG_OLLAMA_MODEL_UNAVAILABLE', ...context
                        });
                    }
                    if (response.status === 429 || [502, 503, 504].includes(response.status)) {
                        throw new RagTransientError(`Transient Ollama HTTP ${response.status}.`, {
                            operation, code: `RAG_OLLAMA_HTTP_${response.status}`, ...context
                        });
                    }
                    if (!response.ok) {
                        throw new RagPermanentError(`Ollama rejected the embedding request (HTTP ${response.status}).`, {
                            operation, code: `RAG_OLLAMA_HTTP_${response.status}`, ...context
                        });
                    }
                    let data;
                    try { data = await response.json(); } catch (error) {
                        throw new RagPermanentError('Malformed JSON response from Ollama.', {
                            operation, code: 'RAG_OLLAMA_MALFORMED_RESPONSE', cause: error, ...context
                        });
                    }
                    const expectedDimension = Number(options.expectedDimension
                        || getConfig('RAG_EMBEDDING_DIMENSION')) || 768;
                    return validateEmbedding(data?.embedding, expectedDimension, context);
                } catch (error) {
                    if (error.code === 'RAG_OLLAMA_TIMEOUT') metrics.increment('dependencyTimeoutsTotal');
                    throw mapOllamaFailure(error, operation, context);
                }
            }
        });
        succeeded = true;
        return result;
    } finally {
        release();
        const durationMs = performance.now() - startedAt;
        metrics.observe('ollamaRequestDurationMs', durationMs);
        console.log(`[RAG Ollama] Embedding ${succeeded ? 'completed' : 'failed'} durationMs=${durationMs.toFixed(1)}`);
    }
}

async function generateEmbeddings(input, profiler = null, options = {}) {
    if (!input || (Array.isArray(input) && input.length === 0)) {
        throw new RagPermanentError('Embedding input is empty.', {
            operation: 'ollama_embedding', code: 'RAG_INVALID_EMBEDDING_INPUT'
        });
    }
    const isBatch = Array.isArray(input);
    const prompts = isBatch ? input : [input];
    const concurrency = Number(options.concurrency)
        || configNumber('RAG_EMBEDDING_CONCURRENCY', 4);
    const startedAt = performance.now();
    try {
        const results = await runBoundedOrdered({
            items: prompts,
            concurrency,
            signal: options.signal,
            operation: 'ollama_embedding_pool',
            onProgress: progress => {
                metrics.setGauge('embeddingActiveWorkers', progress.active);
                metrics.setGauge('embeddingQueueDepth', progress.queued);
                options.onProgress?.(progress);
            },
            worker: (prompt, _index, signal) => generateOne(prompt, { ...options, signal })
        });
        profiler?.recordSubDuration(
            'Embeddings (Ollama)', 'Total Embedding Work', performance.now() - startedAt
        );
        return isBatch ? results : results[0];
    } catch (error) {
        metrics.increment('embeddingFailuresTotal');
        if (error instanceof RagCancelledError) metrics.increment('requestsCancelledTotal');
        throw error;
    } finally {
        metrics.setGauge('embeddingActiveWorkers', 0);
        metrics.setGauge('embeddingQueueDepth', 0);
    }
}

module.exports = {
    checkModelAvailability,
    listModels,
    generateEmbeddings,
    generateEmbeddingsBounded: generateEmbeddings,
    validateEmbedding,
    mapOllamaFailure
};
