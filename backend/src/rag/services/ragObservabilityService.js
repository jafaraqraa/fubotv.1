const db = require('../../database/connection');
const vectorStore = require('../vector/qdrantVectorStore');
const retrievalCache = require('../cache/retrievalCache');
const runtimeMetrics = require('../runtime/ragMetrics');
const { requireTenantId } = require('../security/tenantContext');

function measured(value, metadata) {
    return {
        value: value ?? null,
        unit: metadata.unit || 'count',
        source: metadata.source,
        scope: metadata.scope,
        exactness: metadata.exactness || 'exact',
        collectedAt: metadata.collectedAt || new Date().toISOString(),
        freshness: metadata.freshness || 'live'
    };
}

function tableExists(name) {
    return Boolean(db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(name));
}

function logicalStatistics(tenantId) {
    const docs = db.prepare(`
        SELECT
            COUNT(DISTINCT COALESCE(logical_document_id, document_key)) AS active_documents,
            COUNT(*) AS active_versions,
            COALESCE(SUM(chunk_count), 0) AS active_chunks,
            SUM(CASE WHEN status = 'staging' THEN 1 ELSE 0 END) AS staging_versions,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_versions,
            SUM(CASE WHEN status = 'cleanup_pending' OR cleanup_error IS NOT NULL THEN 1 ELSE 0 END)
                AS cleanup_pending_versions
        FROM knowledge_documents
        WHERE tenant_id = ? AND is_active = 1
    `).get(tenantId) || {};
    const knowledge = tableExists('rag_index_versions') ? db.prepare(`
        SELECT
            SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_versions,
            COALESCE(SUM(CASE WHEN is_active = 1 THEN chunk_count ELSE 0 END), 0) AS active_chunks,
            SUM(CASE WHEN status IN ('staging','indexing','ready') THEN 1 ELSE 0 END) AS staging_versions,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_versions,
            SUM(CASE WHEN cleanup_status = 'pending' OR status = 'cleanup_pending' THEN 1 ELSE 0 END)
                AS cleanup_pending_versions
        FROM rag_index_versions WHERE tenant_id = ?
    `).get(tenantId) : {};
    return {
        activeDocuments: Number(docs.active_documents || 0)
            + Number(knowledge.active_versions || 0),
        activeVersions: Number(docs.active_versions || 0)
            + Number(knowledge.active_versions || 0),
        activeChunks: Number(docs.active_chunks || 0) + Number(knowledge.active_chunks || 0),
        stagingVersions: Number(docs.staging_versions || 0) + Number(knowledge.staging_versions || 0),
        failedVersions: Number(docs.failed_versions || 0) + Number(knowledge.failed_versions || 0),
        cleanupPendingVersions: Number(docs.cleanup_pending_versions || 0)
            + Number(knowledge.cleanup_pending_versions || 0)
    };
}

function latestConsistency(tenantId) {
    if (!tableExists('rag_reconciliation_runs')) {
        return { missingPoints: null, orphanPoints: null, countMismatches: null, source: null };
    }
    const row = db.prepare(`
        SELECT summary_json, completed_at, started_at
        FROM rag_reconciliation_runs
        WHERE tenant_id = ? AND status = 'completed'
        ORDER BY started_at DESC LIMIT 1
    `).get(tenantId);
    if (!row) return { missingPoints: null, orphanPoints: null, countMismatches: null, source: null };
    let summary = {};
    try { summary = JSON.parse(row.summary_json || '{}'); } catch (_) { /* unavailable */ }
    return {
        missingPoints: summary.missingPoints ?? summary.missing_points ?? null,
        orphanPoints: summary.orphanPoints ?? summary.orphan_points ?? null,
        countMismatches: summary.countMismatches ?? summary.count_mismatches ?? null,
        source: 'latest_completed_reconciliation',
        collectedAt: row.completed_at || row.started_at
    };
}

async function getTenantRagStatistics(tenantId, options = {}) {
    tenantId = requireTenantId(tenantId, 'rag-observability');
    const collectedAt = new Date().toISOString();
    const logical = logicalStatistics(tenantId);
    const [qdrantPoints, stagingPoints] = await Promise.all([
        vectorStore.getTenantPhysicalPointCount(tenantId, options),
        vectorStore.countPoints({
            must: [
                { key: 'tenantId', match: { value: tenantId } },
                { key: 'lifecycle', match: { value: 'staging' } }
            ]
        }, options)
    ]);
    const consistency = latestConsistency(tenantId);
    return {
        physical: {
            qdrantPoints: measured(qdrantPoints, {
                source: 'qdrant_exact_filtered_count', scope: 'tenant', collectedAt
            }),
            stagingPoints: measured(stagingPoints, {
                source: 'qdrant_exact_filtered_count', scope: 'tenant+lifecycle:staging', collectedAt
            }),
            stalePoints: measured(null, {
                source: 'reconciliation_required', scope: 'tenant', exactness: 'unavailable', collectedAt
            })
        },
        logical: Object.fromEntries(Object.entries(logical).map(([key, value]) => [
            key, measured(value, { source: 'sqlite_lifecycle_state', scope: 'tenant', collectedAt })
        ])),
        consistency: {
            missingPoints: measured(consistency.missingPoints, {
                source: consistency.source || 'no_completed_reconciliation',
                scope: 'tenant', exactness: consistency.source ? 'audit_snapshot' : 'unavailable',
                collectedAt: consistency.collectedAt || collectedAt,
                freshness: consistency.source ? 'last_reconciliation' : 'unavailable'
            }),
            orphanPoints: measured(consistency.orphanPoints, {
                source: consistency.source || 'no_completed_reconciliation',
                scope: 'tenant', exactness: consistency.source ? 'audit_snapshot' : 'unavailable',
                collectedAt: consistency.collectedAt || collectedAt,
                freshness: consistency.source ? 'last_reconciliation' : 'unavailable'
            }),
            countMismatches: measured(consistency.countMismatches, {
                source: consistency.source || 'no_completed_reconciliation',
                scope: 'tenant', exactness: consistency.source ? 'audit_snapshot' : 'unavailable',
                collectedAt: consistency.collectedAt || collectedAt,
                freshness: consistency.source ? 'last_reconciliation' : 'unavailable'
            })
        }
    };
}

async function getMetricsSummary(tenantId, options = {}) {
    const statistics = await getTenantRagStatistics(tenantId, options);
    const cache = retrievalCache.getMetrics(tenantId);
    return {
        schemaVersion: 1,
        tenantId,
        generatedAt: new Date().toISOString(),
        statistics,
        collection: await vectorStore.getCollectionStats(options),
        runtime: runtimeMetrics.snapshot(),
        cache
    };
}

module.exports = { measured, logicalStatistics, getTenantRagStatistics, getMetricsSummary };
