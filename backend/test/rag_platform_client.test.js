'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.SESSION_SECRET = 'rag_platform_client_test_secret_32_chars';

test('RAG Platform client preserves tenant isolation and maps an answered response', async t => {
    process.env.RAG_PLATFORM_URL = 'http://rag-platform:8000';
    const aiTaskRepo = require('../src/database/repositories/aiTaskRepository');
    const budgetService = require('../src/services/budgetService');
    const originalTask = aiTaskRepo.getTaskConfig;
    const originalKeyLookup = budgetService.getApiKeyForProvider;
    budgetService.getApiKeyForProvider = () => 'test-key';
    aiTaskRepo.getTaskConfig = task => ({
        provider: task === 'reranker' ? 'openrouter' : (task === 'text_generation' ? 'openrouter' : 'ollama'),
        model: task === 'reranker' ? 'voyageai/rerank-2.5' : (task === 'text_generation' ? 'openai/gpt-5' : 'nomic-embed-text'),
        enabled: 1
    });
    const originalFetch = global.fetch;
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith('/v1/documents')) return new Response(JSON.stringify({ status: 'ready' }), { status: 201 });
        return new Response(JSON.stringify({
            status: 'answered', answer: '10 سنوات', citations: [{ evidence_id: 'E1', title: 'Handbook' }],
            confidence: { score: 0.9, label: 'high', reason_codes: [] }, trace_id: 'trace-1'
        }), { status: 200 });
    };
    t.after(() => { global.fetch = originalFetch; aiTaskRepo.getTaskConfig = originalTask; budgetService.getApiKeyForProvider = originalKeyLookup; });

    delete require.cache[require.resolve('../src/rag_platform/client')];
    const { answerWithRagPlatform } = require('../src/rag_platform/client');
    const result = await answerWithRagPlatform({ question: 'وقديش كفالتها؟', tenantId: 'tenant-a' });
    assert.equal(result.answer, '10 سنوات');
    assert.ok(calls.some(call => call.url.endsWith('/v1/documents')), 'default knowledge should be synchronized');
    assert.equal(calls.at(-1).options.headers['X-Tenant-ID'], 'tenant-a');
    assert.equal(JSON.parse(calls.at(-1).options.body).tenant_id, 'tenant-a');
    const body = JSON.parse(calls.at(-1).options.body);
    assert.equal(body.reranker_model, 'voyageai/rerank-2.5');
    assert.equal(body.generator_model, 'openai/gpt-5');
    assert.ok(body.system_prompt.length > 0);
});
