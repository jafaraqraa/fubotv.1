/**
 * Normalizes Arabic text for retrieval purposes.
 * Keeps the original meaning intact and preserves Latin names/numbers.
 */
function normalizeArabic(text) {
    if (!text || typeof text !== 'string') return '';

    // 1. Remove Arabic diacritics (harakat)
    const diacritics = /[\u064B-\u0652\u0670]/g;
    let normalized = text.replace(diacritics, '');

    // 2. Remove tatweel (ـ)
    normalized = normalized.replace(/\u0640/g, '');

    // 3. Normalize Alefs (أ, إ, آ to ا)
    normalized = normalized.replace(/[\u0622\u0623\u0625]/g, '\u0627');

    // 4. Normalize Alef Maqsura (ى to ي)
    normalized = normalized.replace(/\u0649/g, '\u064A');

    // 5. Normalize Ta Marbuta (ة to ه)
    normalized = normalized.replace(/\u0629/g, '\u0647');

    // 6. Normalize whitespace (excessive spaces, repeated spaces)
    normalized = normalized.replace(/\s+/g, ' ').trim();

    return normalized;
}

const ARABIC_STOPWORDS = new Set([
    'من', 'في', 'على', 'إلى', 'عن', 'مع', 'هذا', 'هذه', 'هل', 'ما', 'هو', 'هي',
    'التي', 'الذي', 'ان', 'انها', 'او', 'ثم', 'حتى', 'حول', 'كان', 'كانت', 'لكن',
    'لقد', 'ليس', 'ليست', 'كل', 'بعض'
]);

/**
 * Normalizes and splits a query string into unique non-stopword Arabic/Latin tokens.
 * Includes punctuation removal, token deduplication, and safe stopwords filtering.
 */
function normalizeQueryTokens(query) {
    if (!query || typeof query !== 'string') return [];

    // 1. Normalize diacritics/letters
    let normalized = normalizeArabic(query);

    // 2. Remove Arabic and Latin punctuation/symbols (preserve letters/numbers)
    const punctuation = /[\.,\/#!$%\^&\*;:{}=\-_`~()؟?!\u060C\u061F\u061B\u060D]/g;
    normalized = normalized.replace(punctuation, ' ');

    // 3. Spacing normalization & split
    const tokens = normalized.split(/\s+/).map(t => t.trim().toLowerCase()).filter(Boolean);

    // 4. Token deduplication & stop-word filtering
    const uniqueTokens = [...new Set(tokens)];
    return uniqueTokens.filter(t => (t.length > 1 || /^\d+$/.test(t)) && !ARABIC_STOPWORDS.has(t));
}

module.exports = {
    normalizeArabic,
    normalizeQueryTokens
};
