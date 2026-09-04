const test = require('node:test');
const assert = require('node:assert/strict');
const { extractQuantities, validateDetailed, STATUS } = require('../src/rag/intelligence/answerValidator');
const { RELATION, evaluateConditionalPolicy } = require('../src/rag/security/conditionalPolicyGuard');

const tenantId = 'synthetic-energy-a';
const policy = {
    id: 'battery-policy', tenantId, retrievalScore: 0.9, rerankerScore: 0.9,
    text: [
        'إذا كانت السعة 20 ساعة أو أكثر: تمنح أولوية ذهبية.',
        'إذا كانت السعة أقل من 20 ساعة وأكثر من 5 ساعات: تمنح أولوية فضية.',
        'إذا كانت السعة 5 ساعات أو أقل: تمنح أولوية برونزية.'
    ].join('\n')
};
const guard = (claim, question, chunks = [policy], id = tenantId) =>
    evaluateConditionalPolicy({ claim, question, chunks, tenantId: id, extractQuantities });

test('isolated generic conditional-policy P0 guard', async t => {
    await t.test('1 value inside middle branch', () =>
        assert.equal(guard('الأولوية فضية.', 'السعة 12 ساعة').relation, RELATION.SUPPORTED));
    await t.test('2 inclusive upper boundary', () =>
        assert.equal(guard('الأولوية ذهبية.', 'السعة 20 ساعة').relation, RELATION.SUPPORTED));
    await t.test('3 exclusive middle boundary does not select middle', () =>
        assert.equal(guard('الأولوية فضية.', 'السعة 5 ساعات').relation, RELATION.BLOCK));
    await t.test('4 value below threshold', () =>
        assert.equal(guard('الأولوية برونزية.', 'السعة 2 ساعة').relation, RELATION.SUPPORTED));
    await t.test('5 value above threshold', () =>
        assert.equal(guard('الأولوية ذهبية.', 'السعة 31 ساعة').relation, RELATION.SUPPORTED));
    await t.test('6 correct branch outcome is supported', () =>
        assert.equal(guard('تمنح أولوية فضية.', 'السعة 8 ساعات').reason, 'ACTIVE_BRANCH_OUTCOME'));
    await t.test('7 wrong branch outcome is blocked', () =>
        assert.equal(guard('تمنح أولوية ذهبية.', 'السعة 8 ساعات').reason, 'WRONG_BRANCH_OUTCOME'));
    await t.test('8 wrong unit cannot select a branch', () =>
        assert.equal(guard('الأولوية ذهبية.', 'السعة 20 يوما').relation, RELATION.NOT_APPLICABLE));
    await t.test('9 overlapping branches fail closed', () => {
        const overlapping = { id: 'overlap', tenantId, text: 'إذا كانت القيمة 10 ساعات أو أكثر: مسار أول.\nإذا كانت القيمة 8 ساعات أو أكثر: مسار ثان.' };
        assert.equal(guard('مسار أول.', 'القيمة 12 ساعة', [overlapping]).reason, 'AMBIGUOUS_BRANCHES');
    });
    await t.test('10 missing evidence ID fails closed', () => {
        const missing = { ...policy }; delete missing.id;
        assert.equal(guard('الأولوية ذهبية.', 'السعة 20 ساعة', [missing]).reason, 'MISSING_EVIDENCE_ID');
    });
    await t.test('11 tenant mismatch is ignored', () =>
        assert.equal(guard('الأولوية ذهبية.', 'السعة 20 ساعة', [{ ...policy, tenantId: 'synthetic-energy-b' }]).relation, RELATION.NOT_APPLICABLE));
    await t.test('12 user-provided value selects without becoming evidence', () => {
        const result = guard('الأولوية فضية.', 'أنا أعطيتك السعة: 11 ساعة');
        assert.deepEqual(result.evidenceIds, ['battery-policy']);
    });
    await t.test('13 direct non-conditional numeric fact remains a control', () => {
        const direct = { id: 'direct', tenantId, text: 'سعر الفحص 40 شيكل.', retrievalScore: 0.9, rerankerScore: 0.9 };
        assert.equal(guard('سعر الفحص 40 شيكل.', 'كم السعر؟', [direct]).relation, RELATION.NOT_APPLICABLE);
        assert.equal(validateDetailed('سعر الفحص 40 شيكل.', [direct], { tenantId, question: 'كم السعر؟' }).overallStatus, STATUS.SUPPORTED);
    });
    await t.test('14 ordinary percentage calculation remains a control', () => {
        const direct = { id: 'percent', tenantId, text: 'السعر الأساسي 200 شيكل والخصم 10%.', retrievalScore: 0.9, rerankerScore: 0.9 };
        assert.equal(guard('السعر بعد الخصم 180 شيكل.', 'كم يصبح بعد الخصم؟', [direct]).relation, RELATION.NOT_APPLICABLE);
        assert.equal(validateDetailed('السعر بعد الخصم 180 شيكل.', [direct], { tenantId, question: 'كم يصبح بعد الخصم؟' }).overallStatus, STATUS.SUPPORTED);
    });
});

test('wrong conditional branch is removed from the final validator response', () => {
    const result = validateDetailed('تمنح أولوية ذهبية.', [policy], { tenantId, question: 'السعة 12 ساعة' });
    assert.equal(result.overallStatus, STATUS.CONTRADICTED);
    assert.doesNotMatch(result.finalAnswer, /ذهبية/);
});
