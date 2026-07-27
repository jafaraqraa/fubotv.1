-- SQLite Schema Migration: 005_rag_fingerprint.sql
-- Add index fingerprint support to RAG indexing state

ALTER TABLE rag_indexing_state ADD COLUMN index_fingerprint TEXT;
