'use strict';

const DEFAULTS = Object.freeze({
    implementation: 'legacy',
    collection: 'futhing_knowledge_v2',
    alias: 'futhing_knowledge_active',
    embeddingModel: 'nomic-embed-text:latest',
    embeddingProvider: 'ollama',
    embeddingBaseUrl: 'http://127.0.0.1:11434',
    embeddingDimensions: 768,
    distance: 'Cosine',
    denseCandidates: 40,
    sparseCandidates: 40,
    fusedCandidates: 40,
    rrfK: 60,
    rerankerModel: 'Qwen/Qwen3-Reranker-0.6B',
    rerankerBaseUrl: '',
    denseVectorName: 'dense',
    sparseVectorName: 'sparse',
    rerankerCandidates: 24,
    minimumRerankerScore: 0.35,
    rerankerScoreWindow: 0.18,
    minimumContextChunks: 1,
    maximumContextChunks: 8,
    contextTokenBudget: 3000,
    childChunkTokens: 450,
    overlapTokens: 60,
    parentContextTokens: 1100,
    generationTemperature: 0,
    maximumRegenerations: 1,
    cacheTtlMs: 300000,
    retrievalTimeoutMs: 10000,
    rerankerTimeoutMs: 15000,
    generationTimeoutMs: 60000
});

const ENV = Object.freeze({
    implementation: 'RAG_IMPLEMENTATION', collection: 'RAG_V2_COLLECTION', alias: 'RAG_V2_ALIAS',
    embeddingModel: 'RAG_V2_EMBEDDING_MODEL', embeddingDimensions: 'RAG_V2_EMBEDDING_DIMENSIONS',
    embeddingProvider: 'RAG_V2_EMBEDDING_PROVIDER', embeddingBaseUrl: 'RAG_V2_EMBEDDING_BASE_URL',
    distance: 'RAG_V2_DISTANCE', denseCandidates: 'RAG_V2_DENSE_CANDIDATES',
    sparseCandidates: 'RAG_V2_SPARSE_CANDIDATES', fusedCandidates: 'RAG_V2_FUSED_CANDIDATES',
    rrfK: 'RAG_V2_RRF_K', rerankerModel: 'RAG_V2_RERANKER_MODEL',
    rerankerBaseUrl: 'RAG_V2_RERANKER_BASE_URL', denseVectorName: 'RAG_V2_DENSE_VECTOR_NAME',
    sparseVectorName: 'RAG_V2_SPARSE_VECTOR_NAME',
    rerankerCandidates: 'RAG_V2_RERANKER_CANDIDATES', minimumContextChunks: 'RAG_V2_CONTEXT_MIN_CHUNKS',
    minimumRerankerScore: 'RAG_V2_MIN_RERANKER_SCORE',
    rerankerScoreWindow: 'RAG_V2_RERANKER_SCORE_WINDOW',
    maximumContextChunks: 'RAG_V2_CONTEXT_MAX_CHUNKS', contextTokenBudget: 'RAG_V2_CONTEXT_TOKEN_BUDGET',
    childChunkTokens: 'RAG_V2_CHILD_CHUNK_TOKENS', overlapTokens: 'RAG_V2_OVERLAP_TOKENS',
    parentContextTokens: 'RAG_V2_PARENT_CONTEXT_TOKENS', generationTemperature: 'RAG_V2_TEMPERATURE',
    maximumRegenerations: 'RAG_V2_MAX_REGENERATIONS', cacheTtlMs: 'RAG_V2_CACHE_TTL_MS',
    retrievalTimeoutMs: 'RAG_V2_RETRIEVAL_TIMEOUT_MS', rerankerTimeoutMs: 'RAG_V2_RERANKER_TIMEOUT_MS',
    generationTimeoutMs: 'RAG_V2_GENERATION_TIMEOUT_MS'
});

const NUMERIC = new Set([...Object.keys(DEFAULTS).filter(key => typeof DEFAULTS[key] === 'number'), 'embeddingDimensions']);

function loadRagV2Config(env = process.env) {
    const config = {};
    for (const [key, fallback] of Object.entries(DEFAULTS)) {
        let raw = env[ENV[key]];
        if (env === process.env && key === 'implementation') {
            try {
                const { getSetting } = require('../../database/repositories/settingsRepository');
                const dbVal = getSetting('RAG_IMPLEMENTATION');
                if (dbVal) raw = dbVal;
            } catch (_) {}
        }
        config[key] = raw === undefined || raw === '' ? fallback : (NUMERIC.has(key) ? Number(raw) : raw);
    }
    validateRagV2Config(config);
    return Object.freeze(config);
}

function validateRagV2Config(c) {
    const errors = [];
    if (!['legacy', 'v2', 'shadow'].includes(c.implementation)) errors.push('implementation must be legacy, shadow, or v2');
    if (!/^[A-Za-z0-9_-]+$/.test(c.collection) || !/^[A-Za-z0-9_-]+$/.test(c.alias)) errors.push('collection and alias must be safe identifiers');
    if (!['Cosine', 'Dot', 'Euclid', 'Manhattan'].includes(c.distance)) errors.push('unsupported distance metric');
    if (!['ollama', 'openai-compatible'].includes(c.embeddingProvider)) errors.push('unsupported embedding provider');
    for (const key of ['denseVectorName', 'sparseVectorName']) if (!/^[A-Za-z0-9_-]+$/.test(c[key])) errors.push(`${key} must be a safe identifier`);
    if (c.embeddingDimensions !== null && (!Number.isInteger(c.embeddingDimensions) || c.embeddingDimensions < 1)) errors.push('embedding dimensions must be verified positive integer');
    for (const key of ['denseCandidates', 'sparseCandidates', 'fusedCandidates', 'rrfK', 'rerankerCandidates', 'minimumContextChunks', 'maximumContextChunks', 'contextTokenBudget', 'childChunkTokens', 'parentContextTokens']) {
        if (!Number.isInteger(c[key]) || c[key] < 1) errors.push(`${key} must be a positive integer`);
    }
    if (!Number.isInteger(c.overlapTokens) || c.overlapTokens < 0 || c.overlapTokens >= c.childChunkTokens) errors.push('overlapTokens must be non-negative and smaller than childChunkTokens');
    if (c.minimumContextChunks > c.maximumContextChunks) errors.push('minimumContextChunks cannot exceed maximumContextChunks');
    if (c.rerankerCandidates > c.fusedCandidates) errors.push('rerankerCandidates cannot exceed fusedCandidates');
    if (!Number.isFinite(c.minimumRerankerScore) || c.minimumRerankerScore < 0 || c.minimumRerankerScore > 1) errors.push('minimumRerankerScore must be between 0 and 1');
    if (!Number.isFinite(c.rerankerScoreWindow) || c.rerankerScoreWindow < 0 || c.rerankerScoreWindow > 1) errors.push('rerankerScoreWindow must be between 0 and 1');
    if (c.generationTemperature !== 0) errors.push('grounded generation temperature must be 0');
    if (c.maximumRegenerations !== 1) errors.push('maximumRegenerations must be exactly 1');
    if (errors.length) { const error = new Error(`Invalid RAG v2 configuration: ${errors.join('; ')}`); error.code = 'RAG_V2_INVALID_CONFIG'; throw error; }
    return true;
}

module.exports = { DEFAULTS, ENV, loadRagV2Config, validateRagV2Config };
