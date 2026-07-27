-- 009_task_based_ai_models.sql

CREATE TABLE IF NOT EXISTS ai_task_configs (
    task TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    api_key_ref TEXT,
    enabled INTEGER DEFAULT 1
);
