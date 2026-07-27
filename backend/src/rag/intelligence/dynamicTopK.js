/**
 * Dynamically estimates the optimal Top-K complexity for the query.
 * Longer, more complex questions with specific intents warrant deeper retrieval context,
 * whereas brief conversational inputs scale down to avoid noise.
 */
function determineSmarterTopK(query, tokens, intent, candidates) {
    // Baseline defaults
    let k = 4;

    if (!query) return k;

    // High complexity queries (query length > 50 characters, or multiple unique tokens)
    if (query.length > 50 || (tokens && tokens.length >= 3)) {
        k = 6;
    } else if (query.length < 15 || (tokens && tokens.length <= 1)) {
        k = 3;
    }

    // Adjust based on intent
    if (intent && ['Shipping', 'Payment', 'Returns', 'Technical'].includes(intent)) {
        k = Math.max(k, 5);
    }

    return k;
}

module.exports = {
    determineSmarterTopK
};
