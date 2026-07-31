const { getConfig } = require('../config/ragConfig');
const { generateEmbeddings } = require('../embeddings/ollamaEmbeddingProvider');
const { normalizeQueryTokens, normalizeArabic } = require('../processing/arabicNormalizer');
const { performance } = require('perf_hooks');
const versionedCache = require('../cache/retrievalCache');
const db = require('../../database/connection');
const { requireTenantId } = require('../security/tenantContext');
const { searchPoints } = require('../vector/qdrantVectorStore');
const { registerOperation } = require('../runtime/operationRegistry');
const { RETRIEVAL_MODE, createMetadata } = require('../runtime/fallbackPolicy');
const crypto = require('crypto');

// In-Memory caches to optimize latency and eliminate redundant HTTP requests (Task: Optimizations)
const embeddingsCache = new Map();
const retrievalCache = versionedCache.entries;

/**
 * Computes a normalized keyword score (0.0 to 1.0) representing the fraction of query tokens matched in the chunk.
 */
function computeKeywordScore(chunkText, queryTokens) {
    if (!queryTokens || queryTokens.length === 0) return 0;
    const normalizedChunk = normalizeArabic(chunkText).toLowerCase();
    let matches = 0;
    queryTokens.forEach(token => {
        if (normalizedChunk.includes(token)) {
            matches++;
        }
    });
    return matches / queryTokens.length;
}

/**
 * Normalizes scores to be between 0.0 and 1.0.
 */
function normalizeScore(score, min = 0, max = 1) {
    if (max === min) return 0;
    const normalized = (score - min) / (max - min);
    return Math.max(0, Math.min(1, normalized));
}

/**
 * Dynamically estimates query complexity to determine the optimal Dynamic Top-K.
 */
function determineDynamicTopK(query, queryTokens) {
    const minK = parseInt(getConfig('RAG_MIN_TOP_K'), 10) || 3;
    const defaultK = parseInt(getConfig('RAG_DEFAULT_TOP_K'), 10) || 5;
    const maxK = parseInt(getConfig('RAG_MAX_TOP_K'), 10) || 7;

    if (!query || typeof query !== 'string') return defaultK;

    const len = query.length;
    const tokenCount = queryTokens.length;

    // Check for complex markers
    const complexKeywords = ['سعر', 'خطوات', 'شروط', 'سياسة', 'طريقة', 'كيف', 'متى', 'لماذا', 'قارن', 'افضل', 'فروقات', 'قائمة', 'خيارات', 'تفاصيل', 'جميع'];
    const isComplexQuery = complexKeywords.some(kw => query.toLowerCase().includes(kw));

    if (tokenCount <= 2 && len < 20 && !isComplexQuery) {
        return minK;
    } else if (tokenCount > 5 || len > 50 || isComplexQuery) {
        return maxK;
    }
    return defaultK;
}

/**
 * Perform hybrid semantic + keyword retrieval using Qdrant and local lexical scoring.
 * Accepts optional profiler parameter for high-resolution timing sub-stage telemetry tracking.
 */
async function retrieveHybridContextInternal(query, profiler = null, cacheContext = {}) {
    if (typeof query !== 'string' || !query.trim()) {
        return {
            candidates: [],
            dynamicTopK: 0,
            similarityThreshold: Number(getConfig('RAG_SIMILARITY_THRESHOLD')) || 0.4,
            timings: { embeddings: 0, vectorSearch: 0, keywordSearch: 0 },
            metadata: createMetadata({ retrievalMode: RETRIEVAL_MODE.NORMAL, emptyQuery: true })
        };
    }
    const retrievalStartedAt = performance.now();
    const collectionName = getConfig('QDRANT_COLLECTION');
    const tenantId = requireTenantId(cacheContext.tenantId, 'hybrid-retrieval');
    require('../security/tenantRagSafety').assertTenantRagEnabled(tenantId);
    const embeddingModel = getConfig('RAG_EMBEDDING_MODEL');
    const reranker = process.env.RAG_CROSS_ENCODER_MODEL
        || process.env.RAG_CROSS_ENCODER_URL
        || 'none';

    // Safe load weights
    let semanticWeight = parseFloat(getConfig('RAG_SEMANTIC_WEIGHT'));
    let keywordWeight = parseFloat(getConfig('RAG_KEYWORD_WEIGHT'));
    if (isNaN(semanticWeight) || isNaN(keywordWeight) || semanticWeight < 0 || semanticWeight > 1 || keywordWeight < 0 || keywordWeight > 1 || Math.abs(semanticWeight + keywordWeight - 1.0) > 0.05) {
        semanticWeight = 0.80;
        keywordWeight = 0.20;
    }

    const similarityThreshold = parseFloat(getConfig('RAG_SIMILARITY_THRESHOLD')) || 0.40;

    // 1. Process and tokenize the query
    const queryTokens = normalizeQueryTokens(query);

    // 2. Determine Dynamic Top-K & Candidates Count
    const dynamicTopK = determineDynamicTopK(query, queryTokens);
    const candidateMultiplier = parseInt(getConfig('RAG_CANDIDATE_MULTIPLIER'), 10) || 3;
    const candidateCount = Math.min(100, dynamicTopK * candidateMultiplier);
    let activeKnowledgeVersion = null;
    try {
        activeKnowledgeVersion = db.prepare(`
            SELECT index_version_id FROM rag_index_versions
            WHERE tenant_id = ? AND source_type = 'knowledge_txt'
              AND document_id = 'knowledge.txt' AND is_active = 1
            LIMIT 1
        `).get(tenantId)?.index_version_id || null;
    } catch (_) {}
    const indexVersion = versionedCache.getIndexVersion(tenantId, collectionName);
    const cacheKey = versionedCache.buildCacheKey({
        tenantId,
        collection: collectionName,
        indexVersion,
        activeKnowledgeVersion,
        embeddingModel,
        reranker,
        retrievalWeights: { semantic: semanticWeight, keyword: keywordWeight },
        topK: dynamicTopK,
        threshold: similarityThreshold,
        candidateMultiplier,
        retrievalMode: RETRIEVAL_MODE.NORMAL,
        query
    });

    const cachedResult = versionedCache.get(cacheKey, tenantId);
    if (cachedResult !== undefined) {
        console.log(`[RAG Retrieval] tenant=${tenantId} operation=hybrid results=${cachedResult.candidates?.length || 0} cache=hit durationMs=${(performance.now() - retrievalStartedAt).toFixed(1)}`);
        return {
            ...cachedResult,
            metadata: createMetadata({
                ...(cachedResult.metadata || {}),
                retrievalMode: RETRIEVAL_MODE.CACHE_ONLY,
                cacheHit: true
            })
        };
    }

    // 3. Generate query embedding using Ollama or read from cache
    let queryVector;
    const tEmbedStart = performance.now();
    const embeddingCacheKey = `${embeddingModel}:${versionedCache.normalizeQuery(query)}`;
    if (embeddingsCache.has(embeddingCacheKey)) {
        queryVector = embeddingsCache.get(embeddingCacheKey);
    } else {
        queryVector = await generateEmbeddings(query, profiler, {
            signal: cacheContext.signal,
            tenantId
        });
        if (embeddingsCache.size > 1000) embeddingsCache.clear();
        embeddingsCache.set(embeddingCacheKey, queryVector);
    }
    const durationEmbeddings = performance.now() - tEmbedStart;

    if (!queryVector || queryVector.length === 0) {
        throw new Error('فشل توليد متجه الاستعلام من Ollama.');
    }
    if (!queryVector.every(Number.isFinite)) {
        throw new Error('متجه الاستعلام يحتوي على قيم غير صالحة.');
    }

    // 4. Query Qdrant for semantic candidates
    // Sub-stage 1: Request Build
    const tBuildStart = performance.now();
    const qdrantBody = {
        vector: queryVector,
        limit: candidateCount,
        // Staged replacement vectors must not become searchable before activation.
        filter: {
            must: [
                { key: 'tenantId', match: { value: tenantId } },
                { key: 'embeddingModel', match: { value: embeddingModel } },
                { key: 'vectorDimension', match: { value: queryVector.length } }
            ],
            must_not: [
                { key: 'lifecycle', match: { value: 'staging' } },
                { key: 'lifecycle', match: { value: 'archived' } }
            ],
            should: activeKnowledgeVersion
                ? [
                    { key: 'sourceType', match: { value: 'uploaded_document' } },
                    { key: 'indexVersionId', match: { value: activeKnowledgeVersion } }
                ]
                : [
                    { key: 'sourceType', match: { value: 'uploaded_document' } },
                    { key: 'sourceType', match: { value: 'text' } }
                ]
        },
        // Payload Filtering: retrieve ONLY the required fields to optimize latency and metadata transfer
        with_payload: [
            "text", "source", "chunkId", "documentName", "previousChunkId", "nextChunkId",
            "tenantId", "documentId", "documentVersionId", "indexVersionId", "sourceType",
            "chunkIndex", "contentHash", "embeddingModel", "vectorDimension", "createdAt", "lifecycle",
            "heading", "section", "textLength", "ingestionVersion"
            , "ragMediaType", "ragMediaDocumentId"
        ]
    };
    const durationBuild = performance.now() - tBuildStart;

    // Sub-stage 2: HTTP Send
    const tSendStart = performance.now();
    const searchResults = await searchPoints(qdrantBody, { signal: cacheContext.signal });
    const durationQdrantSearch = performance.now() - tSendStart;

    // Sub-stage 3: Qdrant Search & Parse
    const tParseStart = performance.now();

    // 5. Score fusion & payload validation
    const tKeywordStart = performance.now();
    const candidates = [];
    for (const res of searchResults) {
        if (res.payload?.tenantId !== tenantId) {
            console.error(`[RAG Tenant] Qdrant returned mismatched tenant payload. Result discarded. tenant=${tenantId} point=${res.id}`);
            continue;
        }
        const chunkText = res.payload?.text ?? res.payload?.content ?? res.payload?.pageContent ?? '';
        if (!chunkText || chunkText.trim() === '') {
            continue;
        }

        const semanticScore = res.score;
        const keywordScore = computeKeywordScore(chunkText, queryTokens);

        const finalScore = (semanticScore * semanticWeight) + (keywordScore * keywordWeight);

        candidates.push({
            text: chunkText,
            source: res.payload?.source || 'knowledge.txt',
            chunkId: res.payload?.chunkId || res.id,
            semanticScore,
            keywordScore,
            finalScore,
            payload: res.payload
        });
    }
    const durationResultParsing = (performance.now() - tParseStart) + (performance.now() - tKeywordStart);

    // Record sub-durations if profiler is passed
    if (profiler) {
        profiler.recordSubDuration('Vector Search (Qdrant)', 'Request Build', durationBuild);
        profiler.recordSubDuration('Vector Search (Qdrant)', 'Qdrant Search', durationQdrantSearch);
        profiler.recordSubDuration('Vector Search (Qdrant)', 'Result Parsing', durationResultParsing);
    }

    const result = {
        candidates,
        dynamicTopK,
        similarityThreshold,
        timings: {
            embeddings: durationEmbeddings,
            vectorSearch: durationQdrantSearch + durationBuild + durationResultParsing,
            keywordSearch: performance.now() - tKeywordStart
        },
        metadata: createMetadata({ retrievalMode: RETRIEVAL_MODE.NORMAL })
    };

    versionedCache.set(cacheKey, result, {
        tenantId,
        collection: collectionName,
        indexVersion
    }, {
        ttlMs: parseInt(getConfig('RAG_RETRIEVAL_CACHE_TTL_MS'), 10) || 300000,
        maxEntries: parseInt(getConfig('RAG_RETRIEVAL_CACHE_MAX_ENTRIES'), 10) || 1000
    });

    console.log(JSON.stringify({
        level: 'info',
        event: 'rag_retrieval_completed',
        tenantId,
        queryHash: crypto.createHash('sha256')
            .update(versionedCache.normalizeQuery(query)).digest('hex').slice(0, 16),
        collection: collectionName,
        resultCount: candidates.length,
        selectedChunkIds: candidates.slice(0, dynamicTopK).map(item => item.chunkId),
        topScore: candidates.length ? Math.max(...candidates.map(item => item.finalScore)) : null,
        threshold: similarityThreshold,
        durationMs: Number((performance.now() - retrievalStartedAt).toFixed(1)),
        cache: 'miss'
    }));
    return result;
}

async function retrieveHybridContext(query, profiler = null, cacheContext = {}) {
    const operation = registerOperation('hybrid_retrieval', cacheContext.signal);
    try {
        return await retrieveHybridContextInternal(query, profiler, {
            ...cacheContext, signal: operation.signal
        });
    } finally {
        operation.done();
    }
}

module.exports = {
    retrieveHybridContext,
    computeKeywordScore,
    determineDynamicTopK,
    embeddingsCache,
    retrievalCache
};
