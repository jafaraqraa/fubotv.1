CREATE TABLE IF NOT EXISTS media_attachments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    message_id TEXT,
    channel TEXT NOT NULL CHECK(channel IN ('messenger', 'instagram')),
    owner_administrator_id INTEGER,
    original_filename TEXT NOT NULL,
    stored_filename TEXT NOT NULL,
    storage_path TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
    checksum_sha256 TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'uploaded'
        CHECK(status IN ('uploaded', 'uploading', 'ready', 'sending', 'sent', 'delivered', 'read', 'failed', 'deleted')),
    provider_attachment_id TEXT,
    external_message_id TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count >= 0),
    last_error TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY(owner_administrator_id) REFERENCES administrators(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_media_attachments_tenant_status
ON media_attachments(tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_media_attachments_external
ON media_attachments(tenant_id, channel, external_message_id)
WHERE external_message_id IS NOT NULL;
