const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const testDbPath = path.join(__dirname, '..', 'data', 'test_rag_success_contract.db');
for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
}
process.env.SQLITE_DB_PATH = testDbPath;

const db = require('../src/database/connection');
const { initializeDatabase } = require('../src/database/initialize');
const repo = require('../src/database/repositories/knowledgeDocumentRepository');
const service = require('../src/rag/services/knowledgeDocumentService');
const { assertTransition, assertActiveDocument } = require('../src/rag/indexing/indexingLifecycle');

let sequence = 0;
const storedFiles = new Set();

function healthyDeps(overrides = {}) {
    let points = [];
    return {
        extractTextFromBuffer: async (_ext, buffer) => buffer.toString('utf8'),
        checkQdrantReady: async () => true,
        checkModelAvailability: async () => true,
        chunkDocument: document => [{
            id: 'chunk-1',
            documentId: document.documentId,
            text: document.originalText,
            source: document.source,
            sourceType: 'uploaded_document',
            contentHash: 'chunk-hash'
        }],
        generateEmbeddings: async texts => texts.map(() => [0.1, 0.2, 0.3]),
        initCollection: async () => true,
        upsertVectors: async (chunks, vectors) => {
            points = chunks.map((chunk, index) => ({ payload: chunk, vector: vectors[index] }));
        },
        getPointsByDocument: async () => points,
        deleteVectorsByDocument: async () => { points = []; },
        restoreVectors: async (_tenant, backup) => { points = backup; },
        invalidateCache: () => true,
        ...overrides
    };
}

async function upload(overrides = {}, content = null) {
    sequence += 1;
    const name = `contract-${sequence}.txt`;
    const result = await service.uploadAndRegisterDocument(
        name,
        'text/plain',
        Buffer.from(content || `unique content ${sequence}`),
        { tenantId: 'tenant-contract', _testDependencies: healthyDeps(overrides) }
    );
    if (result?.storage_path) storedFiles.add(result.storage_path);
    return result;
}

function latest() {
    return db.prepare(`
        SELECT * FROM knowledge_documents
        WHERE tenant_id = 'tenant-contract'
        ORDER BY id DESC LIMIT 1
    `).get();
}

async function expectFailure(overrides, expectedStage, expectedStatus = 'failed') {
    await assert.rejects(
        upload(overrides),
        error => error.stage === expectedStage && error.code !== undefined
    );
    const row = latest();
    if (row?.storage_path) storedFiles.add(row.storage_path);
    assert.strictEqual(row.status, expectedStatus);
    assert.notStrictEqual(row.status, 'active');
    assert.strictEqual(row.is_active, 0);
    return row;
}

test('RAG synchronous indexing success contract', async t => {
    initializeDatabase();

    await t.test('1 successful upload returns only after final active state', async () => {
        const doc = await upload();
        assertActiveDocument(doc);
        assert.strictEqual(doc.status, 'active');
        assert.strictEqual(doc.chunk_count, doc.vector_count);
    });

    await t.test('2 extraction failure is typed and persisted failed', async () => {
        await expectFailure({
            extractTextFromBuffer: async () => { throw new Error('extract failed'); }
        }, 'extraction');
    });

    await t.test('3 embedding failure is typed and persisted failed', async () => {
        await expectFailure({
            generateEmbeddings: async () => { throw new Error('embedding failed'); }
        }, 'embedding');
    });

    await t.test('4 Qdrant upload failure is typed and persisted failed', async () => {
        await expectFailure({
            upsertVectors: async () => { throw new Error('upload failed'); }
        }, 'qdrant_upload');
    });

    await t.test('5 verification mismatch cannot activate', async () => {
        await expectFailure({
            getPointsByDocument: async () => []
        }, 'verification');
    });

    await t.test('6 SQLite activation failure cannot return success', async () => {
        await expectFailure({
            beforeActivationCommit: () => { throw new Error('commit failed'); }
        }, 'activation');
    });

    await t.test('7 rollback failure becomes cleanup_pending and still rejects', async () => {
        await expectFailure({
            upsertVectors: async () => { throw new Error('partial upload'); },
            deleteVectorsByDocument: async () => { throw new Error('rollback unavailable'); }
        }, 'rollback', 'cleanup_pending');
    });

    await t.test('8 retry after failure reaches active only after verification', async () => {
        await expectFailure({
            generateEmbeddings: async () => { throw new Error('temporary failure'); }
        }, 'embedding');
        const failed = latest();
        const retried = await service.retryFailedDocument(failed.document_key, {
            tenantId: 'tenant-contract',
            _testDependencies: healthyDeps()
        });
        assertActiveDocument(retried);
    });

    await t.test('9 client cancellation rejects and never activates', async () => {
        const controller = new AbortController();
        await expectFailure({
            generateEmbeddings: async () => {
                controller.abort();
                const error = new Error('request cancelled');
                error.name = 'AbortError';
                throw error;
            }
        }, 'embedding');
    });

    await t.test('10 duplicate upload rejects rather than returning success', async () => {
        sequence += 1;
        const name = `duplicate-${sequence}.txt`;
        const body = Buffer.from(`duplicate unique ${sequence}`);
        const first = await service.uploadAndRegisterDocument(name, 'text/plain', body, {
            tenantId: 'tenant-contract', _testDependencies: healthyDeps()
        });
        storedFiles.add(first.storage_path);
        await assert.rejects(
            service.uploadAndRegisterDocument(name, 'text/plain', body, {
                tenantId: 'tenant-contract', _testDependencies: healthyDeps()
            }),
            error => error.code === 'DUPLICATE_UPLOAD'
        );
    });

    await t.test('11 illegal state transitions throw', () => {
        assert.throws(
            () => assertTransition('uploaded', 'active'),
            error => error.code === 'RAG_ILLEGAL_STATE_TRANSITION'
        );
    });

    await t.test('12 success invariant rejects failed and processing documents', () => {
        assert.throws(() => assertActiveDocument({
            status: 'failed', is_active: 0, chunk_count: 1, vector_count: 1
        }));
        assert.throws(() => assertActiveDocument({
            status: 'embedding', is_active: 0, chunk_count: 0, vector_count: 0
        }));
    });

    await t.test('13 implementation has no background 202 false-success path', () => {
        const routeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'api.js'), 'utf8');
        const uploadRoute = routeSource.slice(
            routeSource.indexOf("router.post('/rag/documents/upload'"),
            routeSource.indexOf("router.post('/rag/documents/:documentId/reindex'")
        );
        assert(!uploadRoute.includes('.status(202)'));
        assert(uploadRoute.includes('assertActiveDocument(doc)'));
        assert(uploadRoute.includes('res.status(200).json'));
    });
});

test.after(() => {
    for (const row of db.prepare('SELECT storage_path FROM knowledge_documents').all()) {
        if (row.storage_path) storedFiles.add(row.storage_path);
    }
    for (const file of storedFiles) if (fs.existsSync(file)) fs.unlinkSync(file);
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
        if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
});
