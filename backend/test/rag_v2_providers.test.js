'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EmbeddingProvider, RerankerProvider, GroundedGeneratorProvider, ClaimVerifierProvider } = require('../src/rag_v2/providers/contracts');
const { DenseEmbeddingProvider } = require('../src/rag_v2/providers/embeddingProvider');
const { TaskRerankerProvider } = require('../src/rag_v2/providers/rerankerProvider');
const { TaskGroundedGeneratorProvider } = require('../src/rag_v2/providers/groundedGeneratorProvider');
const { DeterministicClaimVerifierProvider } = require('../src/rag_v2/providers/claimVerifierProvider');
const { OpenRouterProvider, OpenAIProvider, GeminiProvider, OllamaProvider } = require('../src/services/aiProviders');

test('provider contracts fail closed when not implemented', async () => {
    await assert.rejects(new EmbeddingProvider().embed('x'), /must be implemented/);
    await assert.rejects(new RerankerProvider().rerank({}), /must be implemented/);
    await assert.rejects(new GroundedGeneratorProvider().generateGrounded({}), /must be implemented/);
    await assert.rejects(new ClaimVerifierProvider().verifyClaims({}), /must be implemented/);
});

test('embedding provider delegates to validated adapter', async () => {
    const provider = new DenseEmbeddingProvider({ embed: async value => [value.length], probeDimensions: async () => 1 });
    assert.deepEqual(await provider.embed('abc'), [3]); assert.equal(await provider.probeDimensions(), 1);
});

test('task reranker validates and sorts structured provider output', async () => {
    const fake = { model: 'remote/reranker', baseUrl: 'https://example.test', generate: async (_messages, options) => {
        assert.equal(options.temperature, 0); assert.ok(options.jsonSchema); return JSON.stringify({ rankings: [{ index: 1, score: .9 }, { index: 0, score: .2 }] });
    } };
    const reranker = new TaskRerankerProvider({ provider: fake });
    const result = await reranker.rerank({ originalQuestion: 'q', standaloneQuestion: 'q', candidates: [{ chunkId: 'a', originalText: 'a' }, { chunkId: 'b', originalText: 'b' }] });
    assert.deepEqual(result.map(x => x.chunkId), ['b', 'a']);
});

test('task reranker uses native provider rerank operation when available', async () => {
    let request;
    const reranker = new TaskRerankerProvider({ provider: { model: 'remote/reranker', baseUrl: 'https://example.test',
        rerank: async (query, documents, options) => { request = { query, documents, options }; return [{ index: 0, relevance_score: .8 }]; } } });
    const result = await reranker.rerank({ originalQuestion: 'q', standaloneQuestion: 'q', candidates: [{ chunkId: 'a', originalText: 'a' }], limit: 1 });
    assert.equal(result[0].chunkId, 'a'); assert.equal(request.options.topN, 1);
});

test('grounded generator uses task provider structured output', async () => {
    const payload = { answer: 'fact [S1]', claims: [{ text: 'fact', source_ids: ['S1'], support: 'supported' }], citations: [{ source_id: 'S1' }], conflicts: [], missing_information: [], decision: 'answer', confidence: 'high' };
    const provider = new TaskGroundedGeneratorProvider({ provider: { model: 'remote/generator', baseUrl: 'https://example.test', generate: async (_messages, options) => { assert.ok(options.jsonSchema); return JSON.stringify(payload); } } });
    assert.deepEqual((await provider.generateGrounded({ question: 'q', context: '[S1] fact', sourceIds: ['S1'] })).response, payload);
});

test('deterministic verifier implements neutral claim verifier', async () => {
    const verifier = new DeterministicClaimVerifierProvider();
    const result = await verifier.verifyClaims({ response: { answer: 'fact', decision: 'answer', claims: [{ text: 'fact', source_ids: ['S1'], support: 'supported' }], citations: [{ source_id: 'S1' }] }, selected: [{ sourceId: 'S1', originalText: 'fact' }] });
    assert.equal(result.valid, true);
});

test('existing providers carry JSON schema in their native request shapes', async () => {
    const originalFetch = global.fetch; const bodies = [];
    global.fetch = async (_url, options) => {
        bodies.push(JSON.parse(options.body));
        return { ok: true, status: 200, json: async () => ({
            choices: [{ message: { content: '{}' } }],
            candidates: [{ content: { parts: [{ text: '{}' }] } }],
            usageMetadata: {}, message: { content: '{}' }
        }) };
    };
    try {
        const schema = { type: 'object', properties: {} };
        await new OpenRouterProvider('vendor/model', 'key', 'https://x').generate([{ role: 'user', content: 'x' }], { jsonSchema: schema, temperature: 0 });
        await new OpenAIProvider('gpt-test', 'key', 'https://x').generate([{ role: 'user', content: 'x' }], { jsonSchema: schema, temperature: 0 });
        await new GeminiProvider('gemini-test', 'key').generate([{ role: 'user', content: 'x' }], { jsonSchema: schema, temperature: 0 });
        await new OllamaProvider('local', '', 'https://x').generate([{ role: 'user', content: 'x' }], { jsonSchema: schema, temperature: 0 });
        assert.equal(bodies[0].response_format.type, 'json_schema'); assert.equal(bodies[1].response_format.type, 'json_schema');
        assert.equal(bodies[2].generationConfig.responseMimeType, 'application/json'); assert.deepEqual(bodies[3].format, schema);
    } finally { global.fetch = originalFetch; }
});
