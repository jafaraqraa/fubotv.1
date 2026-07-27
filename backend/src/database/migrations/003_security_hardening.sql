-- SQLite Schema Migration: 003_security_hardening.sql
-- Persistent Login Rate Limiting (Task 5)

CREATE TABLE IF NOT EXISTS login_rate_limits (
    hashed_ip TEXT PRIMARY KEY,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    lockout_until TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_login_rate_limits_lockout ON login_rate_limits(lockout_until);
