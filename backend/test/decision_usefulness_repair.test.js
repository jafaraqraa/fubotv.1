const test = require('node:test');
const assert = require('node:assert/strict');
const {
    DECISION, decideEvidence, needsClarification, clarificationForQuery
} = require('../src/rag/intelligence/evidenceDecisionGate');
const { classifyConversationMode, MODE } = require('../src/services/conversationModeRouter');
const { validateDetailed, STATUS } = require('../src/rag/intelligence/answerValidator');
const { evaluateGroundingSafety, DECISION: BOUNDARY, explicitCurrentDateRange } = require('../src/rag/security/groundingSafetyBoundary');
const PromptBuilder = require('../src/services/PromptBuilder');
const { factMatches } = require('../scripts/evaluate-generalization-v1');

const tenantId = 'tenant-usefulness';
const chunk = (id, text, extra = {}) => ({ chunkId: id, id, tenantId, text, active: true, ...extra });
const gate = (query, chunks, history = []) => decideEvidence({ query, chunks, history, tenantId,
    now: new Date('2026-09-04T12:00:00+03:00') });

test('generic usefulness decision repair', async t => {
    await t.test('direct supported facts and entity attributes remain ANSWER', () => {
        assert.equal(gate('كم سعر الاستشارة؟', [chunk('price', 'سعر الاستشارة 80 شيقل.')]).decision, DECISION.ANSWER);
        assert.equal(gate('وين فرع سامر؟', [chunk('doctor', 'سامر — فرع نابلس.')]).decision, DECISION.ANSWER);
    });

    await t.test('authoritative ANSWER decision constrains realization without changing other modes', () => {
        const messages = PromptBuilder.buildMessages({
            systemPrompt: 'tenant-neutral', conversationHistory: [],
            knowledgeContext: 'سعر الخدمة 80 شيقل.', userQuestion: 'كم السعر؟',
            responseMode: MODE.COMPANY_KNOWLEDGE, tenantId, evidenceDecision: DECISION.ANSWER
        });
        const text = messages.at(-1).content;
        assert.match(text, /SERVER_DECISION: ANSWER/);
        assert.match(text, /Do not emit CLARIFY, NO_ANSWER/);
        const general = PromptBuilder.buildMessages({
            systemPrompt: '', conversationHistory: [], knowledgeContext: '',
            userQuestion: 'مرحبا', responseMode: MODE.GENERAL_CONVERSATION,
            evidenceDecision: DECISION.ANSWER
        });
        assert.doesNotMatch(general.at(-1).content, /SERVER_DECISION/);
    });

    await t.test('supported-answer routing covers inflected warranty, stock and offer questions', () => {
        for (const query of ['والاكسسوارات شو كفالتها؟', 'رمال X خلص، شو بقدر اعمل؟', 'عرض السماعات لسا شغال؟']) {
            assert.equal(classifyConversationMode(query).mode, MODE.COMPANY_KNOWLEDGE, query);
        }
    });

    await t.test('evaluator recognizes harmless Arabic equivalents but rejects changed values', () => {
        assert.equal(factMatches('الدوام من الساعة 8:30 صباحاً حتى 6 مساءً.', 'الثامنة والنصف'), true);
        assert.equal(factMatches('الملحقات المخفضة لا يمكن إرجاعها.', 'لا ترد'), true);
        assert.equal(factMatches('السعر 80 شيكل.', '80 ILS'), true);
        assert.equal(factMatches('تأمين أمان للرعاية الأولية فقط.', 'الرعاية الاولية فقط'), true);
        assert.equal(factMatches('لون لافتة المعرض أزرق.', 'اللافتة الزرقاء'), true);
        assert.equal(factMatches('الحد الأدنى 301 شيكل.', '300 شيكل'), false);
    });

    await t.test('Arabic attached negation and color morphology remain evidence-bound', () => {
        assert.equal(validateDetailed('التأمين لا يشمل جلسات تنظيف البشرة.', [
            chunk('insurance', 'تقبل العيادة تأمين أمان للرعاية الأولية فقط، ولا يشمل جلسات تنظيف البشرة.')
        ], { tenantId }).overallStatus, STATUS.SUPPORTED);
        assert.equal(validateDetailed('لون اللافتة أزرق.', [
            chunk('image', 'صورة معتمدة: واجهة المعرض ذات اللافتة الزرقاء.')
        ], { tenantId }).overallStatus, STATUS.SUPPORTED);
        assert.equal(validateDetailed('تقبل العيادة تأمين أمان للرعاية الأولية فقط.', [
            chunk('compound', 'تقبل العيادة تأمين أمان للرعاية الأولية فقط، ولا يشمل جلسات تنظيف البشرة.')
        ], { tenantId }).overallStatus, STATUS.SUPPORTED);
    });

    await t.test('image prepositional phrase is not misread as a location anchor', () => {
        const result = evaluateGroundingSafety({
            tenantId, route: MODE.COMPANY_KNOWLEDGE,
            question: 'بالصورة شو لون لافتة المعرض ووين مكانه؟',
            answer: 'لون اللافتة أزرق، ومكان المعرض في البيرة.',
            validation: { claims: [{
                text: 'لون اللافتة أزرق.', classification: STATUS.SUPPORTED,
                evidenceChunkIds: ['visual'], matchedSentence: 'اللافتة الزرقاء.'
            }] },
            serverEvidence: [chunk('visual', 'صورة المعرض ذات اللافتة الزرقاء.')]
        });
        assert.equal(result.decision, BOUNDARY.ALLOW);
    });

    await t.test('explicit dated validity proves current state only inside its range', () => {
        const evidence = 'خصم 12% ساري من 1 سبتمبر 2026 حتى 10 سبتمبر 2026.';
        assert.equal(explicitCurrentDateRange(evidence, new Date(2026, 8, 4)), true);
        assert.equal(explicitCurrentDateRange(evidence, new Date(2026, 8, 11)), false);
        assert.equal(explicitCurrentDateRange('خصم 12% بلا فترة صلاحية.', new Date(2026, 8, 4)), false);
    });

    await t.test('explicit complete list remains answerable', () => {
        assert.equal(gate('هل في فرع بجنين؟', [chunk('branches', 'هذه هي القائمة الكاملة الحالية للفروع: رام الله، نابلس.')]).decision, DECISION.ANSWER);
        assert.equal(validateDetailed('نحن نتعامل مع شركتي تأمين فقط حالياً وهما: تأمين الأمان وتأمين الحياة.',
            [chunk('insurance', 'هذه هي القائمة الكاملة الحالية لشركات التأمين المتعاقد معها: تأمين الأمان، تأمين الحياة.')],
            { tenantId }).overallStatus, STATUS.SUPPORTED);
    });

    await t.test('unresolved referents and user-resolvable entities clarify', () => {
        for (const query of ['قديش بتاخد وقت؟', 'بدي أغير الموعد.', 'قديش سعرها؟', 'الدكتور متاح؟', 'متى موعدي؟', 'هل التأمين بشملها؟', 'مين الدكتور المناسب؟']) {
            assert.equal(needsClarification(query), true, query);
        }
    });

    await t.test('missing live data is NO_ANSWER and specified entity/date are not re-asked', () => {
        const policy = [chunk('policy', 'أيام دوام الطبيب لا تثبت توفر موعد فعلي حاليًا.')];
        for (const query of ['هل د. سامر متاح الآن؟', 'في موعد اليوم مع د. نور؟']) {
            const result = gate(query, policy);
            assert.equal(result.decision, DECISION.NO_ANSWER);
            assert.notEqual(result.decision, DECISION.CLARIFY);
        }
    });

    await t.test('patient live result state is NO_ANSWER, not CLARIFY', () => {
        const result = gate('نتيجة تحليلي جاهزة الآن؟', [chunk('result', 'لا توجد بيانات تثبت أن نتيجة مريض معين جاهزة الآن.')]);
        assert.equal(result.decision, DECISION.NO_ANSWER);
    });

    await t.test('future scope cannot be answered by a current or historical period', () => {
        const result = gate('هل ليان متاحة الأسبوع القادم؟', [chunk('availability', 'ليان متاحة هذا الأسبوع فقط.', { validFrom: '2026-09-01', validTo: '2026-09-04' })]);
        assert.equal(result.decision, DECISION.NO_ANSWER);
    });

    await t.test('unproven list membership is NO_ANSWER while explicit completeness proves absence', () => {
        assert.equal(gate('هل تقبلون تأمين الشفاء؟', [chunk('ordinary', 'نقبل تأمين الأمان.')]).decision, DECISION.NO_ANSWER);
        assert.equal(gate('هل في فرع بجنين؟', [chunk('complete', 'هذه هي القائمة الكاملة للفروع: نابلس ورام الله.')]).decision, DECISION.ANSWER);
    });

    await t.test('deterministic gate decisions remain authoritative before generation', () => {
        assert.equal(gate('قديش سعرها؟', [chunk('prices', 'سعر الخدمة 80 شيقل.')]).decision, DECISION.CLARIFY);
        assert.equal(gate('هل سامر متاح الآن؟', [chunk('schedule', 'دوام سامر الثلاثاء.')]).decision, DECISION.NO_ANSWER);
        assert.equal(gate('كم سعر الخدمة؟', [chunk('price', 'سعر الخدمة 80 شيقل.')]).decision, DECISION.ANSWER);
    });

    await t.test('clarification wording is neutral and structurally relevant', () => {
        assert.equal(clarificationForQuery('بدي أغير الموعد.'), 'أي موعد تقصد؟');
        assert.equal(clarificationForQuery('الدكتور متاح؟'), 'أي دكتور تقصد؟');
        assert.doesNotMatch(clarificationForQuery('مين الدكتور المناسب؟'), /منتج|طلب/u);
    });

    await t.test('weekday hour question enters tenant knowledge route', () => {
        assert.equal(classifyConversationMode('الخميس لأي ساعة؟').mode, MODE.COMPANY_KNOWLEDGE);
        assert.equal(classifyConversationMode('هل د. سامر متاح الآن؟').mode, MODE.COMPANY_KNOWLEDGE);
    });

    await t.test('Arabic written and numeric clock forms validate', () => {
        const result = validateDetailed('الدوام من الساعة 8:30 صباحًا حتى 6 مساءً.',
            [chunk('hours', 'الدوام من الثامنة والنصف صباحًا حتى السادسة مساءً.')], { tenantId });
        assert.equal(result.overallStatus, STATUS.SUPPORTED);
        const doctor = validateDetailed('دكتورة الجلدية في العيادة هي الدكتورة ليان منصور.',
            [chunk('doctor', 'الدكتورة ليان منصور مختصة بالجلدية.')], { tenantId });
        assert.equal(doctor.overallStatus, STATUS.SUPPORTED);
    });

    await t.test('explicit once-only evidence is not falsely blocked', () => {
        const evidence = chunk('changes', 'يمكن إعادة الجدولة مرة واحدة دون رسوم إذا تم الطلب قبل 6 ساعات.');
        const validation = validateDetailed('يمكن إعادة الجدولة مرة واحدة فقط دون رسوم إذا تم الطلب قبل 6 ساعات.', [evidence], { tenantId });
        const result = evaluateGroundingSafety({ answer: validation.finalAnswer, question: 'بقدر أغير الموعد مرتين؟',
            tenantId, route: 'COMPANY_KNOWLEDGE', serverEvidence: [evidence], validation });
        assert.equal(result.decision, BOUNDARY.ALLOW);
        const hoursEvidence = chunk('hours', 'الخميس حتى الثانية ظهراً.');
        const hoursValidation = validateDetailed('الخميس حتى الساعة 2 ظهراً فقط.', [hoursEvidence], { tenantId });
        const hoursBoundary = evaluateGroundingSafety({ answer: hoursValidation.finalAnswer,
            question: 'الخميس لأي ساعة؟', tenantId, route: 'COMPANY_KNOWLEDGE',
            serverEvidence: [hoursEvidence], validation: hoursValidation });
        assert.equal(hoursBoundary.decision, BOUNDARY.ALLOW);
    });

    await t.test('tenant evidence remains isolated', () => {
        const result = decideEvidence({ query: 'كم السعر؟', tenantId,
            chunks: [{ chunkId: 'foreign', tenantId: 'other', text: 'السعر 10 شيقل.' }] });
        assert.equal(result.decision, DECISION.NO_ANSWER);
        assert.equal(result.excludedTenantChunks, 1);
    });
});
