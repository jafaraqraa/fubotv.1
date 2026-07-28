ALTER TABLE knowledge_documents ADD COLUMN reconciliation_status TEXT;
ALTER TABLE knowledge_documents ADD COLUMN reconciliation_error TEXT;
ALTER TABLE rag_index_versions ADD COLUMN reconciliation_status TEXT;
ALTER TABLE rag_index_versions ADD COLUMN reconciliation_error TEXT;

CREATE TABLE rag_reconciliation_runs (
    audit_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    dry_run INTEGER NOT NULL,
    operator_id TEXT NOT NULL,
    status TEXT NOT NULL,
    summary_json TEXT,
    continuation_offset TEXT,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    duration_ms INTEGER,
    error_message TEXT
);

CREATE INDEX idx_rag_reconciliation_runs_tenant
ON rag_reconciliation_runs(tenant_id, started_at DESC);

CREATE TABLE rag_reconciliation_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    issue_type TEXT NOT NULL,
    point_id TEXT,
    document_id TEXT,
    version_id TEXT,
    action TEXT NOT NULL,
    reason TEXT NOT NULL,
    operator_id TEXT NOT NULL,
    result TEXT NOT NULL,
    error_message TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (audit_id) REFERENCES rag_reconciliation_runs(audit_id)
);

CREATE INDEX idx_rag_reconciliation_actions_audit
ON rag_reconciliation_actions(audit_id, tenant_id);

CREATE TABLE rag_reconciliation_locks (
    tenant_id TEXT PRIMARY KEY,
    owner_token TEXT NOT NULL,
    operator_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
