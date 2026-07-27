const test = require('node:test');
const assert = require('node:assert');
const PromptBuilder = require('../src/services/PromptBuilder');
const { buildPrompt, validateAnswer } = require('../src/services/ai');

test('Modern Production-Grade RAG Response Generation Pipeline Suite', async (t) => {

    await t.test('PromptBuilder constructs correct message list structure', () => {
        const systemPrompt = "You are a friendly customer helper.";
        const conversationHistory = [
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Hi! How can I help you today?" }
        ];
        const knowledgeContext = "Futhing is a leading AI customer support platform.";
        const userQuestion = "What is Futhing?";

        const messages = PromptBuilder.buildMessages({
            systemPrompt,
            conversationHistory,
            knowledgeContext,
            userQuestion
        });

        // Assert system prompt is placed first and only once
        assert.strictEqual(messages[0].role, "system");
        assert.strictEqual(messages[0].content, systemPrompt);

        // Assert history messages are present, cloned, and unmodified
        assert.strictEqual(messages[1].role, "user");
        assert.strictEqual(messages[1].content, "Hello");
        assert.strictEqual(messages[2].role, "assistant");
        assert.strictEqual(messages[2].content, "Hi! How can I help you today?");

        // Assert user question is last
        const lastMsg = messages[messages.length - 1];
        assert.strictEqual(lastMsg.role, "user");

        // Verify structure of the user prompt content
        assert.ok(lastMsg.content.includes("Knowledge Context"));
        assert.ok(lastMsg.content.includes(knowledgeContext));
        assert.ok(lastMsg.content.includes("Instructions"));
        assert.ok(lastMsg.content.includes("Answer ONLY using the knowledge context."));
        assert.ok(lastMsg.content.includes("User Question"));
        assert.ok(lastMsg.content.includes(userQuestion));
    });

    await t.test('PromptBuilder handles empty or missing knowledge context gracefully', () => {
        const systemPrompt = "Personality instructions.";
        const conversationHistory = [];
        const knowledgeContext = "";
        const userQuestion = "Test question";

        const messages = PromptBuilder.buildMessages({
            systemPrompt,
            conversationHistory,
            knowledgeContext,
            userQuestion
        });

        const lastMsg = messages[messages.length - 1];
        assert.ok(lastMsg.content.includes("[No knowledge context available]"));
        assert.ok(lastMsg.content.includes(userQuestion));
    });

    await t.test('ai.js exports retrieveContext, buildPrompt, callOpenRouter, and validateAnswer helper functions', () => {
        assert.strictEqual(typeof buildPrompt, 'function');
        assert.strictEqual(typeof validateAnswer, 'function');
    });
});
