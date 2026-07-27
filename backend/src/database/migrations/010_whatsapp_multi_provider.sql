-- 010_whatsapp_multi_provider.sql

CREATE TABLE IF NOT EXISTS whatsapp_tenant_configs (
    tenant_id TEXT PRIMARY KEY,
    provider_type TEXT NOT NULL DEFAULT 'web',
    config_json TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
