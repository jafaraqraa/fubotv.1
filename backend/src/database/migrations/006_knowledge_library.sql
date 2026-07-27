-- Migration 006: Create Knowledge Documents Library Schema
CREATE TABLE IF NOT EXISTS knowledge_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_key TEXT UNIQUE NOT NULL,
    original_name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    source_type TEXT NOT NULL, -- 'txt', 'markdown', 'pdf', 'manual'
    mime_type TEXT NOT NULL,
    storage_name TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    content_hash TEXT NOT NULL, -- SHA-256 hash of original uploaded file bytes
    extracted_text_hash TEXT NOT NULL, -- SHA-256 of normalized extracted text
    language TEXT NOT NULL DEFAULT 'ar',
    status TEXT NOT NULL, -- 'uploaded', 'processing', 'ready', 'indexing', 'indexed', 'disabled', 'failed', 'deleting'
    is_enabled INTEGER NOT NULL DEFAULT 1, -- 1 = true, 0 = false
    indexing_status TEXT,
    indexing_error TEXT,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    vector_count INTEGER NOT NULL DEFAULT 0,
    index_fingerprint TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    indexed_at DATETIME,
    disabled_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_knowledge_docs_hash ON knowledge_documents(content_hash);
CREATE INDEX IF NOT EXISTS idx_knowledge_docs_text_hash ON knowledge_documents(extracted_text_hash);
CREATE INDEX IF NOT EXISTS idx_knowledge_docs_key ON knowledge_documents(document_key);
CREATE INDEX IF NOT EXISTS idx_knowledge_docs_enabled ON knowledge_documents(is_enabled);
