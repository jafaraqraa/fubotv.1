ALTER TABLE knowledge_documents ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE knowledge_documents ADD COLUMN logical_document_id TEXT;
ALTER TABLE knowledge_documents ADD COLUMN version_id TEXT;
ALTER TABLE knowledge_documents ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE knowledge_documents ADD COLUMN embedding_model TEXT;
ALTER TABLE knowledge_documents ADD COLUMN vector_dimension INTEGER;
ALTER TABLE knowledge_documents ADD COLUMN cleanup_error TEXT;

UPDATE knowledge_documents
SET logical_document_id = document_key,
    version_id = document_key || ':v' || version
WHERE logical_document_id IS NULL OR version_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_one_active_version
ON knowledge_documents(tenant_id, logical_document_id)
WHERE is_active = 1;

CREATE INDEX IF NOT EXISTS idx_knowledge_versions
ON knowledge_documents(tenant_id, logical_document_id, version DESC);

CREATE TABLE IF NOT EXISTS rag_document_locks (
    tenant_id TEXT NOT NULL,
    logical_document_id TEXT NOT NULL,
    owner_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, logical_document_id)
);
