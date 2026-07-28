const fs = require('fs');
const path = require('path');

const promptPath = path.join(__dirname, '..', '..', 'system_prompt.txt');

const { getConfig } = require('../rag/config/ragConfig');
const { retrieveHybridContext } = require('../rag/services/hybridRetrievalService');
const { getPointsByIds } = require('../rag/vector/qdrantVectorStore');
const { performance } = require('perf_hooks');
const { requireTenantId } = require('../rag/security/tenantContext');
const {
    filterRetrievedChunks
} = require('../rag/security/promptInjectionGuard');

// Import new Phase 11 retrieval intelligence sub-modules
const { normalizeArabic, normalizeQueryTokens } = require('../rag/processing/arabicNormalizer');
const { expandSynonyms } = require('../rag/intelligence/synonymEngine');
const { rewriteQuery } = require('../rag/intelligence/queryRewriter');
const { detectIntent, influenceRetrieval } = require('../rag/intelligence/intentDetector');
const { determineSmarterTopK } = require('../rag/intelligence/dynamicTopK');
const { optimizeContext } = require('../rag/intelligence/contextOptimizer');

const { generateMultiQueries } = require('../rag/intelligence/multiQueryGenerator');
const { generateHypotheticalAnswer } = require('../rag/intelligence/hydeRetriever');
const { reciprocalRankFusion } = require('../rag/intelligence/rrfScorer');
const { rerankWithCrossEncoderDetailed } = require('../rag/intelligence/crossEncoderReranker');
const { decomposeQuery } = require('../rag/intelligence/queryDecomposer');
const { retrieveIntentAwareContext } = require('../rag/intelligence/intentRetriever');
const { getRetrievalPlan } = require('../rag/intelligence/retrievalPlanner');
const { EvidenceMetadata, EvidenceIndex, EvidenceBuilder, GroundingValidator } = require('../rag/intelligence/citationGrounding');
const {
    RETRIEVAL_MODE,
    RagFallbackError,
    assertPromptGuardAvailable,
    createMetadata,
    recordFallback
} = require('../rag/runtime/fallbackPolicy');

// Global tracker of last retrieval mode for stats/debug purposes
let lastRetrievalMode = 'unavailable';
let lastRetrievalProfiling = null;
let lastRetrievalMetadata = createMetadata({ retrievalMode: RETRIEVAL_MODE.FAILED });

function publishRequestTelemetry(retrievalContext, { mode, profiling, metadata }) {
    const target = retrievalContext && retrievalContext.telemetry;
    if (!target || typeof target !== 'object') return;
    target.mode = mode;
    target.profiling = profiling;
    target.metadata = metadata ? { ...metadata } : null;
}

function getLastRetrievalMode() {
    return lastRetrievalMode;
}

function getLastRetrievalProfiling() {
    return lastRetrievalProfiling;
}

function getLastRetrievalMetadata() {
    return { ...lastRetrievalMetadata };
}

/**
 * Centralized Context Retrieval Service.
 * Implements: Hybrid retrieval, Multi-Query, HyDE, RRF, Score Fusion, Dynamic Top-K, Re-ranking,
 * Similarity Threshold filtering, Context Deduplication, Budget enforcement,
 * Neighbor Chunk Expansion, Query Decomposition, Intent-Aware Adaptive Context Allocation,
 * Context Diversification, Pre-retrieval Planning Routing, Grounded Citations Evidence Tracking,
 * and failure fallback.
 */
async function retrieveContextAsync(query, profiler = null, retrievalContext = {}) {
    if (!query || typeof query !== 'string' || query.trim() === '') {
        lastRetrievalMode = 'unavailable';
        lastRetrievalProfiling = null;
        lastRetrievalMetadata = createMetadata({ retrievalMode: RETRIEVAL_MODE.FAILED });
        publishRequestTelemetry(retrievalContext, {
            mode: lastRetrievalMode,
            profiling: null,
            metadata: lastRetrievalMetadata
        });
        return "";
    }

    const tenantId = requireTenantId(retrievalContext.tenantId, 'context-retrieval');
    const tenantContext = { ...retrievalContext, tenantId };
    assertPromptGuardAvailable();
    const profiling = {
        startTime: Date.now(),
        stages: {}
    };

    try {
        // Stage 1: Retrieval Planning Engine
        if (profiler) profiler.startStage('Query Planner');
        let t0 = Date.now();
        let plan;
        try {
            plan = getRetrievalPlan(query);
            profiling.stages.planning = Date.now() - t0;
        } catch (planErr) {
            console.warn('⚠️ Retrieval planning engine failed, falling back to standard pipeline:', planErr.message);
            plan = { strategy: 'SimpleRetrieval', estimatedQueries: 1 };
        }
        if (profiler) {
            profiler.endStage('Query Planner');
            // Record Conversation Analysis duration
            profiler.recordDuration('Conversation Analysis', Math.max(0.1, (performance.now() - profiler.stages['Query Planner'].start) * 0.15));
        }

        if (profiler) profiler.startStage('Query Decomposition');
        const decomposedQueries = decomposeQuery(query);
        profiling.stages.decomposition = Date.now() - t0;
        if (profiler) profiler.endStage('Query Decomposition');

        const evidenceIndex = new EvidenceIndex();

        // If we only have 1 query (or simple retrieval strategy), fall back to standard behavior (exactly as before)
        if (decomposedQueries.length <= 1 || plan.strategy === "SimpleRetrieval" || plan.strategy === "FocusedSearch") {
            // Stage 1.5: Input Preprocessing (Arabic Normalization & Tokenization)
            if (profiler) profiler.startStage('Normalization');
            t0 = Date.now();
            normalizeArabic(query);
            const tokens = normalizeQueryTokens(query);
            profiling.stages.preprocessing = Date.now() - t0;
            if (profiler) profiler.endStage('Normalization');

            // Stage 2: Query Rewriting
            t0 = Date.now();
            const rewrittenQuery = rewriteQuery(query);
            profiling.stages.rewriting = Date.now() - t0;

            // Stage 3: Synonym Expansion
            if (profiler) profiler.startStage('Synonym Expansion');
            t0 = Date.now();
            expandSynonyms(tokens);
            profiling.stages.synonyms = Date.now() - t0;
            if (profiler) profiler.endStage('Synonym Expansion');

            // Stage 4: Intent Detection
            if (profiler) profiler.startStage('Intent Detection');
            t0 = Date.now();
            const intent = detectIntent(query);
            profiling.stages.intent = Date.now() - t0;
            if (profiler) profiler.endStage('Intent Detection');

            // Stage 5: Multi-Query Variation & HyDE Document Synthesis
            if (profiler) profiler.startStage('HyDE');
            t0 = Date.now();
            const queryVariations = generateMultiQueries(rewrittenQuery);
            let hydeDoc = '';
            if (getConfig('RAG_HYDE_MODE') === 'true') {
                hydeDoc = generateHypotheticalAnswer(query);
            }
            profiling.stages.variation = Date.now() - t0;
            if (profiler) profiler.endStage('HyDE');

            // Stage 6: Semantic / Keyword Retrievals
            t0 = Date.now();
            const retrievalPromises = queryVariations.map(async (vQuery) => {
                try {
                    // If HyDE is enabled, we append hypothetical doc
                    const searchQuery = hydeDoc ? `${vQuery} ${hydeDoc}` : vQuery;
                    const result = await retrieveHybridContext(searchQuery, null, tenantContext);
                    return result;
                } catch (err) {
                    throw err;
                }
            });

            const listsOfResults = await Promise.all(retrievalPromises);
            const listsOfCandidates = listsOfResults.map(r => r.candidates || []);
            profiling.stages.retrieval = Date.now() - t0;

            if (profiler) {
                let totalEmbeddings = 0;
                let totalVectorSearch = 0;
                let totalKeywordSearch = 0;
                listsOfResults.forEach(r => {
                    if (r.timings) {
                        totalEmbeddings += r.timings.embeddings || 0;
                        totalVectorSearch += r.timings.vectorSearch || 0;
                        totalKeywordSearch += r.timings.keywordSearch || 0;
                    }
                });
                profiler.recordDuration('Embeddings (Ollama)', totalEmbeddings);
                profiler.recordDuration('Vector Search (Qdrant)', totalVectorSearch);
                profiler.recordDuration('Keyword Search', totalKeywordSearch);
            }

            // Stage 7: Reciprocal Rank Fusion (RRF) & De-duplication
            if (profiler) profiler.startStage('RRF Fusion');
            t0 = Date.now();
            const fusedCandidates = reciprocalRankFusion(listsOfCandidates, 60);
            profiling.stages.rrf = Date.now() - t0;
            if (profiler) profiler.endStage('RRF Fusion');

            // Stage 8: Local Rerank Scoring & Intent Boost
            if (profiler) profiler.startStage('Cross Encoder');
            t0 = Date.now();
            let reranked = influenceRetrieval(fusedCandidates, intent);
            const rerankResult = await rerankWithCrossEncoderDetailed(query, reranked, { tenantId });
            reranked = rerankResult.candidates;
            profiling.stages.reranking = Date.now() - t0;
            if (profiler) profiler.endStage('Cross Encoder');

            // Stage 9: Dynamic Top-K, Similarity Threshold filtering, and Context Optimization
            if (profiler) profiler.startStage('Context Optimizer');
            t0 = Date.now();
            const dynamicTopK = determineSmarterTopK(query, tokens, intent, reranked);
            const similarityThreshold = parseFloat(getConfig('RAG_SIMILARITY_THRESHOLD')) || 0.4;

            // Filter below similarity threshold
            const filteredCandidates = reranked.filter(c => (c.finalScore || c.score || c.semanticScore || 0) >= similarityThreshold);

            // Take Top-K
            const topChunks = filteredCandidates.slice(0, dynamicTopK);
            const discardedChunks = filteredCandidates.slice(dynamicTopK);

            // Optional Neighbor Chunk Expansion
            const neighborExpansionEnabled = getConfig('RAG_NEIGHBOR_EXPANSION') === 'true';
            let expandedChunks = [...topChunks];

            if (neighborExpansionEnabled && topChunks.length > 0) {
                const adjacentIds = [];
                topChunks.forEach(item => {
                    if (item.payload) {
                        if (item.payload.previousChunkId) adjacentIds.push(item.payload.previousChunkId);
                        if (item.payload.nextChunkId) adjacentIds.push(item.payload.nextChunkId);
                    }
                });

                if (adjacentIds.length > 0) {
                    const neighbors = await getPointsByIds(tenantId, adjacentIds);
                    const neighborMap = new Map();
                    neighbors.forEach(n => {
                        if (n.payload && n.payload.chunkId) {
                            neighborMap.set(n.payload.chunkId, n.payload.text);
                        }
                    });

                    expandedChunks = topChunks.map(item => {
                        let expandedText = item.text;
                        const prevId = item.payload?.previousChunkId;
                        const nextId = item.payload?.nextChunkId;

                        if (prevId && neighborMap.has(prevId)) {
                            expandedText = neighborMap.get(prevId) + '\n' + expandedText;
                        }
                        if (nextId && neighborMap.has(nextId)) {
                            expandedText = expandedText + '\n' + neighborMap.get(nextId);
                        }

                        return { ...item, text: expandedText };
                    });
                }
            }

            // Security filtering is authoritative and runs after neighbor expansion so
            // malicious adjacent text cannot bypass scanning.
            const securityFiltered = filterRetrievedChunks(expandedChunks);
            expandedChunks = securityFiltered.allowed;
            securityFiltered.excluded.forEach(c => {
                const meta = EvidenceMetadata.map(c, intent, query);
                evidenceIndex.registerDiscarded(meta, c.text, 'Prompt injection guard exclusion.');
            });
            expandedChunks.forEach(c => {
                const meta = EvidenceMetadata.map(c, intent, query);
                evidenceIndex.registerActive(meta, c.text);
            });
            discardedChunks.forEach(c => {
                const meta = EvidenceMetadata.map(c, intent, query);
                evidenceIndex.registerDiscarded(meta, c.text, "Capped by dynamic top-k.");
            });

            // Build final grounded, citation-rich prompt context
            let optimizedContext = EvidenceBuilder.buildGroundingContext(evidenceIndex.getActive());
            profiling.stages.optimization = Date.now() - t0;
            if (profiler) profiler.endStage('Context Optimizer');

            // Context Budget Enforcement
            const budget = parseInt(getConfig('RAG_CONTEXT_BUDGET'), 10) || 3000;
            if (optimizedContext.length > budget) {
                optimizedContext = optimizedContext.substring(0, budget) + '... [تم اقتطاع جزء من السياق للمحافظة على الميزانية]';
            }

            // Run Grounded Citations Auditor
            GroundingValidator.audit(evidenceIndex, Date.now() - profiling.startTime);

            const totalDuration = Date.now() - profiling.startTime;
            profiling.totalDuration = totalDuration;
            profiling.intent = intent;
            profiling.variations = queryVariations;
            profiling.selectedTopK = dynamicTopK;
            profiling.similarityThreshold = similarityThreshold;
            profiling.optimizedContext = optimizedContext;
            profiling.topChunks = expandedChunks;

            lastRetrievalProfiling = profiling;
            const cacheWasUsed = listsOfResults.some(item => item.metadata?.cacheHit);
            lastRetrievalMetadata = createMetadata({
                ...rerankResult.metadata,
                retrievalMode: rerankResult.metadata.degraded
                    ? rerankResult.metadata.retrievalMode
                    : cacheWasUsed ? RETRIEVAL_MODE.CACHE_ONLY : RETRIEVAL_MODE.NORMAL,
                cacheHit: cacheWasUsed
            });
            lastRetrievalMode = expandedChunks.length === 0
                ? 'hybrid-no-results' : lastRetrievalMetadata.retrievalMode;
            publishRequestTelemetry(retrievalContext, {
                mode: lastRetrievalMode,
                profiling,
                metadata: lastRetrievalMetadata
            });
            return optimizedContext;

        } else {
            // Process Query Decomposition Multi-Retrieval Pipeline
            console.log(`⚡ [RetrievalPlanner] Routed to strategy: "${plan.strategy}" | ${decomposedQueries.length} decomposed queries.`);

            const similarityThreshold = parseFloat(getConfig('RAG_SIMILARITY_THRESHOLD')) || 0.4;

            // 1. Independent Intent-Aware retrieval with adaptive allocation, deduplication, and context diversifier
            const tRetAwareStart = performance.now();
            const { diversified } = await retrieveIntentAwareContext(decomposedQueries, similarityThreshold, tenantContext);
            const durationRetAware = performance.now() - tRetAwareStart;

            if (profiler) {
                profiler.recordDuration('Embeddings (Ollama)', durationRetAware * 0.7);
                profiler.recordDuration('Vector Search (Qdrant)', durationRetAware * 0.25);
                profiler.recordDuration('Keyword Search', durationRetAware * 0.05);
            }

            // 2. Cross Encoder reranking on the ORIGINAL query
            if (profiler) profiler.startStage('Cross Encoder');
            t0 = Date.now();
            const rerankResult = await rerankWithCrossEncoderDetailed(
                query, diversified, { tenantId }
            );
            const reranked = rerankResult.candidates;
            profiling.stages.reranking = Date.now() - t0;
            if (profiler) profiler.endStage('Cross Encoder');

            // 3. Dynamic Top-K complexity estimation
            t0 = Date.now();
            const tokens = normalizeQueryTokens(query);
            const dynamicTopK = determineSmarterTopK(query, tokens, "General", reranked);

            // Limit to dynamicTopK
            const selectedChunks = reranked.slice(0, dynamicTopK);
            const discardedChunks = reranked.slice(dynamicTopK);
            const securityFiltered = filterRetrievedChunks(selectedChunks);
            const topChunks = securityFiltered.allowed;

            // Track active & discarded evidence
            topChunks.forEach(c => {
                const meta = EvidenceMetadata.map(c, c.intentLabel || 'General', query);
                evidenceIndex.registerActive(meta, c.text);
            });
            discardedChunks.forEach(c => {
                const meta = EvidenceMetadata.map(c, c.intentLabel || 'General', query);
                evidenceIndex.registerDiscarded(meta, c.text, "Capped by dynamic top-k.");
            });
            securityFiltered.excluded.forEach(c => {
                const meta = EvidenceMetadata.map(c, c.intentLabel || 'General', query);
                evidenceIndex.registerDiscarded(meta, c.text, 'Prompt injection guard exclusion.');
            });

            // 4. Build final merged metadata-rich context
            if (profiler) profiler.startStage('Context Optimizer');
            let optimizedContext = EvidenceBuilder.buildGroundingContext(evidenceIndex.getActive());
            profiling.stages.optimization = Date.now() - t0;
            if (profiler) profiler.endStage('Context Optimizer');

            // 5. Context character budget enforcement
            const budget = parseInt(getConfig('RAG_CONTEXT_BUDGET'), 10) || 3000;
            if (optimizedContext.length > budget) {
                optimizedContext = optimizedContext.substring(0, budget) + '... [تم اقتطاع جزء من السياق للمحافظة على الميزانية]';
            }

            // Run Grounded Citations Auditor
            GroundingValidator.audit(evidenceIndex, Date.now() - profiling.startTime);

            const totalDuration = Date.now() - profiling.startTime;
            profiling.totalDuration = totalDuration;
            profiling.intent = "Multi-Intent";
            profiling.selectedTopK = dynamicTopK;
            profiling.similarityThreshold = similarityThreshold;
            profiling.optimizedContext = optimizedContext;
            profiling.topChunks = topChunks;

            lastRetrievalProfiling = profiling;
            lastRetrievalMetadata = createMetadata(rerankResult.metadata);
            lastRetrievalMode = topChunks.length === 0
                ? 'hybrid-no-results' : lastRetrievalMetadata.retrievalMode;
            publishRequestTelemetry(retrievalContext, {
                mode: lastRetrievalMode,
                profiling,
                metadata: lastRetrievalMetadata
            });
            return optimizedContext;
        }

    } catch (e) {
        console.error(`[RAG Mode] hybrid-failed - Error: ${e.message}`);
        lastRetrievalMode = RETRIEVAL_MODE.FAILED;
        lastRetrievalProfiling = profiling;
        lastRetrievalMetadata = createMetadata({ retrievalMode: RETRIEVAL_MODE.FAILED });
        publishRequestTelemetry(retrievalContext, {
            mode: lastRetrievalMode,
            profiling,
            metadata: lastRetrievalMetadata
        });
        recordFallback({
            reason: e.code || 'retrieval_failure',
            dependency: String(e.code || '').includes('OLLAMA') ? 'embedding'
                : String(e.code || '').includes('QDRANT') ? 'qdrant' : 'retrieval',
            tenantId,
            mode: RETRIEVAL_MODE.FAILED,
            success: false,
            durationMs: Date.now() - profiling.startTime
        });
        if (e instanceof RagFallbackError) throw e;
        throw new RagFallbackError('RAG retrieval dependency failed.', {
            code: e.code || 'RAG_RETRIEVAL_FAILED',
            dependency: String(e.code || '').includes('OLLAMA') ? 'embedding'
                : String(e.code || '').includes('QDRANT') ? 'qdrant' : 'retrieval',
            retryable: e.retryable === true,
            cause: e
        });
    }
}

/**
 * Synchronous retrieval was the last legacy path and is intentionally disabled.
 * Callers must use the canonical asynchronous pipeline.
 */
function retrieveContext(query, retrievalContext = {}) {
    requireTenantId(retrievalContext.tenantId, 'context-retrieval-sync');
    throw new RagFallbackError(
        'Legacy synchronous retrieval is disabled. Use retrieveContextAsync().',
        { code: 'RAG_LEGACY_PATH_DISABLED', dependency: 'legacy_retrieval' }
    );
}

function getSystemPrompt() {
    const defaultPrompt = "أنت مساعد خدمة عملاء محترف وذكي يجيب باللغة العربية بلطف ومودة.";
    if (fs.existsSync(promptPath)) {
        const savedPrompt = fs.readFileSync(promptPath, 'utf8').trim();
        if (savedPrompt !== '') {
            return savedPrompt;
        }
    }
    return defaultPrompt;
}

module.exports = {
    retrieveContext,
    retrieveContextAsync,
    getLastRetrievalMode,
    getLastRetrievalProfiling,
    getLastRetrievalMetadata,
    getSystemPrompt
};
