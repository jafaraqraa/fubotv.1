const test = require('node:test');
const assert = require('node:assert/strict');
const {
    DECISION,
    SAFE_FALLBACK,
    applyGroundingSafetyBoundary,
    enforcementAssignment
} = require('../src/rag/security/groundingSafetyBoundary');

function evidence(id, text, tenantId = 'tenant-a', metadata = {}) {
    return { id, text, tenantId, ...metadata };
}

function claim(text, id, extra = {}) {
    return {
        text,
        propositionText: text,
        factual: true,
        classification: 'SUPPORTED',
        finalClassification: 'SUPPORTED',
        evidenceChunkIds: id ? [id] : [],
        matchedSentence: extra.matchedSentence,
        numericResult: extra.numericResult || { relation: 'NONE', claimQuantities: [] },
        ...extra
    };
}

function run({ question = 'شو سياسة التوصيل؟', claims, serverEvidence, shadowMode = false, answer }, options) {
    const candidate = answer === undefined
        ? (claims || []).map(item => item.propositionText || item.text).join(' ') : answer;
    return applyGroundingSafetyBoundary({
        answer: candidate,
        validatedAnswer: 'الجزء الآمن',
        question,
        tenantId: 'tenant-a',
        route: 'COMPANY_KNOWLEDGE',
        validation: { claims },
        serverEvidence,
        shadowMode
    }, options);
}

test('grounding hard safety boundary', async t => {
    await t.test('controlled rollout assignment is deterministic at 0, 5, and 100 percent', () => {
        const base = { tenantId: 'tenant-a', conversationId: 'conversation-1', shadowMode: false };
        assert.equal(enforcementAssignment({ ...base, percent: 0 }).enforced, false);
        assert.equal(enforcementAssignment({ ...base, percent: 100 }).enforced, true);
        assert.deepEqual(
            enforcementAssignment({ ...base, percent: 5 }),
            enforcementAssignment({ ...base, percent: 5 })
        );
        const buckets = new Set(Array.from({ length: 200 }, (_, index) =>
            enforcementAssignment({ ...base, conversationId: `conversation-${index}`, percent: 5 }).bucket));
        assert.ok(buckets.size > 50);
        assert.ok(Array.from({ length: 200 }, (_, index) =>
            enforcementAssignment({ ...base, conversationId: `conversation-${index}`, percent: 5 }))
            .some(item => item.enforced));
        assert.equal(enforcementAssignment({ ...base, percent: 100, shadowMode: true }).enforced, false);
    });

    await t.test('enforced block returns fallback while the same shadow block preserves candidate', () => {
        const input = {
            answer: 'سعر التوصيل 50 شيكل.', validatedAnswer: 'سعر التوصيل 50 شيكل.',
            question: 'كم سعر التوصيل؟', tenantId: 'tenant-a', route: 'COMPANY_KNOWLEDGE',
            validation: { claims: [claim('سعر التوصيل 50 شيكل.', 'shipping', {
                numericResult: { relation: 'UNKNOWN', claimQuantities: [{ value: 50, unit: 'ILS' }] }
            })] }, serverEvidence: [evidence('shipping', 'خدمة التوصيل متاحة.')]
        };
        const enforced = applyGroundingSafetyBoundary({ ...input, shadowMode: false, enforcementActive: true });
        const shadow = applyGroundingSafetyBoundary({ ...input, shadowMode: false, enforcementActive: false });
        assert.equal(enforced.outputAnswer, SAFE_FALLBACK);
        assert.equal(shadow.outputAnswer, input.answer);
    });

    await t.test('boundary exceptions fail closed only inside the enforced bucket', () => {
        const evaluator = () => { throw Object.assign(new Error('failure'), { code: 'TEST_FAILURE' }); };
        const input = { answer: 'مرشح', tenantId: 'tenant-a', shadowMode: false };
        assert.equal(applyGroundingSafetyBoundary(
            { ...input, enforcementActive: true }, { evaluator }
        ).outputAnswer, SAFE_FALLBACK);
        const shadow = applyGroundingSafetyBoundary(
            { ...input, enforcementActive: false }, { evaluator }
        );
        assert.equal(shadow.outputAnswer, 'مرشح');
        assert.equal(shadow.telemetry.processingErrorCount, 1);
    });

    await t.test('valid tenant evidence allows a supported answer', () => {
        const result = run({
            claims: [claim('التوصيل متاح داخل الضفة.', 'shipping')],
            serverEvidence: [evidence('shipping', 'التوصيل متاح داخل الضفة.')]
        });
        assert.equal(result.decision, DECISION.ALLOW);
    });

    await t.test('missing tenant provenance blocks', () => {
        const result = run({ claims: [claim('التوصيل متاح.', 'shipping')], serverEvidence: [evidence('shipping', 'التوصيل متاح.', null)] });
        assert.equal(result.decision, DECISION.BLOCK);
        assert.equal(result.telemetry.missingTenantEvidenceCount, 1);
    });

    await t.test('tenant mismatch blocks', () => {
        const result = run({ claims: [claim('التوصيل متاح.', 'shipping')], serverEvidence: [evidence('shipping', 'التوصيل متاح.', 'tenant-b')] });
        assert.equal(result.decision, DECISION.BLOCK);
        assert.equal(result.telemetry.tenantMismatchCount, 1);
    });

    await t.test('hallucinated evidence ID blocks', () => {
        const result = run({ claims: [claim('التوصيل متاح.', 'made-up')], serverEvidence: [evidence('shipping', 'التوصيل متاح.')] });
        assert.equal(result.decision, DECISION.BLOCK);
        assert.equal(result.telemetry.unknownEvidenceIdCount, 1);
    });

    await t.test('unsupported numeric claim blocks', () => {
        const result = run({
            question: 'كم سعر التوصيل؟',
            claims: [claim('سعر التوصيل 50 شيكل.', 'shipping', { numericResult: { relation: 'UNKNOWN', claimQuantities: [{ value: 50, unit: 'ILS' }] } })],
            serverEvidence: [evidence('shipping', 'خدمة التوصيل متاحة.')]
        });
        assert.equal(result.decision, DECISION.BLOCK);
        assert.equal(result.telemetry.numericBlockCount, 1);
    });

    await t.test('explicitly supported numeric claim allows', () => {
        const result = run({
            question: 'كم سعر التوصيل؟',
            claims: [claim('سعر التوصيل 25 شيكل.', 'shipping', { numericResult: { relation: 'ENTAILED', claimQuantities: [{ value: 25, unit: 'ILS' }] } })],
            serverEvidence: [evidence('shipping', 'سعر التوصيل 25 شيكل.')]
        });
        assert.equal(result.decision, DECISION.ALLOW);
    });

    await t.test('current claim without temporal proof blocks', () => {
        const result = run({
            question: 'شو الخصم الحالي؟',
            claims: [claim('الخصم الحالي 10%.', 'offer', { numericResult: { relation: 'ENTAILED', claimQuantities: [{ value: 10, unit: 'PERCENT' }] } })],
            serverEvidence: [evidence('offer', 'خصم 10% على المنتج.')]
        });
        assert.equal(result.decision, DECISION.BLOCK);
        assert.equal(result.telemetry.temporalBlockCount, 1);
    });

    await t.test('current claim with trusted explicit validity allows', () => {
        const result = run({
            question: 'شو الخصم الحالي؟',
            claims: [claim('الخصم الحالي 10%.', 'offer', { numericResult: { relation: 'ENTAILED', claimQuantities: [{ value: 10, unit: 'PERCENT' }] } })],
            serverEvidence: [evidence('offer', 'خصم 10% على المنتج.', 'tenant-a', { currentValid: true })]
        });
        assert.equal(result.decision, DECISION.ALLOW);
    });

    await t.test('Nablus branch is not answered by an Al-Bireh showroom', () => {
        const result = run({
            question: 'هل عندكم فرع في نابلس؟',
            claims: [claim('المعرض الوحيد في البيرة.', 'contact', { matchedSentence: 'المعرض الوحيد في البيرة.' })],
            serverEvidence: [evidence('contact', 'المعرض الوحيد في البيرة.')]
        });
        assert.equal(result.decision, DECISION.BLOCK);
        assert.equal(result.telemetry.nonresponsiveBlockCount, 1);
    });

    await t.test('ordinary Arabic paraphrase is not rejected by broad token overlap', () => {
        const result = run({
            question: 'والاكسسوارات شو كفالتها؟',
            claims: [claim('ضمان الملحقات هو 6 أشهر.', 'warranty', { numericResult: { relation: 'ENTAILED', claimQuantities: [{ value: 6, unit: 'UNSPECIFIED' }] } })],
            serverEvidence: [evidence('warranty', 'ضمان الملحقات 6 أشهر.')]
        });
        assert.equal(result.decision, DECISION.ALLOW);
    });

    await t.test('upstream clarification verdict blocks an otherwise supported policy answer', () => {
        const result = applyGroundingSafetyBoundary({
            answer: 'يمكن إعادة الجدولة قبل 6 ساعات.',
            question: 'بدي أغير الموعد', tenantId: 'tenant-a', route: 'COMPANY_KNOWLEDGE',
            serverEvidence: [evidence('changes', 'يمكن إعادة الجدولة قبل 6 ساعات.')],
            validation: { claims: [claim('يمكن إعادة الجدولة قبل 6 ساعات.', 'changes', { numericResult: { relation: 'ENTAILED', claimQuantities: [{ value: 6, unit: 'HOUR' }] } })] },
            upstreamDecision: 'CLARIFY', shadowMode: false
        });
        assert.equal(result.decision, DECISION.BLOCK);
        assert.deepEqual(result.reasons, ['UPSTREAM_CLARIFY']);
    });

    await t.test('claim removed by validator is telemetry-only and cannot block delivery', () => {
        const removed = claim('يوجد خصم 90%.', 'offer', { numericResult: { relation: 'UNKNOWN', claimQuantities: [{ value: 90, unit: 'PERCENT' }] } });
        removed.classification = 'UNSUPPORTED';
        removed.finalClassification = 'UNSUPPORTED';
        const result = applyGroundingSafetyBoundary({
            answer: 'سعر التوصيل 25 شيكل.', question: 'كم سعر التوصيل؟', tenantId: 'tenant-a',
            serverEvidence: [evidence('shipping', 'سعر التوصيل 25 شيكل.'), evidence('offer', 'لا توجد معلومات عن الخصم.')],
            validation: { claims: [
                claim('سعر التوصيل 25 شيكل.', 'shipping', { numericResult: { relation: 'ENTAILED', claimQuantities: [{ value: 25, unit: 'ILS' }] } }),
                removed
            ] }, shadowMode: false
        });
        assert.equal(result.decision, DECISION.ALLOW);
        assert.equal(result.removedClaims.length, 1);
    });

    await t.test('Sunday through Thursday does not prove Friday unavailable', () => {
        const result = run({
            question: 'هل الدعم متاح يوم الجمعة؟',
            claims: [claim('الدعم غير متاح يوم الجمعة.', 'hours', { matchedSentence: 'ساعات الدعم من الأحد إلى الخميس.' })],
            serverEvidence: [evidence('hours', 'ساعات الدعم من الأحد إلى الخميس.')]
        });
        assert.equal(result.decision, DECISION.BLOCK);
        assert.equal(result.telemetry.negationBlockCount, 1);
    });

    await t.test('explicit exhaustive Friday exclusion allows', () => {
        const source = 'الدعم متاح من الأحد إلى الخميس فقط، ولا يتوفر يوم الجمعة.';
        const result = run({
            question: 'هل الدعم متاح يوم الجمعة؟',
            claims: [claim('الدعم غير متاح يوم الجمعة.', 'hours', { matchedSentence: source })],
            serverEvidence: [evidence('hours', source)]
        });
        assert.equal(result.decision, DECISION.ALLOW);
    });

    await t.test('safe supported answer allows', () => {
        const result = run({
            question: 'وين موقع المعرض؟',
            claims: [claim('موقع المعرض في البيرة.', 'contact')],
            serverEvidence: [evidence('contact', 'موقع المعرض في البيرة.')]
        });
        assert.equal(result.decision, DECISION.ALLOW);
    });

    await t.test('processing exception fails closed under enforcement', () => {
        const result = run({ claims: [], serverEvidence: [], answer: 'الجواب الأصلي' }, { evaluator: () => { throw new Error('boom'); } });
        assert.equal(result.decision, DECISION.BLOCK);
        assert.equal(result.outputAnswer, SAFE_FALLBACK);
    });

    await t.test('processing exception is telemetry-only under shadow', () => {
        const result = run({ claims: [], serverEvidence: [], shadowMode: true, answer: 'الجواب الأصلي' }, { evaluator: () => { throw new Error('boom'); } });
        assert.equal(result.decision, DECISION.BLOCK);
        assert.equal(result.outputAnswer, 'الجواب الأصلي');
        assert.equal(result.telemetry.processingErrorCount, 1);
    });

    await t.test('multi-intent claim already removed by validator cannot re-block safe partial', () => {
        const unsupported = claim('يوجد فرع في الخليل.', 'branch');
        unsupported.classification = 'UNSUPPORTED';
        unsupported.finalClassification = 'UNSUPPORTED';
        const result = run({
            question: 'كم التوصيل وهل في فرع بالخليل؟',
            claims: [
                claim('سعر التوصيل 25 شيكل.', 'shipping', { numericResult: { relation: 'ENTAILED', claimQuantities: [{ value: 25, unit: 'ILS' }] } }),
                unsupported
            ],
            serverEvidence: [evidence('shipping', 'سعر التوصيل 25 شيكل.'), evidence('branch', 'موقع المعرض في البيرة.')],
            answer: 'سعر التوصيل 25 شيكل.'
        });
        assert.equal(result.decision, DECISION.ALLOW);
        assert.equal(result.outputAnswer, 'سعر التوصيل 25 شيكل.');
        assert.equal(result.removedClaims.length, 1);
    });

    await t.test('tenant isolation trap cannot be rescued by valid local evidence', () => {
        const result = run({
            question: 'كم السعر والفرع؟',
            claims: [claim('السعر 25 شيكل.', 'foreign', { numericResult: { relation: 'ENTAILED', claimQuantities: [{ value: 25, unit: 'ILS' }] } })],
            serverEvidence: [evidence('foreign', 'السعر 25 شيكل.', 'tenant-b'), evidence('local', 'الفرع في رام الله.')]
        });
        assert.equal(result.decision, DECISION.BLOCK);
        assert.equal(result.telemetry.tenantMismatchCount, 1);
    });
});
