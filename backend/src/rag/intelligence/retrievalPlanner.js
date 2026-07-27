const { detectIntents } = require('./intentDetector');
const { decomposeQuery } = require('./queryDecomposer');

/**
 * Analyzes the structural complexity, question type, and intent details of the query.
 */
class QueryAnalyzer {
    /**
     * Determines whether the query is procedural (asking "how to", "steps to", etc.).
     */
    static isProcedural(queryLower) {
        return /كيف|طريقة|خطوات|شرح|كيفية|\bhow\b|\bsteps\b|\bmethod\b|\bway\b|tutorial|guide/i.test(queryLower);
    }

    /**
     * Determines whether the query is comparative (asking to compare, difference between, etc.).
     */
    static isComparative(queryLower) {
        return /مقارنة|الفرق|فرق|قارن|مقارنه|\bcompare\b|difference|versus|\bvs\b|comparison/i.test(queryLower);
    }

    /**
     * Determines whether the query is focused or broad.
     */
    static isFocused(queryLower) {
        // Highly specific key terms mean focused search
        return /سعر|تكلفة|رسوم|توصيل|شحن|رقم|واتس|فيزا|كاش|خصم|كود|\bprice\b|\bcost\b|\bfees\b|\bfee\b|visa|card|cash/i.test(queryLower);
    }
}

/**
 * Analyzes conversational context and markers in the query.
 */
class ConversationAnalyzer {
    static isConversational(queryLower) {
        // Conversational cues: greetings, emotional expressions, situation stories
        // We use word boundaries \b for English words to avoid false positive substring matches (like 'hi' inside 'shipping')
        return /مرحبا|اهلين|شكرا|هلو|دفعت|اشتريت|ما وصل|وصلني|\bhello\b|\bhi\b|\bthanks\b|\bthank\s+you\b|\bpaid\b|\bbought\b|\barrived\b/i.test(queryLower);
    }
}

/**
 * Matches patterns and chooses the optimal strategy.
 */
class StrategySelector {
    /**
     * Chooses optimal retrieval strategy.
     *
     * @param {string} query - Raw query.
     * @returns {Object} Strategy, confidence, reason, and estimated queries.
     */
    static selectStrategy(query) {
        if (!query || typeof query !== 'string' || query.trim() === '') {
            return {
                strategy: "SimpleRetrieval",
                confidence: 1.0,
                reason: "Query is empty.",
                estimatedQueries: 1
            };
        }

        const queryLower = query.toLowerCase().trim();

        // 1. Run multi-intent and query decomposition analyzers
        const decomposed = decomposeQuery(query);

        // A. Comparative check
        if (QueryAnalyzer.isComparative(queryLower)) {
            return {
                strategy: "ComparativeRetrieval",
                confidence: 0.95,
                reason: "Comparative indicators detected ('compare', 'difference', 'مقارنة').",
                estimatedQueries: Math.max(2, decomposed.length)
            };
        }

        // B. Conversational combined with Multi-Intent
        if (ConversationAnalyzer.isConversational(queryLower) && decomposed.length >= 2) {
            return {
                strategy: "ConversationalRetrieval",
                confidence: 0.90,
                reason: "Conversational situation combined with multiple intents detected.",
                estimatedQueries: decomposed.length
            };
        }

        // C. Multi-Intent check
        if (decomposed.length >= 2) {
            return {
                strategy: "MultiIntentRetrieval",
                confidence: 0.94,
                reason: "Multiple independent retrieval sub-queries detected via QueryDecomposer.",
                estimatedQueries: decomposed.length
            };
        }

        // D. Procedural check
        if (QueryAnalyzer.isProcedural(queryLower)) {
            return {
                strategy: "ProceduralRetrieval",
                confidence: 0.92,
                reason: "Procedural indicators detected ('how to', 'steps', 'طريقة').",
                estimatedQueries: 1
            };
        }

        // E. Conversational check alone
        if (ConversationAnalyzer.isConversational(queryLower)) {
            return {
                strategy: "ConversationalRetrieval",
                confidence: 0.85,
                reason: "Conversational cues and markers detected.",
                estimatedQueries: 1
            };
        }

        // F. Focused vs Broad search based on analyzer
        if (QueryAnalyzer.isFocused(queryLower)) {
            return {
                strategy: "FocusedSearch",
                confidence: 0.88,
                reason: "Focused query containing specific concrete parameter terms.",
                estimatedQueries: 1
            };
        }

        // G. Default fallback to Simple Retrieval
        return {
            strategy: "SimpleRetrieval",
            confidence: 0.80,
            reason: "Standard simple query.",
            estimatedQueries: 1
        };
    }
}

/**
 * Builds the strategy planning response structure.
 */
class PlanBuilder {
    static buildPlan(query) {
        return StrategySelector.selectStrategy(query);
    }
}

/**
 * High-performance, local Retrieval Planning Engine.
 */
class RetrievalPlanner {
    /**
     * Decides the optimal retrieval plan before search execution.
     *
     * @param {string} query - Raw input query.
     * @returns {Object} Strategy plan with confidence, reason, estimatedQueries, and latency.
     */
    static plan(query) {
        const startTime = Date.now();
        const plan = PlanBuilder.buildPlan(query);
        const executionTimeMs = Date.now() - startTime;

        // Developer logging
        console.log(`\n🧠 [Retrieval Planning Engine]`);
        console.log(`• Input Query: "${query}"`);
        console.log(`• Selected Strategy: "${plan.strategy}"`);
        console.log(`• Confidence: ${plan.confidence}`);
        console.log(`• Reason: "${plan.reason}"`);
        console.log(`• Estimated Queries: ${plan.estimatedQueries}`);
        console.log(`• Planner Latency: ${executionTimeMs} ms\n`);

        return {
            ...plan,
            executionTimeMs
        };
    }
}

module.exports = {
    QueryAnalyzer,
    ConversationAnalyzer,
    StrategySelector,
    PlanBuilder,
    RetrievalPlanner,
    getRetrievalPlan: (query) => RetrievalPlanner.plan(query)
};
