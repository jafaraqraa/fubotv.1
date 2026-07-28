-- Rebuild legacy document metadata so identifiers are unique per tenant, not globally.
ALTER TABLE knowledge_documents RENAME TO knowledge_documents_legacy_018;

CREATE TABLE knowledge_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_key TEXT NOT NULL,
    original_name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    source_type TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    storage_name TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    extracted_text_hash TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'ar',
    status TEXT NOT NULL,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    indexing_status TEXT,
    indexing_error TEXT,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    vector_count INTEGER NOT NULL DEFAULT 0,
    index_fingerprint TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    indexed_at DATETIME,
    disabled_at DATETIME,
    version INTEGER NOT NULL DEFAULT 1,
    tenant_id TEXT NOT NULL,
    logical_document_id TEXT NOT NULL,
    version_id TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    embedding_model TEXT,
    vector_dimension INTEGER,
    cleanup_error TEXT,
    tenant_ownership_status TEXT NOT NULL DEFAULT 'verified',
    UNIQUE (tenant_id, document_key),
    UNIQUE (tenant_id, version_id)
);

INSERT INTO knowledge_documents (
    id, document_key, original_name, display_name, source_type, mime_type,
    storage_name, storage_path, file_size, content_hash, extracted_text_hash,
    language, status, is_enabled, indexing_status, indexing_error, chunk_count,
    vector_count, index_fingerprint, created_at, updated_at, indexed_at, disabled_at,
    version, tenant_id, logical_document_id, version_id, is_active, embedding_model,
    vector_dimension, cleanup_error, tenant_ownership_status
)
SELECT
    id, document_key, original_name, display_name, source_type, mime_type,
    storage_name, storage_path, file_size, content_hash, extracted_text_hash,
    language, status, is_enabled, indexing_status, indexing_error, chunk_count,
    vector_count, index_fingerprint, created_at, updated_at, indexed_at, disabled_at,
    version, tenant_id, COALESCE(logical_document_id, document_key),
    COALESCE(version_id, document_key || ':v' || version), is_active, embedding_model,
    vector_dimension, cleanup_error, 'unverified'
FROM knowledge_documents_legacy_018;

DROP TABLE knowledge_documents_legacy_018;

CREATE INDEX idx_knowledge_docs_hash ON knowledge_documents(tenant_id, content_hash);
CREATE INDEX idx_knowledge_docs_text_hash ON knowledge_documents(tenant_id, extracted_text_hash);
CREATE INDEX idx_knowledge_docs_key ON knowledge_documents(tenant_id, document_key);
CREATE INDEX idx_knowledge_docs_enabled ON knowledge_documents(tenant_id, is_enabled);
CREATE UNIQUE INDEX idx_knowledge_one_active_version
ON knowledge_documents(tenant_id, logical_document_id) WHERE is_active = 1;
CREATE INDEX idx_knowledge_versions
ON knowledge_documents(tenant_id, logical_document_id, version DESC);

-- Legacy indexing state had a global document_id primary key.
ALTER TABLE rag_indexing_state RENAME TO rag_indexing_state_legacy_018;
CREATE TABLE rag_indexing_state (
    tenant_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    document_hash TEXT,
    source TEXT,
    last_status TEXT,
    last_success_at DATETIME,
    last_duration_ms INTEGER,
    total_chunks INTEGER,
    last_error TEXT,
    collection_name TEXT,
    embedding_model TEXT,
    chunk_size INTEGER,
    chunk_overlap INTEGER,
    index_fingerprint TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    tenant_ownership_status TEXT NOT NULL DEFAULT 'verified',
    PRIMARY KEY (tenant_id, document_id)
);
INSERT INTO rag_indexing_state (
    tenant_id, document_id, document_hash, source, last_status, last_success_at,
    last_duration_ms, total_chunks, last_error, collection_name, embedding_model,
    chunk_size, chunk_overlap, index_fingerprint, updated_at, tenant_ownership_status
)
SELECT
    'default', document_id, document_hash, source, last_status, last_success_at,
    last_duration_ms, total_chunks, last_error, collection_name, embedding_model,
    chunk_size, chunk_overlap, index_fingerprint, updated_at, 'unverified'
FROM rag_indexing_state_legacy_018;
DROP TABLE rag_indexing_state_legacy_018;

ALTER TABLE retrieval_analytics ADD COLUMN tenant_id TEXT;
ALTER TABLE retrieval_analytics ADD COLUMN tenant_ownership_status TEXT NOT NULL DEFAULT 'unverified';
CREATE INDEX idx_retrieval_analytics_tenant_created
ON retrieval_analytics(tenant_id, created_at);

CREATE TABLE rag_tenant_migration_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    previous_tenant_id TEXT,
    assigned_tenant_id TEXT,
    status TEXT NOT NULL,
    details TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
