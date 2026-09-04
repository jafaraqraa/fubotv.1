const test = require('node:test');
const assert = require('node:assert/strict');
const {
    STATUS, extractQuantities, validateDetailed
} = require('../src/rag/intelligence/answerValidator');

function verdict(claim, evidence) {
    return validateDetailed(claim, [{ id: 'authoritative', text: evidence }]);
}

test('Arabic clock time and independently scoped numeric conditions', async t => {
    await t.test('Arabic clock marker before HH:MM is supported', () => {
        const result = verdict('ساعات العمل من الساعة 09:00 حتى 16:00', 'الخميس 09:00–16:00');
        assert.equal(result.overallStatus, STATUS.SUPPORTED);
        assert.deepEqual(extractQuantities('من الساعة 09:00 حتى 16:00').map(q => q.unit), ['CLOCK', 'CLOCK']);
    });

    await t.test('clock range without marker is supported', () => {
        assert.equal(verdict('من 09:00 حتى 16:00', 'الخميس 09:00–16:00').overallStatus, STATUS.SUPPORTED);
    });

    const policy = 'التوصيل مجاني عندما تكون قيمة الطلب 300 شيقل أو أكثر بعد الخصومات. لا ينطبق التوصيل المجاني على أجهزة التلفاز الأكبر من 55 بوصة.';

    await t.test('order instance and TV exception align independently', () => {
        const result = verdict(
            'طلب 301 شيقل مؤهل للتوصيل المجاني ما لم يتضمن تلفازًا أكبر من 55 بوصة.',
            policy
        );
        assert.equal(result.overallStatus, STATUS.SUPPORTED);
        assert.equal(result.claims[0].numericResult.relation, 'ENTAILED');
    });

    await t.test('changed free-delivery threshold remains contradicted', () => {
        const result = verdict(
            'الحد الأدنى للتوصيل المجاني هو 301 شيقل أو أكثر.',
            'الحد الأدنى للتوصيل المجاني هو 300 شيقل أو أكثر.'
        );
        assert.equal(result.overallStatus, STATUS.CONTRADICTED);
    });

    await t.test('changed TV-size boundary remains contradicted', () => {
        assert.equal(verdict(
            'أجهزة التلفاز الأكبر من 50 بوصة مستثناة.',
            'أجهزة التلفاز الأكبر من 55 بوصة مستثناة.'
        ).overallStatus, STATUS.CONTRADICTED);
    });

    await t.test('duration units remain distinct', () => {
        assert.equal(verdict('المدة 30 ساعة.', 'المدة 30 دقيقة.').overallStatus, STATUS.CONTRADICTED);
    });
});
