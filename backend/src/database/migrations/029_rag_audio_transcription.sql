ALTER TABLE knowledge_documents ADD COLUMN media_transcript TEXT;
ALTER TABLE knowledge_documents ADD COLUMN media_analysis_model TEXT;

CREATE INDEX idx_knowledge_audio_analysis
ON knowledge_documents(tenant_id, source_type, media_analysis_model)
WHERE source_type IN ('mp3', 'ogg', 'wav', 'm4a') AND is_active = 1;
