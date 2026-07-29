CREATE TABLE IF NOT EXISTS webhook_replay_guard (
    replay_key TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_webhook_replay_expiry
ON webhook_replay_guard(expires_at);
