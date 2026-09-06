'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DenseEmbeddingAdapter } = require('../src/rag_v2/embeddings/denseEmbeddingAdapter');
const { Bm25Index } = require('../src/rag_v2/retrieval/bm25Index');
const { QdrantSearchAdapter } = require('../src/rag_v2/retrieval/qdrantSearchAdapter');
const { RerankerAdapter } = require('../src/rag_v2/reranking/rerankerAdapter');
const { HybridRetriever } = require('../src/rag_v2/retrieval/hybridRetriever');
const { QdrantIndexManager, REQUIRED_PAYLOAD_INDEXES } = require('../src/rag_v2/indexing/qdrantIndexManager');
const { QdrantIndexer, toPayload, qdrantPointId } = require('../src/rag_v2/indexing/qdrantIndexer');
const { createRagV2Runtime } = require('../src/rag_v2');

function response(payload, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => payload }; }
function candidate(id, tenantId = 't1') { return { chunkId: id, tenantId, knowledgeBaseId: 'kb', status: 'active', isCurrent: true, permissions: [], originalText: id, retrievalText: id, documentVersionId: `v-${id}` }; }

test('dense adapter batches Ollama embeddings and verifies dimensions', async () => {
    let request;
    const adapter = new DenseEmbeddingAdapter({ provider: 'ollama', baseUrl: 'http://embed', model: 'pinned', expectedDimensions: 3, timeoutMs: 100, fetch: async (url, options) => { request = { url, body: JSON.parse(options.body) }; return response({ embeddings: [[1, 2, 3], [3, 2, 1]] }); } });
    assert.deepEqual(await adapter.embed(['a', 'b']), [[1, 2, 3], [3, 2, 1]]);
    assert.equal(request.url, 'http://embed/api/embed'); assert.equal(request.body.model, 'pinned');
});

test('BM25 finds exact Arabic-normalized identifiers and enforces tenant scope', () => {
    const index = new Bm25Index();
    index.add({ ...candidate('own'), retrievalText: 'وثيقة POLICY-123 السعر ١٠' });
    index.add({ ...candidate('foreign', 't2'), retrievalText: 'POLICY-123 secret' });
    const hits = index.search('policy-١٢٣', { tenantId: 't1', knowledgeBaseId: 'kb', permissionIds: [] });
    assert.deepEqual(hits.map(x => x.chunkId), ['own']);
});

test('Qdrant adapter sends mandatory filters and rejects forged response payloads', async () => {
    let body;
    const adapter = new QdrantSearchAdapter({ baseUrl: 'http://qdrant', collection: 'kb_v2', timeoutMs: 100, fetch: async (_url, options) => { body = JSON.parse(options.body); return response({ result: { points: [{ id: 'own', score: .8, payload: { chunk_id: 'own', tenantId: 't1', knowledgeBaseId: 'kb', status: 'active', isCurrent: true, permissions: [] } }, { id: 'bad', score: .9, payload: { chunk_id: 'bad', tenantId: 't2', knowledgeBaseId: 'kb', status: 'active', isCurrent: true, permissions: [] } }] } }); } });
    const hits = await adapter.dense([1, 2], { tenantId: 't1', knowledgeBaseId: 'kb', permissionIds: [] }, { limit: 40 });
    assert.deepEqual(hits.map(x => x.chunkId), ['own']);
    assert.equal(body.using, 'dense'); assert.equal(body.filter.must[0].key, 'tenant_id');
});

test('reranker preserves pre-rank positions and maps remote scores', async () => {
    const adapter = new RerankerAdapter({ baseUrl: 'http://rank', model: 'ranker', timeoutMs: 100, fetch: async () => response({ results: [{ index: 1, relevance_score: .9 }, { index: 0, relevance_score: .2 }] }) });
    const hits = await adapter.rerank({ originalQuestion: 'q', standaloneQuestion: 'q', candidates: [candidate('a'), candidate('b')], limit: 2 });
    assert.deepEqual(hits.map(x => x.chunkId), ['b', 'a']); assert.equal(hits[0].preRerankPosition, 2);
});

test('hybrid retriever runs dense and BM25, then RRF and reranking', async () => {
    const bm25 = new Bm25Index(); bm25.add({ ...candidate('sparse'), retrievalText: 'exact CODE-9' }); bm25.add({ ...candidate('both'), retrievalText: 'exact CODE-9' });
    const retriever = new HybridRetriever({ embeddings: { embed: async () => [1] }, qdrant: { dense: async () => [{ ...candidate('both'), retrievalSource: 'dense' }, { ...candidate('dense'), retrievalSource: 'dense' }] }, bm25,
        reranker: { rerank: async ({ candidates }) => candidates.map((c, i) => ({ ...c, rerankerScore: 1 - i / 10 })) }, config: { denseCandidates: 40, sparseCandidates: 40, fusedCandidates: 40, rrfK: 60, rerankerCandidates: 24 } });
    const result = await retriever.retrieve({ originalQuestion: 'exact CODE-9', scope: { tenantId: 't1', knowledgeBaseId: 'kb', permissionIds: [] } });
    assert.equal(result.fused[0].chunkId, 'both'); assert.ok(result.dense.length && result.sparse.length && result.reranked.length);
});

test('hybrid retriever returns an empty result without invoking reranker', async () => {
    let rerankerCalled = false;
    const retriever = new HybridRetriever({
        embeddings: { embed: async () => [1, 0] },
        qdrant: { dense: async () => [], sparse: async () => [] },
        reranker: { rerank: async () => { rerankerCalled = true; return []; } },
        config: { denseCandidates: 5, sparseCandidates: 5, fusedCandidates: 5, rrfK: 60, rerankerCandidates: 5 }
    });
    const result = await retriever.retrieve({ originalQuestion: 'missing', scope: {}, sparseVector: { indices: [1], values: [1] } });
    assert.deepEqual(result.reranked, []);
    assert.equal(rerankerCalled, false);
});

test('index manager only targets versioned collections and creates all payload indexes', async () => {
    assert.throws(() => new QdrantIndexManager({ baseUrl: 'http://q', collection: 'production', alias: 'a' }), /versioned/);
    const calls = [];
    const manager = new QdrantIndexManager({ baseUrl: 'http://q', collection: 'kb_v2', alias: 'kb_active', fetch: async (url, options) => { calls.push({ url, method: options.method, body: options.body && JSON.parse(options.body) }); return response({ result: { status: 'green' } }); } });
    await manager.create({ dimensions: 3, distance: 'Cosine' });
    assert.equal(calls.filter(c => c.url.endsWith('/index')).length, Object.keys(REQUIRED_PAYLOAD_INDEXES).length);
    await assert.rejects(manager.switchAlias({ validated: false }), /validated manifest/);
});

test('indexer maps authoritative metadata to snake-case Qdrant payload and named vectors', async () => {
    let request;
    const indexer = new QdrantIndexer({ baseUrl: 'http://q', collection: 'kb_v2', fetch: async (url, options) => { request = { url, body: JSON.parse(options.body) }; return response({ status: 'ok' }); } });
    await indexer.upsert([{ chunk: candidate('one'), denseVector: [1, 2], sparseVector: { indices: [1], values: [1] } }]);
    assert.equal(request.body.points[0].payload.tenant_id, 't1');
    assert.deepEqual(request.body.points[0].vector.dense, [1, 2]);
    assert.deepEqual(request.body.points[0].vector.sparse.indices, [1]);
    assert.match(request.body.points[0].id, /^[0-9a-f-]{36}$/);
    assert.equal(toPayload(candidate('one')).document_version_id, 'v-one');
    assert.equal(qdrantPointId('550e8400-e29b-41d4-a716-446655440000'), '550e8400-e29b-41d4-a716-446655440000');
});

test('runtime composes adapters while legacy flag remains selected', () => {
    const runtime = createRagV2Runtime({ env: { RAG_IMPLEMENTATION: 'legacy' }, embeddings: { embed() {} }, qdrant: { dense() {} }, reranker: { rerank() {} } });
    assert.equal(runtime.config.implementation, 'legacy'); assert.ok(runtime.retriever && runtime.indexer && runtime.indexManager);
});
