-- 013_multiple_api_keys_management.sql

CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    friendly_name TEXT NOT NULL,
    provider TEXT NOT NULL,
    api_key TEXT NOT NULL,
    api_key_hash TEXT UNIQUE NOT NULL,
    enabled INTEGER DEFAULT 1,
    limits_available INTEGER DEFAULT 0,
    capabilities TEXT, -- JSON string
    current_balance REAL DEFAULT 0.0,
    remaining_balance REAL DEFAULT 0.0,
    limit_val REAL DEFAULT 0.0,
    usage_val REAL DEFAULT 0.0,
    billing_period TEXT,
    reset_date TEXT,
    source TEXT, -- JSON string
    last_sync_success TEXT,
    last_sync_failed TEXT,
    error_message TEXT,
    next_sync TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for searching key hashes quickly
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(api_key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_provider ON api_keys(provider);
