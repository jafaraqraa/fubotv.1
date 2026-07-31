ALTER TABLE knowledge_documents ADD COLUMN media_description TEXT;
ALTER TABLE knowledge_documents ADD COLUMN ai_send_enabled INTEGER NOT NULL DEFAULT 0
    CHECK(ai_send_enabled IN (0, 1));

CREATE INDEX idx_knowledge_rag_images
ON knowledge_documents(tenant_id, ai_send_enabled, is_active, status)
WHERE source_type IN ('jpg', 'jpeg', 'png', 'webp');
