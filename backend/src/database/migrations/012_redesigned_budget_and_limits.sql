-- 012_redesigned_budget_and_limits.sql

CREATE TABLE IF NOT EXISTS api_key_balances (
    api_key_hash TEXT PRIMARY KEY,
    key_ref TEXT,
    provider TEXT NOT NULL,
    masked_key TEXT NOT NULL,
    limits_available INTEGER DEFAULT 0,
    current_balance REAL DEFAULT 0.0,
    remaining_balance REAL DEFAULT 0.0,
    limit_val REAL DEFAULT 0.0,
    usage_val REAL DEFAULT 0.0,
    billing_period TEXT,
    reset_date TEXT,
    usage_data TEXT, -- JSON string for all other properties
    error_message TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Track actual usage per key_hash in ai_usage table
-- We add an api_key_hash column to ai_usage so that requests can map to their respective key_hash
ALTER TABLE ai_usage ADD COLUMN api_key_hash TEXT;
