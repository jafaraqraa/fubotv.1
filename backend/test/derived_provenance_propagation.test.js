const test = require('node:test');
const assert = require('node:assert/strict');

const { validateDetailed, STATUS } = require('../src/rag/intelligence/answerValidator');
const { validateDerivedClaim, DERIVED_STATUS } = require('../src/rag/intelligence/derivedClaimValidator');
const { evaluateGroundingSafety, DECISION } = require('../src/rag/security/groundingSafetyBoundary');
const { serializeChunks, parseSerializedChunks } = require('../src/rag/security/promptInjectionGuard');

const tenantId = 'synthetic-owner';
const chunk = (id, text, extra = {}) => ({ chunkId: id, id, tenantId, text, active: true, ...extra });

function boundary(answer, question, evidence, validation, owner = tenantId) {
    return evaluateGroundingSafety({ tenantId: owner, route: 'COMPANY_KNOWLEDGE',
        answer, validatedAnswer: answer, question, serverEvidence: evidence, validation });
}

test('derived claim provenance propagation contract', async t => {
    await t.test('direct claim keeps its server evidence ID', () => {
        const evidence = [chunk('direct-fact', 'مدة الإجراء 45 دقيقة.')];
        const result = validateDetailed('مدة الإجراء 45 دقيقة.', evidence, { tenantId });
        assert.equal(result.overallStatus, STATUS.SUPPORTED);
        assert.deepEqual(result.claims[0].evidenceChunkIds, ['direct-fact']);
    });

    await t.test('percentage arithmetic unions cross-chunk business premises', () => {
        const evidence = [
            chunk('base-rule', 'قيمة الاشتراك 240 شيقل.'),
            chunk('rate-rule', 'خصم التجديد 25% على الاشتراك.')
        ];
        const result = validateDetailed('قيمة الاشتراك بعد خصم التجديد 180 شيقل.', evidence,
            { tenantId, question: 'كم تصبح قيمة الاشتراك بعد خصم التجديد؟' });
        assert.equal(result.overallStatus, STATUS.SUPPORTED);
        assert.deepEqual(result.claims[0].evidenceChunkIds.sort(), ['base-rule', 'rate-rule']);
        assert.deepEqual(result.claims[0].derivedProvenance.evidenceIds.sort(), ['base-rule', 'rate-rule']);
    });

    await t.test('user value plus threshold rule keeps rule provenance', () => {
        const evidence = [chunk('threshold-rule', 'الطلب مؤهل عندما تكون القيمة 640 شيقل أو أكثر')];
        const result = validateDetailed('القيمة 700 شيقل تقع ضمن النطاق المؤهل.', evidence,
            { tenantId, question: 'القيمة 700 شيقل، هل تحقق الشرط؟' });
        assert.equal(result.overallStatus, STATUS.SUPPORTED);
        assert.deepEqual(result.claims[0].evidenceChunkIds, ['threshold-rule']);
        assert.equal(result.claims[0].derivedProvenance.inputs.some(input => input.source === 'USER_INPUT'), true);
    });

    await t.test('threshold provenance survives an independently split answer', () => {
        const evidence = [chunk('threshold-rule', 'التسجيل متاح لمن يبلغ تقييمه أكثر من 70 نقطة.')];
        const result = validateDetailed('التسجيل متاح لمن يبلغ تقييمه أكثر من 70 نقطة، وتقييم المستخدم 81 نقطة يحقق الشرط.', evidence,
            { tenantId, question: 'تقييمي 81 نقطة، هل أحقق شرط التسجيل؟' });
        assert.equal(result.overallStatus, STATUS.SUPPORTED);
        for (const claim of result.claims) assert.deepEqual(claim.evidenceChunkIds, ['threshold-rule']);
    });

    await t.test('derived validator exposes all evidence premises and user premise marker', () => {
        const evidence = [chunk('rate', 'خصم العضوية 20% على الرسم.')];
        const result = validateDerivedClaim({ claim: 'الرسم بعد خصم العضوية 80 شيقل.',
            question: 'الرسم 100 شيقل، كم يصبح بعد خصم العضوية؟', chunks: evidence, tenantId });
        assert.equal(result.status, DERIVED_STATUS.SUPPORTED);
        assert.deepEqual(result.provenance.evidenceIds, ['rate']);
        assert.equal(result.provenance.inputs.some(input => input.source === 'USER_INPUT' && input.evidenceId === null), true);
    });

    await t.test('evidence ID union is unique and stable', () => {
        const evidence = [chunk('rate', 'خصم العضوية 20% على الرسم. خصم العضوية 20% على الرسم.')];
        const result = validateDerivedClaim({ claim: 'الرسم بعد خصم العضوية 80 شيقل.',
            question: 'الرسم 100 شيقل، كم يصبح؟', chunks: evidence, tenantId });
        assert.deepEqual(result.provenance.evidenceIds, ['rate']);
    });

    await t.test('mixed-tenant derived premises are rejected', () => {
        const evidence = [chunk('base', 'قيمة الاشتراك 240 شيقل.'),
            chunk('rate', 'خصم التجديد 25% على الاشتراك.', { tenantId: 'different-owner' })];
        const result = validateDerivedClaim({ claim: 'قيمة الاشتراك بعد الخصم 180 شيقل.',
            question: 'كم تصبح القيمة؟', chunks: evidence, tenantId });
        assert.equal(result.status, DERIVED_STATUS.NOT_PROVEN);
    });

    await t.test('missing server-issued ID fails closed', () => {
        const result = validateDerivedClaim({ claim: 'الرسم بعد الخصم 80 شيقل.',
            question: 'الرسم 100 شيقل، كم يصبح بعد الخصم؟',
            chunks: [{ tenantId, text: 'خصم 20% على الرسم.' }], tenantId });
        assert.equal(result.status, DERIVED_STATUS.NOT_PROVEN);
    });

    await t.test('fake evidence ID is blocked by Boundary', () => {
        const evidence = [chunk('real-rule', 'مدة الإجراء 45 دقيقة.')];
        const validation = validateDetailed('مدة الإجراء 45 دقيقة.', evidence, { tenantId });
        validation.claims[0].evidenceChunkIds = ['invented-rule'];
        assert.equal(boundary(validation.finalAnswer, 'كم المدة؟', evidence, validation).decision, DECISION.BLOCK);
    });

    await t.test('serialization preserves server-issued IDs', () => {
        const evidence = [chunk('serialized-rule', 'مدة الإجراء 45 دقيقة.')];
        const serialized = serializeChunks(evidence);
        assert.deepEqual(parseSerializedChunks(serialized).map(item => item.chunkId), ['serialized-rule']);
        const result = validateDetailed('مدة الإجراء 45 دقيقة.', serialized, { tenantId });
        assert.deepEqual(result.claims[0].evidenceChunkIds, ['serialized-rule']);
    });

    await t.test('Boundary allows complete derived provenance', () => {
        const evidence = [chunk('threshold-rule', 'الطلب مؤهل عند قيمة 640 شيقل أو أكثر')];
        const validation = validateDetailed('القيمة 700 شيقل تحقق شرط التأهل.', evidence,
            { tenantId, question: 'القيمة 700 شيقل، هل تحقق الشرط؟' });
        assert.equal(boundary(validation.finalAnswer, 'القيمة 700 شيقل، هل تحقق الشرط؟', evidence, validation).decision, DECISION.ALLOW);
    });

    await t.test('Boundary blocks incomplete derived provenance', () => {
        const evidence = [chunk('threshold-rule', 'الطلب مؤهل عند قيمة 640 شيقل أو أكثر')];
        const validation = validateDetailed('القيمة 700 شيقل تحقق شرط التأهل.', evidence,
            { tenantId, question: 'القيمة 700 شيقل، هل تحقق الشرط؟' });
        validation.claims[0].evidenceChunkIds = [];
        assert.equal(boundary(validation.finalAnswer, 'القيمة 700 شيقل، هل تحقق الشرط؟', evidence, validation).decision, DECISION.BLOCK);
    });
});
