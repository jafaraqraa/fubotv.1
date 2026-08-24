DROP INDEX IF EXISTS idx_knowledge_rag_images;

CREATE INDEX idx_knowledge_rag_media
ON knowledge_documents(tenant_id, ai_send_enabled, is_active, status)
WHERE source_type IN ('jpg', 'jpeg', 'png', 'webp', 'mp3', 'ogg', 'wav', 'm4a');
