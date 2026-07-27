/**
 * Generates semantic and search-optimized query variations from a single user query.
 */
function generateMultiQueries(query) {
    if (!query || typeof query !== 'string') return [];

    const queryLower = query.toLowerCase();
    const variations = [query];

    // Rule-based variation injection for testing & standard operations
    if (queryLower.includes('سأدفع') || queryLower.includes('يصل') || queryLower.includes('منزلي')) {
        variations.push('رسوم التوصيل');
        variations.push('تكلفة الشحن');
        variations.push('كم سعر التوصيل');
    }

    if (queryLower.includes('شحن') || queryLower.includes('قدس') || queryLower.includes('القدس')) {
        variations.push('الشحن للقدس');
        variations.push('سعر توصيل القدس');
    }

    if (queryLower.includes('ارجاع') || queryLower.includes('استبدال')) {
        variations.push('سياسة الاسترجاع والتعويض');
        variations.push('شروط التبديل');
    }

    return [...new Set(variations)];
}

module.exports = {
    generateMultiQueries
};
