const test = require('node:test');
const assert = require('node:assert/strict');
const {
    DECISION,
    AMBIGUITY_TYPE,
    analyzeAmbiguity,
    clarificationForQuery,
    decideEvidence
} = require('../src/rag/intelligence/evidenceDecisionGate');

const tenantId = 'neutral-tenant';
const chunks = [
    { chunkId: 'one', tenantId, text: 'الخيار الأول يكلف 40 شيقل ويستغرق يومين.' },
    { chunkId: 'two', tenantId, text: 'الخيار الثاني يكلف 70 شيقل ويستغرق ثلاثة أيام.' }
];
const decision = (query, options = {}) => decideEvidence({
    query, chunks: options.chunks ?? chunks, history: options.history || [], tenantId
});

test('generic CLARIFY contract', async t => {
    await t.test('unresolved feminine pronoun clarifies', () => {
        assert.equal(decision('شو شروطها؟').decision, DECISION.CLARIFY);
    });
    await t.test('unresolved masculine pronoun clarifies', () => {
        assert.equal(decision('قديش نتيجته؟').decision, DECISION.CLARIFY);
    });
    await t.test('unresolved action target clarifies', () => {
        const result = decision('بدي أعدله');
        assert.equal(result.decision, DECISION.CLARIFY);
        assert.equal(result.ambiguity.missingType, AMBIGUITY_TYPE.ACTION_TARGET);
    });
    await t.test('missing attribute target clarifies', () => {
        assert.equal(decision('قديش بتاخد؟').decision, DECISION.CLARIFY);
    });
    await t.test('bare temporal target clarifies', () => {
        assert.equal(decision('متى؟').decision, DECISION.CLARIFY);
    });
    await t.test('short unresolved target clarifies', () => {
        assert.equal(decision('وين وصلت؟').decision, DECISION.CLARIFY);
    });
    await t.test('clear missing business fact is NO_ANSWER', () => {
        assert.equal(decision('شو رقم الهاتف؟').decision, DECISION.NO_ANSWER);
    });
    await t.test('clear live-state question is NO_ANSWER', () => {
        assert.equal(decision('المعاملة رقم 88 وين وصلت هسا؟').decision, DECISION.NO_ANSWER);
    });
    await t.test('named entity is not re-asked', () => {
        assert.notEqual(decision('كم تكلف الخطة الفضية؟').decision, DECISION.CLARIFY);
    });
    await t.test('provided date is not re-asked', () => {
        assert.notEqual(decision('متى تعمل الجهة يوم الأربعاء؟').decision, DECISION.CLARIFY);
    });
    await t.test('one history referent resolves a pronoun', () => {
        const history = [{ role: 'user', content: 'احكيلي عن الخطة الفضية' }];
        assert.notEqual(decision('قديش تكلفتها؟', { history }).decision, DECISION.CLARIFY);
    });
    await t.test('two history referents remain ambiguous', () => {
        const history = [
            { role: 'user', content: 'احكيلي عن الخطة الفضية' },
            { role: 'user', content: 'وعن الخطة الذهبية' }
        ];
        assert.equal(decision('قديش تكلفتها؟', { history }).decision, DECISION.CLARIFY);
        assert.equal(decision('قديش تكلفتها؟', { history }).ambiguity.referentState, 'MULTIPLE');
    });
    await t.test('history content never supplies business evidence', () => {
        const history = [{ role: 'user', content: 'احكيلي عن الخطة الفضية، سعرها 40 شيقل' }];
        assert.equal(decision('شو لون الخطة الفضية؟', { history, chunks: [] }).decision, DECISION.NO_ANSWER);
    });
    await t.test('neutral clarification contains no domain assumption', () => {
        assert.equal(clarificationForQuery('شو شروطها؟'), 'ممكن توضّح المقصود أكثر؟');
    });
    await t.test('informational policy question is not action ambiguity', () => {
        assert.notEqual(decision('شو سياسة التغيير؟').decision, DECISION.CLARIFY);
    });
    await t.test('explicit action target is not clarification', () => {
        assert.notEqual(decision('بقدر أغير الملف قبل التنفيذ؟').decision, DECISION.CLARIFY);
    });
    await t.test('live-state metadata is business-owned', () => {
        const result = analyzeAmbiguity('المقعد شاغر الآن؟');
        assert.equal(result.requiresLiveData, true);
        assert.equal(result.canUserResolve, false);
    });
    await t.test('unresolved live reference remains user-resolvable first', () => {
        const result = analyzeAmbiguity('هل هو متاح الآن؟');
        assert.equal(result.canUserResolve, true);
        assert.equal(result.requiresLiveData, true);
    });
    await t.test('tenant filtering remains enforced', () => {
        const result = decideEvidence({
            query: 'شو رقم الهاتف؟', tenantId,
            chunks: [{ chunkId: 'foreign', tenantId: 'other', text: 'رقم الهاتف 123' }]
        });
        assert.equal(result.decision, DECISION.NO_ANSWER);
        assert.equal(result.excludedTenantChunks, 1);
    });
    await t.test('normal supported control stays ANSWER', () => {
        assert.equal(decision('كم يكلف الخيار الأول؟').decision, DECISION.ANSWER);
    });
    await t.test('ambiguity telemetry uses the minimum contract', () => {
        const result = decision('شو شروطها؟').ambiguity;
        for (const field of ['missingField', 'missingType', 'canUserResolve', 'alreadySpecified', 'requiresLiveData']) {
            assert.ok(Object.hasOwn(result, field), field);
        }
    });
});
