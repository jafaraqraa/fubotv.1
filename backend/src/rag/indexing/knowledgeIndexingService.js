const db = require('../../database/connection');
const { loadTextDocument } = require('../loaders/textDocumentLoader');
const { cleanText } = require('../processing/textCleaner');
const { chunkDocument } = require('../processing/documentChunker');
const { generateEmbeddings, checkModelAvailability } = require('../embeddings/ollamaEmbeddingProvider');
const vectorStore = require('../vector/qdrantVectorStore');
const retrievalCache = require('../cache/retrievalCache');
const { getConfig } = require('../config/ragConfig');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const { requireTenantId } = require('../security/tenantContext');
const { registerOperation } = require('../runtime/operationRegistry');
const { asStageError, RollbackError } = require('./indexingErrors');
const { scanText } = require('../security/promptInjectionGuard');
const { acquireLease } = require('../runtime/distributedLockService');
const { getManualKnowledgePath } = require('../storage/tenantKnowledgeStorage');

const SOURCE_TYPE = 'knowledge_txt';
const DOCUMENT_ID = 'knowledge.txt';
let activeOperations = 0;

function isIndexingRunning() {
    return activeOperations > 0;
}

function computeIndexFingerprint(documentHash, chunkSize, chunkOverlap, embeddingModel, collectionName) {
    return crypto.createHash('sha256').update(JSON.stringify({
        documentHash, chunkSize, chunkOverlap, embeddingModel, collectionName,
        cleanerVersion: 'v1.0', normalizerVersion: 'v1.0', chunkerVersion: 'v1.0'
    }), 'utf8').digest('hex');
}

function saveIndexingState(state) {
    state.tenant_id = requireTenantId(state.tenant_id, 'knowledge-save-index-state');
    db.prepare(`
        INSERT INTO rag_indexing_state (
            tenant_id, document_id, document_hash, source, last_status, last_success_at,
            last_duration_ms, total_chunks, last_error, collection_name,
            embedding_model, chunk_size, chunk_overlap, index_fingerprint, updated_at
        ) VALUES (
            @tenant_id, @document_id, @document_hash, @source, @last_status, @last_success_at,
            @last_duration_ms, @total_chunks, @last_error, @collection_name,
            @embedding_model, @chunk_size, @chunk_overlap, @index_fingerprint, CURRENT_TIMESTAMP
        )
        ON CONFLICT(tenant_id, document_id) DO UPDATE SET
            document_hash = excluded.document_hash, last_status = excluded.last_status,
            last_success_at = excluded.last_success_at, last_duration_ms = excluded.last_duration_ms,
            total_chunks = excluded.total_chunks, last_error = excluded.last_error,
            collection_name = excluded.collection_name, embedding_model = excluded.embedding_model,
            chunk_size = excluded.chunk_size, chunk_overlap = excluded.chunk_overlap,
            index_fingerprint = excluded.index_fingerprint, updated_at = CURRENT_TIMESTAMP
    `).run(state);
}

function getIndexingState(tenantId, documentId) {
    tenantId = requireTenantId(tenantId, 'knowledge-get-index-state');
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='rag_indexing_state'").get();
    return exists ? db.prepare(
        'SELECT * FROM rag_indexing_state WHERE tenant_id = ? AND document_id = ?'
    ).get(tenantId, documentId) : null;
}

function getActiveIndexVersion(tenantId) {
    tenantId = requireTenantId(tenantId, 'knowledge-active-index-version');
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='rag_index_versions'").get();
    if (!exists) return null;
    return db.prepare(`
        SELECT * FROM rag_index_versions
        WHERE tenant_id = ? AND source_type = ? AND document_id = ? AND is_active = 1
        LIMIT 1
    `).get(tenantId, SOURCE_TYPE, DOCUMENT_ID) || null;
}

function stageError(error, stage) {
    return asStageError(error, stage, {
        source: DOCUMENT_ID,
        previousVersionPreserved: true
    });
}

async function reindexKnowledgeBase(force = false, options = {}) {
    const tenantId = requireTenantId(options.tenantId, 'knowledge-reindex');
    let lease;
    try {
        lease = await acquireLease({
            tenantId,
            resourceType: 'knowledge_txt',
            resourceId: DOCUMENT_ID,
            operation: 'knowledge_reindex',
            signal: options.signal,
            failFast: options.failFast !== false,
            idempotencyKey: options.idempotencyKey
        });
    } catch (error) {
        if (error.code === 'RAG_OPERATION_IN_PROGRESS') {
            error.canonicalCode = error.code;
            error.code = 'RAG_INDEX_ALREADY_RUNNING';
        }
        error.stage = error.stage || 'lock';
        throw error;
    }
    if (lease.duplicate) {
        if (lease.operation.status === 'completed' && lease.operation.result_json) {
            return JSON.parse(lease.operation.result_json);
        }
        throw Object.assign(new Error('A matching knowledge reindex operation is already in progress.'), {
            code: 'RAG_OPERATION_IN_PROGRESS', retryable: true, stage: 'lock'
        });
    }
    const operation = registerOperation('knowledge_reindex', lease.signal);
    const signal = operation.signal;
    activeOperations++;
    const startedAt = performance.now();
    const dependencies = options._testDependencies || {};
    const load = dependencies.loadTextDocument || loadTextDocument;
    const chunk = dependencies.chunkDocument || chunkDocument;
    const embed = dependencies.generateEmbeddings || generateEmbeddings;
    const qdrantReady = dependencies.checkQdrantReady || vectorStore.checkQdrantReady;
    const modelAvailable = dependencies.checkModelAvailability || checkModelAvailability;
    const initCollection = dependencies.initCollection || vectorStore.initCollection;
    const upload = dependencies.upsertVectors || vectorStore.upsertVectors;
    const getPoints = dependencies.getPointsByIndexVersion || vectorStore.getPointsByIndexVersion;
    const countVersionPoints = dependencies.countDocumentVersionPoints
        || (dependencies.getPointsByIndexVersion
            ? async identity => (await getPoints(tenantId, identity.indexVersionId, { signal })).length
            : vectorStore.countDocumentVersionPoints);
    const verifyQuery = dependencies.queryIndexVersion || vectorStore.queryIndexVersion;
    const setLifecycle = dependencies.setIndexVersionLifecycle || vectorStore.setIndexVersionLifecycle;
    const deleteVersion = dependencies.deleteVectorsByIndexVersion || vectorStore.deleteVectorsByIndexVersion;
    const deleteDocument = dependencies.deleteVectorsByDocument || vectorStore.deleteVectorsByDocument;
    const invalidate = dependencies.invalidateCache || retrievalCache.invalidate;
    const chunkSize = parseInt(getConfig('RAG_CHUNK_SIZE'), 10) || 800;
    const chunkOverlap = parseInt(getConfig('RAG_CHUNK_OVERLAP'), 10) || 120;
    const embeddingModel = getConfig('RAG_EMBEDDING_MODEL');
    const collection = getConfig('QDRANT_COLLECTION');
    const kbPath = process.env.RAG_TEST_KB_PATH || getManualKnowledgePath(tenantId);
    const previous = getActiveIndexVersion(tenantId);
    const versionNumber = (previous?.version_number || 0) + 1;
    const indexVersionId = `kb_${tenantId}_${crypto.randomUUID().replace(/-/g, '')}`;
    let stagingId = null;
    let temporaryUploadAttempted = false;
    let activated = false;
    let stage = 'read';
    let operationError = null;
    let operationResult = null;

    try {
        stage = 'recovery';
        const abandoned = db.prepare(`
            SELECT * FROM rag_index_versions
            WHERE tenant_id = ? AND source_type = ? AND document_id = ?
              AND is_active = 0 AND status IN ('staging', 'indexing', 'ready')
        `).all(tenantId, SOURCE_TYPE, DOCUMENT_ID);
        for (const version of abandoned) {
            lease.assertOwnership();
            await deleteVersion(tenantId, version.index_version_id);
            db.prepare('DELETE FROM rag_index_versions WHERE tenant_id = ? AND id = ? AND is_active = 0')
                .run(tenantId, version.id);
        }
        const pendingCleanups = db.prepare(`
            SELECT * FROM rag_index_versions
            WHERE tenant_id = ? AND source_type = ? AND document_id = ?
              AND is_active = 0 AND cleanup_status = 'pending'
        `).all(tenantId, SOURCE_TYPE, DOCUMENT_ID);
        for (const version of pendingCleanups) {
            try {
                lease.assertOwnership();
                await setLifecycle(tenantId, version.index_version_id, 'archived');
                await deleteVersion(tenantId, version.index_version_id);
                db.prepare(`
                    UPDATE rag_index_versions
                    SET status = 'archived', cleanup_status = 'completed', error_message = NULL
                    WHERE tenant_id = ? AND id = ?
                `).run(tenantId, version.id);
            } catch (_) {
                // Keep it pending; retry on the next tenant-scoped reindex.
            }
        }

        stage = 'read';
        const document = load(kbPath);
        if (!document.originalText || !document.originalText.trim()) throw new Error('ملف المعرفة فارغ.');
        const contentHash = document.documentHash;
        const fingerprint = computeIndexFingerprint(contentHash, chunkSize, chunkOverlap, embeddingModel, collection);

        if (!force && previous && previous.content_hash === contentHash
            && previous.embedding_model === embeddingModel && previous.collection_name === collection) {
            const existingPoints = await getPoints(tenantId, previous.index_version_id);
            if (existingPoints.length === previous.chunk_count) {
                operationResult = {
                    source: DOCUMENT_ID, tenantId, indexVersionId: previous.index_version_id,
                    status: 'unchanged', chunkCount: previous.chunk_count,
                    chunksCreated: 0, totalVectors: previous.chunk_count,
                    previousVersionCleanup: previous.cleanup_status || 'completed',
                    durationMs: performance.now() - startedAt
                };
                return operationResult;
            }
        }

        stage = 'staging';
        stagingId = db.prepare(`
            INSERT INTO rag_index_versions (
                tenant_id, source_type, document_id, version_number, index_version_id,
                content_hash, chunk_count, embedding_model, collection_name, status,
                is_active, cleanup_status, fencing_token, operation_id
            ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 'staging', 0, 'not_started', ?, ?)
        `).run(
            tenantId, SOURCE_TYPE, DOCUMENT_ID, versionNumber, indexVersionId,
            contentHash, embeddingModel, collection, lease.fencingToken, lease.operationId
        ).lastInsertRowid;
        console.log(`[RAG knowledge.txt] Staging version created tenant=${tenantId} version=${versionNumber}`);

        stage = 'infrastructure';
        if (!await qdrantReady({ signal })) throw new Error('تعذر الاتصال بـ Qdrant.');
        if (!await modelAvailable({ signal })) throw new Error(`نموذج التضمين (${embeddingModel}) غير متوفر.`);

        stage = 'chunking';
        const maxTextLength = Number(getConfig('RAG_MAX_EXTRACTED_TEXT_LENGTH')) || 10000000;
        if (document.originalText.length > maxTextLength) {
            const error = new Error(`النص المستخرج يتجاوز الحد المسموح ${maxTextLength}.`);
            error.code = 'RAG_MAX_TEXT_LENGTH_EXCEEDED';
            throw error;
        }
        const baseChunks = chunk({
            ...document,
            documentId: `${DOCUMENT_ID}:${indexVersionId}`,
            sourceType: SOURCE_TYPE,
            originalText: cleanText(document.originalText),
            ingestionVersion: indexVersionId
        }, chunkSize, chunkOverlap);
        if (!baseChunks.length) throw new Error('لم يتم إنشاء أي مقاطع.');
        const maxChunks = Number(getConfig('RAG_MAX_CHUNKS_PER_DOCUMENT')) || 5000;
        if (baseChunks.length > maxChunks) {
            const error = new Error(`عدد المقاطع ${baseChunks.length} يتجاوز الحد المسموح ${maxChunks}.`);
            error.code = 'RAG_MAX_CHUNKS_EXCEEDED';
            throw error;
        }
        const chunks = baseChunks.map((item, index) => {
            const injectionGuard = String(getConfig('RAG_INJECTION_SCAN_ON_INGEST')).toLowerCase() === 'false'
                ? null : scanText(item.text, {
                    tenantId, documentId: DOCUMENT_ID, chunkId: item.chunkId
                });
            return {
                ...item,
                tenantId,
                sourceType: SOURCE_TYPE,
                logicalDocumentId: DOCUMENT_ID,
                documentVersionId: indexVersionId,
                indexVersionId,
                chunkIndex: index,
                contentHash: item.contentHash,
                documentContentHash: contentHash,
                embeddingModel,
                ingestionVersion: indexVersionId,
                createdAt: new Date().toISOString(),
                lifecycle: 'staging',
                injectionRisk: injectionGuard?.riskLevel || null,
                injectionSignals: injectionGuard?.signals || [],
                injectionScannedAt: injectionGuard?.scannedAt || null,
                injectionScannerVersion: injectionGuard?.scannerVersion || null
            };
        });
        console.log(`[RAG knowledge.txt] Chunking completed tenant=${tenantId} chunks=${chunks.length}`);

        stage = 'embeddings';
        const vectors = await embed(chunks.map(item => item.text), null, {
            concurrency: parseInt(getConfig('RAG_EMBEDDING_CONCURRENCY'), 10) || 4,
            signal, tenantId, indexVersionId
        });
        if (!Array.isArray(vectors) || vectors.length !== chunks.length) {
            throw new Error('عدد embeddings لا يطابق عدد المقاطع.');
        }
        const dimension = vectors[0]?.length || 0;
        if (!dimension || vectors.some(vector => !Array.isArray(vector) || vector.length !== dimension)) {
            throw new Error('أبعاد embeddings غير متطابقة.');
        }
        chunks.forEach(item => { item.vectorDimension = dimension; });
        console.log(`[RAG knowledge.txt] Embeddings completed tenant=${tenantId} chunks=${vectors.length}`);

        stage = 'qdrant_upload';
        await initCollection(dimension, { signal });
        temporaryUploadAttempted = true;
        await upload(chunks, vectors, { signal });
        console.log(`[RAG knowledge.txt] Temporary vectors uploaded tenant=${tenantId} versionId=${indexVersionId}`);

        stage = 'qdrant_verification';
        // Persist the authoritative expected count before asking Qdrant to verify it.
        db.prepare(`
            UPDATE rag_index_versions SET chunk_count = ?, vector_dimension = ?
            WHERE tenant_id = ? AND id = ? AND status = 'staging'
        `).run(chunks.length, dimension, tenantId, stagingId);
        const persistedExpectedChunkCount = db.prepare(`
            SELECT chunk_count FROM rag_index_versions WHERE tenant_id = ? AND id = ?
        `).get(tenantId, stagingId)?.chunk_count;
        const verifiedPointCount = await countVersionPoints({
            tenantId,
            documentId: `${DOCUMENT_ID}:${indexVersionId}`,
            documentVersionId: indexVersionId,
            indexVersionId,
            lifecycle: 'staging'
        }, { signal });
        if (verifiedPointCount !== persistedExpectedChunkCount) {
            throw new Error(
                `Uploaded point count does not match persisted expected chunk count `
                + `(${verifiedPointCount}/${persistedExpectedChunkCount}).`
            );
        }
        const points = await getPoints(tenantId, indexVersionId, { signal });
        if (points.length !== verifiedPointCount) throw new Error('Qdrant count and payload verification disagree.');
        for (const point of points) {
            if (!Array.isArray(point.vector) || point.vector.length !== dimension
                || point.payload?.tenantId !== tenantId
                || point.payload?.sourceType !== SOURCE_TYPE
                || point.payload?.indexVersionId !== indexVersionId
                || point.payload?.embeddingModel !== embeddingModel
                || point.payload?.vectorDimension !== dimension) {
                throw new Error('بيانات التحقق للمتجهات المؤقتة غير صالحة.');
            }
        }
        const queryResult = await verifyQuery(vectors[0], indexVersionId, tenantId, { signal });
        if (!queryResult.length) throw new Error('تعذر الاستعلام عن نسخة الفهرس المؤقتة.');
        db.prepare(`
            UPDATE rag_index_versions
            SET status = 'ready', chunk_count = ?, vector_dimension = ?
            WHERE tenant_id = ? AND id = ?
        `).run(chunks.length, dimension, tenantId, stagingId);
        console.log(`[RAG knowledge.txt] Verification completed tenant=${tenantId} count=${points.length}`);

        stage = 'activation';
        lease.assertOwnership();
        await setLifecycle(tenantId, indexVersionId, 'active', { signal });
        try {
            db.transaction(() => {
                lease.assertOwnership();
                if (dependencies.beforeActivation) dependencies.beforeActivation();
                if (previous) {
                    db.prepare(`
                        UPDATE rag_index_versions SET is_active = 0, status = 'archived'
                        WHERE tenant_id = ? AND id = ? AND is_active = 1
                    `).run(tenantId, previous.id);
                }
                const updated = db.prepare(`
                    UPDATE rag_index_versions
                    SET is_active = 1, status = 'active', activated_at = CURRENT_TIMESTAMP,
                        cleanup_status = 'not_started'
                    WHERE tenant_id = ? AND id = ? AND status = 'ready'
                `).run(tenantId, stagingId);
                if (updated.changes !== 1) throw new Error('فشل تحويل نسخة الفهرس إلى نشطة.');
            })();
        } catch (error) {
            await setLifecycle(tenantId, indexVersionId, 'staging');
            throw error;
        }
        activated = true;
        console.log(`[RAG knowledge.txt] New version activated tenant=${tenantId} versionId=${indexVersionId}`);

        stage = 'cache_invalidation';
        let previousVersionCleanup = 'completed';
        try {
            lease.assertOwnership();
            invalidate({ tenantId, collection, sourceType: SOURCE_TYPE, reason: 'knowledge-txt-activated' });
        } catch (error) {
            previousVersionCleanup = 'pending';
            db.prepare(`
                UPDATE rag_index_versions SET cleanup_status = 'pending', error_message = ?
                WHERE tenant_id = ? AND id = ?
            `).run(`cache:${error.message}`, tenantId, stagingId);
        }

        stage = 'old_cleanup';
        if (previous) {
            try {
                lease.assertOwnership();
                await setLifecycle(tenantId, previous.index_version_id, 'archived');
                await deleteVersion(tenantId, previous.index_version_id);
                db.prepare(`
                    UPDATE rag_index_versions SET cleanup_status = 'completed'
                    WHERE tenant_id = ? AND id = ?
                `).run(tenantId, previous.id);
            } catch (error) {
                previousVersionCleanup = 'pending';
                db.prepare(`
                    UPDATE rag_index_versions
                    SET status = 'cleanup_pending', cleanup_status = 'pending', error_message = ?
                    WHERE tenant_id = ? AND id = ?
                `).run(error.message, tenantId, previous.id);
            }
        } else {
            // Backward-compatible cleanup of pre-versioned knowledge.txt vectors.
            try {
                lease.assertOwnership();
                await (dependencies.setDocumentVectorsLifecycle || vectorStore.setDocumentVectorsLifecycle)(tenantId, DOCUMENT_ID, 'archived');
                await deleteDocument(tenantId, DOCUMENT_ID);
            } catch (_) {
                previousVersionCleanup = 'pending';
            }
        }
        if (previousVersionCleanup === 'completed') {
            console.log(`[RAG knowledge.txt] Old version cleanup completed tenant=${tenantId}`);
        }

        const durationMs = performance.now() - startedAt;
        saveIndexingState({
            tenant_id: tenantId,
            document_id: DOCUMENT_ID, document_hash: contentHash, source: DOCUMENT_ID,
            last_status: 'success', last_success_at: new Date().toISOString(),
            last_duration_ms: durationMs, total_chunks: chunks.length, last_error: null,
            collection_name: collection, embedding_model: embeddingModel,
            chunk_size: chunkSize, chunk_overlap: chunkOverlap, index_fingerprint: fingerprint
        });
        operationResult = {
            source: DOCUMENT_ID, tenantId, indexVersionId, status: 'active',
            documentId: DOCUMENT_ID, chunkCount: chunks.length,
            chunksCreated: chunks.length, chunksUpdated: 0,
            chunksDeleted: previous?.chunk_count || 0, totalVectors: chunks.length,
            previousVersionCleanup, durationMs
        };
        return operationResult;
    } catch (error) {
        operationError = error;
        if (!activated) {
            try {
                lease.assertOwnership();
                if (temporaryUploadAttempted) await deleteVersion(tenantId, indexVersionId);
                if (stagingId) {
                    db.prepare('DELETE FROM rag_index_versions WHERE tenant_id = ? AND id = ? AND is_active = 0')
                        .run(tenantId, stagingId);
                }
                console.log(`[RAG knowledge.txt] Rollback completed tenant=${tenantId} stage=${stage}`);
            } catch (rollbackError) {
                const originalError = error;
                error = new RollbackError('فشل التراجع عن نسخة فهرس knowledge.txt المؤقتة.', {
                    stage: 'rollback',
                    code: 'RAG_ROLLBACK_FAILED',
                    retryable: true,
                    cause: rollbackError,
                    previousVersionPreserved: true
                });
                error.originalError = originalError.message;
                error.rollbackError = rollbackError.message;
                if (stagingId) {
                    db.prepare(`
                        UPDATE rag_index_versions
                        SET status = 'rollback_pending', cleanup_status = 'pending',
                            error_message = ?
                        WHERE tenant_id = ? AND id = ? AND is_active = 0
                    `).run(
                        `qdrant_delete tenantId=${tenantId} indexVersionId=${indexVersionId}: ${rollbackError.message}`,
                        tenantId, stagingId
                    );
                }
            }
        }
        throw stageError(error, stage);
    } finally {
        activeOperations--;
        await lease.release({ error: operationError, result: operationResult });
        operation.done();
    }
}

module.exports = {
    isIndexingRunning,
    reindexKnowledgeBase,
    getIndexingState,
    getActiveIndexVersion,
    computeIndexFingerprint
};
