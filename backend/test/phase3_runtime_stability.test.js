const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const runtimeState = require('../src/runtime/runtimeState');
const { reliableFetch, isRetryableStatus, isRetryableError } = require('../src/utils/reliableFetch');

test('Phase 3 runtime state and provider reliability', async (t) => {
    const originalFetch = global.fetch;
    t.after(() => {
        global.fetch = originalFetch;
        runtimeState.markReady();
    });

    await t.test('readiness transitions are explicit and shutdown is fail-closed', () => {
        runtimeState.markStarting();
        assert.equal(runtimeState.snapshot().ready, false);
        runtimeState.markReady();
        assert.equal(runtimeState.snapshot().ready, true);
        runtimeState.markShuttingDown('SIGTERM');
        assert.equal(runtimeState.snapshot().ready, false);
        assert.equal(runtimeState.snapshot().reason, 'SIGTERM');
    });

    await t.test('provider timeout aborts the request and remains bounded', async () => {
        let calls = 0;
        global.fetch = (_url, options) => {
            calls += 1;
            return new Promise((_resolve, reject) => {
                options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
            });
        };
        await assert.rejects(
            reliableFetch('https://provider.invalid', {}, { timeoutMs: 10, maxAttempts: 1, baseDelayMs: 1 }),
            error => error.code === 'PROVIDER_TIMEOUT'
        );
        assert.equal(calls, 1);
    });

    await t.test('transient status retries once and then succeeds', async () => {
        let calls = 0;
        global.fetch = async () => new Response('', { status: ++calls === 1 ? 503 : 200 });
        const response = await reliableFetch('https://provider.invalid', {}, {
            timeoutMs: 100, maxAttempts: 2, baseDelayMs: 1
        });
        assert.equal(response.status, 200);
        assert.equal(calls, 2);
    });

    await t.test('permanent 4xx is not retried', async () => {
        let calls = 0;
        global.fetch = async () => {
            calls += 1;
            return new Response('', { status: 401 });
        };
        const response = await reliableFetch('https://provider.invalid', {}, {
            timeoutMs: 100, maxAttempts: 3, baseDelayMs: 1
        });
        assert.equal(response.status, 401);
        assert.equal(calls, 1);
        assert.equal(isRetryableStatus(401), false);
        assert.equal(isRetryableStatus(429), true);
        assert.equal(isRetryableError({ code: 'ECONNRESET' }), true);
    });

    await t.test('aborted caller request is never retried', async () => {
        let calls = 0;
        const controller = new AbortController();
        global.fetch = async (_url, options) => {
            calls += 1;
            controller.abort(new Error('client disconnected'));
            throw options.signal.reason;
        };
        await assert.rejects(
            reliableFetch('https://provider.invalid', { signal: controller.signal }, {
                timeoutMs: 100, maxAttempts: 3, baseDelayMs: 1
            }),
            /client disconnected/
        );
        assert.equal(calls, 1);
    });
});

test('HTTP server request timeout is configured and closable', async () => {
    const server = http.createServer((_req, _res) => {});
    server.requestTimeout = 25;
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    assert.equal(server.requestTimeout, 25);
    await new Promise(resolve => server.close(resolve));
});
