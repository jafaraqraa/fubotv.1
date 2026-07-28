const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'futhing-rag-cache-'));
process.env.SQLITE_DB_PATH = path.join(tempDir, 'cache-test.db');
const cache = require('../src/rag/cache/retrievalCache');
const db = require('../src/database/connection');

function descriptor(overrides = {}) {
    const tenantId = overrides.tenantId || 'tenant-a';
    const collection = overrides.collection || 'support';
    return {
        tenantId, collection,
        indexVersion: cache.getIndexVersion(tenantId, collection),
        embeddingModel: 'nomic-embed-text',
        reranker: 'bge-reranker-large',
        retrievalWeights: { semantic: 0.8, keyword: 0.2 },
        topK: 5, threshold: 0.4, candidateMultiplier: 3,
        query: '  أسعارُ   الشحن ',
        ...overrides
    };
}

(async () => {
    cache.resetForTests();
    const first = descriptor();
    const firstKey = cache.buildCacheKey(first);
    cache.set(firstKey, { answer: 'old' }, first, { ttlMs: 5000, maxEntries: 100 });
    assert.deepStrictEqual(cache.get(firstKey), { answer: 'old' });

    for (const change of [
        { tenantId: 'tenant-b' }, { collection: 'sales' },
        { indexVersion: first.indexVersion + 1 }, { embeddingModel: 'new-embedding' },
        { reranker: 'new-reranker' }, { retrievalWeights: { semantic: 0.6, keyword: 0.4 } },
        { topK: 9 }, { threshold: 0.7 }, { query: 'سياسة الاسترجاع' }
    ]) assert.notStrictEqual(cache.buildCacheKey(descriptor(change)), firstKey);

    const tenantB = descriptor({ tenantId: 'tenant-b' });
    const tenantBKey = cache.buildCacheKey(tenantB);
    cache.set(tenantBKey, { answer: 'tenant-b' }, tenantB, { ttlMs: 5000 });
    const invalidated = cache.invalidate({ tenantId: 'tenant-a', collection: 'support', reason: 'document-replace-test' });
    assert.strictEqual(invalidated.removed, 1);
    assert.deepStrictEqual(cache.get(tenantBKey), { answer: 'tenant-b' });

    const newVersion = cache.getIndexVersion('tenant-a', 'support');
    const freshKey = cache.buildCacheKey(descriptor({ indexVersion: newVersion }));
    assert.notStrictEqual(freshKey, firstKey);
    assert.strictEqual(cache.get(freshKey), undefined, 'stale result must be unreachable after update');

    const ttlEntry = descriptor({ collection: 'ttl' });
    const ttlKey = cache.buildCacheKey(ttlEntry);
    cache.set(ttlKey, 'short-lived', ttlEntry, { ttlMs: 5 });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.strictEqual(cache.get(ttlKey), undefined);

    const iterations = 10000;
    const started = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) cache.get(tenantBKey);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    const metrics = cache.getMetrics();
    assert.ok(metrics.hit >= iterations);
    assert.ok(metrics.miss >= 2);
    assert.strictEqual(metrics.invalidation, 1);
    assert.ok(metrics.eviction >= 1);
    console.log(`✅ RAG cache tests passed. Benchmark: ${iterations} hits in ${elapsedMs.toFixed(2)} ms (${Math.round(iterations / (elapsedMs / 1000))} ops/sec).`);
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
})().catch(err => {
    console.error(err);
    try { db.close(); } catch (_) {}
    fs.rmSync(tempDir, { recursive: true, force: true });
    process.exit(1);
});
