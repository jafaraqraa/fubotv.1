const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-reconcile-'));
process.env.SQLITE_DB_PATH = path.join(root, 'test.db');
process.env.NODE_ENV = 'test';
process.env.RAG_ADMIN_TENANTS = 'tenant-a,tenant-b';

const { initializeDatabase } = require('../src/database/initialize');
const db = require('../src/database/connection');
const reconciliation = require('../src/rag/services/ragReconciliationService');
const vectorStore = require('../src/rag/vector/qdrantVectorStore');
initializeDatabase();

function reset() {
    for (const table of ['rag_reconciliation_actions', 'rag_reconciliation_runs',
        'rag_reconciliation_locks', 'rag_document_locks', 'rag_index_locks',
        'knowledge_documents', 'rag_index_versions']) {
        db.prepare(`DELETE FROM ${table}`).run();
    }
}

function addDocument(overrides = {}) {
    const file = overrides.storage_path || path.join(root, `${overrides.version_id || 'doc-v1'}.txt`);
    if (!overrides.missingFile) fs.writeFileSync(file, 'knowledge');
    const row = {
        tenant_id: 'tenant-a', document_key: 'doc', logical_document_id: 'doc',
        version_id: 'doc:v1', original_name: 'doc.txt', display_name: 'Doc',
        source_type: 'txt', mime_type: 'text/plain', storage_name: 'doc.txt',
        storage_path: file, file_size: 9, content_hash: 'hash',
        extracted_text_hash: 'text-hash', status: 'indexed', is_active: 1,
        chunk_count: 1, vector_count: 1, embedding_model: 'embed',
        vector_dimension: 3, ...overrides
    };
    delete row.missingFile;
    db.prepare(`INSERT INTO knowledge_documents (
        tenant_id, document_key, logical_document_id, version_id, original_name,
        display_name, source_type, mime_type, storage_name, storage_path, file_size,
        content_hash, extracted_text_hash, status, is_active, chunk_count, vector_count,
        embedding_model, vector_dimension
    ) VALUES (
        @tenant_id, @document_key, @logical_document_id, @version_id, @original_name,
        @display_name, @source_type, @mime_type, @storage_name, @storage_path, @file_size,
        @content_hash, @extracted_text_hash, @status, @is_active, @chunk_count, @vector_count,
        @embedding_model, @vector_dimension
    )`).run(row);
}

function addIndex(overrides = {}) {
    const row = {
        tenant_id: 'tenant-a', source_type: 'knowledge_txt', document_id: 'knowledge.txt',
        version_number: 1, index_version_id: 'knowledge:v1', content_hash: 'hash',
        chunk_count: 1, embedding_model: 'embed', vector_dimension: 3,
        collection_name: 'knowledge_base', status: 'active', is_active: 1, ...overrides
    };
    db.prepare(`INSERT INTO rag_index_versions (
        tenant_id, source_type, document_id, version_number, index_version_id,
        content_hash, chunk_count, embedding_model, vector_dimension,
        collection_name, status, is_active
    ) VALUES (
        @tenant_id, @source_type, @document_id, @version_number, @index_version_id,
        @content_hash, @chunk_count, @embedding_model, @vector_dimension,
        @collection_name, @status, @is_active
    )`).run(row);
}

function point(id = 'p1', overrides = {}) {
    return { id, payload: {
        tenantId: 'tenant-a', sourceType: 'uploaded_document', documentId: 'doc',
        documentVersionId: 'doc:v1', indexVersionId: 'doc:v1', chunkIndex: 0,
        contentHash: 'hash', embeddingModel: 'embed', vectorDimension: 3,
        createdAt: '2020-01-01T00:00:00.000Z', ...overrides
    } };
}

function deps(pages, extra = {}) {
    let index = 0;
    return {
        scrollTenantPointsPage: async () => {
            const points = pages[index] || [];
            index++;
            return { points, nextOffset: index < pages.length ? String(index) : null };
        },
        scrollUnownedPointsPage: async () => ({ points: [], nextOffset: null }),
        deleteTenantPointsByIds: async (_tenant, ids) => ({ deleted: ids.length }),
        ...extra
    };
}

function run(points = [], input = {}) {
    return reconciliation.reconcileRagIndex({
        tenantId: 'tenant-a', dryRun: true, gracePeriodHours: 0,
        _testDependencies: deps([points]), ...input
    });
}

test('production-safe RAG reconciliation', async t => {
    await t.test('1 healthy point', async () => {
        reset(); addDocument(); const r = await run([point()]);
        assert.strictEqual(r.summary.healthyPoints, 1); assert.strictEqual(r.issues.length, 0);
    });
    await t.test('2 orphan vector', async () => {
        reset(); const r = await run([point()]);
        assert.strictEqual(r.issues[0].type, 'ORPHAN_VECTOR'); assert.strictEqual(r.proposedActions.length, 1);
    });
    await t.test('3 stale version', async () => {
        reset(); addDocument({ is_active: 0, status: 'archived' }); const r = await run([point()]);
        assert.strictEqual(r.issues[0].type, 'STALE_VERSION_VECTOR');
    });
    await t.test('4 missing vector', async () => {
        reset(); addDocument({ chunk_count: 2 }); const r = await run([]);
        assert.ok(r.issues.some(x => x.type === 'MISSING_VECTOR'));
    });
    await t.test('5 count mismatch', async () => {
        reset(); addDocument({ chunk_count: 2 }); const r = await run([point()]);
        assert.ok(r.issues.some(x => x.type === 'COUNT_MISMATCH'));
    });
    await t.test('6 duplicate chunk is review-only', async () => {
        reset(); addDocument(); const r = await run([point('p1'), point('p2')]);
        const x = r.issues.find(i => i.type === 'DUPLICATE_CHUNK');
        assert.ok(x); assert.strictEqual(x.safeToDelete, false);
    });
    await t.test('7 invalid payload', async () => {
        reset(); const r = await run([{ id: 'bad', payload: { tenantId: 'tenant-a' } }]);
        assert.strictEqual(r.issues[0].type, 'INVALID_PAYLOAD');
    });
    await t.test('8 unowned legacy is audit-only', async () => {
        reset(); const r = await run([], { includeLegacyAudit: true,
            _testDependencies: deps([[]], { scrollUnownedPointsPage: async () => ({
                points: [{ id: 'legacy', payload: { source: 'store_information.txt' } }],
                nextOffset: null
            }) }) });
        const x = r.issues.find(i => i.type === 'UNOWNED_LEGACY_POINT');
        assert.ok(x); assert.strictEqual(x.safeToDelete, false);
    });
    await t.test('9 wrong tenant reference', async () => {
        reset(); addDocument({ tenant_id: 'tenant-b' }); const r = await run([point()]);
        assert.strictEqual(r.issues[0].type, 'WRONG_TENANT_REFERENCE');
    });
    await t.test('10 abandoned staging vector', async () => {
        reset(); addDocument({ is_active: 0, status: 'staging' }); const r = await run([point()]);
        assert.strictEqual(r.issues[0].type, 'ABANDONED_STAGING_VECTOR');
    });
    await t.test('11 grace period prevents deletion', async () => {
        reset(); const r = await run([point('young', { createdAt: new Date().toISOString() })],
            { gracePeriodHours: 24 });
        assert.strictEqual(r.proposedActions.length, 0);
    });
    await t.test('12 dry run has no writes', async () => {
        reset(); let deletes = 0;
        await run([point()], { _testDependencies: deps([[point()]], {
            deleteTenantPointsByIds: async () => { deletes++; return { deleted: 1 }; }
        }) });
        assert.strictEqual(deletes, 0);
        assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM rag_reconciliation_runs').get().n, 0);
    });
    await t.test('13 confirmed cleanup is tenant-scoped', async () => {
        reset(); let args;
        const r = await run([point()], { confirmCleanup: true, operatorId: 'admin',
            _testDependencies: deps([[point()]], { deleteTenantPointsByIds: async (tenant, ids) => {
                args = { tenant, ids }; return { deleted: 1 };
            } }) });
        assert.deepStrictEqual(args, { tenant: 'tenant-a', ids: ['p1'] });
        assert.strictEqual(r.cleanup.deletedPoints, 1);
    });
    await t.test('14 active indexing lock prevents deletion', async () => {
        reset(); db.prepare(`INSERT INTO rag_index_locks
            (tenant_id, source_type, owner_token, expires_at) VALUES (?, ?, ?, ?)`)
            .run('tenant-a', 'knowledge_txt', 'owner', Date.now() + 60000);
        const r = await run([point()]); assert.strictEqual(r.proposedActions.length, 0);
    });
    await t.test('active document vectors are never deleted during confirmed cleanup', async () => {
        reset(); addDocument(); let deletes = 0;
        const r = await run([point()], {
            confirmCleanup: true,
            _testDependencies: deps([[point()]], {
                deleteTenantPointsByIds: async () => { deletes++; return { deleted: 1 }; }
            })
        });
        assert.strictEqual(deletes, 0);
        assert.strictEqual(r.summary.healthyPoints, 1);
    });
    await t.test('15 deletion failure is partial and audited', async () => {
        reset(); const r = await run([point()], { confirmCleanup: true,
            _testDependencies: deps([[point()]], { deleteTenantPointsByIds: async () => {
                throw new Error('qdrant down');
            } }) });
        assert.strictEqual(r.cleanup.success, false); assert.strictEqual(r.cleanup.failedActions, 1);
    });
    await t.test('16 pagination', async () => {
        reset(); addDocument({ chunk_count: 2 });
        const r = await run([], { _testDependencies: deps([
            [point('p1')], [point('p2', { chunkIndex: 1 })]
        ]) });
        assert.strictEqual(r.summary.qdrantPoints, 2);
    });
    await t.test('17 deadline returns continuation state safely', async () => {
        reset(); const r = await run([], { maxRuntimeMs: 0.0001,
            _testDependencies: deps([[point()]]) });
        assert.strictEqual(r.scanComplete, false); assert.strictEqual(r.dryRun, true);
    });
    await t.test('18 concurrent cleanup is rejected', async () => {
        reset(); const token = reconciliation.acquireCleanupLease('tenant-a', 'first', 60000);
        await assert.rejects(run([], { confirmCleanup: true }),
            error => error.code === 'RAG_RECONCILIATION_LOCKED');
        reconciliation.releaseCleanupLease('tenant-a', token);
    });
    await t.test('19 stale cleanup lease recovers', async () => {
        reset(); db.prepare(`INSERT INTO rag_reconciliation_locks
            (tenant_id, owner_token, operator_id, expires_at) VALUES (?, ?, ?, ?)`)
            .run('tenant-a', 'stale', 'old', Date.now() - 1);
        const r = await run([], { confirmCleanup: true }); assert.strictEqual(r.cleanup.success, true);
    });
    await t.test('20 knowledge index is version-counted', async () => {
        reset(); addIndex(); const r = await run([point('kb', {
            sourceType: 'knowledge_txt', documentId: 'knowledge.txt',
            documentVersionId: 'knowledge:v1', indexVersionId: 'knowledge:v1'
        })]);
        assert.strictEqual(r.summary.healthyPoints, 1);
        assert.ok(!r.issues.some(x => x.type === 'COUNT_MISMATCH'));
    });
});

test('Qdrant stats expose fields without conflating their semantics', async () => {
    const original = global.fetch;
    global.fetch = async () => ({ ok: true, json: async () => ({ result: {
        points_count: 17, indexed_vectors_count: 16, vectors_count: 999
    } }) });
    try {
        const stats = await vectorStore.getCollectionStats();
        assert.strictEqual(stats.qdrantPointsCount, 17);
        assert.strictEqual(stats.qdrantVectorsCount, 999);
        assert.strictEqual(stats.indexedVectorsCount, 16);
        assert.strictEqual(stats.embeddingDimension, null);
        assert.strictEqual(stats.collectionSegmentsCount, null);
        assert.strictEqual(stats.source, 'qdrant_collection_info');
    } finally { global.fetch = original; }
});

test('destructive Qdrant filter requires tenant, point ID, and version identity', async () => {
    const original = global.fetch;
    let requestBody;
    global.fetch = async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return { ok: true, json: async () => ({ result: { status: 'completed' } }) };
    };
    try {
        await vectorStore.deleteTenantPointsByIds('tenant-a', ['point-a'], {
            sourceType: 'uploaded_document',
            documentVersionId: 'doc:v1',
            indexVersionId: 'doc:v1'
        });
        assert.ok(requestBody.filter.must.some(x => x.key === 'tenantId'
            && x.match.value === 'tenant-a'));
        assert.ok(requestBody.filter.must.some(x => x.has_id?.includes('point-a')));
        assert.ok(requestBody.filter.must.some(x => x.key === 'documentVersionId'
            && x.match.value === 'doc:v1'));
        await assert.rejects(
            vectorStore.deleteTenantPointsByIds('tenant-a', ['point-a']),
            /Version metadata is required/
        );
    } finally { global.fetch = original; }
});

test('version verification uses an exact tenant/document/version/lifecycle count', async () => {
    const original = global.fetch;
    let body;
    global.fetch = async (_url, options) => {
        body = JSON.parse(options.body);
        return { ok: true, status: 200, json: async () => ({ result: { count: 7 } }) };
    };
    try {
        const verified = await vectorStore.countDocumentVersionPoints({
            tenantId: 'tenant-a',
            documentId: 'doc:v2',
            documentVersionId: 'v2',
            indexVersionId: 'idx2',
            lifecycle: 'staging'
        });
        assert.strictEqual(verified, 7);
        assert.strictEqual(body.exact, true);
        assert.deepStrictEqual(body.filter.must, [
            { key: 'tenantId', match: { value: 'tenant-a' } },
            { key: 'documentId', match: { value: 'doc:v2' } },
            { key: 'documentVersionId', match: { value: 'v2' } },
            { key: 'indexVersionId', match: { value: 'idx2' } },
            { key: 'lifecycle', match: { value: 'staging' } }
        ]);
    } finally { global.fetch = original; }
});

test('version verification rejects incomplete identities before Qdrant access', async () => {
    await assert.rejects(
        () => vectorStore.countDocumentVersionPoints({
            tenantId: 'tenant-a', documentId: 'doc', documentVersionId: 'v1'
        }),
        /indexVersionId and lifecycle are required/
    );
});

test.after(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
});
