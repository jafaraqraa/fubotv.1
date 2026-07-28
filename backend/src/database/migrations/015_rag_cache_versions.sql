CREATE TABLE IF NOT EXISTS rag_cache_versions (
    tenant_id TEXT NOT NULL,
    collection_name TEXT NOT NULL,
    index_version INTEGER NOT NULL DEFAULT 1,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, collection_name)
);

