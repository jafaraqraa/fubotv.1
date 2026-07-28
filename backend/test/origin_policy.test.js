const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const WebSocket = require('ws');

const testDbPath = path.resolve(__dirname, '..', 'data', 'test_origin_policy.db');
process.env.SQLITE_DB_PATH = testDbPath;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'origin-policy-test-secret';
process.env.INITIAL_ADMIN_USERNAME = 'origin_admin';
process.env.INITIAL_ADMIN_PASSWORD = 'OriginPolicy@123';
process.env.ALLOWED_ORIGINS = ' http://localhost:5173/ ,https://app.example.com/,http://localhost:5173 ';
process.env.FRONTEND_ORIGIN = 'http://127.0.0.1:3000/';
for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
}

const { initializeDatabase } = require('../src/database/initialize');
initializeDatabase();
const { bootstrapAdminAccount } = require('../src/services/adminBootstrap');
bootstrapAdminAccount();
const app = require('../src/app');
const db = require('../src/database/connection');
const { initializeSocketServer } = require('../src/realtime/socketServer');
const { getOriginPolicy, parseAllowedOrigins } = require('../src/security/originPolicy');

function websocketAttempt(url, options) {
    return new Promise(resolve => {
        const ws = new WebSocket(url, options);
        ws.once('open', () => {
            ws.close();
            resolve({ opened: true });
        });
        ws.once('unexpected-response', (_request, response) => {
            resolve({ opened: false, statusCode: response.statusCode });
        });
        ws.once('error', error => resolve({ opened: false, error }));
    });
}

test('shared Express and Socket.IO origin policy', async t => {
    assert.strictEqual(app.originPolicy, getOriginPolicy());
    assert.deepEqual(
        [...parseAllowedOrigins(process.env)].sort(),
        ['http://127.0.0.1:3000', 'http://localhost:5173', 'https://app.example.com']
    );

    const server = http.createServer(app);
    const io = initializeSocketServer(server);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    t.after(async () => {
        await new Promise(resolve => io.close(resolve));
        if (server.listening) await new Promise(resolve => server.close(resolve));
        db.close();
        for (const suffix of ['', '-wal', '-shm']) {
            if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
        }
    });

    await t.test('allowed origin and credential headers are explicit', async () => {
        const response = await fetch(`${baseUrl}/health`, { headers: { Origin: 'http://localhost:5173/' } });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
        assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
        assert.notEqual(response.headers.get('access-control-allow-origin'), '*');
    });

    await t.test('unauthorized browser origin is rejected', async () => {
        const response = await fetch(`${baseUrl}/health`, { headers: { Origin: 'https://evil.example' } });
        assert.equal(response.status, 403);
        assert.equal(response.headers.get('access-control-allow-origin'), null);
    });

    await t.test('missing Origin remains valid for server health checks', async () => {
        const response = await fetch(`${baseUrl}/health`);
        assert.equal(response.status, 200);
    });

    await t.test('OPTIONS preflight returns exact policy headers', async () => {
        const response = await fetch(`${baseUrl}/api/v1/stats`, {
            method: 'OPTIONS',
            headers: {
                Origin: 'https://app.example.com',
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'Content-Type,X-CSRF-Token'
            }
        });
        assert.equal(response.status, 204);
        assert.equal(response.headers.get('access-control-allow-origin'), 'https://app.example.com');
        assert.match(response.headers.get('access-control-allow-methods'), /OPTIONS/);
        assert.match(response.headers.get('access-control-allow-headers'), /X-CSRF-Token/);
    });

    const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-proto': 'https' },
        body: JSON.stringify({ username: 'admin', password: 'Admin@123456' })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];

    await t.test('Socket.IO polling accepts allowed and rejects unauthorized origins', async () => {
        const allowed = await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling`, {
            headers: { Origin: 'https://app.example.com', Cookie: cookie }
        });
        assert.equal(allowed.status, 200);
        assert.match(await allowed.text(), /"sid":/);

        const rejected = await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling`, {
            headers: { Origin: 'https://evil.example', Cookie: cookie }
        });
        assert.notEqual(rejected.status, 200);
    });

    await t.test('WebSocket transport accepts allowed and rejects unauthorized origins', async () => {
        const socketUrl = `ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`;
        const allowed = await websocketAttempt(socketUrl, {
            origin: 'https://app.example.com',
            headers: { Cookie: cookie }
        });
        assert.equal(allowed.opened, true);

        const rejected = await websocketAttempt(socketUrl, {
            origin: 'https://evil.example',
            headers: { Cookie: cookie }
        });
        assert.equal(rejected.opened, false);
        assert.notEqual(rejected.statusCode, 101);
    });
});

test('production startup fails without configured origins', () => {
    const script = "require('./backend/src/app')";
    const result = spawnSync(process.execPath, ['-e', script], {
        cwd: path.resolve(__dirname, '..', '..'),
        env: { ...process.env, NODE_ENV: 'production', ALLOWED_ORIGINS: '', FRONTEND_ORIGIN: '' },
        encoding: 'utf8'
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}${result.stdout}`, /Production startup refused/);
});
