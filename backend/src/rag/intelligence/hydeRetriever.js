/**
 * Generates local hypothetical document answers based on typical query patterns (HyDE).
 * This boosts semantic search relevance by embedding structured hypothetical answers.
 */
function generateHypotheticalAnswer(query) {
    if (!query || typeof query !== 'string') return '';

    const queryLower = query.toLowerCase();

    if (queryLower.includes('شحن') || queryLower.includes('القدس') || queryLower.includes('قدس')) {
        return 'الشحن والتوصيل لمدينة القدس يتم عبر شركة التوصيل المعتمدة لدينا، بتكلفة ثابتة تبلغ 30 شيكل لجميع الطلبيات والطرود.';
    }

    if (queryLower.includes('دفع') || queryLower.includes('سداد') || queryLower.includes('فيزا')) {
        return 'الموقع يدعم طرق دفع متعددة تشمل الدفع نقداً عند الاستلام (كاش) والبطاقات الائتمانية فيزا وماستركارد بأمان تامل.';
    }

    if (queryLower.includes('ارجاع') || queryLower.includes('استبدال') || queryLower.includes('سياسة')) {
        return 'سياسة الارجاع والتبديل تتيح للعملاء ارجاع الطرد خلال 3 ايام من تاريخ الاستلام في حال وجود خلل او عيب مصنعي مجاناً.';
    }

    return `هذا مستند توضيحي يتعلق بـ ${query} ويتضمن تفاصيل دقيقة وشاملة حول هذا الموضوع لمساعدة المساعد الذكي.`;
}

module.exports = {
    generateHypotheticalAnswer
};
