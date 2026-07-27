-- 011_ai_usage_and_billing.sql

CREATE TABLE IF NOT EXISTS ai_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    task TEXT NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    request_time DATETIME NOT NULL,
    response_time DATETIME NOT NULL,
    duration INTEGER NOT NULL, -- in milliseconds
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    cost REAL DEFAULT 0.0,
    success INTEGER DEFAULT 1, -- 1 for true, 0 for false
    error_message TEXT,
    generation_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS provider_balance_cache (
    provider TEXT PRIMARY KEY,
    current_balance REAL DEFAULT 0.0,
    remaining_balance REAL DEFAULT 0.0,
    usage_data TEXT, -- JSON string for extra fields like limit, resets etc.
    error_message TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);
