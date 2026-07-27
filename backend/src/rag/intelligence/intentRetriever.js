const { retrieveHybridContext } = require('../services/hybridRetrievalService');
const { rewriteQuery } = require('./queryRewriter');
const { generateMultiQueries } = require('./multiQueryGenerator');
const { reciprocalRankFusion } = require('./rrfScorer');
const { influenceRetrieval } = require('./intentDetector');
const { normalizeQueryTokens } = require('../processing/arabicNormalizer');
const { determineSmarterTopK } = require('./dynamicTopK');

/**
 * Handles adaptive context allocation based on intent confidence.
 */
class RetrievalAllocator {
    /**
     * Determines how many chunks to retrieve for each sub-query based on confidence.
     *
     * @param {Array<Object>} decomposedQueries - List of decomposed sub-queries.
     * @returns {Array<Object>} List of sub-queries with allocated chunk counts.
     */
    static allocate(decomposedQueries) {
        if (!decomposedQueries || !Array.isArray(decomposedQueries)) return [];

        return decomposedQueries.map(item => {
            let limit = 1;
            const confidence = item.confidence || 0.5;

            if (confidence >= 0.90) {
                limit = 4;
            } else if (confidence >= 0.75) {
                limit = 3;
            } else if (confidence >= 0.50) {
                limit = 2;
            } else {
                limit = 1;
            }

            return {
                ...item,
                allocatedLimit: limit
            };
        });
    }
}

/**
 * Removes exact and near-duplicate chunks to ensure context purity.
 */
class ChunkDeduplicator {
    /**
     * Calculates Jaccard similarity between two texts.
     */
    static getSimilarity(text1, text2) {
        const clean1 = (text1 || '').toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");
        const clean2 = (text2 || '').toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");

        const words1 = new Set(clean1.split(/\s+/).filter(w => w.length > 2));
        const words2 = new Set(clean2.split(/\s+/).filter(w => w.length > 2));
        if (words1.size === 0 || words2.size === 0) return 0;

        let intersection = 0;
        words1.forEach(w => {
            if (words2.has(w)) intersection++;
        });

        const union = words1.size + words2.size - intersection;
        return intersection / union;
    }

    /**
     * Deduplicates a list of chunks, keeping the one with the highest score.
     *
     * @param {Array<Object>} chunks - Chunks retrieved.
     * @returns {Array<Object>} Cleaned chunk list.
     */
    static deduplicate(chunks) {
        if (!chunks || !Array.isArray(chunks)) return [];

        const unique = [];
        let removedCount = 0;

        for (const candidate of chunks) {
            let isDuplicate = false;

            for (const existing of unique) {
                // 1. Same Chunk ID or payload ID
                const id1 = candidate.chunkId || candidate.payload?.chunkId || '';
                const id2 = existing.chunkId || existing.payload?.chunkId || '';
                if (id1 && id2 && id1 === id2) {
                    isDuplicate = true;
                    break;
                }

                // 2. Exact text match
                if (candidate.text === existing.text) {
                    isDuplicate = true;
                    break;
                }

                // 3. Near-duplicate text (70% Jaccard word overlap is perfect for short chunk deduplication)
                const sim = ChunkDeduplicator.getSimilarity(candidate.text, existing.text);
                if (sim >= 0.70) {
                    isDuplicate = true;
                    break;
                }
            }

            if (!isDuplicate) {
                unique.push(candidate);
            } else {
                removedCount++;
            }
        }

        return { unique, removedCount };
    }
}

/**
 * Diversifies the context to prevent a single intent from dominating all retrieved chunks.
 */
class ContextDiversifier {
    /**
     * Limits chunks per intent to guarantee representations from multiple categories.
     *
     * @param {Array<Object>} chunks - List of chunks.
     * @param {number} maxPerIntent - Cap per category (default 3).
     * @returns {Array<Object>} Diversified chunks list.
     */
    static diversify(chunks, maxPerIntent = 3) {
        if (!chunks || !Array.isArray(chunks)) return [];

        const counts = {};
        const result = [];

        for (const chunk of chunks) {
            const intent = chunk.intentLabel || 'General';
            counts[intent] = counts[intent] || 0;

            if (counts[intent] < maxPerIntent || intent === 'General') {
                counts[intent]++;
                result.push(chunk);
            }
        }

        return result;
    }
}

/**
 * Builds the final context block enriched with chunk metadata annotations.
 */
class MergedContextBuilder {
    /**
     * Constructs metadata block and wraps chunk content.
     *
     * @param {Array<Object>} chunks - Chunks to merge.
     * @returns {string} Fully merged context block.
     */
    static build(chunks) {
        if (!chunks || !Array.isArray(chunks)) return '';

        return chunks.map((c, idx) => {
            const label = c.intentLabel || 'General';
            const finalScore = (c.finalScore || c.score || c.semanticScore || 0).toFixed(2);
            const semScore = (c.semanticScore || 0).toFixed(2);
            const keyScore = (c.keywordScore || 0).toFixed(2);
            const docName = c.source || c.payload?.documentName || 'معرفة عامة';

            let chunkContext = `[المصدر: ${docName} | التصنيف: ${label} | تطابق هجين: ${finalScore} (معنوي: ${semScore}، نصي: ${keyScore})]\n`;
            chunkContext += `${c.text.trim()}`;
            return chunkContext;
        }).join('\n\n---\n\n');
    }
}

/**
 * Coordinates independent intent-aware searches.
 */
class IntentRetriever {
    /**
     * Executes intent-aware diversfied context retrieval across decomposed queries.
     *
     * @param {Array<Object>} decomposedQueries - Atomic sub-queries.
     * @param {number} similarityThreshold - Minimum threshold.
     * @returns {Promise<Object>} { rawChunks, deduplicated, diversified }
     */
    static async retrieve(decomposedQueries, similarityThreshold = 0.4) {
        const startTime = Date.now();
        const allocated = RetrievalAllocator.allocate(decomposedQueries);
        const rawChunks = [];

        console.log(`\n🚦 [IntentRetriever] Starting adaptive query retrieval...`);

        for (const item of allocated) {
            const query = item.query;
            const intent = item.intent;
            const limit = item.allocatedLimit;

            // 1. Rewrite Query
            const rewritten = rewriteQuery(query);

            // 2. Generate variations
            const variations = generateMultiQueries(rewritten);

            // 3. Fetch hybrid candidate lists
            const retrievalPromises = variations.map(async (vQuery) => {
                try {
                    const res = await retrieveHybridContext(vQuery);
                    return res.candidates || [];
                } catch (e) {
                    return [];
                }
            });

            const candidateLists = await Promise.all(retrievalPromises);

            // 4. Reciprocal Rank Fusion on variation lists
            const fused = reciprocalRankFusion(candidateLists, 60);

            // 5. Intent Boost scoring
            const boosted = influenceRetrieval(fused, intent);

            // 6. Filter by similarity threshold & tag chunk labels
            const filtered = boosted
                .filter(c => (c.finalScore || c.score || c.semanticScore || 0) >= similarityThreshold)
                .map(c => ({
                    ...c,
                    intentLabel: intent
                }));

            // 7. Limit to allocated chunks
            const topAllocated = filtered.slice(0, limit);
            console.log(`  • Sub-Query: "${query}" (Intent: ${intent}) | Limit: ${limit} | Retrieved Chunks: ${topAllocated.length}`);

            rawChunks.push(...topAllocated);
        }

        // 8. Deduplicate Chunks
        const { unique: deduplicated, removedCount } = ChunkDeduplicator.deduplicate(rawChunks);

        // 9. Diversify Context
        const diversified = ContextDiversifier.diversify(deduplicated, 3);

        const executionTimeMs = Date.now() - startTime;

        // Developer logging
        console.log(`\n📊 [Intent-Aware Context Retrieval Complete]`);
        console.log(`• Allocated Sub-Queries: ${decomposedQueries.length}`);
        console.log(`• Total Raw Chunks: ${rawChunks.length}`);
        console.log(`• Deduplicated Chunks: ${deduplicated.length} (Removed: ${removedCount})`);
        console.log(`• Diversified Chunks: ${diversified.length}`);
        console.log(`• Chunks per Intent:`);
        const intentCounts = {};
        diversified.forEach(c => {
            intentCounts[c.intentLabel] = (intentCounts[c.intentLabel] || 0) + 1;
        });
        Object.entries(intentCounts).forEach(([lbl, count]) => {
            console.log(`  - ${lbl}: ${count} chunks`);
        });
        console.log(`• Context Retrieval Latency: ${executionTimeMs} ms\n`);

        return {
            rawChunks,
            deduplicated,
            diversified,
            executionTimeMs
        };
    }
}

module.exports = {
    RetrievalAllocator,
    ChunkDeduplicator,
    ContextDiversifier,
    MergedContextBuilder,
    IntentRetriever,
    retrieveIntentAwareContext: (decomposed, threshold) => IntentRetriever.retrieve(decomposed, threshold)
};
