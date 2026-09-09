ALTER TABLE knowledge_documents ADD COLUMN platform_document_id TEXT;
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_platform_id
ON knowledge_documents(tenant_id, platform_document_id);
