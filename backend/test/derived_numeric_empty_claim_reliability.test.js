const test = require('node:test');
const assert = require('node:assert/strict');

const { validateDetailed, STATUS } = require('../src/rag/intelligence/answerValidator');
const { validateDerivedClaim, DERIVED_STATUS } = require('../src/rag/intelligence/derivedClaimValidator');
const { evaluateGroundingSafety, applyGroundingSafetyBoundary, DECISION, SAFE_FALLBACK } = require('../src/rag/security/groundingSafetyBoundary');

const tenantId = 'numeric-dev-owner';
const chunk = (id, text, extra = {}) => ({ id, chunkId: id, tenantId, text, active: true, ...extra });
const validate = (answer, evidence, question = '') => validateDetailed(answer, evidence, { tenantId, question });

function boundary({ route = 'COMPANY_KNOWLEDGE', answer, evidence = [], validation = { claims: [] } }) {
    return evaluateGroundingSafety({ tenantId, route, question: 'سؤال تجريبي', answer,
        validatedAnswer: answer, serverEvidence: evidence, validation });
}

test('generic derived numeric and empty-claim safety contracts', async t => {
    await t.test('1 verbal percentage reduction', () => {
        const evidence = [chunk('base', 'رسم العضوية 500 شيقل.'), chunk('rate', 'ينخفض رسم العضوية بنسبة 10%.')];
        const result = validate('رسم العضوية بعد الانخفاض 450 شيقل.', evidence, 'كم يصبح رسم العضوية؟');
        assert.equal(result.overallStatus, STATUS.SUPPORTED);
        assert.deepEqual(result.claims[0].evidenceChunkIds.sort(), ['base', 'rate']);
    });

    await t.test('2 verbal percentage increase', () => {
        const evidence = [chunk('base', 'الرسم الأساسي 400 شيقل.'), chunk('rate', 'يرتفع الرسم الأساسي بنسبة 15%.')];
        assert.equal(validate('الرسم بعد الارتفاع 460 شيقل.', evidence, 'كم يصبح الرسم؟').overallStatus, STATUS.SUPPORTED);
    });

    await t.test('3 percentage phrase after the result still selects money output', () => {
        const evidence = [chunk('base', 'بدل المعالجة 250 شيقل.'), chunk('rate', 'نسبة التخفيض 20% على بدل المعالجة.')];
        assert.equal(validate('بدل المعالجة يصبح 200 شيقل بعد نسبة التخفيض 20%.', evidence,
            'كم يصبح بدل المعالجة؟').overallStatus, STATUS.SUPPORTED);
    });

    await t.test('4 percentage bound by Arabic بنسبة to its base', () => {
        const evidence = [chunk('base', 'تكلفة الإجراء 600 شيقل.'), chunk('rate', 'تنخفض تكلفة الإجراء بنسبة 25%.')];
        assert.equal(validate('تكلفة الإجراء بعد التخفيض 450 شيقل.', evidence,
            'كم تصبح تكلفة الإجراء؟').overallStatus, STATUS.SUPPORTED);
    });

    await t.test('5 user-provided base is marked and rule ID retained', () => {
        const evidence = [chunk('rate', 'تخفيض الكمية 10% على إجمالي الفاتورة.')];
        const result = validate('الإجمالي بعد التخفيض 270 شيقل.', evidence,
            'إجمالي الفاتورة 300 شيقل، كم يصبح؟');
        assert.equal(result.overallStatus, STATUS.SUPPORTED);
        assert.deepEqual(result.claims[0].evidenceChunkIds, ['rate']);
        assert.equal(result.claims[0].derivedProvenance.inputs.some(input => input.source === 'USER_INPUT'), true);
    });

    await t.test('6 wrong percentage is rejected', () => {
        const evidence = [chunk('base', 'الرسم 500 شيقل.'), chunk('rate', 'تخفيض 10% على الرسم.')];
        assert.notEqual(validate('الرسم بعد تخفيض 20% يصبح 400 شيقل.', evidence).overallStatus, STATUS.SUPPORTED);
    });

    await t.test('7 wrong base is rejected', () => {
        const evidence = [chunk('base', 'الرسم 500 شيقل.'), chunk('rate', 'تخفيض 10% على الرسم.')];
        assert.notEqual(validate('الرسم 600 شيقل وبعد التخفيض يصبح 540 شيقل.', evidence).overallStatus, STATUS.SUPPORTED);
    });

    await t.test('8 wrong unit is rejected', () => {
        const evidence = [chunk('base', 'المدة 100 دقيقة.'), chunk('rate', 'تخفيض 10% على المدة.')];
        assert.notEqual(validate('المدة بعد التخفيض 90 ساعة.', evidence).overallStatus, STATUS.SUPPORTED);
    });

    await t.test('9 wrong arithmetic is rejected', () => {
        const evidence = [chunk('base', 'الرسم 500 شيقل.'), chunk('rate', 'تخفيض 10% على الرسم.')];
        assert.notEqual(validate('الرسم بعد التخفيض 470 شيقل.', evidence).overallStatus, STATUS.SUPPORTED);
    });

    await t.test('10 expired percentage premise is rejected for current question', () => {
        const result = validateDerivedClaim({ claim: 'الرسم بعد التخفيض 90 شيقل.',
            question: 'الرسم 100 شيقل، كم يصبح الآن بعد التخفيض؟', tenantId,
            now: new Date('2026-09-04T12:00:00Z'), chunks: [
                chunk('expired', 'تخفيض 10% على الرسم.', { validFrom: '2026-01-01', validTo: '2026-01-31' })
            ] });
        assert.equal(result.status, DERIVED_STATUS.NOT_PROVEN);
    });

    await t.test('11 cross-tenant percentage premises are rejected', () => {
        const result = validateDerivedClaim({ claim: 'الرسم بعد التخفيض 450 شيقل.', question: 'كم يصبح الرسم؟', tenantId,
            chunks: [chunk('base', 'الرسم 500 شيقل.'), chunk('rate', 'تخفيض 10% على الرسم.', { tenantId: 'other-owner' })] });
        assert.equal(result.status, DERIVED_STATUS.NOT_PROVEN);
    });

    await t.test('12 business route with zero validated claims blocks and falls back', () => {
        const result = applyGroundingSafetyBoundary({ tenantId, route: 'COMPANY_KNOWLEDGE',
            answer: 'إجابة غير مثبتة.', validatedAnswer: 'إجابة غير مثبتة.', validation: { claims: [] }, serverEvidence: [] });
        assert.equal(result.decision, DECISION.BLOCK);
        assert.equal(result.outputAnswer, SAFE_FALLBACK);
    });

    await t.test('13 removed mixed-tenant claims block with deterministic reason', () => {
        const evidence = [chunk('foreign', 'الرسم 500 شيقل.', { tenantId: 'other-owner' })];
        const validation = { claims: [{ text: 'الرسم 500 شيقل.', propositionText: 'الرسم 500 شيقل.',
            sourceText: 'الرسم 500 شيقل.', factual: true, classification: STATUS.SUPPORTED,
            finalClassification: STATUS.SUPPORTED, evidenceChunkIds: ['foreign'], numericResult: { relation: 'ENTAILED', claimQuantities: [{ value: 500 }] } }] };
        const result = boundary({ answer: SAFE_FALLBACK, evidence, validation });
        assert.equal(result.decision, DECISION.BLOCK);
        assert.match(result.reasons.join(' '), /EVIDENCE_TENANT_MISMATCH/u);
    });

    await t.test('14 unsupported extra removed while supported claim remains allows', () => {
        const evidence = [chunk('duration', 'مدة الإجراء 35 دقيقة.')];
        const validation = validate('مدة الإجراء 35 دقيقة. ويتضمن هدية.', evidence);
        const result = boundary({ answer: validation.finalAnswer, evidence, validation });
        assert.equal(result.decision, DECISION.ALLOW);
    });

    await t.test('15 social conversation with no claims remains unchanged', () => {
        assert.equal(boundary({ route: 'GENERAL_CONVERSATION', answer: 'أهلًا وسهلًا!', validation: { claims: [] } }).decision, DECISION.ALLOW);
    });

    await t.test('16 direct supported business claim allows', () => {
        const evidence = [chunk('duration', 'مدة الإجراء 35 دقيقة.')];
        const validation = validate('مدة الإجراء 35 دقيقة.', evidence);
        assert.equal(boundary({ answer: validation.finalAnswer, evidence, validation }).decision, DECISION.ALLOW);
    });
});
