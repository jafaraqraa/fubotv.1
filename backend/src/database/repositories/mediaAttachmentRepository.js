const crypto = require('crypto');
const db = require('../connection');

function createAttachment(record) {
    const id = record.id || crypto.randomUUID();
    db.prepare(`
        INSERT INTO media_attachments (
            id, tenant_id, conversation_id, channel, provider, direction, media_type,
            owner_administrator_id, original_filename, stored_filename, storage_path,
            mime_type, extension, size_bytes, checksum_sha256, caption, status,
            idempotency_key, provider_media_id, provider_attachment_id, provider_url,
            upload_started_at, upload_completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        id, record.tenantId, record.conversationId || null, record.channel,
        record.provider || (['messenger', 'instagram'].includes(record.channel) ? 'meta' : record.channel),
        record.direction || 'outgoing', record.mediaType || 'document',
        record.ownerAdministratorId || null,
        record.originalFilename, record.storedFilename, record.storagePath,
        record.mimeType, record.extension || null, record.sizeBytes, record.checksum,
        record.caption || null, record.status || 'uploaded', record.idempotencyKey || null,
        record.providerMediaId || null, record.providerAttachmentId || null, record.providerUrl || null,
        record.uploadStartedAt || null, record.uploadCompletedAt || new Date().toISOString()
    );
    return getAttachment(id, record.tenantId);
}

function getAttachment(id, tenantId) {
    return db.prepare(`
        SELECT * FROM media_attachments WHERE id = ? AND tenant_id = ?
    `).get(id, tenantId);
}

function updateAttachment(id, tenantId, patch) {
    const allowed = {
        messageId: 'message_id', status: 'status',
        providerAttachmentId: 'provider_attachment_id',
        providerMediaId: 'provider_media_id', providerUrl: 'provider_url',
        externalMessageId: 'external_message_id',
        retryCount: 'retry_count', lastError: 'last_error', failureCode: 'failure_code',
        uploadStartedAt: 'upload_started_at', uploadCompletedAt: 'upload_completed_at',
        providerSentAt: 'provider_sent_at', deletedAt: 'deleted_at'
    };
    const entries = Object.entries(patch).filter(([key]) => allowed[key]);
    if (!entries.length) return getAttachment(id, tenantId);
    const assignments = entries.map(([key]) => `${allowed[key]} = ?`);
    const values = entries.map(([, value]) => value);
    const result = db.prepare(`
        UPDATE media_attachments
        SET ${assignments.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND tenant_id = ?
    `).run(...values, id, tenantId);
    if (result.changes !== 1) {
        const error = new Error('Media attachment not found.');
        error.code = 'MEDIA_NOT_FOUND';
        throw error;
    }
    return getAttachment(id, tenantId);
}

function findByIdempotencyKey(tenantId, idempotencyKey) {
    if (!idempotencyKey) return null;
    return db.prepare(`
        SELECT * FROM media_attachments WHERE tenant_id = ? AND idempotency_key = ?
    `).get(tenantId, idempotencyKey);
}

function findByExternalMessageId(externalMessageId, channel) {
    return db.prepare(`
        SELECT * FROM media_attachments
        WHERE external_message_id = ? AND channel = ?
        ORDER BY created_at DESC LIMIT 1
    `).get(String(externalMessageId), channel);
}

module.exports = {
    createAttachment,
    getAttachment,
    updateAttachment,
    findByExternalMessageId,
    findByIdempotencyKey
};
