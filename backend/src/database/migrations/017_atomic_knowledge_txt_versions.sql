CREATE TABLE IF NOT EXISTS rag_index_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    document_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    index_version_id TEXT NOT NULL UNIQUE,
    content_hash TEXT NOT NULL,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    embedding_model TEXT NOT NULL,
    vector_dimension INTEGER,
    collection_name TEXT NOT NULL,
    status TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    activated_at DATETIME,
    cleanup_status TEXT,
    error_message TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rag_one_active_source_version
ON rag_index_versions(tenant_id, source_type, document_id)
WHERE is_active = 1;

CREATE INDEX IF NOT EXISTS idx_rag_index_version_history
ON rag_index_versions(tenant_id, source_type, document_id, version_number DESC);

CREATE TABLE IF NOT EXISTS rag_index_locks (
    tenant_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    owner_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, source_type)
);
