const test = require('node:test');
const assert = require('node:assert/strict');
const {
    STATUS,
    PROPOSITION_RELATION,
    extractClaims,
    validateDetailed
} = require('../src/rag/intelligence/answerValidator');

const evidence = [
    { id: 'shipping', text: 'الطلبات التي تتجاوز 300 شيكل تحصل على توصيل مجاني.' },
    { id: 'tracking', text: 'يمكن تتبع الطلب باستخدام رقم الطلب.' },
    { id: 'offers', text: 'التوصيل المجاني لا يحتسب مع العروض الخاصة.' }
];

test('proposition-aware Arabic answer validation', async t => {
    await t.test('shipping and tracking intents match separate evidence sentences', () => {
        const answer = 'التوصيل مجاني فوق 300 شيكل وبتقدر تتبع الطلب باستخدام رقم الطلب.';
        const result = validateDetailed(answer, evidence);

        assert.equal(result.overallStatus, STATUS.SUPPORTED);
        assert.equal(result.finalAnswer, answer);
        assert.equal(result.claims.length, 2);
        assert.deepEqual(result.claims.map(claim => claim.matchedEvidenceId), ['shipping', 'tracking']);
        assert.ok(result.claims.every(claim => claim.relationshipType === PROPOSITION_RELATION.INDEPENDENT));
    });

    await t.test('numeric condition and explicit exception are independently supported', () => {
        const answer = 'التوصيل مجاني فوق 300 شيكل، لكنه لا يحتسب مع العروض الخاصة.';
        const result = validateDetailed(answer, evidence);

        assert.equal(result.overallStatus, STATUS.SUPPORTED);
        assert.deepEqual(result.claims.map(claim => claim.propositionType), ['MAIN', 'EXCEPTION']);
        assert.deepEqual(result.claims.map(claim => claim.matchedEvidenceId), ['shipping', 'offers']);
        assert.ok(result.claims.every(claim => claim.originalCompoundClaim === answer));
    });

    await t.test('even-if condition is checked separately without losing exception scope', () => {
        const answer = 'لا يحتسب التوصيل المجاني مع العرض الخاص حتى لو تجاوز الطلب 300 شيكل.';
        const result = validateDetailed(answer, evidence);

        assert.equal(result.overallStatus, STATUS.SUPPORTED);
        assert.deepEqual(result.claims.map(claim => claim.propositionType), ['MAIN', 'CONDITION']);
        assert.deepEqual(result.claims.map(claim => claim.matchedEvidenceId), ['offers', 'shipping']);
    });

    await t.test('Palestinian بس and ولو preserve a scope-coupled exception', () => {
        for (const answer of [
            'التوصيل مجاني فوق 300 شيكل بس لا يحتسب مع العروض الخاصة.',
            'لا يحتسب التوصيل المجاني مع العروض الخاصة ولو تجاوز الطلب 300 شيكل.'
        ]) {
            const result = validateDetailed(answer, evidence);
            assert.equal(result.overallStatus, STATUS.SUPPORTED, answer);
            assert.equal(result.claims.length, 2, answer);
            assert.ok(result.claims.every(claim => claim.relationshipType === PROPOSITION_RELATION.SCOPE_COUPLED));
        }
    });

    await t.test('reviewed explanatory exception markers are split deterministically', () => {
        for (const answer of [
            'التوصيل مجاني فوق 300 شيكل، مع العلم أنه لا يحتسب مع العروض الخاصة.',
            'التوصيل مجاني فوق 300 شيكل، علمًا بأن هذا لا يشمل العروض الخاصة.',
            'التوصيل مجاني فوق 300 شيكل، مع الأخذ في الاعتبار أن هذا لا يشمل العروض الخاصة.',
            'التوصيل مجاني فوق 300 شيكل، مع ملاحظة أن التوصيل المجاني لا يحتسب مع العروض الخاصة.'
        ]) {
            const result = validateDetailed(answer, evidence);
            assert.equal(result.overallStatus, STATUS.SUPPORTED, answer);
            assert.equal(result.claims.length, 2, answer);
        }
    });

    await t.test('إلا receives explicit exclusion semantics and remains scope-coupled', () => {
        const result = validateDetailed(
            'التوصيل مجاني فوق 300 شيكل، إلا مع العروض الخاصة.',
            evidence
        );
        assert.equal(result.overallStatus, STATUS.SUPPORTED);
        assert.equal(result.claims[1].propositionType, 'EXCEPTION');
        assert.match(result.claims[1].text, /لا يحتسب/);
        assert.equal(result.claims[1].matchedEvidenceId, 'offers');
    });

    await t.test('unsupported independent proposition is removed while supported fact remains', () => {
        const result = validateDetailed(
            'التوصيل مجاني فوق 300 شيكل وبتقدر تستلم الطلب من القمر.',
            evidence
        );
        assert.equal(result.overallStatus, STATUS.PARTIAL);
        assert.match(result.finalAnswer, /التوصيل مجاني فوق 300 شيكل/);
        assert.doesNotMatch(result.finalAnswer, /القمر/);
    });

    await t.test('contradicted independent proposition is not silently preserved', () => {
        const result = validateDetailed(
            'التوصيل مجاني فوق 300 شيكل ويمكن تتبع الطلب بدون رقم الطلب.',
            evidence
        );
        assert.equal(result.claims[0].classification, STATUS.SUPPORTED);
        assert.equal(result.claims[1].classification, STATUS.CONTRADICTED);
        assert.match(result.finalAnswer, /التوصيل مجاني فوق 300 شيكل/);
        assert.doesNotMatch(result.finalAnswer, /بدون رقم الطلب/);
    });

    await t.test('unsupported 50 percent does not remove supported free shipping', () => {
        const result = validateDetailed(
            'التوصيل مجاني فوق 300 شيكل والعرض يعطي خصم 50%.',
            evidence
        );
        assert.equal(result.claims[0].classification, STATUS.SUPPORTED);
        assert.notEqual(result.claims[1].classification, STATUS.SUPPORTED);
        assert.match(result.finalAnswer, /التوصيل مجاني فوق 300 شيكل/);
        assert.doesNotMatch(result.finalAnswer, /50%/);
    });

    await t.test('unsafe exception rejects the whole coupled statement instead of broadening it', () => {
        const answer = 'التوصيل مجاني فوق 300 شيكل، لكنه يحتسب مع العروض الخاصة.';
        const result = validateDetailed(answer, evidence);

        assert.equal(result.claims[0].classification, STATUS.SUPPORTED);
        assert.equal(result.claims[1].classification, STATUS.CONTRADICTED);
        assert.doesNotMatch(result.finalAnswer, /التوصيل مجاني فوق 300 شيكل/);
        assert.doesNotMatch(result.finalAnswer, /يحتسب مع العروض/);
    });

    await t.test('words containing waw are not split lexically', () => {
        for (const answer of ['رقم الطلب موجود.', 'الموعد واضح.', 'العروض متاحة.']) {
            assert.equal(extractClaims(answer).length, 1, answer);
        }
    });

    await t.test('unsupported numeric proposition is not rescued by another numeric sentence', () => {
        const result = validateDetailed(
            'التوصيل مجاني فوق 300 شيكل والعرض يعطي خصم 50%.',
            [
                ...evidence,
                { id: 'unrelated-number', text: 'يوجد في المتجر 50 منتجاً مختلفاً.' }
            ]
        );
        assert.notEqual(result.claims[1].classification, STATUS.SUPPORTED);
    });

    await t.test('separate true facts cannot prove an unsupported causal relationship', () => {
        const answer = 'التوصيل مجاني لذلك يمكن تتبع الطلب.';
        const result = validateDetailed(answer, [
            { id: 'a', text: 'التوصيل مجاني.' },
            { id: 'b', text: 'يمكن تتبع الطلب.' }
        ]);
        assert.equal(result.claims.length, 1);
        assert.equal(result.claims[0].relationshipType, PROPOSITION_RELATION.CAUSAL);
        assert.notEqual(result.overallStatus, STATUS.SUPPORTED);
    });

    await t.test('validator cannot use foreign evidence omitted by tenant-scoped retrieval', () => {
        const result = validateDetailed(
            'يوجد فرع في الخليل.',
            [{ id: 'tenant-owned', tenantId: 'tenant-a', text: 'ساعات الدوام من التاسعة حتى الخامسة.' }]
        );
        assert.notEqual(result.overallStatus, STATUS.SUPPORTED);
        assert.equal(result.claims[0].matchedEvidenceId, 'tenant-owned');
    });

    await t.test('limited بواسطة and يسري equivalences are positive but do not weaken negation', () => {
        const tracking = validateDetailed(
            'يمكن تتبع الطلب بواسطة رقم الطلب.',
            [{ id: 'tracking', text: 'يمكن تتبع الطلب باستخدام رقم الطلب.' }]
        );
        assert.equal(tracking.overallStatus, STATUS.SUPPORTED);

        const exclusion = validateDetailed(
            'التوصيل المجاني لا يسري مع العروض الخاصة.',
            [{ id: 'offers', text: 'التوصيل المجاني لا يحتسب مع العروض الخاصة.' }]
        );
        assert.equal(exclusion.overallStatus, STATUS.SUPPORTED);

        const adversarial = validateDetailed(
            'التوصيل المجاني يسري مع العروض الخاصة.',
            [{ id: 'offers', text: 'التوصيل المجاني لا يحتسب مع العروض الخاصة.' }]
        );
        assert.equal(adversarial.overallStatus, STATUS.CONTRADICTED);
    });

    await t.test('discourse لا comma does not become factual negation', () => {
        const result = validateDetailed(
            'لا، التوصيل مجاني لأن الطلب فوق 300 شيكل.',
            [{ id: 'shipping', text: 'التوصيل مجاني للطلبات التي تتجاوز 300 شيكل.' }]
        );
        assert.equal(result.overallStatus, STATUS.SUPPORTED);
        assert.equal(result.claims[0].negationResult.relation, 'ALIGNED');
    });
});
