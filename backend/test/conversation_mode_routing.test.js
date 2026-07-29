const test = require('node:test');
const assert = require('node:assert/strict');
const PromptBuilder = require('../src/services/PromptBuilder');
const {
    MODE,
    classifyConversationMode
} = require('../src/services/conversationModeRouter');
const { blockOpenDomain } = require('../src/rag/runtime/fallbackPolicy');

test('intent-aware AI conversation routing', async t => {
    await t.test('Arabic greetings and casual chat skip RAG', () => {
        for (const message of ['مرحبا', 'شو الأخبار', 'كيفك', 'صباح الخير', 'شكراً', 'مع السلامة']) {
            const decision = classifyConversationMode(message);
            assert.strictEqual(decision.mode, MODE.GENERAL_CONVERSATION, message);

            const prompt = PromptBuilder.buildMessages({
                systemPrompt: 'أنت مساعد خدمة عملاء.',
                conversationHistory: [],
                knowledgeContext: '',
                userQuestion: message,
                responseMode: decision.mode
            });
            const last = prompt.at(-1).content;
            assert.ok(last.includes('USER_MESSAGE_START'));
            assert.ok(!last.includes('UNTRUSTED_RETRIEVED_CONTEXT_START'));
            assert.ok(prompt[0].content.includes('GENERAL CONVERSATION POLICY'));
        }
    });

    await t.test('company questions route through the existing RAG prompt', () => {
        for (const message of ['كم سعر الاشتراك؟', 'ما هي سياسة الشحن؟', 'مرحبا، شو الخدمات اللي بتقدموها؟']) {
            const decision = classifyConversationMode(message);
            assert.strictEqual(decision.mode, MODE.COMPANY_KNOWLEDGE, message);

            const prompt = PromptBuilder.buildMessages({
                systemPrompt: 'أنت مساعد خدمة عملاء.',
                conversationHistory: [],
                knowledgeContext: 'سياق موثق',
                userQuestion: message,
                responseMode: decision.mode
            });
            assert.ok(prompt.at(-1).content.includes('UNTRUSTED_RETRIEVED_CONTEXT_START'));
            assert.ok(prompt[0].content.includes('RAG SECURITY POLICY'));
        }
    });

    await t.test('unknown company knowledge returns the exact safe fallback', () => {
        assert.strictEqual(
            blockOpenDomain('default', 'insufficient_context'),
            'لا تتوفر لدي معلومات مؤكدة حول هذا الموضوع حالياً. يمكنك التواصل مع فريق الدعم للحصول على التفاصيل.'
        );
    });
});
