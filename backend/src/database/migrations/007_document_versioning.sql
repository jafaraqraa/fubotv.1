-- Migration 007: Add version column to knowledge_documents table for document versioning
ALTER TABLE knowledge_documents ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
