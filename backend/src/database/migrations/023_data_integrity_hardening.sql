-- Phase 5: corrective, additive integrity hardening.
-- Existing rows are repaired conservatively before future writes are guarded.

ALTER TABLE schema_migrations ADD COLUMN checksum TEXT;

UPDATE conversations
SET last_message_at = COALESCE(
    (SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = conversations.id),
    updated_at,
    created_at,
    CURRENT_TIMESTAMP
)
WHERE datetime(last_message_at) IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_tenant_activity
ON conversations(tenant_id, last_message_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_messages_tenant_activity
ON messages(tenant_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_ai_usage_tenant_request
ON ai_usage(tenant_id, request_time DESC, id);

CREATE INDEX IF NOT EXISTS idx_api_keys_provider_enabled
ON api_keys(provider, enabled, updated_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_messages_scope_insert
BEFORE INSERT ON messages
WHEN EXISTS (SELECT 1 FROM conversations WHERE id = NEW.conversation_id)
 AND NOT EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = NEW.conversation_id
      AND c.tenant_id = NEW.tenant_id
      AND c.channel = NEW.channel
 )
BEGIN
    SELECT RAISE(ABORT, 'MESSAGE_SCOPE_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_messages_scope_update
BEFORE UPDATE OF conversation_id, tenant_id, channel ON messages
WHEN EXISTS (SELECT 1 FROM conversations WHERE id = NEW.conversation_id)
 AND NOT EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = NEW.conversation_id
      AND c.tenant_id = NEW.tenant_id
      AND c.channel = NEW.channel
 )
BEGIN
    SELECT RAISE(ABORT, 'MESSAGE_SCOPE_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_messages_values_insert
BEFORE INSERT ON messages
WHEN NEW.direction NOT IN ('inbound', 'outbound')
  OR NEW.role NOT IN ('user', 'assistant', 'system')
  OR NEW.delivery_status NOT IN ('pending', 'sending', 'sent', 'delivered', 'failed', 'read')
  OR NEW.is_internal_note NOT IN (0, 1)
  OR NEW.is_ai_generated NOT IN (0, 1)
  OR NEW.is_read NOT IN (0, 1)
  OR (NEW.metadata IS NOT NULL AND json_valid(NEW.metadata) = 0)
BEGIN
    SELECT RAISE(ABORT, 'INVALID_MESSAGE_DATA');
END;

CREATE TRIGGER IF NOT EXISTS trg_messages_values_update
BEFORE UPDATE ON messages
WHEN NEW.direction NOT IN ('inbound', 'outbound')
  OR NEW.role NOT IN ('user', 'assistant', 'system')
  OR NEW.delivery_status NOT IN ('pending', 'sending', 'sent', 'delivered', 'failed', 'read')
  OR NEW.is_internal_note NOT IN (0, 1)
  OR NEW.is_ai_generated NOT IN (0, 1)
  OR NEW.is_read NOT IN (0, 1)
  OR (NEW.metadata IS NOT NULL AND json_valid(NEW.metadata) = 0)
BEGIN
    SELECT RAISE(ABORT, 'INVALID_MESSAGE_DATA');
END;

CREATE TRIGGER IF NOT EXISTS trg_conversations_scope_insert
BEFORE INSERT ON conversations
WHEN NOT EXISTS (
    SELECT 1 FROM channel_accounts ca
    WHERE ca.id = NEW.channel_account_id
      AND ca.customer_id = NEW.customer_id
      AND ca.channel = NEW.channel
)
BEGIN
    SELECT RAISE(ABORT, 'CONVERSATION_SCOPE_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_conversations_scope_update
BEFORE UPDATE OF customer_id, channel_account_id, channel ON conversations
WHEN NOT EXISTS (
    SELECT 1 FROM channel_accounts ca
    WHERE ca.id = NEW.channel_account_id
      AND ca.customer_id = NEW.customer_id
      AND ca.channel = NEW.channel
)
BEGIN
    SELECT RAISE(ABORT, 'CONVERSATION_SCOPE_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_conversations_values_insert
BEFORE INSERT ON conversations
WHEN NEW.tenant_id = ''
  OR NEW.status NOT IN ('active', 'closed', 'archived')
  OR NEW.is_ai_enabled NOT IN (0, 1)
  OR NEW.unread_count < 0
BEGIN
    SELECT RAISE(ABORT, 'INVALID_CONVERSATION_DATA');
END;

CREATE TRIGGER IF NOT EXISTS trg_conversations_values_update
BEFORE UPDATE ON conversations
WHEN NEW.tenant_id = ''
  OR NEW.status NOT IN ('active', 'closed', 'archived')
  OR NEW.is_ai_enabled NOT IN (0, 1)
  OR NEW.unread_count < 0
BEGIN
    SELECT RAISE(ABORT, 'INVALID_CONVERSATION_DATA');
END;

CREATE TRIGGER IF NOT EXISTS trg_api_keys_values_insert
BEFORE INSERT ON api_keys
WHEN trim(NEW.friendly_name) = ''
  OR trim(NEW.provider) = ''
  OR trim(NEW.api_key) = ''
  OR NEW.enabled NOT IN (0, 1)
  OR NEW.limits_available NOT IN (0, 1)
  OR (NEW.capabilities IS NOT NULL AND json_valid(NEW.capabilities) = 0)
  OR (NEW.source IS NOT NULL AND json_valid(NEW.source) = 0)
BEGIN
    SELECT RAISE(ABORT, 'INVALID_API_KEY_DATA');
END;

CREATE TRIGGER IF NOT EXISTS trg_api_keys_values_update
BEFORE UPDATE ON api_keys
WHEN trim(NEW.friendly_name) = ''
  OR trim(NEW.provider) = ''
  OR trim(NEW.api_key) = ''
  OR NEW.enabled NOT IN (0, 1)
  OR NEW.limits_available NOT IN (0, 1)
  OR (NEW.capabilities IS NOT NULL AND json_valid(NEW.capabilities) = 0)
  OR (NEW.source IS NOT NULL AND json_valid(NEW.source) = 0)
BEGIN
    SELECT RAISE(ABORT, 'INVALID_API_KEY_DATA');
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_usage_values_insert
BEFORE INSERT ON ai_usage
WHEN NEW.duration < 0
  OR NEW.input_tokens < 0
  OR NEW.output_tokens < 0
  OR NEW.total_tokens < 0
  OR NEW.cost < 0
  OR NEW.success NOT IN (0, 1)
  OR trim(NEW.tenant_id) = ''
BEGIN
    SELECT RAISE(ABORT, 'INVALID_AI_USAGE_DATA');
END;

CREATE TRIGGER IF NOT EXISTS trg_whatsapp_config_values_insert
BEFORE INSERT ON whatsapp_tenant_configs
WHEN trim(NEW.tenant_id) = ''
  OR NEW.provider_type NOT IN ('web', 'cloud')
  OR NEW.enabled NOT IN (0, 1)
  OR json_valid(NEW.config_json) = 0
BEGIN
    SELECT RAISE(ABORT, 'INVALID_WHATSAPP_CONFIG');
END;

CREATE TRIGGER IF NOT EXISTS trg_whatsapp_config_values_update
BEFORE UPDATE ON whatsapp_tenant_configs
WHEN trim(NEW.tenant_id) = ''
  OR NEW.provider_type NOT IN ('web', 'cloud')
  OR NEW.enabled NOT IN (0, 1)
  OR json_valid(NEW.config_json) = 0
BEGIN
    SELECT RAISE(ABORT, 'INVALID_WHATSAPP_CONFIG');
END;
