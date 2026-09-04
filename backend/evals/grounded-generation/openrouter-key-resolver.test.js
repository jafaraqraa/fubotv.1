'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { fingerprint, resolveOpenRouterEvaluationKey } = require('./openrouter-key-resolver');

function registry(rows = []) {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE api_keys (id INTEGER PRIMARY KEY, provider TEXT, api_key TEXT, enabled INTEGER, created_at TEXT)');
    const insert = db.prepare('INSERT INTO api_keys VALUES (@id,@provider,@api_key,@enabled,@created_at)');
    for (const row of rows) insert.run(row);
    return db;
}
const row = (id, key, enabled, created) => ({ id, provider: 'openrouter', api_key: key, enabled, created_at: created });

test('explicit runtime ENV key has priority over DB', () => {
    const db = registry([row(1, 'db-key', 1, '2026-01-01')]);
    const result = resolveOpenRouterEvaluationKey({ explicitEnvKey: 'runtime-key', db });
    assert.equal(result.source, 'ENV_EXPLICIT'); assert.equal(result.key, 'runtime-key');
});

test('active DB key is selected when explicit ENV is absent', () => {
    const db = registry([row(7, 'active-key', 1, '2026-01-01')]);
    const result = resolveOpenRouterEvaluationKey({ explicitEnvKey: '', db });
    assert.equal(result.source, 'DB_ACTIVE_PROVIDER:7'); assert.equal(result.key, 'active-key');
});

test('disabled key is ignored', () => {
    const db = registry([row(1, 'disabled-key', 0, '2026-02-01'), row(2, 'active-key', 1, '2026-01-01')]);
    assert.equal(resolveOpenRouterEvaluationKey({ explicitEnvKey: '', db }).key, 'active-key');
});

test('older active key is ignored in favor of production-compatible newest active key', () => {
    const db = registry([row(1, 'old-key', 1, '2025-01-01'), row(2, 'new-key', 1, '2026-01-01')]);
    assert.equal(resolveOpenRouterEvaluationKey({ explicitEnvKey: '', db }).key, 'new-key');
});

test('missing valid candidate fails fast', () => {
    const db = registry([row(1, 'disabled-key', 0, '2026-01-01')]);
    assert.throws(() => resolveOpenRouterEvaluationKey({ explicitEnvKey: '', db }), /OPENROUTER_ACTIVE_KEY_NOT_FOUND/);
});

test('fingerprint is deterministic, short, and does not expose the key', () => {
    const secret = 'secret-full-api-key'; const first = fingerprint(secret);
    assert.equal(first, fingerprint(secret)); assert.equal(first.length, 12); assert.equal(first.includes(secret), false);
});
