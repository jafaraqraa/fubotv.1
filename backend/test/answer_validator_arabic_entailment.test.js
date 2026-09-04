const test = require('node:test');
const assert = require('node:assert/strict');
const {
    STATUS,
    hasNegation,
    extractQuantities,
    validateDetailed
} = require('../src/rag/intelligence/answerValidator');

function classify(claim, evidence) {
    return validateDetailed(claim, [{ id: 'evidence-1', text: evidence }]);
}

test('deterministic Arabic claim-to-evidence entailment', async t => {
    await t.test('alphanumeric model and SKU identifiers are not business quantities', () => {
        for (const identifier of ['X1', 'S24', 'A55', 'M2', 'RTX4090', 'WH-1000XM5']) {
            assert.deepEqual(extractQuantities(`الموديل ${identifier}`), [], identifier);
        }
    });

    await t.test('real prices percentages durations thresholds and time ranges remain quantities', () => {
        assert.equal(extractQuantities('1299 ILS')[0].value, 1299);
        assert.equal(extractQuantities('15%')[0].unit, 'PERCENT');
        assert.equal(extractQuantities('2 days')[0].unit, 'DAY');
        assert.equal(extractQuantities('30 minutes')[0].value, 30);
        assert.equal(extractQuantities('>= 300 ILS')[0].value, 300);
        assert.deepEqual(extractQuantities('09:00–16:00').map(item => item.value), [9, 16]);
    });
    const freeShipping = 'الطلبات التي تتجاوز 300 شيكل تحصل على توصيل مجاني.';

    await t.test('301 ILS satisfies an explicit greater-than 300 ILS condition', () => {
        const result = classify('التوصيل سيكون مجانياً لطلبية بقيمة 301 شيكل.', freeShipping);
        assert.equal(result.overallStatus, STATUS.SUPPORTED);
        assert.equal(result.claims[0].numericResult.relation, 'ENTAILED');
    });

    await t.test('leading no answer particle does not negate the following positive proposition', () => {
        const result = classify(
            'لا، بما أن قيمة الطلب تتجاوز 300 شيكل، سيكون التوصيل مجانياً.',
            freeShipping
        );
        assert.equal(result.overallStatus, STATUS.SUPPORTED);
    });

    await t.test('300 ILS does not satisfy greater-than 300 ILS', () => {
        const result = classify('التوصيل سيكون مجانياً لطلبية بقيمة 300 شيكل.', freeShipping);
        assert.equal(result.overallStatus, STATUS.CONTRADICTED);
    });

    await t.test('299 ILS does not satisfy greater-than 300 ILS', () => {
        const result = classify('التوصيل سيكون مجانياً لطلبية بقيمة 299 شيكل.', freeShipping);
        assert.equal(result.overallStatus, STATUS.CONTRADICTED);
    });

    await t.test('equivalent greater-than condition remains supported', () => {
        const result = classify(
            'يجب أن تتجاوز قيمة الطلب 300 شيكل للحصول على التوصيل المجاني.',
            'التوصيل مجاني للطلبات التي تتجاوز 300 شيكل.'
        );
        assert.equal(result.overallStatus, STATUS.SUPPORTED);
    });

    await t.test('matching percentage is supported and mismatching percentage is contradicted', () => {
        const evidence = 'يحصل العميل على كوبون خصم 10%.';
        assert.equal(classify('قيمة الخصم 10%.', evidence).overallStatus, STATUS.SUPPORTED);
        assert.equal(classify('قيمة الخصم 15%.', evidence).overallStatus, STATUS.CONTRADICTED);
    });

    await t.test('written one hour equals numeric one hour', () => {
        const result = classify(
            'سيتم التواصل معك خلال ساعة واحدة.',
            'يتم التواصل مع العميل خلال 1 ساعة.'
        );
        assert.equal(result.overallStatus, STATUS.SUPPORTED);
        assert.equal(result.claims[0].numericResult.relation, 'ENTAILED');
    });

    await t.test('duration units cannot be exchanged', () => {
        const result = classify(
            'يتم التواصل خلال 48 يوم.',
            'يتم التواصل خلال 48 ساعة.'
        );
        assert.equal(result.overallStatus, STATUS.CONTRADICTED);
        assert.equal(result.claims[0].numericResult.reason, 'unit_mismatch');
    });

    await t.test('an order at 9 or 8:30 satisfies an after 8 PM condition', () => {
        const evidence = 'الطلبات التي يتم إرسالها بعد الساعة 8 مساءً يتم تجهيزها صباح اليوم التالي.';
        assert.equal(classify(
            'الطلب المرسل الساعة 9 مساءً يتم تجهيزه صباح اليوم التالي.', evidence
        ).overallStatus, STATUS.SUPPORTED);
        assert.equal(classify(
            'الطلب المرسل الساعة 8:30 مساءً يتم تجهيزه صباح اليوم التالي.', evidence
        ).overallStatus, STATUS.SUPPORTED);
    });

    await t.test('currency units cannot be exchanged', () => {
        const result = classify(
            'التوصيل مجاني فوق 300 دولار.',
            'التوصيل مجاني للطلبات التي تتجاوز 300 شيكل.'
        );
        assert.equal(result.overallStatus, STATUS.CONTRADICTED);
    });

    await t.test('tracking and modification possessive paraphrases are supported', () => {
        assert.equal(classify(
            'يمكنك تتبع طلبك باستخدام رقم الطلب.',
            'يمكن تتبع الطلب باستخدام رقم الطلب.'
        ).overallStatus, STATUS.SUPPORTED);
        assert.equal(classify(
            'يمكن تعديل طلبك فقط قبل بدء تجهيزه.',
            'يمكن تعديل الطلب قبل بدء التجهيز فقط.'
        ).overallStatus, STATUS.SUPPORTED);
    });

    await t.test('offer exclusion paraphrase preserves aligned negation', () => {
        const result = classify(
            'التوصيل المجاني لا يشمل الطلبات ضمن العروض الخاصة.',
            'التوصيل المجاني لا يحتسب مع العروض الخاصة.'
        );
        assert.equal(result.overallStatus, STATUS.SUPPORTED);
        assert.equal(result.claims[0].negationResult.relation, 'ALIGNED');
    });

    await t.test('removing offer exclusion negation is contradicted', () => {
        const result = classify(
            'التوصيل المجاني يحتسب مع العروض الخاصة.',
            'التوصيل المجاني لا يحتسب مع العروض الخاصة.'
        );
        assert.equal(result.overallStatus, STATUS.CONTRADICTED);
        assert.equal(result.claims[0].negationResult.relation, 'MISMATCH');
    });

    await t.test('negation is token-aware and خلال is not negation', () => {
        assert.equal(hasNegation('سيتم التواصل خلال ساعة'), false);
        for (const value of ['لا يشمل', 'ليس متاحاً', 'ليست متاحة', 'لن يصل', 'لم يصل', 'غير متوفر']) {
            assert.equal(hasNegation(value), true, value);
        }
    });

    await t.test('tenant-owned image description supports a generic name claim', () => {
        const result = classify(
            'الشخص الموجود في الصورة هو سامر أحمد.',
            'وصف صورة: سامر احمد.'
        );
        assert.equal(result.overallStatus, STATUS.SUPPORTED);
        assert.equal(result.claims[0].matchedEvidenceId, 'evidence-1');
        assert.equal(result.claims[0].matchedSentence, 'وصف صورة: سامر احمد.');
    });

    await t.test('image metadata labels are compared as separate evidence facts', () => {
        const result = classify(
            'الشخص الموجود في الصورة هو سامر أحمد.',
            'صورة معتمد قابل للإرسال: example.jpeg وصف صورة: سامر احمد نوع المصدر: صورة من مكتبة معرفة الشركة.'
        );
        assert.equal(result.overallStatus, STATUS.SUPPORTED);
        assert.match(result.claims[0].matchedSentence, /وصف صورة: سامر احمد/);
    });

    await t.test('different image identity is never accepted', () => {
        const result = classify(
            'الشخص الموجود في الصورة هو خالد محمود.',
            'وصف صورة: سامر احمد.'
        );
        assert.notEqual(result.overallStatus, STATUS.SUPPORTED);
    });

    await t.test('Palestinian paraphrase remains supported', () => {
        const result = classify(
            'بتقدر تتبع طلبك باستعمال رقم الطلب.',
            'يمكن تتبع الطلب باستخدام رقم الطلب.'
        );
        assert.notEqual(result.overallStatus, STATUS.CONTRADICTED);
        assert.notEqual(result.overallStatus, STATUS.UNSUPPORTED);
    });

    await t.test('fully supported comma-separated multi-intent answer keeps both claims', () => {
        const result = classify(
            'التوصيل مجاني فوق 300 شيكل، وبتقدر تتبع الطلب باستخدام رقم الطلب.',
            'التوصيل مجاني للطلبات التي تتجاوز 300 شيكل. يمكن تتبع الطلب باستخدام رقم الطلب.'
        );
        assert.equal(result.claims.length, 2);
        assert.ok(result.claims.every(claim => claim.classification === STATUS.SUPPORTED));
        assert.doesNotMatch(result.finalAnswer, /لا تتوفر لدي معلومات/);
    });

    await t.test('partially supported multi-intent answer removes only unsafe claim', () => {
        const result = classify(
            'بتقدر تتبع الطلب باستخدام رقم الطلب، وعندنا فرع على القمر.',
            'يمكن تتبع الطلب باستخدام رقم الطلب.'
        );
        assert.equal(result.overallStatus, STATUS.PARTIAL);
        assert.match(result.finalAnswer, /تتبع الطلب/);
        assert.doesNotMatch(result.finalAnswer, /فرع على القمر/);
    });

    await t.test('diagnostics preserve matched sentence and structured decisions', () => {
        const result = classify('قيمة الخصم 10%.', 'يحصل العميل على كوبون خصم 10%.');
        const claim = result.claims[0];
        assert.equal(claim.matchedEvidenceId, 'evidence-1');
        assert.equal(claim.finalClassification, STATUS.SUPPORTED);
        assert.equal(claim.numericResult.relation, 'ENTAILED');
        assert.equal(claim.negationResult.relation, 'ALIGNED');
        assert.equal(typeof claim.semanticScore, 'number');
    });
});
