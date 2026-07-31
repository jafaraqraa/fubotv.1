const test = require('node:test');
const assert = require('node:assert');

const {
    requireSessionSecret,
    validateProductionSecurityConfig
} = require('../src/config/securityConfig');

function withEnvironment(values, callback) {
    const previous = {};
    for (const [key, value] of Object.entries(values)) {
        previous[key] = process.env[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    try {
        return callback();
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

test('security configuration fails closed', async (t) => {
    await t.test('missing session secret is rejected in every environment', () => {
        withEnvironment({ SESSION_SECRET: undefined, NODE_ENV: 'development' }, () => {
            assert.throws(requireSessionSecret, error => error.code === 'INVALID_SESSION_SECRET');
        });
    });

    await t.test('short session secret is rejected', () => {
        withEnvironment({ SESSION_SECRET: 'short' }, () => {
            assert.throws(requireSessionSecret, error => error.code === 'INVALID_SESSION_SECRET');
        });
    });

    await t.test('production requires an authenticated Qdrant configuration', () => {
        withEnvironment({
            NODE_ENV: 'production',
            SESSION_SECRET: 'production_session_secret_at_least_32_chars',
            QDRANT_API_KEY: undefined
        }, () => {
            assert.throws(
                validateProductionSecurityConfig,
                error => error.code === 'INSECURE_QDRANT_CONFIGURATION'
            );
        });
    });

    await t.test('strong production security configuration is accepted', () => {
        withEnvironment({
            NODE_ENV: 'production',
            SESSION_SECRET: 'production_session_secret_at_least_32_chars',
            QDRANT_API_KEY: 'production_qdrant_api_key_at_least_32_chars',
            METRICS_TOKEN: 'production_metrics_token_at_least_32_chars'
        }, () => {
            assert.strictEqual(validateProductionSecurityConfig(), true);
        });
    });

    await t.test('production forbids browser-readable session token fallback', () => {
        withEnvironment({
            NODE_ENV: 'production',
            SESSION_SECRET: 'production_session_secret_at_least_32_chars',
            QDRANT_API_KEY: 'production_qdrant_api_key_at_least_32_chars',
            METRICS_TOKEN: 'production_metrics_token_at_least_32_chars',
            ALLOW_SESSION_TOKEN_FALLBACK: 'true'
        }, () => {
            assert.throws(
                validateProductionSecurityConfig,
                error => error.code === 'INSECURE_SESSION_TOKEN_FALLBACK'
            );
        });
    });
});
