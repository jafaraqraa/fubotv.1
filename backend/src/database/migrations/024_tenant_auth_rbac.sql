CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO tenants (id, name) VALUES ('default', 'Default');
INSERT OR IGNORE INTO tenants (id, name)
SELECT DISTINCT tenant_id, tenant_id FROM conversations WHERE trim(tenant_id) <> '';
INSERT OR IGNORE INTO tenants (id, name)
SELECT DISTINCT tenant_id, tenant_id FROM whatsapp_tenant_configs WHERE trim(tenant_id) <> '';
INSERT OR IGNORE INTO tenants (id, name)
SELECT DISTINCT tenant_id, tenant_id FROM knowledge_documents WHERE trim(tenant_id) <> '';

CREATE TABLE IF NOT EXISTS administrator_tenants (
    administrator_id INTEGER NOT NULL,
    tenant_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin'
        CHECK (role IN ('super_admin', 'admin', 'manager', 'agent', 'viewer')),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (administrator_id, tenant_id),
    FOREIGN KEY (administrator_id) REFERENCES administrators(id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Preserve the behavior of existing single-administrator installations while
-- making the authorization grant explicit and server-controlled.
INSERT OR IGNORE INTO administrator_tenants (administrator_id, tenant_id, role)
SELECT a.id, t.id, 'super_admin' FROM administrators a CROSS JOIN tenants t;

CREATE INDEX IF NOT EXISTS idx_administrator_tenants_tenant
ON administrator_tenants(tenant_id, administrator_id)
WHERE is_active = 1;

CREATE TABLE IF NOT EXISTS security_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER,
    tenant_id TEXT,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    outcome TEXT NOT NULL CHECK (outcome IN ('success', 'denied', 'failure')),
    metadata_json TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (actor_id) REFERENCES administrators(id) ON DELETE SET NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_security_audit_actor_time
ON security_audit_log(actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_audit_tenant_time
ON security_audit_log(tenant_id, created_at DESC);

-- Channel account identifiers can be identical across tenants. Keep the legacy
-- provider identity spine, but isolate every tenant-owned display/profile field.
CREATE TABLE IF NOT EXISTS tenant_channel_profiles (
    tenant_id TEXT NOT NULL,
    channel_account_id TEXT NOT NULL,
    display_name TEXT,
    profile_data TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, channel_account_id),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (channel_account_id) REFERENCES channel_accounts(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO tenant_channel_profiles
    (tenant_id, channel_account_id, display_name, profile_data)
SELECT c.tenant_id, c.channel_account_id, ca.username, ca.profile_data
FROM conversations c
JOIN channel_accounts ca ON ca.id = c.channel_account_id;
