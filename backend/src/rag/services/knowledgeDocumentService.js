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
const retrievalCache = require('../cache/retrievalCache');
const {
    getPointsByDocument,
    setDocumentVectorsLifecycle
} = require('../vector/qdrantVectorStore');
const { registerOperation } = require('../runtime/operationRegistry');
const { asStageError, RollbackError } = require('../indexing/indexingErrors');
const { createLifecycle, assertActiveDocument } = require('../indexing/indexingLifecycle');
const { scanText } = require('../security/promptInjectionGuard');
const { acquireLease } = require('../runtime/distributedLockService');

const RAG_MEDIA_TYPES = new Map([
    ['jpg', 'image'], ['jpeg', 'image'], ['png', 'image'], ['webp', 'image'],
    ['mp3', 'audio'], ['ogg', 'audio'], ['wav', 'audio'], ['m4a', 'audio']
]);

function buildMediaIndexText(originalName, description, mediaType) {
    const value = String(description || '').normalize('NFKC').replace(/[\u0000-\u001f]/g, ' ').trim();
    if (value.length < 3 || value.length > 2000) {
        const error = new Error('وصف وسائط RAG مطلوب ويجب أن يكون بين 3 و2000 حرف.');
        error.code = 'RAG_MEDIA_DESCRIPTION_REQUIRED';
        throw error;
    }
    const label = mediaType === 'audio' ? 'ملف صوتي' : 'صورة';
    return `${label} معتمد قابل للإرسال: ${originalName}\nوصف ${label}: ${value}\nنوع المصدر: ${label} من مكتبة معرفة الشركة.`;
}

async function transcribeRagAudio({ storagePath, originalName, mimeType }) {
    const { getAIProviderForTask } = require('../../services/aiProviders');
    const provider = getAIProviderForTask('speech_to_text');
    if (!provider || typeof provider.transcribe !== 'function') {
        const error = new Error('مهمة تحويل الصوت إلى نص غير مفعلة أو لا يدعمها المزوّد المحدد.');
        error.code = 'RAG_AUDIO_MODEL_UNAVAILABLE';
        throw error;
    }
    const model = provider.model || 'unknown';
    console.log(`[RAG Audio] Analysis started task=speech_to_text provider=${provider.constructor.name} model=${model}`);
    const transcript = await provider.transcribe({
        localPath: storagePath,
        fileName: originalName,
        mimeType
    });
    const normalized = String(transcript || '').normalize('NFKC').trim();
    if (!normalized) {
        const error = new Error(`فشل موديل الصوت (${model}) في استخراج نص من الملف.`);
        error.code = 'RAG_AUDIO_TRANSCRIPTION_FAILED';
        throw error;
    }
    console.log(`[RAG Audio] Analysis completed task=speech_to_text model=${model} characters=${normalized.length}`);
    return { transcript: normalized, model };
}

function buildIndexedMediaText(originalName, description, mediaType, transcript = null) {
    const base = buildMediaIndexText(originalName, description, mediaType);
    return mediaType === 'audio'
        ? `${base}\nالتفريغ النصي المعتمد للتسجيل: ${transcript}`
        : base;
}

function annotateInjectionRisk(chunks, tenantId, documentId) {
    if (String(getConfig('RAG_INJECTION_SCAN_ON_INGEST')).toLowerCase() === 'false') return chunks;
    return chunks.map(item => {
        const guard = scanText(item.text, { tenantId, documentId, chunkId: item.chunkId });
        return {
            ...item,
            injectionRisk: guard.riskLevel,
            injectionSignals: guard.signals,
            injectionScannedAt: guard.scannedAt,
            injectionScannerVersion: guard.scannerVersion
        };
    });
}

function replacementError(error, stage) {
    error.stage = error.stage || stage;
    error.previousVersionPreserved = true;
    return error;
}

async function replaceDocumentAtomically(existing, originalName, mimeType, buffer, ext, options) {
    const { requireTenantId } = require('../security/tenantContext');
    const tenantId = requireTenantId(options.tenantId, 'document-replace');
    const logicalDocumentId = existing.logical_document_id || existing.document_key;
    let lease;
    try {
        lease = await acquireLease({
            tenantId, resourceType: 'document', resourceId: logicalDocumentId,
            operation: 'document_replace', signal: options.signal,
            failFast: options.failFast !== false, idempotencyKey: options.idempotencyKey
        });
    } catch (error) {
        if (error.code === 'RAG_OPERATION_IN_PROGRESS') {
            error.canonicalCode = error.code;
            error.code = 'RAG_REPLACE_LOCKED';
        }
        throw error;
    }
    if (lease.duplicate) {
        if (lease.operation.status === 'completed' && lease.operation.result_json) {
            return JSON.parse(lease.operation.result_json);
        }
        throw Object.assign(new Error('A matching document replacement is already in progress.'), {
            code: 'RAG_OPERATION_IN_PROGRESS', retryable: true, stage: 'lock'
        });
    }
    const operation = registerOperation('document_replace', lease.signal);
    const signal = operation.signal;
    const versionNumber = (existing.version || 1) + 1;
    const versionId = `ver_${crypto.randomUUID().replace(/-/g, '')}`;
    const temporaryDocumentId = `staging_${versionId}`;
    const stagingName = `${versionId}.staging.${ext}`;
    const stagingPath = path.join(docsDir, stagingName);
    const finalName = `${versionId}.${ext}`;
    const finalPath = path.join(docsDir, finalName);
    const contentHash = computeSHA256(buffer);
    const dependencies = options._testDependencies || {};
    const extract = dependencies.extractTextFromBuffer || extractTextFromBuffer;
    const transcribeAudio = dependencies.transcribeRagAudio || transcribeRagAudio;
    const chunk = dependencies.chunkDocument || chunkDocument;
    const embed = dependencies.generateEmbeddings || generateEmbeddings;
    const qdrantReady = dependencies.checkQdrantReady || checkQdrantReady;
    const modelAvailable = dependencies.checkModelAvailability || checkModelAvailability;
    const initializeCollection = dependencies.initCollection || initCollection;
    const uploadVectors = dependencies.upsertVectors || upsertVectors;
    const readPoints = dependencies.getPointsByDocument || getPointsByDocument;
    const countVersionPoints = dependencies.countDocumentVersionPoints
        || (dependencies.getPointsByDocument
            ? async () => (await readPoints(tenantId, temporaryDocumentId, { signal })).length
            : require('../vector/qdrantVectorStore').countDocumentVersionPoints);
    const removeVectors = dependencies.deleteVectorsByDocument || deleteVectorsByDocument;
    const activateVectors = dependencies.setDocumentVectorsLifecycle || setDocumentVectorsLifecycle;
    const invalidateCache = dependencies.invalidateCache || retrievalCache.invalidate;
    const renameFile = dependencies.renameFile || fs.renameSync;
    let stagingRowId = null;
    let temporaryVectorsUploaded = false;
    let committed = false;
    let currentStage = 'staging';
    let operationError = null;
    let operationResult = null;

    try {
        console.log(`[RAG Replace] Staging new version tenant=${tenantId} document=${logicalDocumentId} version=${versionNumber}`);
        fs.writeFileSync(stagingPath, buffer);
        const ragMediaType = RAG_MEDIA_TYPES.get(ext) || null;
        const mediaDescription = ragMediaType
            ? String(options.mediaDescription || existing.media_description || '').trim()
            : null;
        stagingRowId = docRepo.insertDocument({
            document_key: temporaryDocumentId,
            original_name: originalName,
            display_name: originalName,
            source_type: ext,
            mime_type: mimeType,
            storage_name: stagingName,
            storage_path: stagingPath,
            file_size: buffer.length,
            content_hash: contentHash,
            extracted_text_hash: '',
            status: 'staging',
            is_enabled: 0,
            is_active: 0,
            version: versionNumber,
            tenant_id: tenantId,
            logical_document_id: logicalDocumentId,
            version_id: versionId,
            media_description: mediaDescription,
            ai_send_enabled: ragMediaType ? 1 : 0
        });

        currentStage = 'extraction';
        let audioAnalysis = null;
        if (ragMediaType === 'audio') {
            audioAnalysis = await transcribeAudio({
                storagePath: stagingPath, originalName, mimeType
            });
            docRepo.updateDocument(tenantId, stagingRowId, {
                media_transcript: audioAnalysis.transcript,
                media_analysis_model: audioAnalysis.model
            });
        }
        const text = ragMediaType
            ? buildIndexedMediaText(
                originalName, mediaDescription, ragMediaType, audioAnalysis?.transcript
            )
            : await extract(ext, buffer);
        if (!text || !text.trim()) throw new Error('المحتوى المستخرج فارغ.');
        const maxTextLength = Number(getConfig('RAG_MAX_EXTRACTED_TEXT_LENGTH')) || 10000000;
        if (text.length > maxTextLength) {
            const error = new Error(`النص المستخرج يتجاوز الحد المسموح ${maxTextLength}.`);
            error.code = 'RAG_MAX_TEXT_LENGTH_EXCEEDED';
            throw error;
        }
        const extractedTextHash = computeNormalizedTextHash(text);
        console.log(`[RAG Replace] Extraction completed tenant=${tenantId} document=${logicalDocumentId} version=${versionNumber}`);

        const chunkSize = parseInt(getConfig('RAG_CHUNK_SIZE'), 10) || 800;
        const chunkOverlap = parseInt(getConfig('RAG_CHUNK_OVERLAP'), 10) || 120;
        const embeddingModel = getConfig('RAG_EMBEDDING_MODEL');
        const collectionName = getConfig('QDRANT_COLLECTION');

        currentStage = 'infrastructure';
        if (!await qdrantReady({ signal })) throw new Error('تعذر الاتصال بقاعدة البيانات المتجهية Qdrant.');
        if (!await modelAvailable({ signal })) throw new Error(`نموذج التضمين (${embeddingModel}) غير متوفر.`);

        currentStage = 'chunking';
        const chunks = annotateInjectionRisk(chunk({
            documentId: temporaryDocumentId,
            source: originalName,
            sourceType: 'uploaded_document',
            originalText: cleanText(text),
            documentHash: contentHash,
            ingestionVersion: versionId
        }, chunkSize, chunkOverlap).map(item => ({
            ...item,
            tenantId,
            logicalDocumentId,
            documentVersionId: versionId,
            indexVersionId: versionId,
            versionNumber,
            lifecycle: 'staging',
            ragMediaType,
            ragMediaDocumentId: ragMediaType ? temporaryDocumentId : null
        })), tenantId, logicalDocumentId);
        if (!chunks.length) throw new Error('لا يمكن تقسيم المستند إلى مقاطع صالحة.');
        const maxChunks = Number(getConfig('RAG_MAX_CHUNKS_PER_DOCUMENT')) || 5000;
        if (chunks.length > maxChunks) {
            const error = new Error(`عدد المقاطع ${chunks.length} يتجاوز الحد المسموح ${maxChunks}.`);
            error.code = 'RAG_MAX_CHUNKS_EXCEEDED';
            throw error;
        }

        currentStage = 'embeddings';
        const vectors = await embed(chunks.map(item => item.text), null, {
            concurrency: parseInt(getConfig('RAG_EMBEDDING_CONCURRENCY'), 10) || 4,
            signal, tenantId, documentId: logicalDocumentId, indexVersionId: versionId
        });
        if (!Array.isArray(vectors) || vectors.length !== chunks.length) {
            throw new Error('عدد متجهات التضمين لا يطابق عدد المقاطع.');
        }
        const vectorDimension = vectors[0]?.length || 0;
        if (!vectorDimension || vectors.some(vector => !Array.isArray(vector) || vector.length !== vectorDimension)) {
            throw new Error('أبعاد متجهات التضمين غير متطابقة.');
        }
        console.log(`[RAG Replace] Embeddings completed tenant=${tenantId} document=${logicalDocumentId} chunks=${chunks.length}`);

        currentStage = 'qdrant_upload';
        await initializeCollection(vectorDimension, { signal });
        // Mark before the request: Qdrant may have accepted only part of a timed-out batch.
        temporaryVectorsUploaded = true;
        await uploadVectors(chunks, vectors, { signal });

        currentStage = 'qdrant_verify';
        db.prepare(`
            UPDATE knowledge_documents SET chunk_count = ?, vector_count = ?,
                embedding_model = ?, vector_dimension = ?, updated_at = CURRENT_TIMESTAMP
            WHERE tenant_id = ? AND id = ? AND status = 'staging'
        `).run(chunks.length, chunks.length, embeddingModel, vectorDimension, tenantId, stagingRowId);
        const expectedChunkCount = db.prepare(`
            SELECT chunk_count FROM knowledge_documents WHERE tenant_id = ? AND id = ?
        `).get(tenantId, stagingRowId)?.chunk_count;
        const verifiedPointCount = await countVersionPoints({
            tenantId,
            documentId: temporaryDocumentId,
            documentVersionId: versionId,
            indexVersionId: versionId,
            lifecycle: 'staging'
        }, { signal });
        if (verifiedPointCount !== expectedChunkCount) {
            throw new Error(
                `فشل التحقق من العدد الدقيق: المتوقع ${expectedChunkCount} والموجود ${verifiedPointCount}.`
            );
        }
        const uploadedPoints = await readPoints(tenantId, temporaryDocumentId, { signal });
        if (uploadedPoints.length !== verifiedPointCount) {
            throw new Error(`فشل التحقق من المتجهات المؤقتة: المتوقع ${chunks.length} والموجود ${uploadedPoints.length}.`);
        }
        for (const point of uploadedPoints) {
            if (!Array.isArray(point.vector) || point.vector.length !== vectorDimension
                || point.payload?.tenantId !== tenantId
                || point.payload?.documentVersionId !== versionId
                || point.payload?.indexVersionId !== versionId
                || point.payload?.documentId !== temporaryDocumentId
                || point.payload?.lifecycle !== 'staging') {
                throw new Error('بيانات أو أبعاد أحد المتجهات المؤقتة غير صالحة.');
            }
        }
        console.log(`[RAG Replace] Temporary vectors verified tenant=${tenantId} document=${logicalDocumentId} count=${uploadedPoints.length}`);

        currentStage = 'filesystem_commit';
        lease.assertOwnership();
        renameFile(stagingPath, finalPath);

        currentStage = 'database_commit';
        const fingerprint = computeDocumentFingerprint(
            extractedTextHash, chunkSize, chunkOverlap, embeddingModel, collectionName
        );
        db.transaction(() => {
            lease.assertOwnership();
            if (dependencies.beforeDatabaseCommit) dependencies.beforeDatabaseCommit();
            const archived = db.prepare(`
                UPDATE knowledge_documents
                SET is_active = 0, status = 'archived', updated_at = CURRENT_TIMESTAMP
                WHERE tenant_id = ? AND id = ? AND is_active = 1
            `).run(tenantId, existing.id);
            if (archived.changes !== 1) throw new Error('تغيرت النسخة النشطة أثناء الاستبدال.');
            const activatedRow = db.prepare(`
                UPDATE knowledge_documents SET
                    document_key = ?, storage_name = ?, storage_path = ?,
                    extracted_text_hash = ?, status = 'active',
                    is_enabled = 1, is_active = 1, chunk_count = ?, vector_count = ?,
                    index_fingerprint = ?, embedding_model = ?, vector_dimension = ?,
                    fencing_token = ?, operation_id = ?,
                    indexed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE tenant_id = ? AND id = ? AND status = 'staging' AND is_active = 0
            `).run(
                temporaryDocumentId, finalName, finalPath, extractedTextHash,
                chunks.length, chunks.length, fingerprint, embeddingModel,
                vectorDimension, lease.fencingToken, lease.operationId, tenantId, stagingRowId
            );
            if (activatedRow.changes !== 1) throw new Error('فشل تفعيل نسخة المستند الجديدة في SQLite.');
        })();
        currentStage = 'vector_activation';
        try {
            lease.assertOwnership();
            await activateVectors(tenantId, temporaryDocumentId, 'active', { signal });
        } catch (activationError) {
            db.transaction(() => {
                db.prepare(`
                    UPDATE knowledge_documents
                    SET is_active = 0, status = 'staging', updated_at = CURRENT_TIMESTAMP
                    WHERE tenant_id = ? AND id = ?
                `).run(tenantId, stagingRowId);
                db.prepare(`
                    UPDATE knowledge_documents
                    SET is_active = 1, status = 'active', updated_at = CURRENT_TIMESTAMP
                    WHERE tenant_id = ? AND id = ?
                `).run(tenantId, existing.id);
            })();
            throw activationError;
        }
        committed = true;
        console.log(`[RAG Replace] New version committed tenant=${tenantId} document=${logicalDocumentId} version=${versionNumber}`);

        let oldVersionCleanup = 'completed';
        const cleanupErrors = [];
        currentStage = 'old_cleanup';
        try {
            lease.assertOwnership();
            await removeVectors(tenantId, existing.document_key);
        } catch (error) {
            cleanupErrors.push(`vectors:${error.message}`);
        }
        try {
            if (existing.storage_path && fs.existsSync(existing.storage_path)) fs.unlinkSync(existing.storage_path);
        } catch (error) {
            cleanupErrors.push(`file:${error.message}`);
        }

        if (cleanupErrors.length) {
            oldVersionCleanup = 'pending';
            docRepo.updateDocument(tenantId, stagingRowId, {
                cleanup_error: cleanupErrors.join('; ')
            });
            console.error(`[RAG Replace] Old cleanup pending tenant=${tenantId} document=${logicalDocumentId} resources=${cleanupErrors.length}`);
        } else {
            console.log(`[RAG Replace] Old version cleanup completed tenant=${tenantId} document=${logicalDocumentId}`);
        }

        currentStage = 'cache_invalidation';
        try {
            lease.assertOwnership();
            invalidateCache({ tenantId, collection: collectionName, reason: 'document-replaced' });
        } catch (error) {
            oldVersionCleanup = 'pending';
            docRepo.updateDocument(tenantId, stagingRowId, {
                cleanup_error: `cache:${error.message}`
            });
            console.error(`[RAG Replace] Cache invalidation pending tenant=${tenantId} document=${logicalDocumentId}`);
        }

        const active = assertActiveDocument(docRepo.getDocumentById(tenantId, stagingRowId));
        operationResult = { ...active, oldVersionCleanup };
        return operationResult;
    } catch (error) {
        operationError = error;
        if (!committed) {
            try {
                lease.assertOwnership();
                if (temporaryVectorsUploaded) await removeVectors(tenantId, temporaryDocumentId);
                if (fs.existsSync(stagingPath)) fs.unlinkSync(stagingPath);
                if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
                if (stagingRowId) docRepo.deleteDocument(tenantId, stagingRowId);
                console.log(`[RAG Replace] Rollback completed tenant=${tenantId} document=${logicalDocumentId} stage=${currentStage}`);
            } catch (rollbackError) {
                error.rollbackError = rollbackError.message;
                if (stagingRowId) {
                    docRepo.updateDocument(tenantId, stagingRowId, {
                        status: 'rollback_pending',
                        cleanup_error: `qdrant_delete tenantId=${tenantId} documentId=${temporaryDocumentId}: ${rollbackError.message}`
                    });
                }
            }
        }
        throw replacementError(error, currentStage);
    } finally {
        await lease.release({ error: operationError, result: operationResult });
        operation.done();
    }
}

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
    const { requireTenantId } = require('../security/tenantContext');
    const tenantId = requireTenantId(options.tenantId, 'document-upload');

    // 1. Run strict security validations
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        const error = new Error('الملف فارغ ولا يمكن معالجته.');
        error.code = 'RAG_EMPTY_FILE';
        throw error;
    }
    const maxFileSize = Number(getConfig('RAG_MAX_FILE_SIZE_BYTES')) || 10 * 1024 * 1024;
    if (buffer.length > maxFileSize) {
        const error = new Error(`حجم الملف يتجاوز الحد المسموح ${maxFileSize} بايت.`);
        error.code = 'RAG_FILE_TOO_LARGE';
        throw error;
    }
    const ext = validateFilenameSecurity(originalName);
    validateMimeAndMagicBytes(ext, mimeType, buffer);
    const ragMediaType = RAG_MEDIA_TYPES.get(ext) || null;
    const mediaDescription = ragMediaType
        ? String(options.mediaDescription || '').trim()
        : null;
    if (ragMediaType) buildMediaIndexText(originalName, mediaDescription, ragMediaType);

    // A. Duplicate Original Name & Version Detection
    const existingByName = docRepo.getDocumentByOriginalName(tenantId, originalName);
    let nextVersion = 1;

    if (existingByName && existingByName.status !== 'deleted') {
        if (overwriteAction === 'replace') {
            console.log(`[RAG Upload] Overwrite replace requested for existing document: ${originalName}`);
            return replaceDocumentAtomically(existingByName, originalName, mimeType, buffer, ext, options);
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
    const existingByHash = docRepo.getDocumentByContentHash(tenantId, contentHash);
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
        is_active: 0,
        chunk_count: 0,
        vector_count: 0,
        index_fingerprint: null,
        version: nextVersion,
        tenant_id: tenantId,
        media_description: mediaDescription,
        ai_send_enabled: ragMediaType ? 1 : 0
    });

    emitDocumentEvent('rag:document-uploaded', { documentId: docKey, originalFilename: originalName, status: 'uploaded' });

    // 5. Parse and Index the document
    try {
        await parseAndIndexDocumentPipeline(docKey, options);
        const updatedDoc = docRepo.getDocumentByKey(tenantId, docKey);
        return updatedDoc;
    } catch (pipelineErr) {
        console.error(`Pipeline failed for document ${docKey}:`, pipelineErr.message);
        throw pipelineErr;
    }
}

/**
 * Robust helper running the document extraction, chunking, embedding, and vector upsert pipeline.
 * Completely transactional: preserves the previous index if anything fails before successful upserting.
 */
async function parseAndIndexDocumentPipeline(docKey, options = {}) {
    const { requireTenantId } = require('../security/tenantContext');
    const tenantId = requireTenantId(options.tenantId, 'document-index');
    const dependencies = options._testDependencies || {};
    const extract = dependencies.extractTextFromBuffer || extractTextFromBuffer;
    const transcribeAudio = dependencies.transcribeRagAudio || transcribeRagAudio;
    const chunk = dependencies.chunkDocument || chunkDocument;
    const embed = dependencies.generateEmbeddings || generateEmbeddings;
    const qdrantReady = dependencies.checkQdrantReady || checkQdrantReady;
    const modelAvailable = dependencies.checkModelAvailability || checkModelAvailability;
    const initializeCollection = dependencies.initCollection || initCollection;
    const uploadVectors = dependencies.upsertVectors || upsertVectors;
    const readPoints = dependencies.getPointsByDocument || getPointsByDocument;
    const removeVectors = dependencies.deleteVectorsByDocument || deleteVectorsByDocument;
    const restore = dependencies.restoreVectors
        || require('../vector/qdrantVectorStore').restoreVectors;
    const invalidateCache = dependencies.invalidateCache || retrievalCache.invalidate;
    let doc = docRepo.getDocumentByKey(tenantId, docKey);
    if (!doc) {
        const numericId = parseInt(docKey, 10);
        if (!isNaN(numericId)) {
            doc = docRepo.getDocumentById(tenantId, numericId);
        }
    }

    if (!doc) {
        throw new Error('المستند غير موجود في قاعدة البيانات.');
    }
    const logicalDocumentId = doc.logical_document_id || doc.document_key;
    const lease = await acquireLease({
        tenantId, resourceType: 'document', resourceId: logicalDocumentId,
        operation: options.operationType || 'document_index',
        signal: options.signal, failFast: options.failFast !== false,
        idempotencyKey: options.idempotencyKey
    });
    if (lease.duplicate) {
        if (lease.operation.status === 'completed' && lease.operation.result_json) {
            return JSON.parse(lease.operation.result_json);
        }
        throw Object.assign(new Error('A matching document indexing operation is already in progress.'), {
            code: 'RAG_OPERATION_IN_PROGRESS', retryable: true, stage: 'lock'
        });
    }
    const operation = registerOperation('document_index', lease.signal);
    const signal = operation.signal;

    let fileBuffer;
    try {
        fileBuffer = fs.readFileSync(doc.storage_path);
    } catch (error) {
        await lease.release({ error });
        operation.done();
        throw error;
    }

    const versionId = doc.version_id || `${doc.document_key}:v${doc.version || 1}`;
    const lifecycle = createLifecycle({
        tenantId, documentId: doc.document_key, versionId,
        initialState: doc.status === 'failed' ? 'failed' : 'uploaded',
        persist: status => {
            if (!docRepo.updateDocument(tenantId, doc.id, { status })) {
                throw new Error('فشل حفظ حالة فهرسة المستند.');
            }
            emitDocumentEvent('rag:document-status-updated', { documentId: doc.document_key, status });
        }
    });
    let stage = 'extraction';
    let writeAttempted = false;
    let backupPoints = [];
    let operationError = null;
    let operationResult = null;
    try {
        lifecycle.transition('extracting', 'extraction');

        const ext = doc.source_type;
        let text = '';
        try {
            const ragMediaType = RAG_MEDIA_TYPES.get(ext) || null;
            let audioAnalysis = null;
            if (ragMediaType === 'audio') {
                audioAnalysis = await transcribeAudio({
                    storagePath: doc.storage_path,
                    originalName: doc.original_name,
                    mimeType: doc.mime_type
                });
                if (!docRepo.updateDocument(tenantId, doc.id, {
                    media_transcript: audioAnalysis.transcript,
                    media_analysis_model: audioAnalysis.model
                })) {
                    throw new Error('فشل حفظ نتيجة تحليل موديل الصوت.');
                }
            }
            text = ragMediaType
                ? buildIndexedMediaText(
                    doc.original_name, doc.media_description, ragMediaType,
                    audioAnalysis?.transcript
                )
                : await extract(ext, fileBuffer);
        } catch (extractErr) {
            let errorMsg = extractErr.message;
            if (ext === 'pdf' && errorMsg.includes('extract text')) {
                errorMsg = 'تعذر استخراج نص من الملف. قد يكون ملف PDF ممسوحاً ضوئياً ويحتاج إلى OCR.';
            }
            throw asStageError(new Error(errorMsg), 'extraction');
        }

        const maxTextLength = Number(getConfig('RAG_MAX_EXTRACTED_TEXT_LENGTH')) || 10000000;
        if (text.length > maxTextLength) {
            const error = new Error(`النص المستخرج يتجاوز الحد المسموح ${maxTextLength}.`);
            error.code = 'RAG_MAX_TEXT_LENGTH_EXCEEDED';
            throw error;
        }
        const extractedTextHash = computeNormalizedTextHash(text);

        // Check if normalized text is duplicate
        const existingByTextHash = docRepo.getDocumentByExtractedTextHash(tenantId, extractedTextHash);
        if (existingByTextHash && existingByTextHash.document_key !== doc.document_key && existingByTextHash.status !== 'deleted') {
            throw new Error('هذا المستند موجود مسبقاً في قاعدة المعرفة محتوياً على نفس النصوص تماماً.');
        }

        if (!docRepo.updateDocument(tenantId, doc.id, { extracted_text_hash: extractedTextHash })) {
            throw new Error('فشل حفظ بصمة النص المستخرج.');
        }

        // B. Indexing & Vector generation
        // Always dynamically read latest live settings from SQLite
        const chunkSize = parseInt(getConfig('RAG_CHUNK_SIZE'), 10) || 800;
        const chunkOverlap = parseInt(getConfig('RAG_CHUNK_OVERLAP'), 10) || 120;
        const modelName = getConfig('RAG_EMBEDDING_MODEL');
        const collectionName = getConfig('QDRANT_COLLECTION');

        console.log(`[RAG Pipeline] Starting parse/index with chunkSize=${chunkSize}, chunkOverlap=${chunkOverlap}, collection=${collectionName}`);

        // Check infrastructure health
        const qdrantOk = await qdrantReady({ signal });
        if (!qdrantOk) throw new Error('تعذر الاتصال بقاعدة البيانات المتجهية Qdrant.');

        const ollamaOk = await modelAvailable({ signal });
        if (!ollamaOk) throw new Error(`تعذر الاتصال بخدمة Ollama أو النموذج (${modelName}) غير متوفر.`);

        stage = 'chunking';
        lifecycle.transition('chunking');

        // Create virtual chunking document model
        const virtualDoc = {
            documentId: doc.document_key,
            source: doc.original_name,
            sourceType: 'uploaded_document',
            originalText: text,
            documentHash: doc.content_hash,
            tenantId,
            ingestionVersion: versionId
        };

        const richChunks = annotateInjectionRisk(chunk(virtualDoc, chunkSize, chunkOverlap)
            .map((chunk, index) => ({
                ...chunk,
                tenantId,
                documentId: doc.document_key,
                documentVersionId: doc.version_id,
                indexVersionId: doc.version_id,
                sourceType: 'uploaded_document',
                chunkIndex: index,
                contentHash: chunk.contentHash || extractedTextHash,
                embeddingModel: modelName,
                ingestionVersion: versionId,
                createdAt: new Date().toISOString(),
                ragMediaType: RAG_MEDIA_TYPES.get(ext) || null,
                ragMediaDocumentId: RAG_MEDIA_TYPES.has(ext) ? doc.document_key : null
            })), tenantId, doc.document_key);
        if (richChunks.length === 0) {
            throw new Error('لا يمكن تقسيم المستند إلى مقاطع صالحة.');
        }
        const maxChunks = Number(getConfig('RAG_MAX_CHUNKS_PER_DOCUMENT')) || 5000;
        if (richChunks.length > maxChunks) {
            const error = new Error(`عدد المقاطع ${richChunks.length} يتجاوز الحد المسموح ${maxChunks}.`);
            error.code = 'RAG_MAX_CHUNKS_EXCEEDED';
            throw error;
        }

        // Generate embeddings in Ollama
        const chunkTexts = richChunks.map(c => c.text);
        stage = 'embedding';
        lifecycle.transition('embedding');
        const vectors = await embed(chunkTexts, null, {
            signal, tenantId, documentId: doc.document_key,
            concurrency: Number(getConfig('RAG_EMBEDDING_CONCURRENCY')) || 4
        });
        if (!Array.isArray(vectors) || vectors.length !== richChunks.length) {
            throw new Error('عدد متجهات التضمين لا يطابق عدد المقاطع.');
        }

        const dimension = vectors[0]?.length || 0;
        if (!dimension || vectors.some(vector =>
            !Array.isArray(vector) || vector.length !== dimension
            || vector.some(value => !Number.isFinite(value))
        )) throw new Error('متجهات التضمين غير صالحة أو ذات أبعاد غير متطابقة.');
        richChunks.forEach(chunk => { chunk.vectorDimension = dimension; });
        await initializeCollection(dimension, { signal });

        // Transactional write sequence: Only delete old vectors and write new ones after successful generation
        backupPoints = await readPoints(tenantId, doc.document_key, { signal });
        console.log(`[RAG Transactional] Backed up ${backupPoints.length} old vectors for rollback.`);

        stage = 'qdrant_upload';
        lifecycle.transition('uploading_vectors');
        try {
            lease.assertOwnership();
            writeAttempted = true;
            await removeVectors(tenantId, doc.document_key, { signal });
            await uploadVectors(richChunks, vectors, { signal });
        } catch (writeErr) {
            console.error('[RAG Transactional] Write failed. Restoring previous index...', writeErr.message);
            throw writeErr;
        }

        stage = 'verification';
        lifecycle.transition('verifying');
        const uploadedPoints = await readPoints(tenantId, doc.document_key, { signal });
        if (uploadedPoints.length !== richChunks.length) {
            throw new Error(`Qdrant point count mismatch (${uploadedPoints.length}/${richChunks.length}).`);
        }
        for (const point of uploadedPoints) {
            if (!Array.isArray(point.vector) || point.vector.length !== dimension
                || point.payload?.tenantId !== tenantId
                || point.payload?.documentId !== doc.document_key
                || point.payload?.sourceType !== 'uploaded_document') {
                throw new Error('Qdrant verification found an invalid vector or payload.');
            }
        }

        // Compute indexing fingerprint
        const fingerprint = computeDocumentFingerprint(extractedTextHash, chunkSize, chunkOverlap, modelName, collectionName);

        // Update database record with final successful indexing metadata
        stage = 'activation';
        lifecycle.transition('activating');
        lease.assertOwnership();
        if (dependencies.beforeActivationCommit) dependencies.beforeActivationCommit();
        const committed = docRepo.updateDocument(tenantId, doc.id, {
            status: 'active',
            is_active: 1,
            chunk_count: richChunks.length,
            vector_count: richChunks.length,
            index_fingerprint: fingerprint,
            fencing_token: lease.fencingToken,
            operation_id: lease.operationId,
            indexed_at: new Date().toISOString()
        });
        if (!committed) throw new Error('لم يتم تثبيت حالة المستند النشطة في SQLite.');

        lease.assertOwnership();
        invalidateCache({
            tenantId,
            collection: collectionName,
            reason: options.reason || 'document-indexed'
        });

        emitDocumentEvent('rag:document-indexed', {
            documentId: doc.document_key,
            status: 'active',
            chunkCount: richChunks.length
        });
        lifecycle.transition('active');
        const activeDoc = assertActiveDocument(docRepo.getDocumentByKey(tenantId, doc.document_key));
        console.log('[Index] Response ready', {
            tenantId, documentId: doc.document_key, versionId,
            stage: 'active', durationMs: 0
        });
        operationResult = activeDoc;
        return activeDoc;

    } catch (err) {
        operationError = err;
        let finalError = asStageError(err, stage);
        if (writeAttempted) {
            try {
                lease.assertOwnership();
                await removeVectors(tenantId, doc.document_key, { signal });
                if (backupPoints.length) await restore(tenantId, backupPoints, { signal });
            } catch (rollbackCause) {
                finalError = new RollbackError('فشل التراجع عن فهرسة المستند.', {
                    stage: 'rollback',
                    code: 'RAG_ROLLBACK_FAILED',
                    retryable: true,
                    cause: rollbackCause
                });
                finalError.originalError = err.message;
                docRepo.updateDocument(tenantId, doc.id, {
                    status: 'cleanup_pending',
                    indexing_status: 'failed',
                    indexing_error: `${err.message}; rollback: ${rollbackCause.message}`
                });
            }
        }
        if (finalError.stage !== 'rollback') {
            docRepo.updateDocument(tenantId, doc.id, {
                status: 'failed',
                indexing_status: 'failed',
                indexing_error: finalError.message
            });
        }
        lifecycle.fail(finalError);

        emitDocumentEvent('rag:document-failed', {
            documentId: doc.document_key,
            status: finalError.stage === 'rollback' ? 'cleanup_pending' : 'failed',
            error: finalError.message
        });

        throw finalError;
    } finally {
        await lease.release({ error: operationError, result: operationResult });
        operation.done();
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
async function reindexDocument(docKey, options = {}) {
    const { requireTenantId } = require('../security/tenantContext');
    const tenantId = requireTenantId(options.tenantId, 'document-reindex');
    let doc = docRepo.getDocumentByKey(tenantId, docKey);
    if (!doc) {
        const numericId = parseInt(docKey, 10);
        if (!isNaN(numericId)) {
            doc = docRepo.getDocumentById(tenantId, numericId);
        }
    }

    if (!doc) throw new Error('المستند غير موجود في قاعدة البيانات.');

    return parseAndIndexDocumentPipeline(doc.document_key, {
        ...options,
        reason: 'document-reindexed'
    });
}

/**
 * Retries parsing and indexing a failed document.
 */
async function retryFailedDocument(docKey, options = {}) {
    return reindexDocument(docKey, options);
}

/**
 * Safely deletes a document, its original file, and all corresponding Qdrant points.
 * Features lookups by either document_key or numerical id and proceeds safely.
 */
async function deleteDocument(docKey, options = {}) {
    const { requireTenantId } = require('../security/tenantContext');
    const tenantId = requireTenantId(options.tenantId, 'document-delete');
    let doc = docRepo.getDocumentByKey(tenantId, docKey);
    if (!doc) {
        const numericId = parseInt(docKey, 10);
        if (!isNaN(numericId)) {
            doc = docRepo.getDocumentById(tenantId, numericId);
        }
    }

    const logicalDocumentId = doc?.logical_document_id || doc?.document_key || String(docKey);
    const lease = await acquireLease({
        tenantId, resourceType: 'document', resourceId: logicalDocumentId,
        operation: 'document_delete', signal: options.signal,
        failFast: options.failFast !== false, idempotencyKey: options.idempotencyKey
    });
    if (lease.duplicate) {
        if (lease.operation.status === 'completed') return true;
        throw Object.assign(new Error('A matching document deletion is already in progress.'), {
            code: 'RAG_OPERATION_IN_PROGRESS', retryable: true, stage: 'lock'
        });
    }
    let operationError = null;
    let operationResult;

    if (!doc) {
        // Idempotent delete: also clean any orphaned vectors left behind by a
        // prior partial operation, then report the desired absent state.
        console.warn(`⚠️ Proceeding to clean orphaned vectors for missing SQLite document key: ${docKey}`);
        try {
            lease.assertOwnership();
            await deleteVectorsByDocument(tenantId, docKey);
        } catch (qErr) {
            await lease.release({ error: qErr });
            throw qErr;
        }
        operationResult = { success: true, documentId: String(docKey), alreadyAbsent: true };
        await lease.release({ result: operationResult });
        return true;
    }

    try {
        lease.assertOwnership();
        // 1. Mark as deleting
        docRepo.updateDocument(tenantId, doc.id, { status: 'deleting' });
        emitDocumentEvent('rag:document-status-updated', { documentId: doc.document_key, status: 'deleting' });

        // 2. Delete from Qdrant
        lease.assertOwnership();
        await deleteVectorsByDocument(tenantId, doc.document_key);

        // 3. Delete from private filesystem
        if (doc.storage_path && fs.existsSync(doc.storage_path)) {
            fs.unlinkSync(doc.storage_path);
        }

        // 4. Delete SQLite record
        lease.assertOwnership();
        docRepo.deleteDocument(tenantId, doc.id);

        lease.assertOwnership();
        retrievalCache.invalidate({
            tenantId,
            collection: getConfig('QDRANT_COLLECTION'),
            reason: 'document-deleted'
        });

        emitDocumentEvent('rag:document-deleted', { documentId: doc.document_key, status: 'deleted' });
        operationResult = { success: true, documentId: doc.document_key };
        return true;
    } catch (err) {
        operationError = err;
        if (lease.owns()) {
            docRepo.updateDocument(tenantId, doc.id, {
                status: 'failed',
                indexing_error: `فشل الحذف: ${err.message}`
            });
        }
        throw err;
    } finally {
        await lease.release({ error: operationError, result: operationResult });
    }
}

module.exports = {
    uploadAndRegisterDocument,
    listDocuments,
    countDocuments,
    reindexDocument,
    retryFailedDocument,
    deleteDocument,
    computeDocumentFingerprint,
    replaceDocumentAtomically,
    parseAndIndexDocumentPipeline
};
