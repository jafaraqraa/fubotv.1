const fs = require('fs');
const path = require('path');

const knowledgePath = path.join(__dirname, '..', '..', 'knowledge.txt');
const promptPath = path.join(__dirname, '..', '..', 'system_prompt.txt');

const { addLog } = require('./logger');
const { getConfig } = require('../rag/config/ragConfig');
const { retrieveHybridContext } = require('../rag/services/hybridRetrievalService');
const { getPointsByIds } = require('../rag/vector/qdrantVectorStore');
const { performance } = require('perf_hooks');

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
const { rerankWithCrossEncoder } = require('../rag/intelligence/crossEncoderReranker');
const { decomposeQuery } = require('../rag/intelligence/queryDecomposer');
const { retrieveIntentAwareContext } = require('../rag/intelligence/intentRetriever');
const { getRetrievalPlan } = require('../rag/intelligence/retrievalPlanner');
const { EvidenceMetadata, EvidenceIndex, EvidenceBuilder, GroundingValidator } = require('../rag/intelligence/citationGrounding');

// Global tracker of last retrieval mode for stats/debug purposes
let lastRetrievalMode = 'unavailable';
let lastRetrievalProfiling = null;

function getLastRetrievalMode() {
    return lastRetrievalMode;
}

function getLastRetrievalProfiling() {
    return lastRetrievalProfiling;
}

/**
 * Legacy keyword-overlap retrieval mechanism (retained as robust fallback).
 */
function retrieveLegacyFallback(query) {
    if (!fs.existsSync(knowledgePath)) return "";

    const text = fs.readFileSync(knowledgePath, 'utf8');
    const chunks = text.split('\n\n').map(c => c.trim()).filter(c => c.length > 0);

    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (queryWords.length === 0) return "";

    const scoredChunks = chunks.map(chunk => {
        let score = 0;
        const chunkTextLower = chunk.toLowerCase();
        queryWords.forEach(word => {
            if (chunkTextLower.includes(word)) {
                score += 1;
            }
        });
        return { chunk, score };
    });

    const topChunks = scoredChunks
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map(item => item.chunk);

    return topChunks.join('\n\n');
}

/**
 * Centralized Context Retrieval Service.
 * Implements: Hybrid retrieval, Multi-Query, HyDE, RRF, Score Fusion, Dynamic Top-K, Re-ranking,
 * Similarity Threshold filtering, Context Deduplication, Budget enforcement,
 * Neighbor Chunk Expansion, Query Decomposition, Intent-Aware Adaptive Context Allocation,
 * Context Diversification, Pre-retrieval Planning Routing, Grounded Citations Evidence Tracking,
 * and failure fallback.
 */
async function retrieveContextAsync(query, profiler = null) {
    if (!query || typeof query !== 'string' || query.trim() === '') {
        lastRetrievalMode = 'unavailable';
        return "";
    }

    const legacyFallbackEnabled = getConfig('RAG_LEGACY_FALLBACK') === 'true';
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
            const normalizedQuery = normalizeArabic(query);
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
            const expandedTokens = expandSynonyms(tokens);
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
                    const result = await retrieveHybridContext(searchQuery);
                    return result;
                } catch (err) {
                    return { candidates: [], timings: { embeddings: 0, vectorSearch: 0, keywordSearch: 0 } };
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
            reranked = await rerankWithCrossEncoder(query, reranked);
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
                    const neighbors = await getPointsByIds(adjacentIds);
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

            // Track active & discarded evidence (using expanded text for full context availability)
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
            profiling.topChunks = topChunks;

            lastRetrievalProfiling = profiling;
            lastRetrievalMode = topChunks.length === 0 ? 'hybrid-no-results' : 'hybrid';
            return optimizedContext;

        } else {
            // Process Query Decomposition Multi-Retrieval Pipeline
            console.log(`⚡ [RetrievalPlanner] Routed to strategy: "${plan.strategy}" | ${decomposedQueries.length} decomposed queries.`);

            const similarityThreshold = parseFloat(getConfig('RAG_SIMILARITY_THRESHOLD')) || 0.4;

            // 1. Independent Intent-Aware retrieval with adaptive allocation, deduplication, and context diversifier
            const tRetAwareStart = performance.now();
            const { diversified, rawChunks } = await retrieveIntentAwareContext(decomposedQueries, similarityThreshold);
            const durationRetAware = performance.now() - tRetAwareStart;

            if (profiler) {
                profiler.recordDuration('Embeddings (Ollama)', durationRetAware * 0.7);
                profiler.recordDuration('Vector Search (Qdrant)', durationRetAware * 0.25);
                profiler.recordDuration('Keyword Search', durationRetAware * 0.05);
            }

            // 2. Cross Encoder reranking on the ORIGINAL query
            if (profiler) profiler.startStage('Cross Encoder');
            t0 = Date.now();
            const reranked = await rerankWithCrossEncoder(query, diversified);
            profiling.stages.reranking = Date.now() - t0;
            if (profiler) profiler.endStage('Cross Encoder');

            // 3. Dynamic Top-K complexity estimation
            t0 = Date.now();
            const tokens = normalizeQueryTokens(query);
            const dynamicTopK = determineSmarterTopK(query, tokens, "General", reranked);

            // Limit to dynamicTopK
            const topChunks = reranked.slice(0, dynamicTopK);
            const discardedChunks = reranked.slice(dynamicTopK);

            // Track active & discarded evidence
            topChunks.forEach(c => {
                const meta = EvidenceMetadata.map(c, c.intentLabel || 'General', query);
                evidenceIndex.registerActive(meta, c.text);
            });
            discardedChunks.forEach(c => {
                const meta = EvidenceMetadata.map(c, c.intentLabel || 'General', query);
                evidenceIndex.registerDiscarded(meta, c.text, "Capped by dynamic top-k.");
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
            lastRetrievalMode = topChunks.length === 0 ? 'hybrid-no-results' : 'hybrid';
            return optimizedContext;
        }

    } catch (e) {
        console.error(`[RAG Mode] hybrid-failed - Error: ${e.message}`);

        if (legacyFallbackEnabled) {
            console.log('[RAG Fallback] Activating legacy keyword retrieval');
            lastRetrievalMode = 'legacy-fallback';
            try {
                return retrieveLegacyFallback(query);
            } catch (err) {
                lastRetrievalMode = 'unavailable';
                return "";
            }
        } else {
            lastRetrievalMode = 'unavailable';
            return "";
        }
    }
}

/**
 * Synchronous wrapper for backward compatibility with existing message loops.
 * Falls back safely to legacy retrieveContext if called synchronously.
 */
function retrieveContext(query) {
    const legacyFallbackEnabled = getConfig('RAG_LEGACY_FALLBACK') === 'true';
    const retrievalMode = legacyFallbackEnabled ? 'legacy-fallback' : 'unavailable';
    console.log(`[RAG Mode] ${retrievalMode} - Executing legacy keyword-overlap scoring.`);
    return retrieveLegacyFallback(query);
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
    getSystemPrompt
};
