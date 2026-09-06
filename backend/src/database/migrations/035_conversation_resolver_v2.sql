CREATE TABLE IF NOT EXISTS conversation_resolver_states (
    tenant_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    active_topic_json TEXT,
    active_entities_json TEXT NOT NULL DEFAULT '[]',
    last_user_intent TEXT,
    pending_action_json TEXT,
    pending_slots_json TEXT NOT NULL DEFAULT '[]',
    last_explicit_user_subject_json TEXT,
    last_answered_subject_json TEXT,
    conversation_summary TEXT NOT NULL DEFAULT '',
    summary_source_range_json TEXT,
    state_version INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, conversation_id, contact_id, channel)
);

CREATE TABLE IF NOT EXISTS conversation_resolver_events (
    event_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    message_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    sequence_number INTEGER NOT NULL,
    event_payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, conversation_id, contact_id, channel, message_id, event_type),
    UNIQUE (tenant_id, conversation_id, contact_id, channel, sequence_number)
);

CREATE INDEX IF NOT EXISTS idx_conversation_resolver_events_scope
ON conversation_resolver_events(tenant_id, conversation_id, contact_id, channel, sequence_number);

CREATE TABLE IF NOT EXISTS conversation_resolver_traces (
    trace_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    conversation_hash TEXT NOT NULL,
    contact_hash TEXT NOT NULL,
    message_id TEXT,
    message_type TEXT NOT NULL,
    intent TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    latency_ms REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
