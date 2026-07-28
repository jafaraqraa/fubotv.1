const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { test } = require('node:test');
const dbPath = path.join(__dirname, '..', 'data', 'test_knowledge_atomic.db');
for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(dbPath + suffix)) fs.unlinkSync(dbPath + suffix);
process.env.SQLITE_DB_PATH = dbPath;
const db = require('../src/database/connection');
const { initializeDatabase } = require('../src/database/initialize');
const service = require('../src/rag/indexing/knowledgeIndexingService');
const points = new Map();

function oldVersion(tenantId) {
    const versionId = `old_${tenantId}_${crypto.randomUUID().replace(/-/g, '')}`;
    const id = db.prepare(`
        INSERT INTO rag_index_versions (
            tenant_id, source_type, document_id, version_number, index_version_id,
            content_hash, chunk_count, embedding_model, vector_dimension,
            collection_name, status, is_active, cleanup_status, activated_at
        ) VALUES (?, 'knowledge_txt', 'knowledge.txt', 1, ?, 'old-hash', 1,
                  'nomic-embed-text', 4, 'futhing_knowledge', 'active', 1,
                  'completed', CURRENT_TIMESTAMP)
    `).run(tenantId, versionId).lastInsertRowid;
    points.set(versionId, [{ payload: {
        tenantId, sourceType: 'knowledge_txt', indexVersionId: versionId,
        embeddingModel: 'nomic-embed-text', vectorDimension: 4
    }, vector: [1, 0, 0, 0] }]);
    return db.prepare('SELECT * FROM rag_index_versions WHERE id = ?').get(id);
}

function dependencies(overrides = {}) {
    return {
        loadTextDocument: () => ({
            documentId: 'knowledge.txt', source: 'knowledge.txt', sourceType: 'text',
            originalText: 'قاعدة معرفة جديدة صالحة للاختبار الذري.',
            documentHash: crypto.randomUUID().replace(/-/g, '')
        }),
        checkQdrantReady: async () => true,
        checkModelAvailability: async () => true,
        initCollection: async () => true,
        generateEmbeddings: async texts => texts.map(() => [0.1, 0.2, 0.3, 0.4]),
        upsertVectors: async (chunks, vectors) => {
            points.set(chunks[0].indexVersionId, chunks.map((chunk, i) => ({
                payload: chunk, vector: vectors[i]
            })));
        },
        getPointsByIndexVersion: async (_tenant, id) => points.get(id) || [],
        queryIndexVersion: async (_vector, id, tenant) =>
            (points.get(id) || []).some(p => p.payload.tenantId === tenant) ? [{}] : [],
        setIndexVersionLifecycle: async (_tenant, id, lifecycle) => {
            for (const point of points.get(id) || []) point.payload.lifecycle = lifecycle;
        },
        deleteVectorsByIndexVersion: async (_tenant, id) => points.delete(id),
        deleteVectorsByDocument: async () => true,
        setDocumentVectorsLifecycle: async () => true,
        invalidateCache: () => true,
        ...overrides
    };
}

async function expectPreserved(previous, tenantId, overrides, stage) {
    await assert.rejects(
        service.reindexKnowledgeBase(true, {
            tenantId, _testDependencies: dependencies(overrides)
        }),
        error => error.previousVersionPreserved === true && error.stage === stage
    );
    assert.strictEqual(service.getActiveIndexVersion(tenantId).id, previous.id);
    assert.ok(points.has(previous.index_version_id));
    assert.strictEqual(
        db.prepare("SELECT COUNT(*) count FROM rag_index_versions WHERE tenant_id = ? AND status IN ('staging','ready','indexing')").get(tenantId).count,
        0
    );
}

test('knowledge.txt atomic versioned reindex', async t => {
    initializeDatabase();

    await t.test('1 successful atomic reindex', async () => {
        const previous = oldVersion('success');
        const result = await service.reindexKnowledgeBase(true, {
            tenantId: 'success', _testDependencies: dependencies()
        });
        assert.strictEqual(result.status, 'active');
        assert.strictEqual(result.chunkCount, 1);
        assert.strictEqual(result.previousVersionCleanup, 'completed');
        assert.notStrictEqual(service.getActiveIndexVersion('success').id, previous.id);
        assert.ok(!points.has(previous.index_version_id));
    });

    await t.test('2 empty knowledge.txt preserves old index', async () => {
        const previous = oldVersion('empty');
        await expectPreserved(previous, 'empty', {
            loadTextDocument: () => { throw new Error('ملف المعرفة فارغ'); }
        }, 'read');
    });

    await t.test('3 chunking failure preserves old index', async () => {
        const previous = oldVersion('chunk');
        await expectPreserved(previous, 'chunk', {
            chunkDocument: () => { throw new Error('chunk failure'); }
        }, 'chunking');
    });

    await t.test('4 Ollama unavailable preserves old index', async () => {
        const previous = oldVersion('ollama');
        await expectPreserved(previous, 'ollama', {
            checkModelAvailability: async () => false
        }, 'infrastructure');
    });

    await t.test('5 partial embedding failure preserves old index', async () => {
        const previous = oldVersion('embedding');
        await expectPreserved(previous, 'embedding', {
            generateEmbeddings: async () => []
        }, 'embeddings');
    });

    await t.test('6 Qdrant upload timeout preserves old index', async () => {
        const previous = oldVersion('timeout');
        await expectPreserved(previous, 'timeout', {
            upsertVectors: async () => { throw new Error('Qdrant upload timeout'); }
        }, 'qdrant_upload');
    });

    await t.test('7 partial Qdrant upload is rolled back', async () => {
        const previous = oldVersion('partial');
        const before = new Set(points.keys());
        await expectPreserved(previous, 'partial', {
            upsertVectors: async (chunks, vectors) => {
                points.set(chunks[0].indexVersionId, [{ payload: chunks[0], vector: vectors[0] }]);
                throw new Error('partial upload');
            }
        }, 'qdrant_upload');
        assert.deepStrictEqual([...points.keys()].filter(key => !before.has(key)), []);
    });

    await t.test('8 verification count mismatch rolls back', async () => {
        const previous = oldVersion('count');
        await expectPreserved(previous, 'count', {
            getPointsByIndexVersion: async (_tenant, id) =>
                id === previous.index_version_id ? points.get(id) : []
        }, 'qdrant_verification');
    });

    await t.test('9 SQLite activation failure restores previous active version', async () => {
        const previous = oldVersion('activation');
        await expectPreserved(previous, 'activation', {
            beforeActivation: () => { throw new Error('SQLite activation failed'); }
        }, 'activation');
    });

    await t.test('10 old cleanup failure keeps new version active', async () => {
        const previous = oldVersion('cleanup');
        const result = await service.reindexKnowledgeBase(true, {
            tenantId: 'cleanup',
            _testDependencies: dependencies({
                deleteVectorsByIndexVersion: async (_tenant, id) => {
                    if (id === previous.index_version_id) throw new Error('cleanup failed');
                    points.delete(id);
                }
            })
        });
        assert.strictEqual(result.status, 'active');
        assert.strictEqual(result.previousVersionCleanup, 'pending');
        assert.notStrictEqual(service.getActiveIndexVersion('cleanup').id, previous.id);
        assert.strictEqual(db.prepare('SELECT cleanup_status FROM rag_index_versions WHERE id = ?').get(previous.id).cleanup_status, 'pending');
    });

    await t.test('11 concurrent reindex is rejected by SQLite lease', async () => {
        oldVersion('concurrent');
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const first = service.reindexKnowledgeBase(true, {
            tenantId: 'concurrent',
            _testDependencies: dependencies({
                generateEmbeddings: async texts => {
                    await gate;
                    return texts.map(() => [1, 2, 3, 4]);
                }
            })
        });
        await new Promise(resolve => setImmediate(resolve));
        await assert.rejects(
            service.reindexKnowledgeBase(true, {
                tenantId: 'concurrent', _testDependencies: dependencies()
            }),
            error => error.code === 'RAG_INDEX_ALREADY_RUNNING'
        );
        release();
        await first;
    });

    await t.test('12 expired stale lock is recovered', async () => {
        oldVersion('stale');
        db.prepare(`
            INSERT INTO rag_index_locks (tenant_id, source_type, owner_token, expires_at)
            VALUES ('stale', 'knowledge_txt', 'dead-owner', ?)
        `).run(Date.now() - 1);
        const result = await service.reindexKnowledgeBase(true, {
            tenantId: 'stale', _testDependencies: dependencies()
        });
        assert.strictEqual(result.status, 'active');
    });

    await t.test('13 cache invalidates only after activation', async () => {
        oldVersion('cache');
        let activeAtInvalidation = false;
        let invalidationArgs;
        await service.reindexKnowledgeBase(true, {
            tenantId: 'cache',
            _testDependencies: dependencies({
                invalidateCache: args => {
                    invalidationArgs = args;
                    activeAtInvalidation = Boolean(service.getActiveIndexVersion('cache'));
                }
            })
        });
        assert.strictEqual(activeAtInvalidation, true);
        assert.strictEqual(invalidationArgs.tenantId, 'cache');
        assert.strictEqual(invalidationArgs.sourceType, 'knowledge_txt');
    });

    await t.test('14 tenant indexes remain isolated', async () => {
        const a = oldVersion('tenant-a');
        const b = oldVersion('tenant-b');
        await service.reindexKnowledgeBase(true, {
            tenantId: 'tenant-a', _testDependencies: dependencies()
        });
        assert.notStrictEqual(service.getActiveIndexVersion('tenant-a').id, a.id);
        assert.strictEqual(service.getActiveIndexVersion('tenant-b').id, b.id);
        assert.ok(points.has(b.index_version_id));
    });

    await t.test('15 restart after failed staging finds no lock or staging version', async () => {
        const previous = oldVersion('restart');
        await expectPreserved(previous, 'restart', {
            upsertVectors: async () => { throw new Error('crash-like failure'); }
        }, 'qdrant_upload');
        assert.strictEqual(db.prepare("SELECT COUNT(*) count FROM rag_index_locks WHERE tenant_id = 'restart'").get().count, 0);
        const result = await service.reindexKnowledgeBase(true, {
            tenantId: 'restart', _testDependencies: dependencies()
        });
        assert.strictEqual(result.status, 'active');
    });
});

test.after(() => {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(dbPath + suffix)) fs.unlinkSync(dbPath + suffix);
});
