'use strict';
const crypto = require('node:crypto');
const { decryptSecret } = require('../../src/security/credentialCrypto');

function fingerprint(key) {
    if (!key) return null;
    return crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 12);
}

function resolveOpenRouterEvaluationKey({ explicitEnvKey, db }) {
    if (explicitEnvKey) {
        return { key: explicitEnvKey, source: 'ENV_EXPLICIT', fingerprint: fingerprint(explicitEnvKey) };
    }
    const row = db.prepare(`
        SELECT id, api_key FROM api_keys
        WHERE LOWER(provider) = 'openrouter' AND enabled = 1
        ORDER BY created_at DESC LIMIT 1
    `).get();
    if (!row?.api_key) throw new Error('OPENROUTER_ACTIVE_KEY_NOT_FOUND');
    const key = decryptSecret(row.api_key);
    if (!key) throw new Error('OPENROUTER_ACTIVE_KEY_NOT_FOUND');
    return { key, source: `DB_ACTIVE_PROVIDER:${row.id}`, fingerprint: fingerprint(key) };
}

module.exports = { fingerprint, resolveOpenRouterEvaluationKey };
