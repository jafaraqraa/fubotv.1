'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('RAG Platform forwards the selected embedding provider and model', async t => {
    const aiTaskRepo = require('../src/database/repositories/aiTaskRepository');
    const budgetService = require('../src/services/budgetService');
    const originalTask = aiTaskRepo.getTaskConfig;
    const originalKey = budgetService.getApiKeyForProvider;
    const originalFetch = global.fetch;
    aiTaskRepo.getTaskConfig = () => ({
        task: 'embedding', provider: 'openrouter', model: 'google/gemini-embedding-2',
        api_key_ref: 'OPENROUTER_API_KEY', enabled: 1
    });
    budgetService.getApiKeyForProvider = () => 'test-key';
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith('/v1/documents')) return new Response(JSON.stringify({ status: 'ready' }), { status: 201 });
        return new Response(JSON.stringify({
            status: 'answered', answer: 'ok', citations: [],
            confidence: { score: 1, label: 'high', reason_codes: [] }, trace_id: 't1'
        }), { status: 200 });
    };
    t.after(() => {
        aiTaskRepo.getTaskConfig = originalTask;
        budgetService.getApiKeyForProvider = originalKey;
        global.fetch = originalFetch;
    });
    delete require.cache[require.resolve('../src/rag_platform/client')];
    await require('../src/rag_platform/client').answerWithRagPlatform({ question: 'test', tenantId: 'config-test' });
    const query = calls.find(call => call.url.endsWith('/v1/query'));
    const body = JSON.parse(query.options.body);
    assert.equal(body.embedding_provider, 'openrouter');
    assert.equal(body.embedding_model, 'google/gemini-embedding-2');
    assert.equal(query.options.headers['X-Embedding-API-Key'], 'test-key');
});
