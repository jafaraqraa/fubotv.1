/**
 * IntentNormalizer performs fast local text normalization
 * for both Arabic and English to support dialects and spelling mistakes.
 */
class IntentNormalizer {
    /**
     * Normalizes query string for uniform matching.
     * Removes diacritics, maps similar Arabic letters, and trims whitespace.
     */
    static normalize(text) {
        if (!text || typeof text !== 'string') return '';
        let normalized = text.toLowerCase();

        // Arabic Character Normalization
        normalized = normalized.replace(/[ًٌٍَُِّْ]/g, ''); // Strip Arabic diacritics (harakat)
        normalized = normalized.replace(/[أإآ]/g, 'ا'); // Normalize Alif to plain Alif
        normalized = normalized.replace(/ة/g, 'ه'); // Normalize Ta Marbuta to Hah
        normalized = normalized.replace(/ى/g, 'ي'); // Normalize Alif Maqsura to Yeh
        normalized = normalized.replace(/ـ/g, ''); // Strip Tatweel (Kashida)

        // Trim and collapse whitespace
        return normalized.trim().replace(/\s+/g, ' ');
    }
}

/**
 * IntentRegistry registers all possible intents and their synonyms/patterns.
 * Easy to extend for any future intents.
 */
class IntentRegistry {
    static getIntents() {
        return {
            "Shipping": [
                "شحن", "توصيل", "رسوم التوصيل", "تكلفه الشحن", "يوصل", "وصل الطلب", "وصلني", "رسوم شحن", "توصيل للقدس", "موقعكم", "طرد",
                "shipping", "delivery", "shipping cost", "shipment", "cost of shipping", "deliver", "ship"
            ],
            "Returns": [
                "ارجاع", "استرجاع", "ترجيع", "ارجاع المنتج", "ترجيع المنتج", "ارجاع الطلب", "ارجع", "يرجع", "برجع", "ارجعه", "رجع", "استبدال", "سياسه الاستبدال",
                "return", "returns", "return policy", "returning"
            ],
            "Refund": [
                "استرداد", "استرجاع الاموال", "كاش باك", "استرداد المبلغ", "رجع فلوسي", "رجعولي فلوسي",
                "refund", "refunds", "money back", "refund policy", "get money back"
            ],
            "Order Modification": [
                "تعديل الطلب", "تغيير الطلب", "اعدل الطلب", "تعديل", "تغيير طلب", "اغير الطلب", "اعدل طلبي", "اغير طلبي", "اعدل", "اغير",
                "modify order", "change order", "order modification", "modify", "edit order", "update order"
            ],
            "Customer Support": [
                "الدعم", "خدمه العملاء", "التواصل", "التواصل معكم", "تواصل", "كلمني", "تواصل معنا", "دعم", "رقم", "هاتف", "واتس",
                "contact", "support", "customer support", "customer service", "help", "agent", "human support"
            ],
            "Payment": [
                "دفع", "سداد", "فيزا", "كاش", "طريقه الدفع", "دفعت", "دفع كاش", "فيزا كارد", "فيزا",
                "pay", "payment", "card", "cash", "visa", "payments", "how to pay"
            ],
            "Delivery": [
                "توصيل", "تسليم", "موعد التوصيل", "متي يوصل", "تسليم الطلب",
                "delivery", "deliver", "delivery time", "delivery date", "when will it arrive", "delivery method"
            ],
            "Warranty": [
                "ضمان", "كفاله", "الضمان", "ضمان المنتج", "كفاله المنتج", "كفاله",
                "warranty", "guarantee", "warranties"
            ],
            "Account": [
                "حسابي", "تسجيل الدخول", "حساب", "التسجيل", "انشاء حساب", "حساب العميل",
                "login", "account", "register", "sign up", "my account", "sign in"
            ],
            "Technical Issue": [
                "مشكله فنيه", "عطل", "تطبيق", "موقع", "مشكله", "خراب", "ما بيشتغل", "تعليق", "خلل", "عيب",
                "technical issue", "technical", "bug", "error", "not working", "crash", "tech issue"
            ],
            "Cancellation": [
                "الغاء", "كنسل", "الغاء الطلب", "كنسله", "الغاء طلبي",
                "cancel", "cancellation", "cancel order", "cancelling"
            ],
            "Product Information": [
                "تفاصيل المنتج", "معلومات", "مواصفات", "تفاصيل", "معلومات المنتج", "عن المنتج", "شرح المنتج",
                "product", "details", "info", "description", "product info", "about product"
            ],
            "Pricing": [
                "السعر", "سعر", "كم السعر", "تكلفه", "الاسعار", "قديش", "بكم",
                "price", "prices", "pricing", "cost", "how much", "rate"
            ],
            "Orders": [
                "طلبي", "تتبع", "حاله الطلب", "طلباتي", "رقم الطلب", "وين طلبي", "تتبع الطلب", "اين الطلب",
                "order", "orders", "track", "order status", "my order", "order details"
            ],
            "Coupons": [
                "كوبون", "كود خصم", "كوبونات", "كود الخصم", "قسيمه",
                "coupon", "coupons", "promo code", "promo", "voucher"
            ],
            "Discounts": [
                "خصم", "تخفيض", "عروض", "تنزيلات", "الخصومات", "عرض خاص",
                "discount", "discounts", "sale", "offer", "offers"
            ],
            "Store Policy": [
                "شروط", "سياسه", "قوانين", "سياسه المتجر", "الشروط والاحكام",
                "policy", "policies", "store policy", "rules", "terms"
            ],
            "Complaint": [
                "شكوي", "اعتراض", "خدمه سيئه", "سيئ", "تاخر الطلب", "مشتكي",
                "complaint", "complaints", "bad service", "complain", "delay", "issue with order"
            ]
        };
    }
}

/**
 * IntentScorer scores each registered intent against normalized text
 * using word overlap and phrase matching.
 */
class IntentScorer {
    static scoreIntent(normalizedQuery, intentName, synonyms) {
        let score = 0;
        let matchedKeywords = [];

        for (const synonym of synonyms) {
            const normalizedSynonym = IntentNormalizer.normalize(synonym);
            if (!normalizedSynonym) continue;

            // 1. Exact or whole phrase matching (high score)
            if (normalizedQuery === normalizedSynonym) {
                score += 5.0;
                matchedKeywords.push(synonym);
            }
            // 2. Contains as substring
            else if (normalizedQuery.includes(normalizedSynonym)) {
                // If it's a multi-word phrase, give a higher weight
                const wordsCount = normalizedSynonym.split(' ').length;
                score += 1.0 + (wordsCount * 0.5);
                matchedKeywords.push(synonym);
            }
        }

        return { score, matchedKeywords };
    }
}

/**
 * IntentConfidenceCalculator maps raw match scores into normalized confidence bounds [0.0, 1.0].
 */
class IntentConfidenceCalculator {
    static calculateConfidence(score) {
        if (score <= 0) return 0.0;
        // Mathematical dynamic curve: confidence increases with higher score, capping at 0.98
        const rawConfidence = 1.0 - Math.exp(-score * 0.35);
        return Math.round((Math.max(0.1, Math.min(0.98, rawConfidence))) * 100) / 100;
    }
}

/**
 * Central Multi-Intent Detection Engine.
 */
class IntentDetector {
    /**
     * Detects all matching intents in descending order of confidence.
     *
     * @param {string} query - The raw input query.
     * @returns {Object} { intents: [ { name, confidence, matchedKeywords } ] }
     */
    static detectIntents(query) {
        const startTime = Date.now();
        if (!query || typeof query !== 'string' || query.trim() === '') {
            return { intents: [], executionTimeMs: 0 };
        }

        const normalizedQuery = IntentNormalizer.normalize(query);
        const registry = IntentRegistry.getIntents();
        const results = [];

        for (const [intentName, synonyms] of Object.entries(registry)) {
            const { score, matchedKeywords } = IntentScorer.scoreIntent(normalizedQuery, intentName, synonyms);
            if (score > 0) {
                const confidence = IntentConfidenceCalculator.calculateConfidence(score);
                results.push({
                    name: intentName,
                    confidence,
                    matchedKeywords
                });
            }
        }

        // Sort descending by confidence
        results.sort((a, b) => b.confidence - a.confidence);

        const executionTimeMs = Date.now() - startTime;

        // Developer logging
        if (results.length > 0) {
            console.log(`\n🎯 [Multi-Intent Detection Engine]`);
            console.log(`• Raw Query: "${query}"`);
            console.log(`• Normalized Query: "${normalizedQuery}"`);
            console.log(`• Detected Intents (${results.length}):`);
            results.forEach((r, idx) => {
                console.log(`  [${idx + 1}] Intent: "${r.name}" | Confidence: ${r.confidence} | Matched: [${r.matchedKeywords.join(', ')}]`);
            });
            console.log(`• Engine Execution Time: ${executionTimeMs} ms\n`);
        }

        return {
            intents: results,
            executionTimeMs
        };
    }
}

// Preserve constant mapping compatibility for legacy references
const INTENTS = IntentRegistry.getIntents();

/**
 * Detects the highest-confidence intent of a query.
 * Calls detectIntents internally to achieve modern multi-intent processing.
 *
 * @param {string} query - The raw input query.
 * @returns {string} The highest-confidence intent name or 'General' as fallback.
 */
function detectIntent(query) {
    const result = IntentDetector.detectIntents(query);
    if (result && result.intents && result.intents.length > 0) {
        const top = result.intents[0];
        if (top.confidence >= 0.15) {
            return top.name;
        }
    }
    return 'General';
}

/**
 * Detects all intents matching the query.
 * Exposes multi-intent payload with confidence.
 *
 * @param {string} query - The raw input query.
 * @returns {Object} { intents: [ { name, confidence, matchedKeywords } ] }
 */
function detectIntents(query) {
    return IntentDetector.detectIntents(query);
}

/**
 * Boosts retrieval candidates matching the detected intent.
 * Intact and perfectly preserved backward compatibility.
 */
function influenceRetrieval(candidates, intent) {
    if (!candidates || !Array.isArray(candidates)) return [];
    if (!intent || intent === 'Unknown' || intent === 'General') return candidates;

    const intentKeywords = INTENTS[intent] || [];

    return candidates.map(c => {
        const textLower = (c.text || '').toLowerCase();
        const sourceLower = (c.source || '').toLowerCase();

        let hasMatch = false;

        // Match source files or content
        if (intent === 'Shipping' && (sourceLower.includes('shipping') || textLower.includes('شحن') || textLower.includes('توصيل'))) {
            hasMatch = true;
        } else if (intent === 'Payment' && (sourceLower.includes('payment') || textLower.includes('دفع') || textLower.includes('سداد'))) {
            hasMatch = true;
        } else if (intent === 'Returns' && (sourceLower.includes('return') || textLower.includes('ارجاع') || textLower.includes('استرجاع') || textLower.includes('استبدال'))) {
            hasMatch = true;
        } else {
            // General match on intent keywords
            hasMatch = intentKeywords.some(kw => textLower.includes(kw));
        }

        if (hasMatch) {
            // Apply 10% mathematical boost to context chunks matching the intent
            const baseScore = c.finalScore || c.score || c.semanticScore || 0;
            const boostedScore = baseScore + 0.10;
            return {
                ...c,
                finalScore: boostedScore,
                score: boostedScore,
                intentBoosted: true
            };
        }

        return {
            ...c,
            finalScore: c.finalScore || c.score || c.semanticScore || 0,
            intentBoosted: false
        };
    });
}

module.exports = {
    detectIntent,
    detectIntents,
    influenceRetrieval,
    INTENTS
};
