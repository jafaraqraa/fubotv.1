CREATE TABLE IF NOT EXISTS tenant_entity_catalogs (
 tenant_id TEXT NOT NULL, catalog_version TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN('building','active','retired')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(tenant_id,catalog_version));
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_active_catalog ON tenant_entity_catalogs(tenant_id) WHERE status='active';
CREATE TABLE IF NOT EXISTS tenant_catalog_entities (
 tenant_id TEXT NOT NULL, catalog_version TEXT NOT NULL, entity_id TEXT NOT NULL, canonical_name TEXT NOT NULL, display_name TEXT NOT NULL,
 normalized_name TEXT NOT NULL, entity_type TEXT NOT NULL, aliases_json TEXT NOT NULL DEFAULT '[]', parent_entity_id TEXT, related_entity_ids_json TEXT NOT NULL DEFAULT '[]',
 status TEXT NOT NULL CHECK(status IN('active','inactive','conflicted')), valid_from TEXT, valid_to TEXT, attributes_json TEXT NOT NULL DEFAULT '{}',
 source_type TEXT NOT NULL CHECK(source_type IN('database','configuration','knowledge','api')), source_id TEXT NOT NULL, source_version_id TEXT,
 authority TEXT NOT NULL CHECK(authority IN('authoritative','informational')), allowed_actions_json TEXT NOT NULL DEFAULT '[]', supporting_chunk_ids_json TEXT NOT NULL DEFAULT '[]', exact_source_wording TEXT,
 PRIMARY KEY(tenant_id,catalog_version,entity_id), FOREIGN KEY(tenant_id,catalog_version) REFERENCES tenant_entity_catalogs(tenant_id,catalog_version));
CREATE INDEX IF NOT EXISTS idx_catalog_entity_lookup ON tenant_catalog_entities(tenant_id,catalog_version,status,normalized_name);
CREATE TABLE IF NOT EXISTS tenant_business_capabilities (
 tenant_id TEXT NOT NULL, capability_id TEXT NOT NULL, intent TEXT NOT NULL, supported_entity_types_json TEXT NOT NULL DEFAULT '[]', supported_entity_ids_json TEXT NOT NULL DEFAULT '[]',
 required_slots_json TEXT NOT NULL DEFAULT '[]', optional_slots_json TEXT NOT NULL DEFAULT '[]', confirmation_required INTEGER NOT NULL DEFAULT 1,
 execution_mode TEXT NOT NULL CHECK(execution_mode IN('api','database','ticket','human_handoff','informational','unsupported')), handler TEXT NOT NULL,
 permissions_json TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 0, version TEXT NOT NULL, source TEXT NOT NULL CHECK(source IN('tenant_configuration','business_system')),
 PRIMARY KEY(tenant_id,capability_id,version));
CREATE INDEX IF NOT EXISTS idx_capabilities_active ON tenant_business_capabilities(tenant_id,intent,enabled);
CREATE TABLE IF NOT EXISTS tenant_business_action_audit (
 action_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, conversation_id TEXT NOT NULL, contact_id TEXT NOT NULL, message_id TEXT NOT NULL,
 capability_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, status TEXT NOT NULL, request_json TEXT NOT NULL DEFAULT '{}', result_json TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,idempotency_key));
CREATE TABLE IF NOT EXISTS conversation_resolver_shadow_traces (
 trace_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, conversation_hash TEXT NOT NULL, contact_hash TEXT NOT NULL, message_id TEXT,
 decision_json TEXT NOT NULL, latency_ms REAL NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_shadow_trace_retention ON conversation_resolver_shadow_traces(created_at);
