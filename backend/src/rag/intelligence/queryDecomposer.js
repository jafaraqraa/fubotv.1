const { detectIntents } = require('./intentDetector');

/**
 * Normalizes sub-queries for comparisons and deduplication.
 */
class QueryNormalizer {
    static normalize(text) {
        if (!text || typeof text !== 'string') return '';
        let normalized = text.toLowerCase().trim();
        // Remove basic punctuation
        normalized = normalized.replace(/[؟?.,،!;:]/g, '');
        // Standardize Arabic Alif, Yeh, Ta Marbuta
        normalized = normalized.replace(/[أإآ]/g, 'ا');
        normalized = normalized.replace(/ة/g, 'ه');
        normalized = normalized.replace(/ى/g, 'ي');
        return normalized.trim().replace(/\s+/g, ' ');
    }
}

/**
 * Splits complex queries using explicit separators: and, then, also, etc.
 */
class QuestionSplitter {
    static split(query) {
        if (!query || typeof query !== 'string') return [];

        // Safe separators list with lookahead to prevent false splits on native "و" words like "وصلني"
        const separators = [
            /\?/, /؟/, /\./, /,/, /،/,
            /\s+و(?=ما|لا|لم|لن|بدي|اريد|تعديل|استرجاع|الغاء|ارجاع|شحن|دفع|سداد|سعر|تتبع|حساب|مشكله|خدمه)/,
            /\s+ثم\s+/, /\s+ايضا\s+/, /\s+كمان\s+/,
            /\band\b/i, /\balso\b/i, /\bthen\b/i
        ];

        let clauses = [query];

        for (const sep of separators) {
            let nextClauses = [];
            for (const clause of clauses) {
                const parts = clause.split(sep).map(p => p.trim()).filter(Boolean);
                nextClauses.push(...parts);
            }
            clauses = nextClauses;
        }

        return clauses;
    }
}

/**
 * Extracts and cleans split clauses.
 */
class ClauseExtractor {
    static extract(clauses) {
        return clauses
            .map(c => c.trim())
            .filter(c => c.length >= 3) // filter out extremely short connectors
            .map(c => {
                let cleaned = c;
                // Strip leading Arabic "و" if any escaped splitting
                cleaned = cleaned.replace(/^و/, '');
                // Strip redundant leading connectors like "بدي", "اريد", "حابب", "ابي", "كمان", "ايضا", "ثم"
                cleaned = cleaned.replace(/^(اريد|بدي|حابب|ابي|كمان|ايضا|ثم|and|also|then|want\s+to|please)\s+/i, '');
                return cleaned.trim();
            })
            .filter(c => c.length >= 3);
    }
}

/**
 * Maps cleaned clauses to intents and computes final confidence.
 */
class IntentMapper {
    static mapClause(clause) {
        const detected = detectIntents(clause);
        let intent = "General";
        let confidence = 0.50;

        if (detected && detected.intents && detected.intents.length > 0) {
            const top = detected.intents[0];
            intent = top.name;
            confidence = top.confidence;
        }

        // Refine implicit semantic labels for cleaner enterprise output
        let queryLabel = clause;
        if (intent === "Payment" && clause.includes("دفعت")) {
            queryLabel = "Payment Status";
        } else if (intent === "Shipping" && clause.includes("وصلني")) {
            queryLabel = "Shipping Status";
        } else if (intent === "Order Modification") {
            queryLabel = "Modify Order";
        } else if (intent === "Returns") {
            queryLabel = "Return Product";
        } else if (intent === "Refund") {
            queryLabel = "Refund Request";
        } else if (intent === "Shipping" && (clause.includes("شحن") || clause.includes("توصيل"))) {
            queryLabel = "shipping fees";
        } else if (intent === "Customer Support") {
            queryLabel = "customer support";
        }

        return {
            query: queryLabel,
            intent: intent,
            confidence: confidence
        };
    }
}

/**
 * Removes semantic duplicates and merges equivalent sub-queries.
 */
class DuplicateRemover {
    static remove(decomposedList) {
        const unique = [];
        const seenNormal = new Set();
        const seenIntent = new Set();

        let removedCount = 0;

        for (const item of decomposedList) {
            const normalQuery = QueryNormalizer.normalize(item.query);

            // Deduplicate if identical query or if same intent is matched on similar short clause
            if (seenNormal.has(normalQuery)) {
                removedCount++;
                continue;
            }

            // For semantic deduplication, if intent is the same and queries are highly similar, skip
            if (seenIntent.has(item.intent) && item.intent !== "General" && item.intent !== "Product Information") {
                // If we already have this intent with higher confidence, skip this one
                const existing = unique.find(u => u.intent === item.intent);
                if (existing && existing.confidence >= item.confidence) {
                    removedCount++;
                    continue;
                }
            }

            seenNormal.add(normalQuery);
            if (item.intent !== "General") {
                seenIntent.add(item.intent);
            }
            unique.push(item);
        }

        return { unique, removedCount };
    }
}

/**
 * Enterprise production-ready Query Decomposition Subsystem.
 */
class QueryDecomposer {
    /**
     * Decomposes a single complex user query into multiple atomic retrieval sub-queries.
     *
     * @param {string} query - Complex query.
     * @returns {Array<Object>} List of sub-queries with intents and confidence scores.
     */
    static decompose(query) {
        const startTime = Date.now();
        if (!query || typeof query !== 'string' || query.trim() === '') {
            return [];
        }

        // 1. Split query by separators
        const rawClauses = QuestionSplitter.split(query);

        // 2. Extract and clean clauses
        const extractedClauses = ClauseExtractor.extract(rawClauses);

        // 3. Map clauses to intents
        const mappedList = extractedClauses.map(clause => IntentMapper.mapClause(clause));

        // 4. Deduplicate and merge equivalent queries
        const { unique, removedCount } = DuplicateRemover.remove(mappedList);

        const durationMs = Date.now() - startTime;

        // Developer logging
        if (unique.length > 0) {
            console.log(`\n🔍 [Query Decomposition Engine]`);
            console.log(`• Original Query: "${query}"`);
            console.log(`• Decomposed Clauses count: ${rawClauses.length}`);
            console.log(`• Extracted Clauses: [${extractedClauses.join(' | ')}]`);
            console.log(`• Decomposed Sub-Queries (${unique.length}):`);
            unique.forEach((item, idx) => {
                console.log(`  [${idx + 1}] Query: "${item.query}" | Intent: "${item.intent}" | Confidence: ${item.confidence}`);
            });
            console.log(`• Removed Duplicates Count: ${removedCount}`);
            console.log(`• Execution Time: ${durationMs} ms\n`);
        }

        return unique;
    }
}

module.exports = {
    QueryDecomposer,
    QuestionSplitter,
    ClauseExtractor,
    IntentMapper,
    QueryNormalizer,
    DuplicateRemover,
    decomposeQuery: (query) => QueryDecomposer.decompose(query)
};
