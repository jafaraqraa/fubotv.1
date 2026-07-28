const assert = require('assert');
const { EventEmitter } = require('events');
const { test } = require('node:test');

process.env.NODE_ENV = 'test';
process.env.RAG_OLLAMA_EMBED_TIMEOUT_MS = '20';
process.env.RAG_OLLAMA_HEALTH_TIMEOUT_MS = '20';
process.env.RAG_QDRANT_SEARCH_TIMEOUT_MS = '20';
process.env.RAG_QDRANT_COUNT_TIMEOUT_MS = '20';
process.env.RAG_QDRANT_UPLOAD_TIMEOUT_MS = '20';
process.env.RAG_QDRANT_DELETE_TIMEOUT_MS = '20';
process.env.RAG_QDRANT_SCROLL_TIMEOUT_MS = '20';
process.env.RAG_QDRANT_HEALTH_TIMEOUT_MS = '20';
process.env.RAG_RETRY_MAX_ATTEMPTS = '1';
process.env.RAG_RETRY_BASE_DELAY_MS = '1';
process.env.RAG_RETRY_MAX_DELAY_MS = '2';
process.env.RAG_EMBEDDING_DIMENSION = '3';
process.env.RAG_QDRANT_UPLOAD_BATCH_SIZE = '2';

const control = require('../src/rag/runtime/asyncControl');
const registry = require('../src/rag/runtime/operationRegistry');
const metrics = require('../src/rag/runtime/ragMetrics');
const ollama = require('../src/rag/embeddings/ollamaEmbeddingProvider');
const qdrant = require('../src/rag/vector/qdrantVectorStore');
const { createRequestCancellation } = require('../src/rag/runtime/requestCancellation');

const okJson = data => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
const hangingFetch = (_url, options = {}) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => {
        const error = new Error('aborted'); error.name = 'AbortError'; reject(error);
    }, { once: true });
});

test('RAG dependency runtime controls', async t => {
    let originalFetch;
    t.beforeEach(() => {
        originalFetch = global.fetch;
        metrics.resetForTests();
        registry.resetForTests();
        process.env.RAG_RETRY_MAX_ATTEMPTS = '1';
    });
    t.afterEach(() => { global.fetch = originalFetch; });

    await t.test('1 Ollama embedding timeout is structured', async () => {
        global.fetch = hangingFetch;
        await assert.rejects(ollama.generateEmbeddings('hello'),
            error => error.code === 'RAG_OLLAMA_TIMEOUT' && error.retryable);
    });
    await t.test('2 Ollama connection refusal is transient', async () => {
        global.fetch = async () => { const e = new Error('refused'); e.code = 'ECONNREFUSED'; throw e; };
        await assert.rejects(ollama.generateEmbeddings('hello'),
            error => error.code === 'RAG_OLLAMA_CONNECTION_FAILED' && error.retryable);
    });
    await t.test('3 Ollama 429 retries then succeeds', async () => {
        process.env.RAG_RETRY_MAX_ATTEMPTS = '2';
        let calls = 0;
        global.fetch = async () => ++calls === 1
            ? { ok: false, status: 429, text: async () => 'rate' }
            : okJson({ embedding: [1, 2, 3] });
        assert.deepStrictEqual(await ollama.generateEmbeddings('hello'), [1, 2, 3]);
        assert.strictEqual(calls, 2);
    });
    await t.test('4 permanent Ollama error is not retried', async () => {
        process.env.RAG_RETRY_MAX_ATTEMPTS = '3'; let calls = 0;
        global.fetch = async () => { calls++; return { ok: false, status: 400, text: async () => 'bad' }; };
        await assert.rejects(ollama.generateEmbeddings('hello'),
            error => error.code === 'RAG_OLLAMA_HTTP_400' && !error.retryable);
        assert.strictEqual(calls, 1);
    });
    await t.test('5 invalid embedding dimension is rejected', async () => {
        global.fetch = async () => okJson({ embedding: [1, 2] });
        await assert.rejects(ollama.generateEmbeddings('hello'),
            error => error.code === 'RAG_EMBEDDING_DIMENSION_MISMATCH');
    });
    await t.test('6 non-finite embedding is rejected', () =>
        assert.throws(() => ollama.validateEmbedding([1, Infinity, 3], 3),
            error => error.code === 'RAG_EMBEDDING_NON_FINITE'));
    await t.test('7 bounded concurrency never exceeds limit', async () => {
        let active = 0; let peak = 0;
        const items = Array.from({ length: 100 }, (_, i) => i);
        await control.runBoundedOrdered({ items, concurrency: 4, worker: async value => {
            active++; peak = Math.max(peak, active);
            await new Promise(resolve => setTimeout(resolve, 1));
            active--; return value;
        } });
        assert.strictEqual(peak, 4);
    });
    await t.test('8 bounded worker preserves result order', async () => {
        const values = await control.runBoundedOrdered({
            items: [0, 1, 2, 3], concurrency: 3,
            worker: async value => {
                await new Promise(resolve => setTimeout(resolve, (3 - value) * 2));
                return `v${value}`;
            }
        });
        assert.deepStrictEqual(values, ['v0', 'v1', 'v2', 'v3']);
    });
    await t.test('9 fatal failure stops new scheduling', async () => {
        let started = 0;
        await assert.rejects(control.runBoundedOrdered({
            items: Array.from({ length: 100 }), concurrency: 2,
            worker: async (_value, index) => {
                started++;
                if (index === 0) throw new Error('fatal');
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }), /fatal/);
        assert.ok(started <= 2);
    });
    await t.test('10 parent cancellation aborts embedding work', async () => {
        global.fetch = hangingFetch;
        const controller = new AbortController();
        const promise = ollama.generateEmbeddings(['a', 'b'], null, { signal: controller.signal });
        controller.abort();
        await assert.rejects(promise, error => error.code === 'RAG_REQUEST_CANCELLED');
    });
    await t.test('11 Qdrant search timeout is not an empty result', async () => {
        global.fetch = hangingFetch;
        await assert.rejects(qdrant.searchPoints({ vector: [1], limit: 1 }),
            error => error.code === 'RAG_QDRANT_TIMEOUT');
    });
    await t.test('12 Qdrant count timeout is explicit', async () => {
        global.fetch = hangingFetch;
        await assert.rejects(qdrant.countPoints({ must: [] }),
            error => error.code === 'RAG_QDRANT_TIMEOUT');
    });
    await t.test('13 Qdrant upload batch timeout identifies batch', async () => {
        global.fetch = hangingFetch;
        const chunks = [{ tenantId: 't', chunkId: '1' }];
        await assert.rejects(qdrant.upsertVectors(chunks, [[1, 2, 3]]),
            error => error.code === 'RAG_QDRANT_TIMEOUT' && error.failedBatch === 1);
    });
    await t.test('14 partial upload failure records uploaded batch IDs', async () => {
        let calls = 0;
        global.fetch = async (_url, options) => {
            calls++;
            if (calls === 2) return { ok: false, status: 400, text: async () => 'bad' };
            return okJson({ result: { status: 'completed' } });
        };
        const chunks = [0, 1, 2].map(i => ({ tenantId: 't', chunkId: String(i) }));
        await assert.rejects(qdrant.upsertVectors(chunks, chunks.map(() => [1, 2, 3])),
            error => error.failedBatch === 2 && error.uploadedBatchIds.length === 1);
    });
    await t.test('15 deterministic IDs prevent duplicate retry points', () => {
        assert.strictEqual(qdrant.stringToDeterministicUUID('t:chunk'),
            qdrant.stringToDeterministicUUID('t:chunk'));
    });
    await t.test('16 Qdrant delete timeout remains an error', async () => {
        global.fetch = hangingFetch;
        await assert.rejects(qdrant.deleteVectorsByIndexVersion('t', 'v1'),
            error => error.code === 'RAG_QDRANT_TIMEOUT');
    });
    await t.test('17 maximum chunk guard configuration is finite', () => {
        const max = Number(require('../src/rag/config/ragConfig').getConfig('RAG_MAX_CHUNKS_PER_DOCUMENT'));
        assert.ok(Number.isInteger(max) && max > 0);
    });
    await t.test('18 client disconnect aborts dependency work', async () => {
        const req = new EventEmitter();
        const res = new EventEmitter(); res.writableEnded = false;
        const cancellation = createRequestCancellation(req, res);
        const work = control.withTimeout({
            operation: 'qdrant_search', timeoutMs: 1000,
            parentSignal: cancellation.signal, fn: signal => hangingFetch('', { signal })
        });
        req.emit('aborted');
        await assert.rejects(work, error => error.code === 'RAG_REQUEST_CANCELLED');
        cancellation.cleanup();
    });
    await t.test('19 indexing cancellation signal propagates through registry', async () => {
        const parent = new AbortController();
        const operation = registry.registerOperation('index', parent.signal);
        parent.abort();
        assert.strictEqual(operation.signal.aborted, true);
        operation.done();
    });
    await t.test('20 graceful shutdown aborts after grace', async () => {
        const operation = registry.registerOperation('index');
        await registry.beginShutdown(1);
        assert.strictEqual(operation.signal.aborted, true);
        operation.done();
    });
    await t.test('21 retry respects maximum attempts', async () => {
        let calls = 0;
        await assert.rejects(control.retryOperation({
            operation: 'test', maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1,
            random: () => 0, fn: async () => {
                calls++; throw new control.RagTransientError('retry', { operation: 'test' });
            }
        }));
        assert.strictEqual(calls, 3);
    });
    await t.test('22 permanent failures are never retried', async () => {
        let calls = 0;
        await assert.rejects(control.retryOperation({
            operation: 'test', maxAttempts: 3, fn: async () => {
                calls++; throw new control.RagPermanentError('stop', { operation: 'test' });
            }
        }));
        assert.strictEqual(calls, 1);
    });
    await t.test('23 timeout removes parent abort listeners', async () => {
        const parent = new AbortController();
        let adds = 0; let removes = 0;
        const add = parent.signal.addEventListener.bind(parent.signal);
        const remove = parent.signal.removeEventListener.bind(parent.signal);
        parent.signal.addEventListener = (...args) => { adds++; return add(...args); };
        parent.signal.removeEventListener = (...args) => { removes++; return remove(...args); };
        await control.withTimeout({
            operation: 'fast', timeoutMs: 50, parentSignal: parent.signal,
            fn: async () => true
        });
        assert.strictEqual(adds, removes);
    });
    await t.test('24 partial failure cannot be represented as upload success', async () => {
        global.fetch = async () => ({ ok: false, status: 500, text: async () => 'failed' });
        await assert.rejects(qdrant.upsertVectors(
            [{ tenantId: 't', chunkId: '1' }], [[1, 2, 3]]
        ));
    });
});

test('controlled load: 100 and 500 chunks remain bounded', async () => {
    for (const count of [1, 100, 500]) {
        let active = 0; let peak = 0;
        const before = process.memoryUsage().heapUsed;
        const started = performance.now();
        await control.runBoundedOrdered({
            items: Array.from({ length: count }), concurrency: 4,
            worker: async (_item, index) => {
                active++; peak = Math.max(peak, active);
                await Promise.resolve();
                active--; return index;
            }
        });
        const memoryDelta = process.memoryUsage().heapUsed - before;
        console.log(`[RAG Load] chunks=${count} peakConcurrency=${peak} durationMs=${(performance.now() - started).toFixed(1)} memoryDeltaBytes=${memoryDelta}`);
        assert.ok(peak <= 4);
    }

    const originalFetch = global.fetch;
    process.env.RAG_EMBEDDING_CONCURRENCY = '4';
    let activeOllama = 0;
    let peakOllama = 0;
    global.fetch = async url => {
        if (String(url).includes('/api/embeddings')) {
            activeOllama++;
            peakOllama = Math.max(peakOllama, activeOllama);
            await new Promise(resolve => setTimeout(resolve, 1));
            activeOllama--;
            return okJson({ embedding: [1, 2, 3] });
        }
        return okJson({ result: [] });
    };
    try {
        await Promise.all(Array.from({ length: 4 }, () =>
            ollama.generateEmbeddings(Array.from({ length: 25 }, () => 'chunk'))
        ));
        assert.ok(peakOllama <= 4);
        console.log(`[RAG Load] simultaneousDocuments=4 chunks=100 peakOllamaConcurrency=${peakOllama}`);

        const started = performance.now();
        await Promise.all(Array.from({ length: 25 }, () =>
            qdrant.searchPoints({ vector: [1, 2, 3], limit: 1 })
        ));
        console.log(`[RAG Load] simultaneousRetrievals=25 durationMs=${(performance.now() - started).toFixed(1)}`);
    } finally {
        global.fetch = originalFetch;
    }
});
