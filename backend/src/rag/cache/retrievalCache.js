const crypto = require('crypto');
const db = require('../../database/connection');
const { normalizeArabic } = require('../processing/arabicNormalizer');
const { requireTenantId } = require('../security/tenantContext');

const entries = new Map();
const metrics = {
    hit: 0,
    miss: 0,
    invalidation: 0,
    eviction: 0
};
const tenantMetrics = new Map();

function incrementTenantMetric(tenantId, metric) {
    if (!tenantId) return;
    const current = tenantMetrics.get(tenantId) || { hit: 0, miss: 0, invalidation: 0, eviction: 0 };
    current[metric]++;
    tenantMetrics.set(tenantId, current);
}

function ensureVersionTable() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS rag_cache_versions (
            tenant_id TEXT NOT NULL,
            collection_name TEXT NOT NULL,
            index_version INTEGER NOT NULL DEFAULT 1,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (tenant_id, collection_name)
        )
    `);
}

ensureVersionTable();

function normalizeNamespace(value, fallback) {
    const normalized = String(value || fallback).trim();
    if (!normalized) throw new Error('RAG cache namespace cannot be empty.');
    return normalized;
}

function normalizeQuery(query) {
    return normalizeArabic(String(query || ''))
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function getIndexVersion(tenantId, collection) {
    const tenant = requireTenantId(tenantId, 'cache-index-version');
    const collectionName = normalizeNamespace(collection, 'futhing_knowledge');
    db.prepare(`
        INSERT INTO rag_cache_versions (tenant_id, collection_name, index_version)
        VALUES (?, ?, 1)
        ON CONFLICT(tenant_id, collection_name) DO NOTHING
    `).run(tenant, collectionName);
    return db.prepare(`
        SELECT index_version FROM rag_cache_versions
        WHERE tenant_id = ? AND collection_name = ?
    `).get(tenant, collectionName).index_version;
}

function buildCacheKey(options) {
    const descriptor = {
        tenantId: requireTenantId(options.tenantId, 'cache-key'),
        collection: normalizeNamespace(options.collection, 'futhing_knowledge'),
        indexVersion: Number(options.indexVersion),
        activeKnowledgeVersion: String(options.activeKnowledgeVersion || 'legacy'),
        embeddingModel: String(options.embeddingModel || 'unknown'),
        reranker: String(options.reranker || 'none'),
        retrievalMode: String(options.retrievalMode || 'NORMAL'),
        retrievalWeights: {
            semantic: Number(options.retrievalWeights?.semantic),
            keyword: Number(options.retrievalWeights?.keyword)
        },
        topK: Number(options.topK),
        threshold: Number(options.threshold),
        candidateMultiplier: Number(options.candidateMultiplier || 1),
        normalizedQuery: normalizeQuery(options.query)
    };
    return crypto.createHash('sha256').update(JSON.stringify(descriptor)).digest('hex');
}

function get(key, tenantId) {
    const entry = entries.get(key);
    if (!entry) {
        metrics.miss++;
        incrementTenantMetric(tenantId, 'miss');
        return undefined;
    }
    const expectedTenant = tenantId ? requireTenantId(tenantId, 'cache-get') : null;
    if (expectedTenant && entry.tenantId !== expectedTenant) {
        metrics.miss++;
        incrementTenantMetric(expectedTenant, 'miss');
        console.warn('[RAG Cache] Tenant mismatch blocked.');
        return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
        entries.delete(key);
        metrics.eviction++;
        metrics.miss++;
        incrementTenantMetric(entry.tenantId, 'eviction');
        incrementTenantMetric(tenantId || entry.tenantId, 'miss');
        return undefined;
    }
    metrics.hit++;
    incrementTenantMetric(entry.tenantId, 'hit');
    return entry.value;
}

function evictOldestIfNeeded(maxEntries) {
    while (entries.size >= maxEntries) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey === undefined) break;
        const oldestEntry = entries.get(oldestKey);
        entries.delete(oldestKey);
        metrics.eviction++;
        incrementTenantMetric(oldestEntry?.tenantId, 'eviction');
    }
}

function set(key, value, metadata, options = {}) {
    const ttlMs = Math.max(1, Number(options.ttlMs) || 300000);
    const maxEntries = Math.max(1, Number(options.maxEntries) || 1000);
    if (!entries.has(key)) evictOldestIfNeeded(maxEntries);
    entries.set(key, {
        value,
        tenantId: requireTenantId(metadata.tenantId, 'cache-set'),
        collection: normalizeNamespace(metadata.collection, 'futhing_knowledge'),
        indexVersion: Number(metadata.indexVersion),
        expiresAt: Date.now() + ttlMs
    });
}

const bumpVersionTransaction = db.transaction((tenantId, collection) => {
    db.prepare(`
        INSERT INTO rag_cache_versions (tenant_id, collection_name, index_version)
        VALUES (?, ?, 2)
        ON CONFLICT(tenant_id, collection_name) DO UPDATE SET
            index_version = index_version + 1,
            updated_at = CURRENT_TIMESTAMP
    `).run(tenantId, collection);
    return getIndexVersion(tenantId, collection);
});

function invalidate({ tenantId, collection, reason = 'index-changed' }) {
    const tenant = requireTenantId(tenantId, 'cache-invalidate');
    const collectionName = normalizeNamespace(collection, 'futhing_knowledge');
    const indexVersion = bumpVersionTransaction(tenant, collectionName);
    let removed = 0;

    for (const [key, entry] of entries) {
        if (entry.tenantId === tenant && entry.collection === collectionName) {
            entries.delete(key);
            removed++;
        }
    }

    metrics.invalidation++;
    incrementTenantMetric(tenant, 'invalidation');
    console.log(`[RAG Cache] Invalidated tenant=${tenant}, collection=${collectionName}, version=${indexVersion}, entries=${removed}, reason=${reason}`);
    return { tenantId: tenant, collection: collectionName, indexVersion, removed };
}

function metricView(value) {
    const lookups = value.hit + value.miss;
    return {
        ...value,
        lookups,
        hitRate: lookups ? value.hit / lookups : null,
        missRate: lookups ? value.miss / lookups : null,
        exactness: 'process_local',
        collectedAt: new Date().toISOString()
    };
}

function getMetrics(tenantId) {
    if (tenantId) {
        const tenant = requireTenantId(tenantId, 'cache-metrics');
        return metricView(tenantMetrics.get(tenant)
            || { hit: 0, miss: 0, invalidation: 0, eviction: 0 });
    }
    return {
        ...metricView(metrics),
        size: entries.size,
        scope: 'process',
        warning: 'Process-local cache metrics are not cluster-wide.'
    };
}

function resetForTests() {
    entries.clear();
    tenantMetrics.clear();
    Object.keys(metrics).forEach(key => { metrics[key] = 0; });
}

module.exports = {
    buildCacheKey,
    get,
    set,
    invalidate,
    getIndexVersion,
    getMetrics,
    normalizeQuery,
    resetForTests,
    entries
};
