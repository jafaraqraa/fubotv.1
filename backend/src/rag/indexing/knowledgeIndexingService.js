const db = require('../../database/connection');
const { loadTextDocument } = require('../loaders/textDocumentLoader');
const { cleanText } = require('../processing/textCleaner');
const { chunkDocument } = require('../processing/documentChunker');
const { generateEmbeddings, checkModelAvailability } = require('../embeddings/ollamaEmbeddingProvider');
const { initCollection, upsertVectors, deleteVectorsByDocument, checkQdrantReady, getCollectionVectorCount } = require('../vector/qdrantVectorStore');
const { getConfig } = require('../config/ragConfig');
const crypto = require('crypto');
const path = require('path');

let isIndexingInProgress = false;

/**
 * Gets the current lock status.
 */
function isIndexingRunning() {
    return isIndexingInProgress;
}

/**
 * Computes a deterministic Index Fingerprint based on text content and all indexing settings.
 */
function computeIndexFingerprint(documentHash, chunkSize, chunkOverlap, embeddingModel, collectionName) {
    const data = JSON.stringify({
        documentHash,
        chunkSize,
        chunkOverlap,
        embeddingModel,
        collectionName,
        cleanerVersion: 'v1.0',
        normalizerVersion: 'v1.0',
        chunkerVersion: 'v1.0'
    });
    return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * Persists indexing state metadata into SQLite.
 */
function saveIndexingState(state) {
    db.prepare(`
        INSERT INTO rag_indexing_state (
            document_id, document_hash, source, last_status,
            last_success_at, last_duration_ms, total_chunks,
            last_error, collection_name, embedding_model,
            chunk_size, chunk_overlap, index_fingerprint, updated_at
        ) VALUES (
            @document_id, @document_hash, @source, @last_status,
            @last_success_at, @last_duration_ms, @total_chunks,
            @last_error, @collection_name, @embedding_model,
            @chunk_size, @chunk_overlap, @index_fingerprint, CURRENT_TIMESTAMP
        )
        ON CONFLICT(document_id) DO UPDATE SET
            document_hash = excluded.document_hash,
            last_status = excluded.last_status,
            last_success_at = excluded.last_success_at,
            last_duration_ms = excluded.last_duration_ms,
            total_chunks = excluded.total_chunks,
            last_error = excluded.last_error,
            collection_name = excluded.collection_name,
            embedding_model = excluded.embedding_model,
            chunk_size = excluded.chunk_size,
            chunk_overlap = excluded.chunk_overlap,
            index_fingerprint = excluded.index_fingerprint,
            updated_at = CURRENT_TIMESTAMP
    `).run(state);
}

/**
 * Retrieves the persisted indexing state from SQLite.
 */
function getIndexingState(documentId) {
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='rag_indexing_state'").get();
    if (!tableExists) return null;
    return db.prepare('SELECT * FROM rag_indexing_state WHERE document_id = ?').get(documentId);
}

/**
 * Core RAG reindexing logic. Idempotent and incremental.
 * Atomic and failure-safe: generates and validates new embeddings before deleting any active Qdrant points.
 */
async function reindexKnowledgeBase(force = false) {
    if (isIndexingInProgress) {
        const err = new Error('عملية الفهرسة جارية بالفعل في الخلفية.');
        err.code = 'RAG_INDEX_ALREADY_RUNNING';
        throw err;
    }

    isIndexingInProgress = true;
    const startTime = Date.now();

    // 1. ALWAYS read latest live settings from SQLite source of truth
    const chunkSize = parseInt(getConfig('RAG_CHUNK_SIZE'), 10) || 800;
    const chunkOverlap = parseInt(getConfig('RAG_CHUNK_OVERLAP'), 10) || 120;
    const modelName = getConfig('RAG_EMBEDDING_MODEL');
    const collectionName = getConfig('QDRANT_COLLECTION');

    const kbPath = process.env.RAG_TEST_KB_PATH || path.join(__dirname, '..', '..', '..', 'knowledge.txt');

    try {
        // 2. Check Infrastructure Health
        const qdrantOk = await checkQdrantReady();
        if (!qdrantOk) {
            throw new Error('تعذر الاتصال بقاعدة البيانات المتجهية Qdrant.');
        }

        const ollamaOk = await checkModelAvailability();
        if (!ollamaOk) {
            throw new Error(`تعذر الاتصال بخدمة Ollama أو أن النموذج المختار (${modelName}) غير متوفر.`);
        }

        // 3. Load document
        const document = loadTextDocument(kbPath);
        const { documentId, documentHash, source } = document;

        // 4. Compute index fingerprint
        const currentFingerprint = computeIndexFingerprint(documentHash, chunkSize, chunkOverlap, modelName, collectionName);

        // 5. Clean, normalize, and chunk
        const cleanedText = cleanText(document.originalText);
        document.originalText = cleanedText;

        const richChunks = chunkDocument(document, chunkSize, chunkOverlap);

        // 6. Incremental update check
        const prevState = getIndexingState(documentId);
        const isCompatible = prevState &&
            prevState.index_fingerprint === currentFingerprint &&
            prevState.last_status === 'success';

        // Skip reindexing ONLY if fingerprint matches and not forced (Bypassed if Full Reindex is clicked)
        if (isCompatible && !force) {
            const vectorCount = await getCollectionVectorCount();
            if (vectorCount > 0) {
                isIndexingInProgress = false;
                return {
                    status: 'unchanged',
                    documentId,
                    chunksCreated: 0,
                    chunksUpdated: 0,
                    chunksDeleted: 0,
                    totalVectors: vectorCount,
                    durationMs: Date.now() - startTime
                };
            }
        }

        // 7. Atomic validation: Generate embeddings FIRST.
        // If this step fails, previous points are safely left intact in Qdrant!
        const chunkTexts = richChunks.map(c => c.text);
        const vectors = await generateEmbeddings(chunkTexts);

        if (richChunks.length > 0 && (!vectors || vectors.length === 0)) {
            throw new Error('فشل إنشاء المتجهات لمقاطع قاعدة المعرفة.');
        }

        const dimension = vectors[0].length;

        // 8. Init collection
        await initCollection(dimension);

        // 9. Qdrant transaction-like sequence (delete existing document points, then write new)
        await deleteVectorsByDocument(documentId);
        await upsertVectors(richChunks, vectors);

        const durationMs = Date.now() - startTime;

        // 10. Persist metadata with success state and fingerprint
        const successState = {
            document_id: documentId,
            document_hash: documentHash,
            source,
            last_status: 'success',
            last_success_at: new Date().toISOString(),
            last_duration_ms: durationMs,
            total_chunks: richChunks.length,
            last_error: null,
            collection_name: collectionName,
            embedding_model: modelName,
            chunk_size: chunkSize,
            chunk_overlap: chunkOverlap,
            index_fingerprint: currentFingerprint
        };

        saveIndexingState(successState);
        isIndexingInProgress = false;

        return {
            status: prevState ? 'updated' : 'indexed',
            documentId,
            chunksCreated: richChunks.length,
            chunksUpdated: 0,
            chunksDeleted: prevState ? prevState.total_chunks : 0,
            totalVectors: richChunks.length,
            durationMs
        };

    } catch (e) {
        const durationMs = Date.now() - startTime;
        const failedState = {
            document_id: 'knowledge.txt',
            document_hash: '',
            source: 'knowledge.txt',
            last_status: 'failed',
            last_success_at: null,
            last_duration_ms: durationMs,
            total_chunks: 0,
            last_error: e.message,
            collection_name: collectionName,
            embedding_model: modelName,
            chunk_size: chunkSize,
            chunk_overlap: chunkOverlap,
            index_fingerprint: ''
        };
        try {
            saveIndexingState(failedState);
        } catch (dbErr) {
            console.error('Failed to save failed indexing state:', dbErr);
        }

        isIndexingInProgress = false;
        throw e;
    }
}

module.exports = {
    isIndexingRunning,
    reindexKnowledgeBase,
    getIndexingState,
    computeIndexFingerprint
};
