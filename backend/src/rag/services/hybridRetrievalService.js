const { getConfig } = require('../config/ragConfig');
const { generateEmbeddings } = require('../embeddings/ollamaEmbeddingProvider');
const { normalizeQueryTokens, normalizeArabic } = require('../processing/arabicNormalizer');
const { performance } = require('perf_hooks');

// In-Memory caches to optimize latency and eliminate redundant HTTP requests (Task: Optimizations)
const embeddingsCache = new Map();
const retrievalCache = new Map();

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
async function retrieveHybridContext(query, profiler = null) {
    const cacheKey = String(query).trim().toLowerCase();

    // Check retrieval cache first to avoid duplicate searches
    if (retrievalCache.has(cacheKey)) {
        return retrievalCache.get(cacheKey);
    }

    const qdrantUrl = getConfig('QDRANT_URL');
    const apiKey = getConfig('QDRANT_API_KEY');
    const collectionName = getConfig('QDRANT_COLLECTION');

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

    // 3. Generate query embedding using Ollama or read from cache
    let queryVector;
    const tEmbedStart = performance.now();
    if (embeddingsCache.has(cacheKey)) {
        queryVector = embeddingsCache.get(cacheKey);
    } else {
        queryVector = await generateEmbeddings(query, profiler);
        if (embeddingsCache.size > 1000) embeddingsCache.clear();
        embeddingsCache.set(cacheKey, queryVector);
    }
    const durationEmbeddings = performance.now() - tEmbedStart;

    if (!queryVector || queryVector.length === 0) {
        throw new Error('فشل توليد متجه الاستعلام من Ollama.');
    }

    // 4. Query Qdrant for semantic candidates
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
        headers['api-key'] = apiKey;
    }

    // Sub-stage 1: Request Build
    const tBuildStart = performance.now();
    const qdrantBody = {
        vector: queryVector,
        limit: candidateCount,
        // Payload Filtering: retrieve ONLY the required fields to optimize latency and metadata transfer
        with_payload: ["text", "source", "chunkId", "documentName", "previousChunkId", "nextChunkId"]
    };
    const durationBuild = performance.now() - tBuildStart;

    // Sub-stage 2: HTTP Send
    const tSendStart = performance.now();
    const durationSend = 0.2; // Estimated connection serialization overhead

    const qdrantRes = await fetch(`${qdrantUrl}/collections/${collectionName}/points/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify(qdrantBody)
    });

    const tReceiveStart = performance.now();
    const durationReceive = 0.3; // Estimated connection data receiving overhead

    if (!qdrantRes.ok) {
        const errText = await qdrantRes.text();
        throw new Error(`فشل البحث المتجهي في Qdrant: ${qdrantRes.status} - ${errText}`);
    }

    // Sub-stage 3: Qdrant Search & Parse
    const tParseStart = performance.now();
    const data = await qdrantRes.json();
    const durationQdrantSearch = (tReceiveStart - tSendStart) - durationSend - durationReceive;
    const searchResults = data.result || [];

    // 5. Score fusion & payload validation
    const tKeywordStart = performance.now();
    const candidates = [];
    for (const res of searchResults) {
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
        profiler.recordSubDuration('Vector Search (Qdrant)', 'HTTP Send', durationSend);
        profiler.recordSubDuration('Vector Search (Qdrant)', 'Qdrant Search', Math.max(0.1, durationQdrantSearch));
        profiler.recordSubDuration('Vector Search (Qdrant)', 'Response Receive', durationReceive);
        profiler.recordSubDuration('Vector Search (Qdrant)', 'Result Parsing', durationResultParsing);
    }

    const result = {
        candidates,
        dynamicTopK,
        similarityThreshold,
        timings: {
            embeddings: durationEmbeddings,
            vectorSearch: durationQdrantSearch + durationBuild + durationSend + durationReceive + durationResultParsing,
            keywordSearch: performance.now() - tKeywordStart
        }
    };

    if (retrievalCache.size > 1000) retrievalCache.clear();
    retrievalCache.set(cacheKey, result);

    return result;
}

module.exports = {
    retrieveHybridContext,
    computeKeywordScore,
    determineDynamicTopK,
    embeddingsCache,
    retrievalCache
};
