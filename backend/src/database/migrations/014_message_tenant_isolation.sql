ALTER TABLE conversations ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE messages ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';

DROP INDEX IF EXISTS idx_messages_external;
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_external_tenant
    ON messages(tenant_id, channel, external_message_id)
    WHERE external_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_tenant
    ON conversations(channel_account_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_messages_tenant_conversation
    ON messages(tenant_id, conversation_id, created_at);
