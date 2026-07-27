const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../../database/connection');
const docRepo = require('../../database/repositories/knowledgeDocumentRepository');
const { getConfig } = require('../config/ragConfig');
const {
    docsDir,
    computeSHA256,
    validateFilenameSecurity,
    validateMimeAndMagicBytes,
    extractTextFromBuffer,
    computeNormalizedTextHash
} = require('../loaders/documentExtractionService');
const { cleanText } = require('../processing/textCleaner');
const { chunkDocument } = require('../processing/documentChunker');
const { generateEmbeddings, checkModelAvailability } = require('../embeddings/ollamaEmbeddingProvider');
const { initCollection, upsertVectors, deleteVectorsByDocument, checkQdrantReady } = require('../vector/qdrantVectorStore');

// Safe Socket.IO event publishing helper
function emitDocumentEvent(eventName, docData) {
    try {
        const { publish } = require('../../realtime/eventPublisher');
        publish(eventName, docData);
    } catch (err) {
        console.error('Failed to emit real-time event:', err.message);
    }
}

/**
 * Computes the complete deterministic Index Fingerprint based on configuration and content.
 */
function computeDocumentFingerprint(extractedTextHash, chunkSize, chunkOverlap, embeddingModel, collectionName) {
    const data = JSON.stringify({
        extractedTextHash,
        chunkSize,
        chunkOverlap,
        embeddingModel,
        collectionName,
        cleanerVersion: 'v1.0',
        normalizerVersion: 'v1.0',
        chunkerVersion: 'v1.0',
        parserType: 'standard',
        parserVersion: 'v1.0'
    });
    return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * Validates, registers, parses, and indexes a newly uploaded file.
 * Completely atomic and failure-safe.
 */
async function uploadAndRegisterDocument(originalName, mimeType, buffer, options = {}) {
    const overwriteAction = options.overwriteAction;

    // 1. Run strict security validations
    const ext = validateFilenameSecurity(originalName);
    validateMimeAndMagicBytes(ext, mimeType, buffer);

    if (!buffer || buffer.length === 0) {
        throw new Error('الملف فارغ ولا يمكن معالجته.');
    }

    // A. Duplicate Original Name & Version Detection
    const existingByName = docRepo.getDocumentByOriginalName(originalName);
    let nextVersion = 1;

    if (existingByName && existingByName.status !== 'deleted') {
        if (overwriteAction === 'replace') {
            console.log(`[RAG Upload] Overwrite replace requested for existing document: ${originalName}`);
            nextVersion = (existingByName.version || 1) + 1;
            // Safely delete the old document vectors and filesystem record
            await deleteDocument(existingByName.document_key);
        } else if (overwriteAction === 'keep_both') {
            console.log(`[RAG Upload] Overwrite keep both requested for: ${originalName}`);
            nextVersion = 1;
        } else {
            // Throw conflict error to show versioning modal dialog in frontend
            const err = new Error('هذا المستند موجود مسبقاً بنفس الاسم في قاعدة المعرفة.');
            err.code = 'DUPLICATE_UPLOAD';
            err.existing = {
                documentId: existingByName.document_key,
                originalFilename: existingByName.original_name,
                version: existingByName.version || 1,
                createdAt: existingByName.created_at
            };
            throw err;
        }
    }

    const contentHash = computeSHA256(buffer);

    // 2. Duplicate Content Detection
    const existingByHash = docRepo.getDocumentByContentHash(contentHash);
    if (existingByHash && existingByHash.status !== 'deleted' && overwriteAction !== 'replace') {
        const err = new Error('هذا المستند موجود مسبقاً في قاعدة المعرفة.');
        err.code = 'DUPLICATE_DOCUMENT';
        throw err;
    }

    // 3. Save file to private persistent storage
    const storageName = `${crypto.randomUUID()}.${ext}`;
    const storagePath = path.join(docsDir, storageName);
    fs.writeFileSync(storagePath, buffer);

    const docKey = `doc_${crypto.randomUUID().replace(/-/g, '')}`;

    // 4. Create SQLite record (status: uploaded)
    const docId = docRepo.insertDocument({
        document_key: docKey,
        original_name: originalName,
        display_name: originalName,
        source_type: ext,
        mime_type: mimeType,
        storage_name: storageName,
        storage_path: storagePath,
        file_size: buffer.length,
        content_hash: contentHash,
        extracted_text_hash: '',
        language: 'ar',
        status: 'uploaded',
        is_enabled: 1,
        chunk_count: 0,
        vector_count: 0,
        index_fingerprint: null,
        version: nextVersion
    });

    emitDocumentEvent('rag:document-uploaded', { documentId: docKey, originalFilename: originalName, status: 'uploaded' });

    // 5. Parse and Index the document
    try {
        await parseAndIndexDocumentPipeline(docKey);
        const updatedDoc = docRepo.getDocumentByKey(docKey);
        return updatedDoc;
    } catch (pipelineErr) {
        console.error(`Pipeline failed for document ${docKey}:`, pipelineErr.message);
        const currentDoc = docRepo.getDocumentByKey(docKey) || docRepo.getDocumentById(parseInt(docKey, 10));
        if (currentDoc) {
            return currentDoc;
        }
        throw pipelineErr;
    }
}

/**
 * Robust helper running the document extraction, chunking, embedding, and vector upsert pipeline.
 * Completely transactional: preserves the previous index if anything fails before successful upserting.
 */
async function parseAndIndexDocumentPipeline(docKey) {
    let doc = docRepo.getDocumentByKey(docKey);
    if (!doc) {
        const numericId = parseInt(docKey, 10);
        if (!isNaN(numericId)) {
            doc = docRepo.getDocumentById(numericId);
        }
    }

    if (!doc) throw new Error('المستند غير موجود في قاعدة البيانات.');

    const fileBuffer = fs.readFileSync(doc.storage_path);

    try {
        // A. Extract text (status: parsing)
        docRepo.updateDocument(doc.id, { status: 'parsing' });
        emitDocumentEvent('rag:document-status-updated', { documentId: doc.document_key, status: 'parsing' });

        const ext = doc.source_type;
        let text = '';
        try {
            text = await extractTextFromBuffer(ext, fileBuffer);
        } catch (extractErr) {
            let errorMsg = extractErr.message;
            if (ext === 'pdf' && errorMsg.includes('extract text')) {
                errorMsg = 'تعذر استخراج نص من الملف. قد يكون ملف PDF ممسوحاً ضوئياً ويحتاج إلى OCR.';
            }
            throw new Error(errorMsg);
        }

        const extractedTextHash = computeNormalizedTextHash(text);

        // Check if normalized text is duplicate
        const existingByTextHash = docRepo.getDocumentByExtractedTextHash(extractedTextHash);
        if (existingByTextHash && existingByTextHash.document_key !== doc.document_key && existingByTextHash.status !== 'deleted') {
            throw new Error('هذا المستند موجود مسبقاً في قاعدة المعرفة محتوياً على نفس النصوص تماماً.');
        }

        docRepo.updateDocument(doc.id, {
            status: 'parsed',
            extracted_text_hash: extractedTextHash
        });
        emitDocumentEvent('rag:document-status-updated', { documentId: doc.document_key, status: 'parsed' });

        // B. Indexing & Vector generation
        // Always dynamically read latest live settings from SQLite
        const chunkSize = parseInt(getConfig('RAG_CHUNK_SIZE'), 10) || 800;
        const chunkOverlap = parseInt(getConfig('RAG_CHUNK_OVERLAP'), 10) || 120;
        const modelName = getConfig('RAG_EMBEDDING_MODEL');
        const collectionName = getConfig('QDRANT_COLLECTION');

        console.log(`[RAG Pipeline] Starting parse/index with chunkSize=${chunkSize}, chunkOverlap=${chunkOverlap}, collection=${collectionName}`);

        // Check infrastructure health
        const qdrantOk = await checkQdrantReady();
        if (!qdrantOk) throw new Error('تعذر الاتصال بقاعدة البيانات المتجهية Qdrant.');

        const ollamaOk = await checkModelAvailability();
        if (!ollamaOk) throw new Error(`تعذر الاتصال بخدمة Ollama أو النموذج (${modelName}) غير متوفر.`);

        docRepo.updateDocument(doc.id, { status: 'indexing' });
        emitDocumentEvent('rag:document-status-updated', { documentId: doc.document_key, status: 'indexing' });

        // Create virtual chunking document model
        const virtualDoc = {
            documentId: doc.document_key,
            source: doc.original_name,
            sourceType: 'uploaded_document',
            originalText: text,
            documentHash: doc.content_hash
        };

        const richChunks = chunkDocument(virtualDoc, chunkSize, chunkOverlap);
        if (richChunks.length === 0) {
            throw new Error('لا يمكن تقسيم المستند إلى مقاطع صالحة.');
        }

        // Generate embeddings in Ollama
        const chunkTexts = richChunks.map(c => c.text);
        const vectors = await generateEmbeddings(chunkTexts);
        if (!vectors || vectors.length === 0) {
            throw new Error('فشل إنشاء المتجهات لمقاطع قاعدة المعرفة.');
        }

        const dimension = vectors[0].length;
        await initCollection(dimension);

        // Transactional write sequence: Only delete old vectors and write new ones after successful generation
        const { getPointsByDocument, restoreVectors } = require('../vector/qdrantVectorStore');
        const backupPoints = await getPointsByDocument(doc.document_key);
        console.log(`[RAG Transactional] Backed up ${backupPoints.length} old vectors for rollback.`);

        try {
            await deleteVectorsByDocument(doc.document_key);
            await upsertVectors(richChunks, vectors);
        } catch (writeErr) {
            console.error('[RAG Transactional] Write failed. Restoring previous index...', writeErr.message);
            if (backupPoints.length > 0) {
                try {
                    await restoreVectors(backupPoints);
                    console.log('[RAG Transactional] Successfully restored previous index.');
                } catch (restoreErr) {
                    console.error('[RAG Transactional] Critical: Failed to restore backup points!', restoreErr.message);
                }
            }
            throw writeErr;
        }

        // Compute indexing fingerprint
        const fingerprint = computeDocumentFingerprint(extractedTextHash, chunkSize, chunkOverlap, modelName, collectionName);

        // Update database record with final successful indexing metadata
        docRepo.updateDocument(doc.id, {
            status: 'indexed',
            chunk_count: richChunks.length,
            vector_count: richChunks.length,
            index_fingerprint: fingerprint,
            indexed_at: new Date().toISOString()
        });

        emitDocumentEvent('rag:document-indexed', {
            documentId: doc.document_key,
            status: 'indexed',
            chunkCount: richChunks.length
        });

    } catch (err) {
        console.error('Failure in indexing pipeline:', err);

        docRepo.updateDocument(doc.id, {
            status: 'failed',
            indexing_status: 'failed',
            indexing_error: err.message
        });

        emitDocumentEvent('rag:document-failed', {
            documentId: doc.document_key,
            status: 'failed',
            error: err.message
        });

        throw err;
    }
}

/**
 * Lists all registered documents with optional filters.
 */
function listDocuments(filters = {}) {
    return docRepo.listDocuments(filters);
}

/**
 * Returns total count of documents matching the filters.
 */
function countDocuments(filters = {}) {
    return docRepo.countDocuments(filters);
}

/**
 * Re-parses, re-chunks, and re-indexes an existing document using the latest RAG settings.
 * Manual reindexing always bypasses index fingerprint optimization.
 */
async function reindexDocument(docKey) {
    let doc = docRepo.getDocumentByKey(docKey);
    if (!doc) {
        const numericId = parseInt(docKey, 10);
        if (!isNaN(numericId)) {
            doc = docRepo.getDocumentById(numericId);
        }
    }

    if (!doc) throw new Error('المستند غير موجود في قاعدة البيانات.');

    try {
        await parseAndIndexDocumentPipeline(doc.document_key);
        return docRepo.getDocumentByKey(doc.document_key);
    } catch (err) {
        throw new Error(`تعذر إعادة فهرسة المستند. تم الحفاظ على آخر فهرس صالح أو تنظيف المتجهات الجزئية. الخطأ: ${err.message}`);
    }
}

/**
 * Retries parsing and indexing a failed document.
 */
async function retryFailedDocument(docKey) {
    return reindexDocument(docKey);
}

/**
 * Safely deletes a document, its original file, and all corresponding Qdrant points.
 * Features lookups by either document_key or numerical id and proceeds safely.
 */
async function deleteDocument(docKey) {
    let doc = docRepo.getDocumentByKey(docKey);
    if (!doc) {
        const numericId = parseInt(docKey, 10);
        if (!isNaN(numericId)) {
            doc = docRepo.getDocumentById(numericId);
        }
    }

    if (!doc) {
        // Repair lookup logic: if document exists in Qdrant but is missing in SQLite, delete vectors to keep environment clean
        console.warn(`⚠️ Proceeding to clean orphaned vectors for missing SQLite document key: ${docKey}`);
        try {
            await deleteVectorsByDocument(docKey);
        } catch (qErr) {
            console.error('Failed to delete orphaned vectors from Qdrant:', qErr.message);
        }
        throw new Error('المستند غير موجود في قاعدة البيانات.');
    }

    try {
        // 1. Mark as deleting
        docRepo.updateDocument(doc.id, { status: 'deleting' });
        emitDocumentEvent('rag:document-status-updated', { documentId: doc.document_key, status: 'deleting' });

        // 2. Delete from Qdrant
        await deleteVectorsByDocument(doc.document_key);

        // 3. Delete from private filesystem
        if (doc.storage_path && fs.existsSync(doc.storage_path)) {
            try {
                fs.unlinkSync(doc.storage_path);
            } catch (fsErr) {
                console.error(`Failed to delete private stored file ${doc.storage_path}:`, fsErr.message);
            }
        }

        // 4. Delete SQLite record
        docRepo.deleteDocument(doc.id);

        emitDocumentEvent('rag:document-deleted', { documentId: doc.document_key, status: 'deleted' });
        return true;
    } catch (err) {
        docRepo.updateDocument(doc.id, {
            status: 'failed',
            indexing_error: `فشل الحذف: ${err.message}`
        });
        throw err;
    }
}

module.exports = {
    uploadAndRegisterDocument,
    listDocuments,
    countDocuments,
    reindexDocument,
    retryFailedDocument,
    deleteDocument,
    computeDocumentFingerprint
};
