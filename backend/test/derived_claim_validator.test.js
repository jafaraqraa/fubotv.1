const test = require('node:test');
const assert = require('node:assert/strict');
const { validateDerivedClaim, DERIVED_STATUS } = require('../src/rag/intelligence/derivedClaimValidator');
const { validateDetailed, STATUS } = require('../src/rag/intelligence/answerValidator');

const tenantId = 'tenant-a';
const chunk = (id, text, extra = {}) => ({ id, chunkId: id, tenantId, text, ...extra });
const supported = input => {
    const result = validateDerivedClaim({ tenantId, ...input });
    assert.equal(result.status, DERIVED_STATUS.SUPPORTED);
    return result;
};
const rejected = input => assert.equal(
    validateDerivedClaim({ tenantId, ...input }).status,
    DERIVED_STATUS.NOT_PROVEN
);

test('deterministic multi-evidence derived claim validation', async t => {
    await t.test('same-chunk percentage discount', () => {
        supported({ question: 'بعد خصم الاستشارة كم السعر؟', claim: 'السعر بعد الخصم 135 شيقل.',
            chunks: [chunk('all', 'سعر الاستشارة 150 شيقل وخصم الاستشارات 10% يطبق على رسوم الاستشارات.')] });
    });

    await t.test('cross-chunk percentage discount and complete provenance', () => {
        const result = supported({ question: 'إذا الاستشارة 150 شيقل وعندي خصم كبار السن، كم بصير السعر؟',
            claim: 'إذا كانت الاستشارة 150 شيقل فبعد الخصم يصبح السعر 135 شيقل.',
            chunks: [chunk('price', 'سعر الاستشارة 150 شيقل.'), chunk('discount', 'خصم كبار السن 10% ويطبق على رسوم الاستشارات.')] });
        assert.deepEqual(new Set(result.provenance.evidenceIds), new Set(['price', 'discount']));
        assert.deepEqual(result.provenance.scopeEvidenceIds, ['discount']);
    });

    await t.test('cross-chunk addition', () => {
        const result = supported({ question: 'ما مجموع رسوم الخدمة والتركيب؟', claim: 'المجموع 120 شيقل.',
            chunks: [chunk('service', 'رسوم الخدمة 100 شيقل.'), chunk('install', 'رسوم التركيب 20 شيقل.')] });
        assert.deepEqual(new Set(result.provenance.evidenceIds), new Set(['service', 'install']));
    });

    await t.test('cross-chunk subtraction', () => {
        supported({ question: 'شو الفرق بين سعر الباقة الأساسية والمتقدمة؟', claim: 'الفرق 30 شيقل.',
            chunks: [chunk('advanced', 'سعر الباقة المتقدمة 100 شيقل.'), chunk('basic', 'سعر الباقة الأساسية 70 شيقل.')] });
    });

    await t.test('missing scope premise', () => {
        rejected({ question: 'بعد خصم الاستشارة كم؟', claim: 'السعر بعد الخصم 135 شيقل.',
            chunks: [chunk('price', 'سعر الاستشارة 150 شيقل.'), chunk('discount', 'يوجد خصم 10%.')] });
    });

    await t.test('wrong scope', () => {
        rejected({ question: 'بعد خصم الاستشارة كم؟', claim: 'السعر بعد الخصم 135 شيقل.',
            chunks: [chunk('price', 'سعر الاستشارة 150 شيقل.'), chunk('discount', 'خصم 10% يطبق على الإكسسوارات فقط.')] });
    });

    await t.test('incompatible units', () => {
        rejected({ question: 'ما المجموع؟', claim: 'المجموع 160 شيقل.',
            chunks: [chunk('a', 'رسوم الخدمة 150 شيقل.'), chunk('b', 'رسوم إضافية 10 دولار.')] });
    });

    await t.test('tenant mismatch', () => {
        rejected({ question: 'بعد الخصم كم؟', claim: 'بعد الخصم 135 شيقل.',
            chunks: [chunk('price', 'سعر الاستشارة 150 شيقل.'), { id: 'discount', tenantId: 'tenant-b', text: 'خصم 10% يطبق على الاستشارات.' }] });
    });

    await t.test('missing evidence ID', () => {
        rejected({ question: 'بعد الخصم كم؟', claim: 'بعد الخصم 135 شيقل.',
            chunks: [chunk('price', 'سعر الاستشارة 150 شيقل.'), { tenantId, text: 'خصم 10% يطبق على الاستشارات.' }] });
    });

    await t.test('user-provided base value is input, not evidence', () => {
        const result = supported({ question: 'إذا السعر 200 شيقل والخصم المطبق على الخدمة 10% قديش بصير؟',
            claim: 'السعر بعد الخصم 180 شيقل.', chunks: [chunk('discount', 'خصم الخدمة 10% يطبق على رسوم الخدمة.')] });
        assert.equal(result.provenance.inputs[0].source, 'USER_INPUT');
        assert.equal(result.provenance.inputs[0].evidenceId, null);
    });

    await t.test('hallucinated arithmetic result', () => {
        rejected({ question: 'الاستشارة 150 شيقل وبعد الخصم كم؟', claim: 'بعد الخصم 140 شيقل.',
            chunks: [chunk('discount', 'خصم الاستشارات 10% يطبق على رسوم الاستشارات.')] });
    });

    await t.test('rounding to currency precision', () => {
        const result = supported({ question: 'السعر 99.99 شيقل وبعد خصم الخدمة كم؟', claim: 'بعد الخصم 89.99 شيقل.',
            chunks: [chunk('discount', 'خصم الخدمة 10% يطبق على رسوم الخدمة.')] });
        assert.equal(result.provenance.expectedResult.value, 89.99);
    });

    await t.test('temporally invalid premise', () => {
        rejected({ question: 'السعر اليوم 150 شيقل وبعد الخصم كم؟', claim: 'السعر اليوم بعد الخصم 135 شيقل.', now: new Date('2026-09-04T12:00:00Z'),
            chunks: [chunk('discount', 'خصم الاستشارات 10% يطبق على رسوم الاستشارات.', { validTo: '2026-08-01' })] });
    });

    await t.test('answerValidator integration exposes all provenance IDs', () => {
        const chunks = [chunk('price', 'سعر الاستشارة 150 شيقل.'), chunk('discount', 'خصم كبار السن 10% ويطبق على رسوم الاستشارات.')];
        const result = validateDetailed('إذا كانت الاستشارة 150 شيقل فبعد الخصم يصبح السعر 135 شيقل.', chunks,
            { tenantId, question: 'إذا الاستشارة 150 شيقل وعندي خصم كبار السن، كم بصير السعر؟' });
        assert.equal(result.overallStatus, STATUS.SUPPORTED);
        assert.equal(result.claims[0].derivedStatus, DERIVED_STATUS.SUPPORTED);
        assert.deepEqual(new Set(result.claims[0].evidenceChunkIds), new Set(['price', 'discount']));
    });
});
