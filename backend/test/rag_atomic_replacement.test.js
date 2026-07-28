const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { test } = require('node:test');
const testDbPath = path.join(__dirname, '..', 'data', 'test_rag_atomic_replace.db');
for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
process.env.SQLITE_DB_PATH = testDbPath;
const db = require('../src/database/connection');
const { initializeDatabase } = require('../src/database/initialize');
const repo = require('../src/database/repositories/knowledgeDocumentRepository');
const service = require('../src/rag/services/knowledgeDocumentService');
const { docsDir } = require('../src/rag/loaders/documentExtractionService');
const files = new Set();
const vectors = new Map();

function oldDocument(name, tenantId = 'tenant-a') {
    const key = `old_${crypto.randomUUID().replace(/-/g, '')}`;
    const file = path.join(docsDir, `${key}.txt`);
    fs.writeFileSync(file, 'old valid content');
    files.add(file);
    const id = repo.insertDocument({
        document_key: key, original_name: name, display_name: name, source_type: 'txt',
        mime_type: 'text/plain', storage_name: path.basename(file), storage_path: file,
        file_size: 17, content_hash: crypto.createHash('sha256').update(key).digest('hex'),
        extracted_text_hash: crypto.createHash('sha256').update(`${key}-text`).digest('hex'),
        status: 'active', is_enabled: 1, is_active: 1, version: 1, tenant_id: tenantId,
        logical_document_id: key, version_id: `${key}:v1`, chunk_count: 1, vector_count: 1,
        embedding_model: 'nomic-embed-text', vector_dimension: 4
    });
    vectors.set(key, [{ payload: { documentId: key, tenantId }, vector: [1, 0, 0, 0] }]);
    return repo.getDocumentById(tenantId, id);
}

function deps(overrides = {}) {
    return {
        extractTextFromBuffer: async () => 'محتوى جديد صالح ومختلف لاختبار الاستبدال الذري.',
        checkQdrantReady: async () => true,
        checkModelAvailability: async () => true,
        initCollection: async () => true,
        generateEmbeddings: async texts => texts.map(() => [0.1, 0.2, 0.3, 0.4]),
        upsertVectors: async (chunks, embeddings) => {
            vectors.set(chunks[0].documentId, chunks.map((chunk, i) => ({ payload: chunk, vector: embeddings[i] })));
        },
        getPointsByDocument: async (_tenantId, id) => vectors.get(id) || [],
        deleteVectorsByDocument: async (_tenantId, id) => vectors.delete(id),
        setDocumentVectorsLifecycle: async (_tenantId, id, lifecycle) => {
            for (const point of vectors.get(id) || []) point.payload.lifecycle = lifecycle;
        },
        invalidateCache: () => true,
        ...overrides
    };
}
const options = (overrides = {}, tenantId = 'tenant-a') => ({
    overwriteAction: 'replace', tenantId, _testDependencies: deps(overrides)
});

async function preserved(old, opts, stage) {
    await assert.rejects(
        service.uploadAndRegisterDocument(old.original_name, 'text/plain', Buffer.from('new'), opts),
        error => error.previousVersionPreserved === true && error.stage === stage
    );
    const active = repo.getDocumentByOriginalName(old.tenant_id, old.original_name);
    assert.strictEqual(active.id, old.id);
    assert.strictEqual(active.status, 'active');
    assert.ok(fs.existsSync(old.storage_path));
    assert.ok(vectors.has(old.document_key));
    assert.strictEqual(repo.listDocumentVersions(old.tenant_id, old.logical_document_id).length, 1);
    assert.strictEqual(db.prepare("SELECT COUNT(*) count FROM knowledge_documents WHERE status = 'staging'").get().count, 0);
}

test('atomic RAG document replacement lifecycle', async t => {
    initializeDatabase();

    await t.test('success commits verified version, invalidates cache, then removes old resources', async () => {
        const old = oldDocument('success.txt');
        let invalidations = 0;
        const result = await service.uploadAndRegisterDocument(
            old.original_name, 'text/plain', Buffer.from('new'),
            options({ invalidateCache: () => invalidations++ })
        );
        files.add(result.storage_path);
        assert.strictEqual(result.status, 'active');
        assert.strictEqual(result.version, 2);
        assert.strictEqual(result.oldVersionCleanup, 'completed');
        assert.strictEqual(invalidations, 1);
        assert.ok(vectors.has(result.document_key));
        assert.ok(!vectors.has(old.document_key));
        assert.ok(!fs.existsSync(old.storage_path));
        assert.strictEqual(repo.listDocumentVersions('tenant-a', old.logical_document_id).filter(v => v.is_active).length, 1);
    });

    await t.test('extraction and empty-content failures preserve old version', async () => {
        await preserved(oldDocument('extract.txt'), options({
            extractTextFromBuffer: async () => { throw new Error('invalid PDF'); }
        }), 'extraction');
        await preserved(oldDocument('empty.txt'), options({
            extractTextFromBuffer: async () => ' '
        }), 'extraction');
    });

    await t.test('chunking failure preserves old version', async () => {
        await preserved(oldDocument('chunk.txt'), options({
            chunkDocument: () => { throw new Error('chunk failure'); }
        }), 'chunking');
    });

    await t.test('Ollama and partial embedding failures preserve old version', async () => {
        await preserved(oldDocument('ollama.txt'), options({
            checkModelAvailability: async () => false
        }), 'infrastructure');
        await preserved(oldDocument('embedding.txt'), options({
            generateEmbeddings: async () => []
        }), 'embeddings');
    });

    await t.test('partial Qdrant upload is deleted while old vectors remain', async () => {
        const old = oldDocument('qdrant.txt');
        const vectorKeysBefore = new Set(vectors.keys());
        await preserved(old, options({
            upsertVectors: async (chunks, embeddings) => {
                vectors.set(chunks[0].documentId, [{ payload: chunks[0], vector: embeddings[0] }]);
                throw new Error('timeout after partial write');
            }
        }), 'qdrant_upload');
        assert.deepStrictEqual(
            [...vectors.keys()].filter(key => !vectorKeysBefore.has(key)),
            []
        );
    });

    await t.test('SQLite commit and filesystem rename failures roll back staging', async () => {
        await preserved(oldDocument('database.txt'), options({
            beforeDatabaseCommit: () => { throw new Error('commit failure'); }
        }), 'database_commit');
        await preserved(oldDocument('rename.txt'), options({
            renameFile: () => { throw new Error('rename failure'); }
        }), 'filesystem_commit');
    });

    await t.test('old cleanup failure leaves new version active and reports cleanup separately', async () => {
        const old = oldDocument('cleanup.txt');
        const result = await service.uploadAndRegisterDocument(
            old.original_name, 'text/plain', Buffer.from('new'),
            options({
                deleteVectorsByDocument: async (_tenantId, id) => {
                    if (id === old.document_key) throw new Error('cleanup unavailable');
                    vectors.delete(id);
                }
            })
        );
        files.add(result.storage_path);
        assert.strictEqual(result.status, 'active');
        assert.strictEqual(result.is_active, 1);
        assert.strictEqual(result.oldVersionCleanup, 'pending');
        assert.match(result.cleanup_error, /vectors:/);
        assert.ok(vectors.has(old.document_key));
    });

    await t.test('cache invalidation failure does not roll back committed version', async () => {
        const old = oldDocument('cache.txt');
        const result = await service.uploadAndRegisterDocument(
            old.original_name, 'text/plain', Buffer.from('new'),
            options({ invalidateCache: () => { throw new Error('cache down'); } })
        );
        files.add(result.storage_path);
        assert.strictEqual(result.status, 'active');
        assert.strictEqual(result.is_active, 1);
        assert.strictEqual(result.oldVersionCleanup, 'pending');
    });

    await t.test('concurrent replacement is rejected by SQLite document lock', async () => {
        const old = oldDocument('concurrent.txt');
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const first = service.uploadAndRegisterDocument(
            old.original_name, 'text/plain', Buffer.from('one'),
            options({ generateEmbeddings: async texts => { await gate; return texts.map(() => [1, 2, 3, 4]); } })
        );
        await new Promise(resolve => setImmediate(resolve));
        await assert.rejects(
            service.uploadAndRegisterDocument(old.original_name, 'text/plain', Buffer.from('two'), options()),
            error => error.code === 'RAG_REPLACE_LOCKED'
        );
        release();
        const result = await first;
        files.add(result.storage_path);
        assert.strictEqual(repo.listDocumentVersions('tenant-a', old.logical_document_id).filter(v => v.is_active).length, 1);
    });

    await t.test('same filename remains isolated between tenants', async () => {
        const a = oldDocument('shared.txt', 'tenant-a');
        const b = oldDocument('shared.txt', 'tenant-b');
        const result = await service.uploadAndRegisterDocument(
            a.original_name, 'text/plain', Buffer.from('new-a'), options({}, 'tenant-a')
        );
        files.add(result.storage_path);
        assert.notStrictEqual(repo.getDocumentByOriginalName('tenant-a', 'shared.txt').id, a.id);
        assert.strictEqual(repo.getDocumentByOriginalName('tenant-b', 'shared.txt').id, b.id);
        assert.ok(fs.existsSync(b.storage_path));
        assert.ok(vectors.has(b.document_key));
    });
});

test.after(() => {
    for (const row of db.prepare('SELECT storage_path FROM knowledge_documents').all()) files.add(row.storage_path);
    for (const file of files) if (file && fs.existsSync(file)) fs.unlinkSync(file);
    db.close();
    for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
});
