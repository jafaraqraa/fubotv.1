const test = require('node:test');
const assert = require('node:assert/strict');

const { validateDetailed, STATUS } = require('../src/rag/intelligence/answerValidator');
const { decideEvidence, DECISION } = require('../src/rag/intelligence/evidenceDecisionGate');
const { evaluateGroundingSafety, DECISION: BOUNDARY } = require('../src/rag/security/groundingSafetyBoundary');
const { answerMatchesExpectedFacts } = require('../scripts/evaluate-generalization-v1');
const ai = require('../src/services/ai');

const tenantId = 'tenant-neutral';
const chunk = (id, text, extra = {}) => ({ chunkId: id, tenantId, text, active: true, ...extra });
const validate = (answer, evidence, question = '') => validateDetailed(answer, evidence, { tenantId, question });

test('generic evidence decision and validation reliability', async t => {
    await t.test('1 direct supported proposition accepted by Gate', () => {
        assert.equal(decideEvidence({ query: 'شو دوام المركز؟', tenantId,
            chunks: [chunk('hours', 'المركز يعمل من الاثنين إلى الخميس 10:00–16:00.')] }).decision, DECISION.ANSWER);
    });

    await t.test('2 related but unproven proposition rejected', () => {
        assert.equal(decideEvidence({ query: 'شو دوام المركز؟', tenantId,
            chunks: [chunk('related', 'المركز يقدم خدمات تدريبية.')] }).decision, DECISION.NO_ANSWER);
    });

    await t.test('3 complete-list positive membership', () => {
        const result = validate('نعم، العنصر باء من الفئات المدعومة.',
            [chunk('set', 'هذه هي القائمة الكاملة الحالية للفئات المدعومة: العنصر ألف، العنصر باء.')],
            'هل العنصر باء من الفئات المدعومة؟');
        assert.equal(result.overallStatus, STATUS.SUPPORTED);
        assert.equal(result.claims[0].completeListEntailed, true);
    });

    await t.test('4 complete-list negative membership', () => {
        assert.equal(validate('لا يوجد العنصر جيم ضمن الفئات.',
            [chunk('set', 'هذه هي القائمة الكاملة الحالية للفئات: العنصر ألف، العنصر باء.')],
            'هل يوجد العنصر جيم ضمن الفئات؟').overallStatus, STATUS.SUPPORTED);
    });

    await t.test('5 incomplete-list negative rejected', () => {
        assert.notEqual(validate('لا يوجد العنصر جيم ضمن الفئات.',
            [chunk('set', 'تشمل الفئات العنصر ألف والعنصر باء.')],
            'هل يوجد العنصر جيم ضمن الفئات؟').overallStatus, STATUS.SUPPORTED);
    });

    await t.test('6 wrong complete-list subject rejected', () => {
        assert.notEqual(validate('لا يوجد المزود جيم ضمن المزودين.',
            [chunk('set', 'هذه هي القائمة الكاملة للمواقع: الموقع ألف، الموقع باء.')],
            'هل المزود جيم ضمن المزودين؟').overallStatus, STATUS.SUPPORTED);
    });

    await t.test('7 list header and members split across lines', () => {
        assert.equal(validate('نعم، الموقع باء ضمن المواقع.',
            [chunk('set', 'هذه هي القائمة الكاملة الحالية للمواقع:\nالموقع ألف،\nالموقع باء.')],
            'هل الموقع باء ضمن المواقع؟').overallStatus, STATUS.SUPPORTED);
    });

    await t.test('8 list header and members split across adjacent chunks', () => {
        const evidence = [
            chunk('set-1', 'هذه هي القائمة الكاملة الحالية للمواقع:', { documentId: 'set', chunkIndex: 0 }),
            chunk('set-2', 'الموقع ألف، الموقع باء.', { documentId: 'set', chunkIndex: 1 })
        ];
        const result = validate('نعم، الموقع باء ضمن المواقع.', evidence, 'هل الموقع باء ضمن المواقع؟');
        assert.equal(result.overallStatus, STATUS.SUPPORTED);
        assert.deepEqual(result.claims[0].evidenceChunkIds, ['set-1', 'set-2']);
    });

    await t.test('9 unrelated chunks cannot be stitched into a complete list', () => {
        const evidence = [
            chunk('a', 'هذه هي القائمة الكاملة الحالية للمواقع:', { documentId: 'a', chunkIndex: 0 }),
            chunk('b', 'الموقع جيم.', { documentId: 'b', chunkIndex: 1 })
        ];
        const result = validate('نعم، الموقع جيم ضمن المواقع.', evidence,
            'هل الموقع جيم ضمن المواقع؟');
        assert.equal(result.claims[0].completeListEntailed, false);
        assert.notDeepEqual(result.claims[0].evidenceChunkIds.sort(), ['a', 'b']);
    });

    await t.test('10 threshold equality is applied without changing the boundary', () => {
        const result = validate('نعم، القيمة 300 شيقل تحقق الشرط الأدنى 300 شيقل أو أكثر.',
            [chunk('policy', 'القبول متاح عندما تكون القيمة 300 شيقل أو أكثر.')],
            'القيمة 300 شيقل، هل تحقق الشرط؟');
        assert.equal(result.overallStatus, STATUS.SUPPORTED);
    });

    await t.test('11 less-than threshold instance is supported', () => {
        const result = validate('نعم، يمكن التقديم لأن الدخل 1700 شيقل وهو أقل من 1800 شيقل.',
            [chunk('policy', 'التقديم متاح لمن يقل دخله الشهري عن 1800 شيقل.')],
            'الدخل 1700 شيقل، هل يمكن التقديم؟');
        assert.equal(result.overallStatus, STATUS.SUPPORTED);
    });

    await t.test('12 greater-than and greater-or-equal remain distinct', () => {
        assert.equal(validate('الحد الأدنى هو أكثر من 300 شيقل.',
            [chunk('policy', 'الحد الأدنى 300 شيقل أو أكثر.')]).overallStatus, STATUS.CONTRADICTED);
    });

    await t.test('13 removable unsupported suffix preserves supported proposition', () => {
        const result = validate('مدة الإجراء 30 دقيقة. ويتضمن هدية مجانية.',
            [chunk('duration', 'مدة الإجراء 30 دقيقة.')]);
        assert.match(result.finalAnswer, /30 دقيقة/u);
        assert.doesNotMatch(result.finalAnswer, /هدية/u);
    });

    await t.test('14 genuine partial multi-intent remains partial', () => {
        const result = validate('مدة الإجراء 30 دقيقة. وتكلفته 50 شيقل.',
            [chunk('duration', 'مدة الإجراء 30 دقيقة.')]);
        assert.equal(result.overallStatus, STATUS.PARTIAL);
    });

    await t.test('15 Arabic morphology equivalence', () => {
        assert.equal(validate('اللافتة لونها أزرق.',
            [chunk('visual', 'صورة معتمدة تظهر اللافتة الزرقاء.')]).overallStatus, STATUS.SUPPORTED);
    });

    await t.test('16 attached Arabic negation remains aligned', () => {
        assert.equal(validate('الخدمة لا تشمل العنصر الإضافي.',
            [chunk('scope', 'الخدمة الأساسية متاحة، ولا تشمل العنصر الإضافي.')]).overallStatus, STATUS.SUPPORTED);
    });

    await t.test('17 equivalent clock forms', () => {
        assert.equal(validate('العمل من الساعة 09:00 حتى 16:00.',
            [chunk('hours', 'العمل 09:00–16:00.')]).overallStatus, STATUS.SUPPORTED);
    });

    await t.test('18 evaluator recognizes complete-set meaning but rejects wrong numeric', () => {
        assert.equal(answerMatchesExpectedFacts('لا يوجد العنصر جيم. الفئات الحالية هي العنصر ألف، العنصر باء.',
            ['القائمة الكاملة', 'العنصر ألف', 'العنصر باء']), true);
        assert.equal(answerMatchesExpectedFacts('الحد الأدنى 301 شيقل.', ['300 شيقل']), false);
    });

    await t.test('19 tenant mismatch remains blocked', () => {
        const evidence = [chunk('fact', 'القيمة 30 دقيقة.')];
        const validation = validate('القيمة 30 دقيقة.', evidence);
        const boundary = evaluateGroundingSafety({ tenantId: 'other-tenant', route: 'COMPANY_KNOWLEDGE',
            question: 'كم القيمة؟', answer: validation.finalAnswer, validatedAnswer: validation.finalAnswer,
            validation, serverEvidence: evidence });
        assert.equal(boundary.decision, BOUNDARY.BLOCK);
    });

    await t.test('20 evidence-ID integrity remains blocked', () => {
        const evidence = [chunk('fact', 'القيمة 30 دقيقة.')];
        const validation = validate('القيمة 30 دقيقة.', evidence);
        validation.claims[0].evidenceChunkIds = ['unknown-id'];
        const boundary = evaluateGroundingSafety({ tenantId, route: 'COMPANY_KNOWLEDGE',
            question: 'كم القيمة؟', answer: validation.finalAnswer, validatedAnswer: validation.finalAnswer,
            validation, serverEvidence: evidence });
        assert.equal(boundary.decision, BOUNDARY.BLOCK);
    });

    await t.test('21 linked multi-sentence evidence supports one scoped proposition', () => {
        const evidence = chunk('service', 'الخدمة ألف متاحة في الموقع باء. مدة الخدمة ألف في الموقع باء 30 دقيقة.');
        assert.equal(validate('مدة الخدمة ألف في الموقع باء 30 دقيقة.', [evidence],
            'كم مدة الخدمة ألف في الموقع باء؟').overallStatus, STATUS.SUPPORTED);
    });

    await t.test('22 ambiguous sentences do not prove a causal relationship', () => {
        const evidence = chunk('facts', 'الخدمة ألف متاحة. مدة الإجراء 30 دقيقة.');
        assert.notEqual(validate('الخدمة ألف متاحة لذلك مدة الإجراء 30 دقيقة.', [evidence],
            'ما نتيجة توفر الخدمة ألف؟').overallStatus, STATUS.SUPPORTED);
    });

    await t.test('23 expired temporal evidence does not prove a current proposition', () => {
        const result = decideEvidence({ query: 'هل العرض متاح حاليا؟', tenantId,
            now: new Date('2026-09-04T12:00:00+03:00'), chunks: [
                chunk('offer', 'العرض متاح حاليا.', { validFrom: '2026-01-01', validTo: '2026-01-31' })
            ] });
        assert.equal(result.decision, DECISION.NO_ANSWER);
    });

    await t.test('24 AI validation wrapper preserves question and tenant options', () => {
        const evidence = [chunk('set', 'هذه هي القائمة الكاملة الحالية لمناطق الخدمة: الموقع ألف، الموقع باء.')];
        const answer = ai.validateAnswer('نعم، نخدم الموقع باء.', evidence, {
            question: 'هل تخدمون الموقع باء؟', tenantId
        });
        assert.equal(answer, 'نعم، نخدم الموقع باء.');
    });
});
