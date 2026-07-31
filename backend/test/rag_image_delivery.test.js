const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.SQLITE_DB_PATH = path.join(__dirname, '..', 'data', 'test_rag_image_delivery.db');
for (const suffix of ['', '-wal', '-shm']) {
    const candidate = process.env.SQLITE_DB_PATH + suffix;
    if (fs.existsSync(candidate)) fs.unlinkSync(candidate);
}

const db = require('../src/database/connection');
const { initializeDatabase } = require('../src/database/initialize');
const docRepo = require('../src/database/repositories/knowledgeDocumentRepository');
const mediaRepo = require('../src/database/repositories/mediaAttachmentRepository');
const { docsDir, validateFilenameSecurity, validateMimeAndMagicBytes, computeSHA256 } =
    require('../src/rag/loaders/documentExtractionService');
const { uploadAndRegisterDocument } = require('../src/rag/services/knowledgeDocumentService');
const { _test } = require('../src/messaging/messageProcessor');
const { MODE, classifyConversationMode } = require('../src/services/conversationModeRouter');

async function run() {
    initializeDatabase();

    const png = Buffer.alloc(32);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(png, 0);
    assert.strictEqual(validateFilenameSecurity('product.png'), 'png');
    validateMimeAndMagicBytes('png', 'image/png', png);
    assert.throws(
        () => validateMimeAndMagicBytes('png', 'image/png', Buffer.from('not-an-image')),
        /PNG/
    );
    assert.strictEqual(_test.requestsKnowledgeImage('ابعثلي صورة المنتج الأحمر'), true);
    assert.strictEqual(_test.requestsKnowledgeImage('شكراً'), false);
    assert.strictEqual(classifyConversationMode('ابعثلي صورة العرض').mode, MODE.COMPANY_KNOWLEDGE);
    await assert.rejects(
        () => uploadAndRegisterDocument('missing-description.png', 'image/png', png, {
            tenantId: 'default'
        }),
        error => error.code === 'RAG_IMAGE_DESCRIPTION_REQUIRED'
    );

    let vectorPoints = [];
    const indexed = await uploadAndRegisterDocument('product.png', 'image/png', png, {
        tenantId: 'default',
        mediaDescription: 'صورة المنتج الأحمر من الأمام',
        _testDependencies: {
            checkQdrantReady: async () => true,
            checkModelAvailability: async () => true,
            initCollection: async () => true,
            generateEmbeddings: async texts => texts.map(() => [0.1, 0.2, 0.3]),
            getPointsByDocument: async () => vectorPoints,
            deleteVectorsByDocument: async () => { vectorPoints = []; },
            upsertVectors: async (chunks, vectors) => {
                vectorPoints = chunks.map((chunk, index) => ({
                    id: chunk.chunkId,
                    payload: chunk,
                    vector: vectors[index]
                }));
                return { success: true };
            },
            restoreVectors: async points => { vectorPoints = points; },
            invalidateCache: async () => 0
        }
    });
    assert.strictEqual(indexed.status, 'active');
    assert.strictEqual(indexed.source_type, 'png');
    assert.strictEqual(indexed.ai_send_enabled, 1);
    assert.strictEqual(indexed.media_description, 'صورة المنتج الأحمر من الأمام');
    assert.strictEqual(vectorPoints[0].payload.ragMediaType, 'image');
    assert.strictEqual(vectorPoints[0].payload.ragMediaDocumentId, indexed.document_key);
    const documentKey = indexed.document_key;

    const selected = _test.selectRetrievedRagImage('default', {
        profiling: { topChunks: [{ payload: {
            ragMediaType: 'image', ragMediaDocumentId: documentKey
        } }] }
    });
    assert.strictEqual(selected.document_key, documentKey);
    assert.strictEqual(_test.selectRetrievedRagImage('another-tenant', {
        profiling: { topChunks: [{ payload: {
            ragMediaType: 'image', ragMediaDocumentId: documentKey
        } }] }
    }), null);
    assert.strictEqual(_test.selectRetrievedRagImage('default', { profiling: { topChunks: [] } }), null);

    docRepo.updateDocument('default', indexed.id, { ai_send_enabled: 0 });
    assert.strictEqual(_test.selectRetrievedRagImage('default', {
        profiling: { topChunks: [{ payload: {
            ragMediaType: 'image', ragMediaDocumentId: documentKey
        } }] }
    }), null);
    docRepo.updateDocument('default', indexed.id, { ai_send_enabled: 1 });

    assert.throws(
        () => _test.createOutgoingMediaFromRagImage(
            { ...selected, storage_path: path.join(__dirname, 'outside.png') },
            'messenger', 'default'
        ),
        error => error.code === 'RAG_MEDIA_FILE_UNAVAILABLE'
    );

    const outgoingCopies = [];
    for (const channel of ['messenger', 'instagram', 'telegram', 'whatsapp']) {
        const outgoing = _test.createOutgoingMediaFromRagImage(selected, channel, 'default');
        outgoingCopies.push(outgoing);
        assert.ok(outgoing.attachmentId);
        const attachment = mediaRepo.getAttachment(outgoing.attachmentId, 'default');
        assert.strictEqual(attachment.media_type, 'image');
        assert.strictEqual(attachment.direction, 'outgoing');
        assert.strictEqual(attachment.channel, channel);
        assert.strictEqual(attachment.tenant_id, 'default');
        assert.strictEqual(mediaRepo.getAttachment(outgoing.attachmentId, 'another-tenant'), undefined);
    }

    fs.unlinkSync(indexed.storage_path);
    outgoingCopies.forEach(outgoing => fs.unlinkSync(outgoing.localPath));
    db.close();
    fs.unlinkSync(process.env.SQLITE_DB_PATH);
    console.log('✅ RAG image delivery tests passed');
}

run().catch(error => {
    console.error(error);
    try { db.close(); } catch (_) {}
    process.exit(1);
});
