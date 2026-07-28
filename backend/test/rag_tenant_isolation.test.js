const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-tenant-'));
process.env.SQLITE_DB_PATH = path.join(root, 'test.db');
process.env.NODE_ENV = 'test';
process.env.RAG_LEGACY_TENANT_ID = 'tenant-a';
process.env.RAG_ADMIN_TENANTS = 'tenant-a,tenant-b';
process.env.RAG_TENANT_KNOWLEDGE_DIR = path.join(root, 'knowledge');

const { initializeDatabase } = require('../src/database/initialize');
const db = require('../src/database/connection');
const repo = require('../src/database/repositories/knowledgeDocumentRepository');
const cache = require('../src/rag/cache/retrievalCache');
const vectors = require('../src/rag/vector/qdrantVectorStore');
const hybrid = require('../src/rag/services/hybridRetrievalService');
const knowledge = require('../src/services/knowledge');
const { resolveAuthorizedTenant, requireTenantId } = require('../src/rag/security/tenantContext');

function addDoc(tenantId, suffix) {
    return repo.insertDocument({
        document_key: 'same-id', original_name: `${suffix}.txt`, display_name: suffix,
        source_type: 'txt', mime_type: 'text/plain', storage_name: `${suffix}.txt`,
        storage_path: `/tenant/${tenantId}/${suffix}.txt`, file_size: 1,
        content_hash: `content-${suffix}`, extracted_text_hash: `text-${suffix}`,
        status: 'indexed', tenant_id: tenantId, logical_document_id: 'same-id',
        version_id: 'same-id:v1'
    });
}

const response = value => ({
    ok: true, status: 200,
    json: async () => value,
    text: async () => JSON.stringify(value)
});

test('strict RAG tenant isolation', async t => {
    initializeDatabase();
    const aId = addDoc('tenant-a', 'a');
    const bId = addDoc('tenant-b', 'b');

    await t.test('1 tenant A upload is owned by A', () =>
        assert.strictEqual(repo.getDocumentById('tenant-a', aId).tenant_id, 'tenant-a'));
    await t.test('2 tenant B upload is owned by B', () =>
        assert.strictEqual(repo.getDocumentById('tenant-b', bId).tenant_id, 'tenant-b'));
    await t.test('3 A cannot read B by numeric ID', () =>
        assert.strictEqual(repo.getDocumentById('tenant-a', bId), undefined));
    await t.test('4 identical document IDs remain isolated', () => {
        assert.strictEqual(repo.getDocumentByKey('tenant-a', 'same-id').id, aId);
        assert.strictEqual(repo.getDocumentByKey('tenant-b', 'same-id').id, bId);
    });
    await t.test('5 identical query cache keys differ', () => {
        const base = {
            collection: 'kb', indexVersion: 1, embeddingModel: 'embed', reranker: 'none',
            retrievalWeights: { semantic: .8, keyword: .2 }, topK: 5, threshold: .4, query: 'same'
        };
        assert.notStrictEqual(cache.buildCacheKey({ ...base, tenantId: 'tenant-a' }),
            cache.buildCacheKey({ ...base, tenantId: 'tenant-b' }));
    });
    await t.test('6 A invalidation preserves B cache', () => {
        cache.resetForTests();
        cache.set('a', 'A', { tenantId: 'tenant-a', collection: 'kb', indexVersion: 1 });
        cache.set('b', 'B', { tenantId: 'tenant-b', collection: 'kb', indexVersion: 1 });
        cache.invalidate({ tenantId: 'tenant-a', collection: 'kb', reason: 'test' });
        assert.strictEqual(cache.get('a'), undefined);
        assert.strictEqual(cache.get('b'), 'B');
    });
    await t.test('7 A delete includes tenant filter', async () => {
        let body;
        global.fetch = async (_url, options) => { body = JSON.parse(options.body); return response({}); };
        await vectors.deleteVectorsByDocument('tenant-a', 'same-id');
        assert.deepStrictEqual(body.filter.must[0], { key: 'tenantId', match: { value: 'tenant-a' } });
    });
    await t.test('8 A reindex lifecycle update includes tenant filter', async () => {
        let body;
        global.fetch = async (_url, options) => { body = JSON.parse(options.body); return response({}); };
        await vectors.setIndexVersionLifecycle('tenant-a', 'v1', 'active');
        assert.ok(body.filter.must.some(x => x.key === 'tenantId' && x.match.value === 'tenant-a'));
    });
    await t.test('9 A rollback rejects B staging points', async () =>
        assert.rejects(vectors.restoreVectors('tenant-a', [
            { payload: { tenantId: 'tenant-b' }, vector: [1] }
        ]), /رفض استعادة/));
    await t.test('10 A orphan/list scan excludes B', () =>
        assert.strictEqual(repo.listDocuments({ tenantId: 'tenant-a' }).some(x => x.tenant_id === 'tenant-b'), false));
    await t.test('11 missing tenantId rejects', () => {
        assert.throws(() => requireTenantId(null, 'test'), e => e.code === 'RAG_TENANT_REQUIRED');
        assert.throws(() => cache.getIndexVersion(null, 'kb'), e => e.code === 'RAG_TENANT_REQUIRED');
    });
    await t.test('12 forged browser tenantId rejects', () =>
        assert.throws(() => resolveAuthorizedTenant({
            session: { tenantId: 'tenant-a' }, headers: { 'x-tenant-id': 'tenant-b' },
            params: {}, body: {}, query: {}
        }), e => e.code === 'RAG_TENANT_FORBIDDEN'));
    await t.test('13 simultaneous retrieval directly rejects cross-tenant chunks', async () => {
        cache.resetForTests();
        hybrid.embeddingsCache.set('nomic-embed-text:same query', [0.1]);
        const seen = [];
        global.fetch = async (_url, options) => {
            const body = JSON.parse(options.body);
            const tenant = body.filter.must.find(x => x.key === 'tenantId').match.value;
            seen.push(tenant);
            const foreign = tenant === 'tenant-a' ? 'tenant-b' : 'tenant-a';
            return response({ result: [
                { id: 'own', score: .9, payload: { tenantId: tenant, text: `${tenant} own`, sourceType: 'uploaded_document' } },
                { id: 'foreign', score: 1, payload: { tenantId: foreign, text: 'foreign secret', sourceType: 'uploaded_document' } }
            ] });
        };
        const [a, b] = await Promise.all([
            hybrid.retrieveHybridContext('same query', null, { tenantId: 'tenant-a' }),
            hybrid.retrieveHybridContext('same query', null, { tenantId: 'tenant-b' })
        ]);
        assert.deepStrictEqual(new Set(seen), new Set(['tenant-a', 'tenant-b']));
        assert.deepStrictEqual(a.candidates.map(x => x.text), ['tenant-a own']);
        assert.deepStrictEqual(b.candidates.map(x => x.text), ['tenant-b own']);
    });
    await t.test('14 legacy fallback cannot bypass canonical retrieval', () => {
        assert.throws(
            () => knowledge.retrieveContext('تفاحة', { tenantId: 'tenant-a' }),
            error => error.code === 'RAG_LEGACY_PATH_DISABLED'
        );
    });
    await t.test('15 persisted cache versions remain isolated after restart-equivalent read', () => {
        const a = cache.getIndexVersion('tenant-a', 'restart');
        const b = cache.getIndexVersion('tenant-b', 'restart');
        cache.invalidate({ tenantId: 'tenant-a', collection: 'restart', reason: 'test' });
        assert.strictEqual(cache.getIndexVersion('tenant-a', 'restart'), a + 1);
        assert.strictEqual(cache.getIndexVersion('tenant-b', 'restart'), b);
    });
});

test.after(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
});
