const test = require('node:test');
const assert = require('node:assert/strict');

const { validateDetailed, STATUS } = require('../src/rag/intelligence/answerValidator');
const { decideEvidence, DECISION, clarificationForQuery } = require('../src/rag/intelligence/evidenceDecisionGate');
const { classifyConversationMode, MODE } = require('../src/services/conversationModeRouter');
const { evaluateGroundingSafety, DECISION: BOUNDARY } = require('../src/rag/security/groundingSafetyBoundary');
const { serializeChunks } = require('../src/rag/security/promptInjectionGuard');

const tenant = 'tenant-generic';
const chunk = (id, text) => ({ chunkId: id, tenantId: tenant, text, active: true });

test('system-wide generic grounding repair', async t => {
    await t.test('doctor abbreviation remains part of the direct factual claim', () => {
        const evidence = chunk('doctors', 'د. سامر خليل — عيون — نابلس. د. ليان حمدان — طب عام — الاستشارة 80 شيقل.');
        assert.equal(validateDetailed('د. سامر خليل يعمل في فرع نابلس.', [evidence]).overallStatus, STATUS.SUPPORTED);
        assert.equal(validateDetailed('فرع د. سامر خليل موجود في نابلس.', [evidence]).overallStatus, STATUS.SUPPORTED);
        assert.equal(validateDetailed('سعر استشارة الطب العام مع د. ليان هو 80 شيقل.', [evidence]).overallStatus, STATUS.SUPPORTED);
    });

    await t.test('serialized trusted context is parsed before legacy Chunk headers', () => {
        const context = serializeChunks([chunk('doctors', '# الأطباء\nالدكتورة ليان منصور مختصة بالجلدية.')]);
        const result = validateDetailed('دكتورة الجلدية هي الدكتورة ليان منصور.', context);
        assert.equal(result.overallStatus, STATUS.SUPPORTED);
        assert.deepEqual(result.claims[0].evidenceChunkIds, ['doctors']);
    });

    await t.test('Arabic written clock hours align with generated numeric clock hours', () => {
        const evidence = chunk('hours', 'العمل من الثامنة والنصف صباحاً حتى السادسة مساءً، والخميس حتى الثانية ظهراً.');
        assert.equal(validateDetailed('العمل من الساعة 8:30 صباحاً حتى الساعة 6 مساءً.', [evidence]).overallStatus, STATUS.SUPPORTED);
        assert.equal(validateDetailed('الخميس حتى الساعة 2 ظهراً.', [evidence]).overallStatus, STATUS.SUPPORTED);
    });

    await t.test('Arabic discourse phrase بعد ذلك does not mutate a money equality', () => {
        const evidence = chunk('fees', 'الإلغاء المتأخر عليه رسم 40 شيكلاً.');
        assert.equal(validateDetailed('بعد ذلك، يتم فرض رسم 40 شيكلاً.', [evidence]).overallStatus, STATUS.SUPPORTED);
    });

    await t.test('verified percentage arithmetic is supported with provenance', () => {
        const evidence = chunk('discount', 'خصم كبار السن 10% على رسوم الاستشارات فقط.');
        const result = validateDetailed('إذا كانت الاستشارة 150 شيقل، السعر بعد الخصم 135 شيقل.', [evidence], {
            question: 'الاستشارة 150 شيقل، كم تصير مع الخصم؟'
        });
        assert.equal(result.overallStatus, STATUS.SUPPORTED);
        assert.equal(result.claims[0].numericResult.derived, true);
        const splitEvidence = [
            chunk('price', 'الاستشارة 150 شيقل.'),
            chunk('discount', 'خصم كبار السن 10% على رسوم الاستشارات فقط.')
        ];
        assert.equal(validateDetailed('الاستشارة 150 شيقل وبعد الخصم السعر 135 شيقل.', splitEvidence, {
            question: 'إذا الاستشارة 150 شيقل وعندي خصم كبار السن، كم بصير السعر؟'
        }).overallStatus, STATUS.SUPPORTED);
    });

    await t.test('arithmetic rejects a wrong result, missing percentage, and incompatible units', () => {
        const evidence = chunk('discount', 'الخصم 10% على الاستشارة.');
        const options = { question: 'الاستشارة 150 شيقل.' };
        assert.notEqual(validateDetailed('السعر بعد الخصم 140 شيقل.', [evidence], options).overallStatus, STATUS.SUPPORTED);
        assert.notEqual(validateDetailed('السعر بعد الخصم 135 شيقل.', [chunk('none', 'الاستشارة متوفرة.')], options).overallStatus, STATUS.SUPPORTED);
        assert.notEqual(validateDetailed('المدة بعد الخصم 135 ساعة.', [evidence], options).overallStatus, STATUS.SUPPORTED);
    });

    await t.test('explicit complete lists prove scoped absence but ordinary/wrong-scope lists do not', () => {
        const complete = chunk('branches', 'هذه هي القائمة الكاملة والحالية للفروع: رام الله، نابلس.');
        assert.equal(validateDetailed('لا يوجد فرع في جنين.', [complete]).overallStatus, STATUS.SUPPORTED);
        assert.notEqual(validateDetailed('لا يوجد فرع في جنين.', [chunk('ordinary', 'فرع رام الله، فرع نابلس.')]).overallStatus, STATUS.SUPPORTED);
        assert.notEqual(validateDetailed('لا نتعامل مع تأمين القدس.', [complete]).overallStatus, STATUS.SUPPORTED);
        assert.notEqual(validateDetailed('فروعنا رام الله ونابلس وجنين فقط.', [complete]).overallStatus, STATUS.SUPPORTED);
    });

    await t.test('missing live state is NO_ANSWER while resolvable appointment ambiguity clarifies neutrally', () => {
        const liveMissing = [chunk('live', 'لا توجد معلومات تثبت أن نتيجة مريض معين جاهزة الآن.')];
        assert.equal(decideEvidence({ query: 'نتيجة تحليلي جاهزة الآن؟', chunks: liveMissing, tenantId: tenant }).decision, DECISION.NO_ANSWER);
        assert.equal(clarificationForQuery('بدي أغير الموعد.'), 'أي موعد تقصد؟');
        assert.doesNotMatch(clarificationForQuery('قديش سعرها؟'), /منتج|طلب/u);
    });

    await t.test('live result requests route through tenant knowledge', () => {
        assert.equal(classifyConversationMode('نتيجة تحليلي جاهزة الآن؟').mode, MODE.COMPANY_KNOWLEDGE);
        assert.equal(classifyConversationMode('شو تشخيص وجع الصدر؟').mode, MODE.COMPANY_KNOWLEDGE);
        assert.equal(classifyConversationMode('مرحبا كيفك').mode, MODE.GENERAL_CONVERSATION);
    });

    await t.test('boundary accepts validator-approved explicit completeness and keeps tenant checks', () => {
        const evidence = chunk('branches', 'هذه هي القائمة الكاملة للفروع: رام الله، نابلس.');
        const validation = validateDetailed('لا يوجد فرع في جنين.', [evidence]);
        const result = evaluateGroundingSafety({ answer: validation.finalAnswer, validatedAnswer: validation.finalAnswer, question: 'هل في فرع بجنين؟', tenantId: tenant, route: 'COMPANY_KNOWLEDGE', serverEvidence: [evidence], validation });
        assert.equal(result.decision, BOUNDARY.ALLOW);
    });
});
