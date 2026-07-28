const crypto = require('crypto');
const fs = require('fs');
const db = require('../../database/connection');
const vectorStore = require('../vector/qdrantVectorStore');
const { getConfig } = require('../config/ragConfig');
const { requireTenantId } = require('../security/tenantContext');
const { acquireLease } = require('../runtime/distributedLockService');

const REQUIRED_PAYLOAD_FIELDS = [
    'tenantId', 'sourceType', 'documentId', 'documentVersionId', 'indexVersionId',
    'chunkIndex', 'contentHash', 'embeddingModel', 'vectorDimension', 'createdAt'
];
const SAFE_DELETE_TYPES = new Set([
    'ORPHAN_VECTOR', 'STALE_VERSION_VECTOR', 'ABANDONED_STAGING_VECTOR'
]);

function numberConfig(key, fallback) {
    const value = Number(getConfig(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function payloadIsValid(payload) {
    if (!payload || typeof payload !== 'object') return false;
    if (REQUIRED_PAYLOAD_FIELDS.some(field => payload[field] === undefined || payload[field] === null || payload[field] === '')) {
        return false;
    }
    return Number.isInteger(Number(payload.chunkIndex))
        && Number(payload.vectorDimension) > 0
        && !Number.isNaN(Date.parse(payload.createdAt));
}

function versionKey(payload) {
    return String(payload.documentVersionId || payload.indexVersionId || '');
}

function pointAgeMs(point, now) {
    const createdAt = Date.parse(point.payload?.createdAt);
    return Number.isNaN(createdAt) ? 0 : Math.max(0, now - createdAt);
}

function issue(type, point, extra = {}) {
    const payload = point?.payload || {};
    return {
        type,
        pointId: point?.id != null ? String(point.id) : null,
        documentId: payload.documentId || extra.documentId || null,
        versionId: versionKey(payload) || extra.versionId || null,
        sourceType: payload.sourceType || null,
        documentVersionId: payload.documentVersionId || null,
        indexVersionId: payload.indexVersionId || null,
        chunkIndex: payload.chunkIndex ?? extra.chunkIndex ?? null,
        proposedAction: extra.proposedAction || 'REVIEW',
        safeToDelete: extra.safeToDelete === true,
        reason: extra.reason || type,
        ...extra
    };
}

function acquireCleanupLease(tenantId, operatorId, ttlMs) {
    const ownerToken = crypto.randomUUID();
    const now = Date.now();
    const acquired = db.transaction(() => {
        db.prepare('DELETE FROM rag_reconciliation_locks WHERE expires_at <= ?').run(now);
        return db.prepare(`
            INSERT INTO rag_reconciliation_locks (
                tenant_id, owner_token, operator_id, expires_at
            ) VALUES (?, ?, ?, ?)
            ON CONFLICT(tenant_id) DO NOTHING
        `).run(tenantId, ownerToken, operatorId, now + ttlMs).changes === 1;
    })();
    if (!acquired) {
        const error = new Error(`RAG reconciliation cleanup is already running for tenant ${tenantId}.`);
        error.code = 'RAG_RECONCILIATION_LOCKED';
        throw error;
    }
    return ownerToken;
}

function releaseCleanupLease(tenantId, ownerToken) {
    db.prepare(`
        DELETE FROM rag_reconciliation_locks
        WHERE tenant_id = ? AND owner_token = ?
    `).run(tenantId, ownerToken);
}

function hasActiveIndexingOperation(tenantId, documentId) {
    const now = Date.now();
    const documentLock = db.prepare(`
        SELECT 1 FROM rag_document_locks
        WHERE tenant_id = ? AND expires_at > ?
          AND (? IS NULL OR logical_document_id = ?)
    `).get(tenantId, now, documentId || null, documentId || null);
    const indexLock = db.prepare(`
        SELECT 1 FROM rag_index_locks
        WHERE tenant_id = ? AND expires_at > ?
    `).get(tenantId, now);
    return Boolean(documentLock || indexLock);
}

function createSummary(documents, indexVersions) {
    return {
        sqliteDocuments: documents.length,
        sqliteActiveVersions: documents.filter(row => row.is_active === 1).length
            + indexVersions.filter(row => row.is_active === 1).length,
        qdrantPoints: 0,
        healthyPoints: 0,
        orphanVectors: 0,
        staleVersionVectors: 0,
        missingVectors: 0,
        countMismatches: 0,
        duplicateChunks: 0,
        invalidPayloads: 0,
        wrongTenantReferences: 0,
        abandonedStagingVectors: 0,
        missingFiles: 0,
        unownedLegacyPoints: 0
    };
}

function incrementSummary(summary, type) {
    const map = {
        ORPHAN_VECTOR: 'orphanVectors',
        STALE_VERSION_VECTOR: 'staleVersionVectors',
        MISSING_VECTOR: 'missingVectors',
        COUNT_MISMATCH: 'countMismatches',
        DUPLICATE_CHUNK: 'duplicateChunks',
        INVALID_PAYLOAD: 'invalidPayloads',
        WRONG_TENANT_REFERENCE: 'wrongTenantReferences',
        ABANDONED_STAGING_VECTOR: 'abandonedStagingVectors',
        MISSING_FILE: 'missingFiles',
        UNOWNED_LEGACY_POINT: 'unownedLegacyPoints'
    };
    if (map[type]) summary[map[type]]++;
}

function recordAction({ auditId, tenantId, issueItem, action, operatorId, result, error }) {
    db.prepare(`
        INSERT INTO rag_reconciliation_actions (
            audit_id, tenant_id, issue_type, point_id, document_id, version_id,
            action, reason, operator_id, result, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        auditId, tenantId, issueItem.type, issueItem.pointId,
        issueItem.documentId, issueItem.versionId, action, issueItem.reason,
        operatorId, result, error?.message || null
    );
}

async function scanLegacyUnowned(dependencies, options) {
    if (!options.includeLegacyAudit) return [];
    const results = [];
    let offset = null;
    do {
        const page = await dependencies.scrollUnownedPointsPage({
            offset, limit: options.batchSize, signal: options.signal
        });
        for (const point of page.points) {
            results.push(issue('UNOWNED_LEGACY_POINT', point, {
                proposedAction: 'ADMINISTRATIVE_REVIEW',
                safeToDelete: false,
                reason: 'Point has no tenantId; ownership cannot be inferred safely.'
            }));
        }
        offset = page.nextOffset;
    } while (offset !== null && results.length < options.maxLegacyAuditPoints);
    return results;
}

async function reconcileRagIndex(input = {}) {
    const tenantId = requireTenantId(input.tenantId, 'rag-reconciliation');
    const dryRun = input.confirmCleanup === true ? false : input.dryRun !== false;
    const operatorId = String(input.operatorId || 'system');
    const batchSize = Math.max(1, Math.min(500, Number(input.batchSize)
        || numberConfig('RAG_RECONCILIATION_BATCH_SIZE', 100)));
    const maxRuntimeMs = Number(input.maxRuntimeMs)
        || numberConfig('RAG_RECONCILIATION_MAX_RUNTIME_MS', 30000);
    const requestedGraceHours = Number(input.gracePeriodHours);
    const graceHours = Number.isFinite(requestedGraceHours) && requestedGraceHours >= 0
        ? requestedGraceHours
        : numberConfig('RAG_ORPHAN_GRACE_PERIOD_HOURS', 24);
    const graceMs = graceHours * 60 * 60 * 1000;
    const lockTtlMs = numberConfig('RAG_RECONCILIATION_LOCK_TTL_MS', 600000);
    const dependencies = { ...vectorStore, fs, ...(input._testDependencies || {}) };
    const auditId = crypto.randomUUID();
    const startedAt = Date.now();
    const deadline = startedAt + maxRuntimeMs;
    let lease = null;
    let continuationOffset = input.continuationOffset ?? null;
    let scanComplete = true;
    let auditPersisted = false;

    console.log(`[RAG Reconcile] Scan started tenant=${tenantId} dryRun=${dryRun}`);
    if (!dryRun || input.useLease === true) {
        try {
            lease = await acquireLease({
                tenantId,
                resourceType: dryRun ? 'tenant_scan' : 'tenant_cleanup',
                resourceId: tenantId,
                operation: dryRun ? 'reconciliation_scan' : 'reconciliation_cleanup',
                signal: input.signal,
                failFast: input.failFast !== false,
                ttlMs: lockTtlMs,
                idempotencyKey: input.idempotencyKey,
                metadata: { operatorId }
            });
        } catch (error) {
            if (error.code === 'RAG_OPERATION_IN_PROGRESS') {
                error.canonicalCode = error.code;
                error.code = 'RAG_RECONCILIATION_LOCKED';
            }
            throw error;
        }
        if (lease.duplicate) {
            if (lease.operation.status === 'completed' && lease.operation.result_json) {
                return JSON.parse(lease.operation.result_json);
            }
            throw Object.assign(new Error('A matching reconciliation operation is already in progress.'), {
                code: 'RAG_OPERATION_IN_PROGRESS', retryable: true
            });
        }
    }

    const documents = db.prepare(`
        SELECT * FROM knowledge_documents WHERE tenant_id = ?
    `).all(tenantId);
    const indexVersions = db.prepare(`
        SELECT * FROM rag_index_versions WHERE tenant_id = ?
    `).all(tenantId);
    const documentByVersion = new Map(documents.map(row => [String(row.version_id), row]));
    const indexByVersion = new Map(indexVersions.map(row => [String(row.index_version_id), row]));
    const issues = [];
    const proposedActions = [];
    const pointsByVersion = new Map();
    const chunkKeys = new Map();
    const summary = createSummary(documents, indexVersions);
    const now = Date.now();

    try {
        do {
            if (input.signal?.aborted) throw Object.assign(new Error('Reconciliation aborted.'), { code: 'ABORT_ERR' });
            if (Date.now() >= deadline) {
                scanComplete = false;
                break;
            }
            const page = await dependencies.scrollTenantPointsPage(tenantId, {
                offset: continuationOffset, limit: batchSize, signal: input.signal
            });
            continuationOffset = page.nextOffset;
            for (const point of page.points) {
                summary.qdrantPoints++;
                const payload = point.payload;
                if (!payloadIsValid(payload)) {
                    const item = issue('INVALID_PAYLOAD', point, {
                        safeToDelete: false,
                        proposedAction: 'ADMINISTRATIVE_REVIEW',
                        reason: 'Required ownership or version payload metadata is missing or malformed.'
                    });
                    issues.push(item); incrementSummary(summary, item.type);
                    continue;
                }
                if (payload.tenantId !== tenantId) {
                    const item = issue('WRONG_TENANT_REFERENCE', point, {
                        safeToDelete: false,
                        proposedAction: 'CRITICAL_ISOLATION_REVIEW',
                        reason: `Filtered scan returned payload owned by ${payload.tenantId}.`
                    });
                    issues.push(item); incrementSummary(summary, item.type);
                    continue;
                }

                const key = versionKey(payload);
                if (!pointsByVersion.has(key)) pointsByVersion.set(key, []);
                pointsByVersion.get(key).push(point);
                const duplicateKey = `${tenantId}:${key}:${payload.chunkIndex}`;
                if (chunkKeys.has(duplicateKey)) {
                    const item = issue('DUPLICATE_CHUNK', point, {
                        safeToDelete: false,
                        proposedAction: 'ADMINISTRATIVE_REVIEW',
                        reason: `Duplicate chunk index; original point=${chunkKeys.get(duplicateKey)}.`
                    });
                    issues.push(item); incrementSummary(summary, item.type);
                    continue;
                }
                chunkKeys.set(duplicateKey, String(point.id));

                const document = documentByVersion.get(String(payload.documentVersionId));
                const indexVersion = indexByVersion.get(String(payload.indexVersionId));
                const sameSourceRecord = payload.sourceType === 'knowledge_txt' ? indexVersion : document;
                if (!sameSourceRecord) {
                    const otherTenant = db.prepare(`
                        SELECT tenant_id FROM knowledge_documents WHERE version_id = ?
                        UNION ALL
                        SELECT tenant_id FROM rag_index_versions WHERE index_version_id = ?
                        LIMIT 1
                    `).get(payload.documentVersionId, payload.indexVersionId);
                    const type = otherTenant && otherTenant.tenant_id !== tenantId
                        ? 'WRONG_TENANT_REFERENCE' : 'ORPHAN_VECTOR';
                    const oldEnough = pointAgeMs(point, now) >= graceMs;
                    const safe = type === 'ORPHAN_VECTOR' && oldEnough
                        && !hasActiveIndexingOperation(tenantId, payload.documentId);
                    const item = issue(type, point, {
                        safeToDelete: safe,
                        proposedAction: safe ? 'DELETE_AFTER_GRACE_PERIOD' : 'ADMINISTRATIVE_REVIEW',
                        reason: type === 'WRONG_TENANT_REFERENCE'
                            ? `Version belongs to tenant ${otherTenant.tenant_id}.`
                            : oldEnough ? 'No matching SQLite tenant/version metadata exists.' : 'Orphan is inside grace period.'
                    });
                    issues.push(item); incrementSummary(summary, item.type);
                    if (safe) proposedActions.push(item);
                    console.warn(`[RAG Reconcile] Orphan detected tenant=${tenantId} point=${point.id} type=${type}`);
                    continue;
                }

                const status = String(sameSourceRecord.status || '');
                const active = sameSourceRecord.is_active === 1;
                const oldEnough = pointAgeMs(point, now) >= graceMs;
                const running = hasActiveIndexingOperation(tenantId, payload.documentId);
                if (!active && ['staging', 'indexing', 'failed', 'ready'].includes(status)) {
                    const safe = oldEnough && !running;
                    const item = issue('ABANDONED_STAGING_VECTOR', point, {
                        safeToDelete: safe,
                        proposedAction: safe ? 'DELETE_AFTER_GRACE_PERIOD' : 'SKIP_GRACE_OR_ACTIVE_JOB',
                        reason: safe ? `Inactive ${status} version exceeded grace period.` : 'Grace period or active job prevents cleanup.'
                    });
                    issues.push(item); incrementSummary(summary, item.type);
                    if (safe) proposedActions.push(item);
                } else if (!active && ['archived', 'cleanup_pending', 'deleted'].includes(status)) {
                    const safe = oldEnough && !running;
                    const item = issue('STALE_VERSION_VECTOR', point, {
                        safeToDelete: safe,
                        proposedAction: safe ? 'DELETE_AFTER_GRACE_PERIOD' : 'SKIP_GRACE_OR_ACTIVE_JOB',
                        reason: safe ? 'Inactive version exceeded cleanup grace period.' : 'Grace period or active job prevents cleanup.'
                    });
                    issues.push(item); incrementSummary(summary, item.type);
                    if (safe) proposedActions.push(item);
                } else {
                    summary.healthyPoints++;
                }
            }
        } while (continuationOffset !== null);

        if (scanComplete) {
            for (const document of documents.filter(row => row.is_active === 1 && row.status !== 'deleted')) {
                const versionId = String(document.version_id);
                const points = pointsByVersion.get(versionId) || [];
                const expected = Number(document.chunk_count || document.vector_count || 0);
                if (document.storage_path && !dependencies.fs.existsSync(document.storage_path)) {
                    const item = issue('MISSING_FILE', null, {
                        documentId: document.document_key, versionId,
                        proposedAction: 'REINDEX_OR_RESTORE_FILE', safeToDelete: false,
                        reason: 'SQLite metadata exists but the physical uploaded file is missing.'
                    });
                    issues.push(item); incrementSummary(summary, item.type);
                }
                if (points.length !== expected) {
                    const mismatch = issue('COUNT_MISMATCH', null, {
                        documentId: document.document_key, versionId,
                        expectedCount: expected, actualCount: points.length,
                        proposedAction: 'MARK_DEGRADED_AND_REINDEX', safeToDelete: false,
                        reason: 'Tenant/version filtered Qdrant point count differs from SQLite.'
                    });
                    issues.push(mismatch); incrementSummary(summary, mismatch.type);
                    console.warn(`[RAG Reconcile] Count mismatch detected tenant=${tenantId} version=${versionId} expected=${expected} actual=${points.length}`);
                    if (points.length < expected) {
                        const missing = issue('MISSING_VECTOR', null, {
                            documentId: document.document_key, versionId,
                            expectedCount: expected, actualCount: points.length,
                            proposedAction: 'TENANT_SCOPED_REINDEX', safeToDelete: false,
                            reason: 'One or more expected chunks are absent from Qdrant.'
                        });
                        issues.push(missing); incrementSummary(summary, missing.type);
                    }
                }
            }
            for (const version of indexVersions.filter(row => row.is_active === 1)) {
                const versionId = String(version.index_version_id);
                const points = pointsByVersion.get(versionId) || [];
                const expected = Number(version.chunk_count || 0);
                if (points.length !== expected) {
                    const mismatch = issue('COUNT_MISMATCH', null, {
                        documentId: version.document_id, versionId,
                        expectedCount: expected, actualCount: points.length,
                        proposedAction: 'MARK_DEGRADED_AND_REINDEX', safeToDelete: false,
                        reason: 'Active knowledge index filtered count differs from SQLite.'
                    });
                    issues.push(mismatch); incrementSummary(summary, mismatch.type);
                    if (points.length < expected) {
                        const missing = issue('MISSING_VECTOR', null, {
                            documentId: version.document_id, versionId,
                            expectedCount: expected, actualCount: points.length,
                            proposedAction: 'TENANT_SCOPED_REINDEX', safeToDelete: false,
                            reason: 'Active knowledge index is missing expected points.'
                        });
                        issues.push(missing); incrementSummary(summary, missing.type);
                    }
                }
            }
        }

        const legacyIssues = await scanLegacyUnowned(dependencies, {
            includeLegacyAudit: input.includeLegacyAudit === true,
            batchSize,
            signal: input.signal,
            maxLegacyAuditPoints: Number(input.maxLegacyAuditPoints) || 1000
        });
        legacyIssues.forEach(item => { issues.push(item); incrementSummary(summary, item.type); });

        const cleanup = {
            success: true, tenantId, deletedPoints: 0, skippedPoints: 0,
            repairedRecords: 0, failedActions: 0, auditId
        };
        if (!dryRun) {
            lease.assertOwnership();
            db.prepare(`
                INSERT INTO rag_reconciliation_runs (
                    audit_id, tenant_id, dry_run, operator_id, status, started_at
                ) VALUES (?, ?, 0, ?, 'running', CURRENT_TIMESTAMP)
            `).run(auditId, tenantId, operatorId);
            auditPersisted = true;

            for (const item of issues.filter(value => value.pointId)) {
                if (!SAFE_DELETE_TYPES.has(item.type) || !item.safeToDelete) {
                    cleanup.skippedPoints++;
                    recordAction({
                        auditId, tenantId, issueItem: item, action: 'SKIP',
                        operatorId, result: 'skipped'
                    });
                    console.log(`[RAG Cleanup] Point skipped tenant=${tenantId} point=${item.pointId} type=${item.type}`);
                }
            }
            for (const item of proposedActions) {
                try {
                    lease.assertOwnership();
                    const result = await dependencies.deleteTenantPointsByIds(
                        tenantId, [item.pointId], {
                            signal: input.signal,
                            sourceType: item.sourceType,
                            documentVersionId: item.documentVersionId,
                            indexVersionId: item.indexVersionId
                        }
                    );
                    cleanup.deletedPoints += result.deleted || 0;
                    recordAction({
                        auditId, tenantId, issueItem: item, action: 'DELETE_POINT',
                        operatorId, result: 'deleted'
                    });
                    console.log(`[RAG Cleanup] Point deleted tenant=${tenantId} point=${item.pointId} type=${item.type}`);
                } catch (error) {
                    cleanup.failedActions++;
                    cleanup.success = false;
                    recordAction({
                        auditId, tenantId, issueItem: item, action: 'DELETE_POINT',
                        operatorId, result: 'failed', error
                    });
                }
            }

            const degraded = issues.filter(item => ['MISSING_VECTOR', 'COUNT_MISMATCH'].includes(item.type));
            const degradedVersions = new Set(degraded.map(item => item.versionId).filter(Boolean));
            for (const versionId of degradedVersions) {
                lease.assertOwnership();
                const docsChanged = db.prepare(`
                    UPDATE knowledge_documents
                    SET reconciliation_status = 'degraded',
                        reconciliation_error = 'Qdrant count mismatch; tenant-scoped reindex required.'
                    WHERE tenant_id = ? AND version_id = ?
                `).run(tenantId, versionId).changes;
                const indexesChanged = db.prepare(`
                    UPDATE rag_index_versions
                    SET reconciliation_status = 'degraded',
                        reconciliation_error = 'Qdrant count mismatch; tenant-scoped reindex required.'
                    WHERE tenant_id = ? AND index_version_id = ?
                `).run(tenantId, versionId).changes;
                cleanup.repairedRecords += docsChanged + indexesChanged;
            }
            db.prepare(`
                UPDATE rag_reconciliation_runs
                SET status = ?, summary_json = ?, continuation_offset = ?,
                    completed_at = CURRENT_TIMESTAMP, duration_ms = ?, error_message = ?
                WHERE audit_id = ?
            `).run(
                cleanup.success ? 'completed' : 'partial_failure',
                JSON.stringify(summary),
                continuationOffset === null ? null : JSON.stringify(continuationOffset),
                Date.now() - startedAt,
                cleanup.failedActions ? `${cleanup.failedActions} cleanup action(s) failed.` : null,
                auditId
            );
        }

        const report = {
            tenantId, dryRun, auditId, scanComplete,
            continuationOffset, summary, issues, proposedActions,
            cleanup: dryRun ? null : cleanup,
            durationMs: Date.now() - startedAt
        };
        console.log(`[RAG Reconcile] Tenant scan completed tenant=${tenantId} durationMs=${report.durationMs} issues=${issues.length}`);
        console.log(`[RAG Cleanup] ${dryRun ? 'Dry run' : 'Cleanup'} completed tenant=${tenantId} deleted=${cleanup.deletedPoints} failed=${cleanup.failedActions}`);
        if (lease) lease._result = report;
        return report;
    } catch (error) {
        if (lease) lease._error = error;
        if (auditPersisted) {
            db.prepare(`
                UPDATE rag_reconciliation_runs
                SET status = 'failed', completed_at = CURRENT_TIMESTAMP,
                    duration_ms = ?, error_message = ?
                WHERE audit_id = ? AND status = 'running'
            `).run(Date.now() - startedAt, String(error.message || error).slice(0, 1000), auditId);
        }
        throw error;
    } finally {
        if (lease) await lease.release({
            result: lease._result,
            error: lease._error
        });
    }
}

function getReconciliationHistory(tenantId, limit = 20) {
    tenantId = requireTenantId(tenantId, 'rag-reconciliation-history');
    return db.prepare(`
        SELECT audit_id, tenant_id, dry_run, operator_id, status, summary_json,
               continuation_offset, started_at, completed_at, duration_ms, error_message
        FROM rag_reconciliation_runs
        WHERE tenant_id = ?
        ORDER BY started_at DESC
        LIMIT ?
    `).all(tenantId, Math.max(1, Math.min(100, Number(limit) || 20)))
        .map(row => ({ ...row, summary: row.summary_json ? JSON.parse(row.summary_json) : null }));
}

module.exports = {
    REQUIRED_PAYLOAD_FIELDS,
    SAFE_DELETE_TYPES,
    payloadIsValid,
    reconcileRagIndex,
    getReconciliationHistory,
    acquireCleanupLease,
    releaseCleanupLease
};
