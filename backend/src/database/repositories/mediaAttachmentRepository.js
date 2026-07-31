const crypto = require('crypto');
const db = require('../connection');

function createAttachment(record) {
    const id = record.id || crypto.randomUUID();
    db.prepare(`
        INSERT INTO media_attachments (
            id, tenant_id, channel, owner_administrator_id, original_filename,
            stored_filename, storage_path, mime_type, size_bytes, checksum_sha256
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        id, record.tenantId, record.channel, record.ownerAdministratorId || null,
        record.originalFilename, record.storedFilename, record.storagePath,
        record.mimeType, record.sizeBytes, record.checksum
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
        externalMessageId: 'external_message_id',
        retryCount: 'retry_count', lastError: 'last_error'
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
    findByExternalMessageId
};
