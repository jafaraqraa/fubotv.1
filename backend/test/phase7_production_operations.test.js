const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'phase7-test-session-secret-at-least-32-chars';
process.env.ALLOWED_ORIGINS = 'http://localhost:3001';
process.env.METRICS_TOKEN = 'phase7-test-metrics-token-at-least-32-chars';

const app = require('../src/app');
const metrics = require('../src/observability/runtimeMetrics');
const { fixedWindow, buckets } = require('../src/middleware/rateLimits');
const { redact } = require('../src/services/logger');

let server;
let baseUrl;

test.before(async () => {
    server = http.createServer(app);
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    await new Promise(resolve => server.close(resolve));
});

test('liveness, readiness, request IDs and protected Prometheus metrics are real', async () => {
    metrics.resetForTests();
    const live = await fetch(`${baseUrl}/live`, {
        headers: {
            Origin: 'http://localhost:3001',
            'X-Request-ID': 'phase7-live',
            'X-Correlation-ID': 'phase7-flow'
        }
    });
    assert.equal(live.status, 200);
    assert.equal(live.headers.get('x-request-id'), 'phase7-live');
    assert.equal(live.headers.get('x-correlation-id'), 'phase7-flow');
    assert.equal((await live.json()).status, 'ALIVE');

    const ready = await fetch(`${baseUrl}/ready`);
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).database, 'connected');

    assert.equal((await fetch(`${baseUrl}/internal/metrics`)).status, 401);
    const authorized = await fetch(`${baseUrl}/internal/metrics`, {
        headers: { Authorization: `Bearer ${process.env.METRICS_TOKEN}` }
    });
    assert.equal(authorized.status, 200);
    const output = await authorized.text();
    assert.match(output, /futhing_process_resident_memory_bytes/);
    assert.match(output, /futhing_http_requests_total/);
});

test('local liveness load has no failures and reports a bounded p95', async () => {
    const durations = [];
    const responses = await Promise.all(Array.from({ length: 100 }, async () => {
        const started = performance.now();
        const response = await fetch(`${baseUrl}/live`);
        durations.push(performance.now() - started);
        return response.status;
    }));
    assert.equal(responses.filter(status => status !== 200).length, 0);
    durations.sort((a, b) => a - b);
    const p95 = durations[Math.ceil(durations.length * 0.95) - 1];
    assert.ok(p95 < 2000, `Local /live p95 was ${p95.toFixed(1)}ms`);
});

test('rate limiter returns 429 with retry metadata after the configured limit', () => {
    buckets.clear();
    const limiter = fixedWindow({ name: 'phase7', limit: 2, windowMs: 60_000 });
    const req = { ip: '127.0.0.22', session: { userId: 9 } };
    const headers = {};
    let statusCode;
    let body;
    const res = {
        setHeader(name, value) { headers[name] = value; },
        status(value) { statusCode = value; return this; },
        json(value) { body = value; return this; }
    };
    let passed = 0;
    limiter(req, res, () => { passed += 1; });
    limiter(req, res, () => { passed += 1; });
    limiter(req, res, () => { passed += 1; });
    assert.equal(passed, 2);
    assert.equal(statusCode, 429);
    assert.equal(body.success, false);
    assert.ok(Number(headers['Retry-After']) > 0);
});

test('structured error redaction removes credentials', () => {
    const value = redact(
        'Authorization: Bearer abc.def.secret password=hunter2 api_key=sk-12345678901234567890'
    );
    assert.doesNotMatch(value, /abc\.def\.secret|hunter2|sk-12345678901234567890/);
    assert.match(value, /\[REDACTED\]/);
});

test('backup is atomic, checksum verified and SQLite restore passes integrity checks', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'futhing-phase7-'));
    const destination = path.join(root, 'backup');
    const uploads = path.join(root, 'uploads');
    fs.mkdirSync(uploads);
    fs.writeFileSync(path.join(uploads, 'proof.txt'), 'phase7');
    const environment = {
        ...process.env,
        UPLOADS_DIR: uploads
    };
    const backup = spawnSync(process.execPath, [
        path.join(__dirname, '..', 'scripts', 'production-backup.js'),
        `--output=${destination}`,
        '--skip-qdrant'
    ], { env: environment, encoding: 'utf8' });
    assert.equal(backup.status, 0, backup.stderr || backup.stdout);
    assert.ok(fs.existsSync(path.join(destination, 'manifest.json')));
    assert.ok(fs.existsSync(path.join(destination, 'uploads', 'proof.txt')));
    assert.equal(fs.readdirSync(root).some(name => name.includes('.partial-')), false);

    const verify = spawnSync(process.execPath, [
        path.join(__dirname, '..', 'scripts', 'verify-production-backup.js'),
        destination
    ], { env: environment, encoding: 'utf8' });
    assert.equal(verify.status, 0, verify.stderr || verify.stdout);
    const result = JSON.parse(verify.stdout);
    assert.equal(result.success, true);
    assert.equal(result.integrity, 'ok');
    fs.rmSync(root, { recursive: true, force: true });
});

test('production container definitions are pinned and least-privilege aware', () => {
    const repositoryRoot = path.resolve(__dirname, '..', '..');
    const dockerfile = fs.readFileSync(path.join(repositoryRoot, 'Dockerfile'), 'utf8');
    const compose = fs.readFileSync(
        path.join(repositoryRoot, 'docker-compose.production.yml'),
        'utf8'
    );
    assert.match(dockerfile, /FROM node:22-bookworm-slim AS dependencies/);
    assert.match(dockerfile, /USER node/);
    assert.match(dockerfile, /HEALTHCHECK/);
    assert.match(dockerfile, /ENTRYPOINT \["\/usr\/bin\/tini"/);
    assert.match(compose, /qdrant\/qdrant:v1\.12\.5/);
    assert.match(compose, /127\.0\.0\.1:3001:3001/);
    assert.match(compose, /no-new-privileges:true/);
    assert.match(compose, /stop_grace_period: 45s/);
});
