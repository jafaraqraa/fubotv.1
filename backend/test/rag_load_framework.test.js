const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const {
    assertSafeTarget, percentile, validateResult, run
} = require('../scripts/rag-load-runner');

test('RAG load framework safety and calculations', async t => {
    await t.test('local target is accepted', () =>
        assert.doesNotThrow(() => assertSafeTarget('http://127.0.0.1:3001', false)));

    await t.test('remote target is rejected by default', () =>
        assert.throws(() => assertSafeTarget('https://production.example', false),
            /RAG_LOAD_ALLOW_REMOTE/));

    await t.test('mutation scenario requires explicit opt-in', () =>
        assert.throws(() => assertSafeTarget('http://localhost:3001', true),
            /RAG_LOAD_ALLOW_MUTATIONS/));

    await t.test('nearest-rank percentiles use real samples', () => {
        assert.strictEqual(percentile([1, 2, 3, 4, 100], 0.50), 3);
        assert.strictEqual(percentile([1, 2, 3, 4, 100], 0.95), 100);
        assert.strictEqual(percentile([], 0.95), null);
    });

    await t.test('retrieval requires a successful answer contract', () => {
        assert.strictEqual(validateResult({ scenario: 'retrieval' }, {
            ok: true, body: { success: true, finalAnswer: 'verified' }
        }), true);
        assert.strictEqual(validateResult({ scenario: 'retrieval' }, {
            ok: true, body: { success: true }
        }), false);
    });

    await t.test('indexing success requires an active version with chunks', () => {
        assert.strictEqual(validateResult({ scenario: 'indexing' }, {
            ok: true, body: { success: true, status: 'active', chunkCount: 2 }
        }), true);
        assert.strictEqual(validateResult({ scenario: 'indexing' }, {
            ok: true, body: { success: true, status: 'staging', chunkCount: 2 }
        }), false);
    });

    await t.test('metrics response enforces tenant identity', () => {
        assert.strictEqual(validateResult({ scenario: 'metrics', tenantId: 'a' }, {
            ok: true, body: { success: true, metrics: { tenantId: 'a' } }
        }), true);
        assert.strictEqual(validateResult({ scenario: 'metrics', tenantId: 'a' }, {
            ok: true, body: { success: true, metrics: { tenantId: 'b' } }
        }), false);
    });

    await t.test('CI load smoke executes concurrent authenticated requests', async () => {
        const server = http.createServer((req, res) => {
            res.setHeader('Content-Type', 'application/json');
            if (req.url === '/api/auth/login') {
                return res.end(JSON.stringify({ success: true, sessionId: 'test-session' }));
            }
            if (req.url === '/api/auth/csrf-token') {
                return res.end(JSON.stringify({ success: true, csrfToken: 'a'.repeat(64) }));
            }
            if (req.url === '/api/rag/status') {
                return res.end(JSON.stringify({ success: true, status: { retrievalMode: 'NORMAL' } }));
            }
            return res.end(JSON.stringify({ success: true, finalAnswer: 'verified answer' }));
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const previousUser = process.env.RAG_LOAD_USERNAME;
        const previousPassword = process.env.RAG_LOAD_PASSWORD;
        process.env.RAG_LOAD_USERNAME = 'test';
        process.env.RAG_LOAD_PASSWORD = 'test';
        try {
            const address = server.address();
            const report = await run({
                baseUrl: `http://127.0.0.1:${address.port}`,
                scenario: 'mixed',
                concurrency: 10,
                requests: 100,
                timeoutMs: 1000,
                tenantId: 'default',
                questions: ['test'],
                minAvailability: 1,
                maxErrorRate: 0,
                maxP95Ms: 1000,
                maxP99Ms: 1000
            });
            assert.strictEqual(report.results.requests, 100);
            assert.strictEqual(report.results.failed, 0);
            assert.strictEqual(report.acceptance.passed, true);
            assert.ok(report.results.throughputRps > 0);
        } finally {
            if (previousUser === undefined) delete process.env.RAG_LOAD_USERNAME;
            else process.env.RAG_LOAD_USERNAME = previousUser;
            if (previousPassword === undefined) delete process.env.RAG_LOAD_PASSWORD;
            else process.env.RAG_LOAD_PASSWORD = previousPassword;
            await new Promise(resolve => server.close(resolve));
        }
    });
});
