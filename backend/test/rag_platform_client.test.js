'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('RAG Platform client preserves tenant isolation and maps an answered response', async t => {
    process.env.RAG_PLATFORM_URL = 'http://rag-platform:8000';
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
    t.after(() => { global.fetch = originalFetch; });

    delete require.cache[require.resolve('../src/rag_platform/client')];
    const { answerWithRagPlatform } = require('../src/rag_platform/client');
    const result = await answerWithRagPlatform({ question: 'وقديش كفالتها؟', tenantId: 'tenant-a' });
    assert.equal(result.answer, '10 سنوات');
    assert.ok(calls.some(call => call.url.endsWith('/v1/documents')), 'default knowledge should be synchronized');
    assert.equal(calls.at(-1).options.headers['X-Tenant-ID'], 'tenant-a');
    assert.equal(JSON.parse(calls.at(-1).options.body).tenant_id, 'tenant-a');
});
