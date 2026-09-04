const test = require('node:test');
const assert = require('node:assert/strict');
const {
    DECISION,
    decideEvidence,
    followUpReferentStatus
} = require('../src/rag/intelligence/evidenceDecisionGate');

const tenant = 'tenant-a';
const shipping = {
    chunkId: 'shipping', tenantId: tenant,
    text: 'يصبح التوصيل مجانياً إذا تجاوزت قيمة الطلب 300 شيكل. الشحن متوفر لجميع المحافظات.'
};

test('evidence decision gate', async t => {
    await t.test('answers when scoped evidence covers the requested fact', () => {
        const result = decideEvidence({
            query: 'متى يصبح التوصيل مجانياً؟', chunks: [shipping], tenantId: tenant
        });
        assert.equal(result.decision, DECISION.ANSWER);
    });

    await t.test('rejects a missing high-risk business attribute', () => {
        const result = decideEvidence({
            query: 'هل عندكم فرع في الخليل؟', chunks: [shipping], tenantId: tenant
        });
        assert.equal(result.decision, DECISION.NO_ANSWER);
    });

    await t.test('clarifies an unresolved Palestinian Arabic reference', () => {
        const result = decideEvidence({
            query: 'قديش سعرها؟', chunks: [shipping], tenantId: tenant, history: []
        });
        assert.equal(result.decision, DECISION.CLARIFY);
    });

    await t.test('clarifies normalized follow-up forms without a referent', () => {
        for (const query of ['متى بوصل؟', 'شو بصير بعدين؟', 'هل يشملها العرض؟']) {
            const result = decideEvidence({ query, chunks: [shipping], tenantId: tenant });
            assert.equal(result.decision, DECISION.CLARIFY, query);
        }
    });

    await t.test('does not treat general coverage as evidence for an unsupported destination', () => {
        const result = decideEvidence({
            query: 'هل بتوصلوا الطلبات للقمر؟', chunks: [shipping], tenantId: tenant
        });
        assert.equal(result.decision, DECISION.NO_ANSWER);
    });

    await t.test('uses only same-tenant evidence', () => {
        const result = decideEvidence({
            query: 'هل عندكم فرع في الخليل؟', tenantId: tenant,
            chunks: [{ chunkId: 'foreign', tenantId: 'tenant-b', text: 'لدينا فرع في الخليل.' }]
        });
        assert.equal(result.decision, DECISION.NO_ANSWER);
        assert.equal(result.excludedTenantChunks, 1);
        assert.deepEqual(result.consideredChunkIds, []);
    });

    await t.test('resolves a follow-up only from same conversation history supplied by caller', () => {
        const result = decideEvidence({
            query: 'وبعدها بقدر أعدله؟', tenantId: tenant,
            chunks: [{ chunkId: 'modify', tenantId: tenant, text: 'يمكن تعديل الطلب قبل بدء تجهيزه فقط.' }],
            history: [{ role: 'user', content: 'بعثت طلب جديد' }]
        });
        assert.equal(result.decision, DECISION.ANSWER);
    });

    await t.test('current discounts require current evidence, not a general coupon policy', () => {
        const result = decideEvidence({
            query: 'شو الخصومات الموجودة اليوم؟', tenantId: tenant,
            chunks: [{ chunkId: 'coupon', tenantId: tenant, text: 'يحصل العميل على كوبون خصم 10% عند تأخر الطلب أكثر من 48 ساعة.' }]
        });
        assert.equal(result.decision, DECISION.NO_ANSWER);
        assert.equal(result.reason, 'current_state_not_proven');
        assert.equal(result.currentIntent, true);
    });

    await t.test('unrelated today wording elsewhere in a large chunk is not temporal proof', () => {
        const result = decideEvidence({
            query: 'شو الخصومات الموجودة اليوم؟', tenantId: tenant,
            chunks: [{
                chunkId: 'mixed-policy', tenantId: tenant,
                text: 'يحصل العميل على كوبون خصم 10% عند التأخير. الطلبات الليلية تُجهز صباح اليوم التالي.'
            }]
        });
        assert.equal(result.decision, DECISION.NO_ANSWER);
        assert.deepEqual(result.temporalEvidenceChunkIds, []);
    });

    await t.test('explicit current discount text is sufficient', () => {
        const result = decideEvidence({
            query: 'شو الخصم الحالي؟', tenantId: tenant,
            chunks: [{ chunkId: 'current-discount', tenantId: tenant, text: 'الخصم الحالي 15%.' }]
        });
        assert.equal(result.decision, DECISION.ANSWER);
        assert.deepEqual(result.temporalEvidenceChunkIds, ['current-discount']);
    });

    await t.test('active date range is sufficient while an expired range is not', () => {
        const now = new Date(2026, 8, 2, 12, 0, 0);
        const active = decideEvidence({
            query: 'في عروض هسا؟', tenantId: tenant, now,
            chunks: [{ chunkId: 'active-offer', tenantId: tenant, text: 'عرض خصم 15%.', validFrom: '2026-09-01', validTo: '2026-09-03' }]
        });
        assert.equal(active.decision, DECISION.ANSWER);

        const expired = decideEvidence({
            query: 'في عروض هسا؟', tenantId: tenant, now,
            chunks: [{ chunkId: 'expired-offer', tenantId: tenant, text: 'عرض خصم 15%.', validFrom: '2026-08-30', validTo: '2026-09-01' }]
        });
        assert.equal(expired.decision, DECISION.NO_ANSWER);
    });

    await t.test('updatedAt alone never proves current temporal validity', () => {
        const result = decideEvidence({
            query: 'في عروض هسا؟', tenantId: tenant,
            chunks: [{ chunkId: 'fresh-policy', tenantId: tenant, text: 'يوجد كوبون خصم عند التأخير.', updatedAt: new Date().toISOString() }]
        });
        assert.equal(result.decision, DECISION.NO_ANSWER);
    });

    await t.test('generic policy questions remain outside temporal gating', () => {
        for (const query of ['شو شروط الخصومات؟', 'كيف بطلعلي كوبون 10%؟', 'متى بصير التوصيل مجاني؟']) {
            const result = decideEvidence({
                query, tenantId: tenant,
                chunks: [{ chunkId: 'policy', tenantId: tenant, text: 'يحصل العميل على كوبون خصم 10% عند تأخر الطلب أكثر من 48 ساعة. يصبح التوصيل مجانياً فوق 300 شيكل.' }]
            });
            assert.equal(result.decision, DECISION.ANSWER, query);
            assert.equal(result.currentIntent, false, query);
        }
    });

    await t.test('current availability requires explicit availability evidence', () => {
        const general = decideEvidence({
            query: 'شو المتوفر حاليًا؟', tenantId: tenant,
            chunks: [{ chunkId: 'catalog', tenantId: tenant, text: 'يشمل الكتالوج هواتف وحواسيب.' }]
        });
        assert.equal(general.decision, DECISION.NO_ANSWER);

        const explicit = decideEvidence({
            query: 'هل المنتج متوفر الآن؟', tenantId: tenant,
            chunks: [{ chunkId: 'availability', tenantId: tenant, text: 'المنتج متوفر حاليًا.' }]
        });
        assert.equal(explicit.decision, DECISION.ANSWER);
    });

    await t.test('ambiguous current availability asks for the missing reference', () => {
        const result = decideEvidence({
            query: 'هل متوفر الآن؟', tenantId: tenant,
            chunks: [{ chunkId: 'availability', tenantId: tenant, text: 'المنتج متوفر حاليًا.' }]
        });
        assert.equal(result.decision, DECISION.CLARIFY);
    });

    await t.test('ambiguous appointment operation without referent clarifies', () => {
        const result = decideEvidence({
            query: 'بدي أغير الموعد', tenantId: tenant, history: [], chunks: [shipping]
        });
        assert.equal(followUpReferentStatus('بدي أغير الموعد', []), 'UNRESOLVED');
        assert.equal(result.decision, DECISION.CLARIFY);
        assert.equal(result.reason, 'unresolved_referent');
    });

    await t.test('explicit appointment is not forced to clarify', () => {
        assert.equal(followUpReferentStatus('بدي أغير موعد فحص النظر', []), 'EXPLICIT');
        const result = decideEvidence({
            query: 'بدي أغير موعد فحص النظر', tenantId: tenant,
            chunks: [{ chunkId: 'appointments', tenantId: tenant, text: 'يمكن تغيير موعد فحص النظر.' }]
        });
        assert.notEqual(result.decision, DECISION.CLARIFY);
    });

    await t.test('one identified appointment in history resolves follow-up', () => {
        const history = [{ role: 'user', content: 'عندي موعد فحص النظر يوم الأحد' }];
        assert.equal(followUpReferentStatus('بدي أغير الموعد', history), 'HISTORY_SINGLE');
        const result = decideEvidence({
            query: 'بدي أغير الموعد', tenantId: tenant, history,
            chunks: [{ chunkId: 'appointments', tenantId: tenant, text: 'يمكن تغيير موعد فحص النظر.' }]
        });
        assert.notEqual(result.decision, DECISION.CLARIFY);
    });

    await t.test('multiple possible history referents clarify', () => {
        const history = [
            { role: 'user', content: 'عندي موعد فحص النظر' },
            { role: 'user', content: 'وعندي موعد طبيب الجلدية' }
        ];
        assert.equal(followUpReferentStatus('بدي أغير الموعد', history), 'HISTORY_MULTIPLE');
        const result = decideEvidence({ query: 'بدي أغير الموعد', tenantId: tenant, history, chunks: [shipping] });
        assert.equal(result.decision, DECISION.CLARIFY);
    });

    await t.test('generic company question is never treated as follow-up ambiguity', () => {
        assert.equal(followUpReferentStatus('شو ساعات دوام الشركة؟', []), 'NOT_APPLICABLE');
        const result = decideEvidence({
            query: 'شو ساعات دوام الشركة؟', tenantId: tenant,
            chunks: [{ chunkId: 'hours', tenantId: tenant, text: 'ساعات الدوام من التاسعة حتى الخامسة.' }]
        });
        assert.notEqual(result.decision, DECISION.CLARIFY);
    });

    const durations = [
        { chunkId: 'a', tenantId: tenant, text: 'تستغرق باقة الانطلاق 12 يوم عمل.' },
        { chunkId: 'b', tenantId: tenant, text: 'تستغرق باقة النمو 25 يوم عمل.' }
    ];

    await t.test('clarifies an unresolved value with multiple candidate referents', () => {
        const result = decideEvidence({ query: 'كم بتاخد وقت؟', chunks: durations, tenantId: tenant });
        assert.equal(result.decision, DECISION.CLARIFY);
        assert.equal(result.reason, 'multiple_candidate_referents');
    });

    await t.test('one candidate service does not force clarification', () => {
        const result = decideEvidence({ query: 'كم بتاخد وقت؟', chunks: [durations[0]], tenantId: tenant });
        assert.notEqual(result.decision, DECISION.CLARIFY);
    });

    await t.test('an explicit service is unaffected by other evidence candidates', () => {
        const result = decideEvidence({ query: 'كم بتاخد خدمة الاستشارة؟', chunks: durations, tenantId: tenant });
        assert.notEqual(result.decision, DECISION.CLARIFY);
    });

    await t.test('one history referent resolves a value question', () => {
        const history = [{ role: 'user', content: 'احكيلي عن خدمة التدقيق' }];
        const result = decideEvidence({ query: 'كم بتاخد وقت؟', chunks: durations, history, tenantId: tenant });
        assert.notEqual(result.decision, DECISION.CLARIFY);
    });

    await t.test('multiple history referents keep a value question ambiguous', () => {
        const history = [
            { role: 'user', content: 'احكيلي عن خدمة التدقيق' },
            { role: 'user', content: 'وعن خدمة التصميم' }
        ];
        const result = decideEvidence({ query: 'كم بتاخد وقت؟', chunks: durations, history, tenantId: tenant });
        assert.equal(result.decision, DECISION.CLARIFY);
    });

    await t.test('duplicate evidence for one value and entity does not clarify', () => {
        const chunks = [durations[0], { ...durations[0], chunkId: 'a-copy' }];
        const result = decideEvidence({ query: 'كم بتاخد وقت؟', chunks, tenantId: tenant });
        assert.notEqual(result.decision, DECISION.CLARIFY);
    });

    await t.test('generic company and explicit multi-intent questions are unaffected', () => {
        const general = decideEvidence({ query: 'شو بتقدم الشركة؟', chunks: durations, tenantId: tenant });
        const multiIntent = decideEvidence({
            query: 'كم بتاخد باقة الانطلاق وكم بتاخد باقة النمو؟', chunks: durations, tenantId: tenant
        });
        assert.notEqual(general.decision, DECISION.CLARIFY);
        assert.notEqual(multiIntent.decision, DECISION.CLARIFY);
    });
});
