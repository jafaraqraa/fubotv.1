CREATE TABLE IF NOT EXISTS rag_operation_locks (
    lock_key TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    owner_token TEXT NOT NULL,
    owner_instance_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    fencing_token INTEGER NOT NULL DEFAULT 1,
    acquired_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    heartbeat_at INTEGER NOT NULL,
    metadata_json TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rag_operation_locks_expiry
ON rag_operation_locks(expires_at);

CREATE INDEX IF NOT EXISTS idx_rag_operation_locks_tenant
ON rag_operation_locks(tenant_id, resource_type, expires_at);

CREATE TABLE IF NOT EXISTS rag_operations (
    operation_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    operation_type TEXT NOT NULL,
    status TEXT NOT NULL,
    lock_key TEXT NOT NULL,
    fencing_token INTEGER,
    idempotency_key TEXT,
    instance_id TEXT NOT NULL,
    started_at DATETIME,
    heartbeat_at DATETIME,
    completed_at DATETIME,
    failed_at DATETIME,
    error_code TEXT,
    error_message TEXT,
    cleanup_status TEXT,
    result_json TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rag_operation_idempotency
ON rag_operations(tenant_id, operation_type, idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rag_operations_resource
ON rag_operations(tenant_id, resource_type, resource_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rag_operations_status
ON rag_operations(status, heartbeat_at);

ALTER TABLE rag_index_versions ADD COLUMN fencing_token INTEGER;
ALTER TABLE rag_index_versions ADD COLUMN operation_id TEXT;
ALTER TABLE knowledge_documents ADD COLUMN fencing_token INTEGER;
ALTER TABLE knowledge_documents ADD COLUMN operation_id TEXT;
