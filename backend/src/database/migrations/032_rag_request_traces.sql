CREATE TABLE IF NOT EXISTS rag_request_traces (
    request_id TEXT PRIMARY KEY,
    message_id TEXT,
    tenant_id TEXT NOT NULL,
    conversation_id TEXT,
    route TEXT,
    intent TEXT,
    retrieval_query TEXT,
    retrieved_chunks_json TEXT NOT NULL DEFAULT '[]',
    selected_context_chunk_ids_json TEXT NOT NULL DEFAULT '[]',
    evidence_gate_decision TEXT,
    evidence_gate_reason TEXT,
    raw_model_output TEXT,
    claims_json TEXT NOT NULL DEFAULT '[]',
    boundary_decision TEXT,
    boundary_reasons_json TEXT NOT NULL DEFAULT '[]',
    enforcement_active INTEGER,
    fallback_source TEXT,
    final_response_type TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_rag_request_traces_tenant_created
ON rag_request_traces(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rag_request_traces_message
ON rag_request_traces(message_id);
