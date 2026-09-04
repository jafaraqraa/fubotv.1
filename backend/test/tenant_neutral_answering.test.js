const test = require('node:test');
const assert = require('node:assert/strict');
const PromptBuilder = require('../src/services/PromptBuilder');
const { MODE, classifyConversationMode } = require('../src/services/conversationModeRouter');
const { inspectEvidenceTenantIntegrity } = require('../src/services/ai');

function prompt(tenantId, evidence, question, history = []) {
    return PromptBuilder.buildMessages({
        systemPrompt: 'You are FuBot, a customer-service platform assistant.',
        conversationHistory: history,
        knowledgeContext: evidence,
        userQuestion: question,
        responseMode: MODE.COMPANY_KNOWLEDGE,
        tenantId
    });
}

test('tenant-neutral evidence-exclusive answering contracts', async t => {
    await t.test('unseen-domain questions do not bypass tenant knowledge', () => {
        for (const question of ['مين طبيب الأسرة؟', 'قبل كم ساعة ألغي الموعد؟', 'كم صفحة بالموقع التعريفي؟']) {
            assert.equal(classifyConversationMode(question).mode, MODE.COMPANY_KNOWLEDGE, question);
        }
    });

    await t.test('electronics and fashion tenants receive only their own supplied rule', () => {
        const electronics = prompt('electronics', 'الشحن مجاني فوق 250 شيكل.', 'متى الشحن مجاني؟');
        const fashion = prompt('fashion', 'الشحن مجاني فوق 400 شيكل.', 'متى الشحن مجاني؟');
        assert.match(electronics.at(-1).content, /250/);
        assert.doesNotMatch(electronics.at(-1).content, /400/);
        assert.match(fashion.at(-1).content, /400/);
        assert.doesNotMatch(fashion.at(-1).content, /250/);
    });

    await t.test('unknown tenant needs no prompt customization', () => {
        const messages = prompt('brand-new-tenant', 'الاستشارة 90 شيكلاً.', 'كم الاستشارة؟');
        assert.match(messages[0].content, /tenantId: brand-new-tenant/);
        assert.match(messages.at(-1).content, /الاستشارة 90/);
    });

    await t.test('missing business evidence is explicit and cannot borrow a default rule', () => {
        const messages = prompt('no-shipping-policy', '', 'متى الشحن مجاني؟');
        assert.match(messages.at(-1).content, /No verified knowledge context available/);
        assert.match(messages[0].content, /including the default tenant/);
    });

    await t.test('clinic evidence is structurally separated from retail assumptions', () => {
        const messages = prompt('clinic', 'إلغاء الموعد مجاني قبل 12 ساعة.', 'متى ألغي الموعد؟');
        assert.match(messages.at(-1).content, /قبل 12 ساعة/);
        assert.doesNotMatch(messages.at(-1).content, /returns|refund/i);
    });

    await t.test('assistant history is reference context and never verified evidence', () => {
        const messages = prompt('warranty-shop', 'الضمان سنة واحدة.', 'قديش الضمان؟', [
            { role: 'assistant', content: 'الضمان سنتين.' }
        ]);
        assert.equal(messages[1].content, 'الضمان سنتين.');
        assert.match(messages[0].content, /assistant\s+claims are not verified business evidence/);
        assert.match(messages.at(-1).content, /الضمان سنة واحدة/);
    });

    await t.test('global knowledge and unsupported multi-intent portions are prohibited', () => {
        const messages = prompt('services', 'سعر الخدمة 100 شيكل.', 'كم السعر ووين الفرع؟');
        assert.match(messages[0].content, /use ONLY document text in VERIFIED EVIDENCE/);
        assert.match(messages[0].content, /Never use assumed real-world knowledge/);
    });

    await t.test('general greetings still bypass RAG', () => {
        assert.equal(classifyConversationMode('مرحبا').mode, MODE.GENERAL_CONVERSATION);
    });

    await t.test('tenant mismatch fails integrity validation', () => {
        const result = inspectEvidenceTenantIntegrity([
            { tenantId: 'tenant-b', chunkId: 'foreign' }
        ], 'tenant-a');
        assert.equal(result.valid, false);
        assert.deepEqual(result.evidenceTenantIds, ['tenant-b']);
    });

    await t.test('same-tenant evidence passes integrity validation', () => {
        const result = inspectEvidenceTenantIntegrity([
            { tenantId: 'tenant-a' }, { payload: { tenantId: 'tenant-a' } }
        ], 'tenant-a');
        assert.equal(result.valid, true);
        assert.deepEqual(result.evidenceTenantIds, ['tenant-a']);
    });
});
