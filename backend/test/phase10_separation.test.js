const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

// Load App
const app = require('../src/app');

test('Phase 10 Frontend-Backend Separation & Security Suite', async (t) => {
    const server = http.createServer(app);
    const listenServer = server.listen(0);
    const port = listenServer.address().port;
    const baseUrl = `http://localhost:${port}`;

    t.after(() => {
        listenServer.close();
    });

    await t.test('1. Health and ready endpoints return safe status', async () => {
        const resHealth = await fetch(`${baseUrl}/health`);
        assert.strictEqual(resHealth.status, 200, 'Health check must return 200 OK');
        const dataHealth = await resHealth.json();
        assert.strictEqual(dataHealth.status, 'OK', 'Health status must be OK');
        assert.ok(dataHealth.uptime !== undefined, 'Health check must include uptime');
        assert.strictEqual(dataHealth.database, undefined, 'Health check must not expose database details');

        const resReady = await fetch(`${baseUrl}/ready`);
        assert.strictEqual(resReady.status, 200, 'Readiness check must return 200 OK');
        const dataReady = await resReady.json();
        assert.strictEqual(dataReady.status, 'READY', 'Readiness status must be READY');
        assert.strictEqual(dataReady.database, 'connected', 'Readiness database status must be connected');
        assert.strictEqual(dataReady.path, undefined, 'Readiness check must not expose database paths');
    });

    await t.test('2. CORS accepts trusted frontend origin in development mode', async () => {
        process.env.NODE_ENV = 'development';
        delete process.env.FRONTEND_ORIGIN;
        const res = await fetch(`${baseUrl}/health`, {
            headers: {
                'Origin': 'http://localhost:5173'
            }
        });
        assert.strictEqual(res.headers.get('access-control-allow-origin'), 'http://localhost:5173', 'CORS must allow trusted localhost port in development fallback');
        assert.strictEqual(res.headers.get('access-control-allow-credentials'), 'true', 'CORS must allow credentials');
    });

    await t.test('3. CORS rejects arbitrary untrusted origins', async () => {
        process.env.FRONTEND_ORIGIN = 'https://dashboard.example.com';
        const res = await fetch(`${baseUrl}/health`, {
            headers: {
                'Origin': 'http://untrusted-attacker.com'
            }
        });
        assert.strictEqual(res.headers.get('access-control-allow-origin'), null, 'CORS must not allow untrusted origins');
        delete process.env.FRONTEND_ORIGIN;
    });

    await t.test('4. CORS enforces configured FRONTEND_ORIGIN and blocks localhost fallback in production mode', async () => {
        process.env.NODE_ENV = 'production';
        process.env.FRONTEND_ORIGIN = 'https://dashboard.example.com';

        // Allowed origin:
        const resAllowed = await fetch(`${baseUrl}/health`, {
            headers: {
                'Origin': 'https://dashboard.example.com'
            }
        });
        assert.strictEqual(resAllowed.headers.get('access-control-allow-origin'), 'https://dashboard.example.com', 'CORS must allow explicitly configured FRONTEND_ORIGIN in production');

        // Rejected development origin in production:
        const resRejected = await fetch(`${baseUrl}/health`, {
            headers: {
                'Origin': 'http://localhost:5173'
            }
        });
        assert.strictEqual(resRejected.headers.get('access-control-allow-origin'), null, 'CORS must block localhost fallback in production mode');

        // Clean up env vars
        process.env.NODE_ENV = 'development';
        delete process.env.FRONTEND_ORIGIN;
    });

    await t.test('5. Versioned and legacy auth routes are registered and return 401 for unauthenticated clients', async () => {
        // Versioned
        const resV1 = await fetch(`${baseUrl}/api/v1/stats`);
        assert.strictEqual(resV1.status, 401, 'Versioned API must reject unauthenticated request with 401');

        // Legacy
        const resLegacy = await fetch(`${baseUrl}/api/stats`);
        assert.strictEqual(resLegacy.status, 401, 'Legacy API must reject unauthenticated request with 401');
    });

    await t.test('6. Public Meta webhook is public and signature-protected', async () => {
        const res = await fetch(`${baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=test`);
        assert.strictEqual(res.status, 403, 'Meta webhook verification should return 403 with wrong verify token');
    });
});
