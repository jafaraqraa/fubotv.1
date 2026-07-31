ALTER TABLE media_attachments RENAME TO media_attachments_meta_legacy;

CREATE TABLE media_attachments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    conversation_id TEXT,
    message_id TEXT,
    channel TEXT NOT NULL CHECK(channel IN ('messenger', 'instagram', 'telegram', 'whatsapp')),
    provider TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT 'outgoing' CHECK(direction IN ('incoming', 'outgoing')),
    media_type TEXT NOT NULL DEFAULT 'document'
        CHECK(media_type IN ('image', 'video', 'audio', 'voice', 'document', 'animation', 'sticker')),
    owner_administrator_id INTEGER,
    original_filename TEXT NOT NULL,
    stored_filename TEXT NOT NULL,
    storage_path TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    extension TEXT,
    size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
    checksum_sha256 TEXT NOT NULL,
    provider_media_id TEXT,
    provider_attachment_id TEXT,
    provider_url TEXT,
    external_message_id TEXT,
    thumbnail_reference TEXT,
    width INTEGER,
    height INTEGER,
    duration_ms INTEGER,
    caption TEXT,
    status TEXT NOT NULL DEFAULT 'uploaded'
        CHECK(status IN ('validating', 'uploading', 'uploaded', 'sending', 'sent', 'delivered', 'read', 'failed', 'cancelled', 'unknown', 'deleted')),
    failure_code TEXT,
    last_error TEXT,
    idempotency_key TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count >= 0),
    upload_started_at DATETIME,
    upload_completed_at DATETIME,
    provider_sent_at DATETIME,
    deleted_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY(owner_administrator_id) REFERENCES administrators(id) ON DELETE SET NULL
);

INSERT INTO media_attachments (
    id, tenant_id, message_id, channel, provider, direction, media_type,
    owner_administrator_id, original_filename, stored_filename, storage_path,
    mime_type, extension, size_bytes, checksum_sha256, status,
    provider_attachment_id, external_message_id, retry_count, last_error,
    upload_completed_at, created_at, updated_at
)
SELECT id, tenant_id, message_id, channel, 'meta', 'outgoing',
       CASE
           WHEN mime_type LIKE 'image/%' THEN 'image'
           WHEN mime_type LIKE 'video/%' THEN 'video'
           WHEN mime_type LIKE 'audio/%' THEN 'audio'
           ELSE 'document'
       END,
       owner_administrator_id, original_filename, stored_filename, storage_path,
       mime_type, lower(substr(stored_filename, instr(stored_filename, '.') + 1)),
       size_bytes, checksum_sha256, status, provider_attachment_id,
       external_message_id, retry_count, last_error, created_at, created_at, updated_at
FROM media_attachments_meta_legacy;

DROP TABLE media_attachments_meta_legacy;

CREATE INDEX idx_media_attachments_tenant_status
ON media_attachments(tenant_id, status, created_at DESC);

CREATE INDEX idx_media_attachments_message
ON media_attachments(tenant_id, message_id);

CREATE INDEX idx_media_attachments_external
ON media_attachments(tenant_id, channel, external_message_id)
WHERE external_message_id IS NOT NULL;

CREATE UNIQUE INDEX idx_media_attachments_idempotency
ON media_attachments(tenant_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;
