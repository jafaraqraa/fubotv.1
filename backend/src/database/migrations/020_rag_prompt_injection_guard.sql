CREATE TABLE IF NOT EXISTS rag_injection_quarantine (
    quarantine_id TEXT PRIMARY KEY,
    tenant_id TEXT,
    document_id TEXT,
    chunk_id TEXT,
    risk_level TEXT NOT NULL,
    signal_codes TEXT NOT NULL DEFAULT '[]',
    scanner_version TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    review_decision TEXT,
    reviewed_by TEXT,
    review_reason TEXT,
    reviewed_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_rag_injection_quarantine_tenant
ON rag_injection_quarantine(tenant_id, created_at DESC);
