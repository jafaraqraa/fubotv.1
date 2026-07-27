-- SQLite Schema Migration: 004_rag_foundation.sql
-- Vector Infrastructure & RAG Indexing State Persistence

CREATE TABLE IF NOT EXISTS rag_indexing_state (
    document_id TEXT PRIMARY KEY,
    document_hash TEXT NOT NULL,
    source TEXT NOT NULL,
    last_status TEXT NOT NULL,
    last_success_at TEXT,
    last_duration_ms INTEGER,
    total_chunks INTEGER,
    last_error TEXT,
    collection_name TEXT,
    embedding_model TEXT,
    chunk_size INTEGER,
    chunk_overlap INTEGER,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
