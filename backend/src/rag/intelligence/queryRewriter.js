const rules = [
    {
        pattern: /كيف.*اشتري|طريقة.*الشراء|كيف.*اطلب|طريقة.*الطلب/i,
        rewrite: 'خطوات الشراء وكيفية الطلب من الموقع وطريقة الدفع والتوصيل'
    },
    {
        pattern: /سعر.*الشحن|تكلفة.*التوصيل|رسوم.*الشحن|كم.*الشحن/i,
        rewrite: 'اسعار الشحن والتوصيل للمحافظات وتكلفة التوصيل للقدس والضفة'
    },
    {
        pattern: /الارجاع|الاستبدال|ارجاع.*طرد|استبدال.*منتج/i,
        rewrite: 'سياسة الارجاع والتعويض والتبديل وشروط الاستبدال للطلبات'
    }
];

/**
 * Rewrites or expands brief queries into optimal search terms.
 */
function rewriteQuery(query) {
    if (!query || typeof query !== 'string') return '';

    // Check match rules
    for (const rule of rules) {
        if (rule.pattern.test(query)) {
            // Include original and optimized search terms
            return `${query} خطوات الشراء طريقة الطلب ${rule.rewrite}`;
        }
    }

    return query;
}

module.exports = {
    rewriteQuery
};
