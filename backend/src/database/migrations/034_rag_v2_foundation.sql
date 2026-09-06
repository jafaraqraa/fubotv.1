-- Additive RAG v2 source-of-truth tables. Qdrant remains a derived index.
CREATE TABLE IF NOT EXISTS rag_v2_document_versions (
    document_version_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    knowledge_base_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('staging','active','inactive','rejected','tombstoned')),
    valid_from TEXT,
    valid_to TEXT,
    is_current INTEGER NOT NULL DEFAULT 0 CHECK(is_current IN (0,1)),
    source_type TEXT NOT NULL,
    source_uri TEXT,
    source_checksum TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'und',
    title TEXT,
    permissions_json TEXT NOT NULL DEFAULT '[]',
    quality_report_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    indexed_at TEXT,
    UNIQUE(tenant_id, knowledge_base_id, document_id, version_number),
    UNIQUE(tenant_id, knowledge_base_id, source_checksum)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rag_v2_current_document
ON rag_v2_document_versions(tenant_id, knowledge_base_id, document_id)
WHERE is_current = 1 AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_rag_v2_versions_scope
ON rag_v2_document_versions(tenant_id, knowledge_base_id, status, is_current);

CREATE TABLE IF NOT EXISTS rag_v2_chunks (
    chunk_id TEXT PRIMARY KEY,
    document_version_id TEXT NOT NULL REFERENCES rag_v2_document_versions(document_version_id),
    tenant_id TEXT NOT NULL,
    knowledge_base_id TEXT NOT NULL,
    parent_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    section_path_json TEXT NOT NULL DEFAULT '[]',
    page_number INTEGER,
    original_text TEXT NOT NULL,
    retrieval_text TEXT NOT NULL,
    content_checksum TEXT NOT NULL,
    token_count INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(document_version_id, chunk_index),
    UNIQUE(document_version_id, content_checksum)
);

CREATE INDEX IF NOT EXISTS idx_rag_v2_chunks_scope
ON rag_v2_chunks(tenant_id, knowledge_base_id, document_version_id);

CREATE TABLE IF NOT EXISTS rag_v2_ingestion_jobs (
    job_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    knowledge_base_id TEXT NOT NULL,
    document_version_id TEXT,
    state TEXT NOT NULL,
    stage TEXT NOT NULL,
    checkpoint_json TEXT NOT NULL DEFAULT '{}',
    error_code TEXT,
    error_detail_redacted TEXT,
    started_at TEXT,
    finished_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rag_v2_index_versions (
    index_version_id TEXT PRIMARY KEY,
    collection_name TEXT NOT NULL UNIQUE,
    alias_name TEXT NOT NULL,
    embedding_model TEXT NOT NULL,
    embedding_dimensions INTEGER NOT NULL,
    distance_metric TEXT NOT NULL,
    sparse_model TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('building','validated','active','retired','failed')),
    manifest_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    activated_at TEXT
);

CREATE TABLE IF NOT EXISTS rag_v2_evaluation_runs (
    run_id TEXT PRIMARY KEY,
    dataset_version TEXT NOT NULL,
    implementation TEXT NOT NULL,
    config_json TEXT NOT NULL,
    metrics_json TEXT NOT NULL,
    artifact_uri TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

