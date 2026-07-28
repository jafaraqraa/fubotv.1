const crypto = require('crypto');
const os = require('os');
const db = require('../../database/connection');
const metrics = require('./ragMetrics');
const { requireTenantId } = require('../security/tenantContext');

const startupId = crypto.randomUUID();
const instanceId = process.env.RAG_INSTANCE_ID
    || `${os.hostname()}:${process.pid}:${startupId}`;

function positiveNumber(name, fallback) {
    const raw = process.env[name];
    const value = raw == null || raw === '' ? fallback : Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${name} must be a positive number.`);
    }
    return value;
}

function getConfig() {
    const enabled = String(process.env.RAG_DISTRIBUTED_LOCK_ENABLED ?? 'true').toLowerCase() === 'true';
    const provider = String(process.env.RAG_LOCK_PROVIDER || 'sqlite').toLowerCase();
    const ttlMs = positiveNumber('RAG_LOCK_TTL_MS', 60000);
    const heartbeatMs = positiveNumber('RAG_LOCK_HEARTBEAT_MS', 15000);
    const maxWaitMs = positiveNumber('RAG_LOCK_MAX_WAIT_MS', 15000);
    const retryDelayMs = positiveNumber('RAG_LOCK_RETRY_DELAY_MS', 250);
    const staleScanIntervalMs = positiveNumber('RAG_LOCK_STALE_SCAN_INTERVAL_MS', 60000);
    if (heartbeatMs >= ttlMs / 2) {
        throw new Error('RAG_LOCK_HEARTBEAT_MS must be less than half of RAG_LOCK_TTL_MS.');
    }
    if (provider !== 'sqlite') {
        const error = new Error(`Unsupported RAG lock provider: ${provider}`);
        error.code = 'RAG_LOCK_SERVICE_UNAVAILABLE';
        throw error;
    }
    const workers = Number(process.env.WEB_CONCURRENCY || process.env.NODE_CLUSTER_WORKERS || 1);
    if (!enabled && process.env.NODE_ENV === 'production' && workers > 1) {
        throw new Error('Distributed RAG locks cannot be disabled with multiple production workers.');
    }
    return { enabled, provider, ttlMs, heartbeatMs, maxWaitMs, retryDelayMs, staleScanIntervalMs };
}

function safeResource(value) {
    const result = String(value || '').trim();
    if (!result || result.length > 300 || /[\u0000-\u001f]/.test(result)) {
        const error = new Error('Invalid RAG lock resource identifier.');
        error.code = 'RAG_LOCK_INVALID_RESOURCE';
        throw error;
    }
    return result;
}

function lockKeyFor({ tenantId, resourceType, resourceId }) {
    tenantId = requireTenantId(tenantId, 'rag-lock-key');
    resourceType = safeResource(resourceType);
    resourceId = safeResource(resourceId);
    const supported = new Set([
        'document', 'knowledge_txt', 'tenant_scan', 'tenant_cleanup', 'collection', 'migration'
    ]);
    if (!supported.has(resourceType)) {
        const error = new Error(`Unsupported RAG lock resource type: ${resourceType}`);
        error.code = 'RAG_LOCK_INVALID_RESOURCE';
        throw error;
    }
    if (resourceType === 'migration') return `rag:migration:${resourceId}`;
    if (resourceType === 'knowledge_txt') return `rag:knowledge_txt:${tenantId}`;
    if (resourceType === 'tenant_scan') return `rag:reconcile:${tenantId}`;
    if (resourceType === 'tenant_cleanup') return `rag:cleanup:${tenantId}`;
    if (resourceType === 'collection') return `rag:collection:${tenantId}:${resourceId}`;
    return `rag:document:${tenantId}:${resourceId}`;
}

function makeError(code, message, extra = {}) {
    return Object.assign(new Error(message), { code, retryable: true, ...extra });
}

function throwIfAborted(signal) {
    if (signal?.aborted) {
        throw Object.assign(new Error('RAG lock acquisition cancelled.'), { code: 'ABORT_ERR' });
    }
}

function legacyConflict(tenantId, resourceType, resourceId, now) {
    if (resourceType === 'knowledge_txt') {
        db.prepare('DELETE FROM rag_index_locks WHERE expires_at <= ?').run(now);
        return Boolean(db.prepare(`
            SELECT 1 FROM rag_index_locks
            WHERE tenant_id = ? AND expires_at > ? LIMIT 1
        `).get(tenantId, now));
    }
    if (resourceType === 'document') {
        db.prepare('DELETE FROM rag_document_locks WHERE expires_at <= ?').run(now);
        return Boolean(db.prepare(`
            SELECT 1 FROM rag_document_locks
            WHERE tenant_id = ? AND logical_document_id = ? AND expires_at > ? LIMIT 1
        `).get(tenantId, resourceId, now));
    }
    if (resourceType === 'tenant_cleanup') {
        db.prepare('DELETE FROM rag_reconciliation_locks WHERE expires_at <= ?').run(now);
        return Boolean(db.prepare(`
            SELECT 1 FROM rag_reconciliation_locks
            WHERE tenant_id = ? AND expires_at > ? LIMIT 1
        `).get(tenantId, now));
    }
    return false;
}

function hasConflict(tenantId, resourceType, lockKey, now) {
    if (resourceType === 'tenant_cleanup') {
        return Boolean(db.prepare(`
            SELECT 1 FROM rag_operation_locks
            WHERE tenant_id = ? AND expires_at > ? LIMIT 1
        `).get(tenantId, now));
    }
    return Boolean(db.prepare(`
        SELECT 1 FROM rag_operation_locks
        WHERE expires_at > ? AND (
            lock_key = ? OR
            (tenant_id = ? AND resource_type IN ('tenant_cleanup', 'collection'))
        ) LIMIT 1
    `).get(now, lockKey, tenantId));
}

function tryAcquire(input) {
    const now = Date.now();
    const ownerToken = crypto.randomUUID();
    const lockKey = lockKeyFor(input);
    const ttlMs = input.ttlMs;
    let reclaimed = false;
    let fencingToken;

    const acquired = db.transaction(() => {
        const existing = db.prepare(
            'SELECT expires_at, fencing_token FROM rag_operation_locks WHERE lock_key = ?'
        ).get(lockKey);
        if (legacyConflict(input.tenantId, input.resourceType, input.resourceId, now)
            || hasConflict(input.tenantId, input.resourceType, lockKey, now)) return false;
        reclaimed = Boolean(existing && existing.expires_at > 0 && existing.expires_at <= now);
        const result = db.prepare(`
            INSERT INTO rag_operation_locks (
                lock_key, tenant_id, resource_type, resource_id, owner_token,
                owner_instance_id, operation, operation_id, fencing_token, acquired_at,
                expires_at, heartbeat_at, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
            ON CONFLICT(lock_key) DO UPDATE SET
                tenant_id = excluded.tenant_id,
                resource_type = excluded.resource_type,
                resource_id = excluded.resource_id,
                owner_token = excluded.owner_token,
                owner_instance_id = excluded.owner_instance_id,
                operation = excluded.operation,
                operation_id = excluded.operation_id,
                fencing_token = rag_operation_locks.fencing_token + 1,
                acquired_at = excluded.acquired_at,
                expires_at = excluded.expires_at,
                heartbeat_at = excluded.heartbeat_at,
                metadata_json = excluded.metadata_json,
                updated_at = CURRENT_TIMESTAMP
            WHERE rag_operation_locks.expires_at <= ?
        `).run(
            lockKey, input.tenantId, input.resourceType, input.resourceId,
            ownerToken, instanceId, input.operation, input.operationId,
            now, now + ttlMs, now,
            JSON.stringify(input.metadata || {}), now
        );
        if (result.changes !== 1) return false;
        fencingToken = db.prepare(
            'SELECT fencing_token FROM rag_operation_locks WHERE lock_key = ?'
        ).get(lockKey).fencing_token;
        return true;
    })();

    return acquired ? { lockKey, ownerToken, fencingToken, acquiredAt: now, reclaimed } : null;
}

function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        const finish = () => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        };
        const timer = setTimeout(finish, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(Object.assign(new Error('RAG lock acquisition cancelled.'), { code: 'ABORT_ERR' }));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

function updateOperation(operationId, fields) {
    const allowed = {
        status: 'status', fencingToken: 'fencing_token', heartbeatAt: 'heartbeat_at',
        completedAt: 'completed_at', failedAt: 'failed_at', errorCode: 'error_code',
        errorMessage: 'error_message', cleanupStatus: 'cleanup_status',
        resultJson: 'result_json', startedAt: 'started_at'
    };
    const entries = Object.entries(fields).filter(([key]) => allowed[key]);
    if (!entries.length) return;
    const setters = entries.map(([key]) => `${allowed[key]} = ?`).join(', ');
    db.prepare(`UPDATE rag_operations SET ${setters}, updated_at = CURRENT_TIMESTAMP WHERE operation_id = ?`)
        .run(...entries.map(([, value]) => value), operationId);
}

async function acquireLease(input) {
    const config = getConfig();
    if (!config.enabled) {
        throw makeError('RAG_LOCK_SERVICE_UNAVAILABLE', 'Distributed RAG locking is disabled.');
    }
    const tenantId = input.resourceType === 'migration'
        ? safeResource(input.tenantId || 'global')
        : requireTenantId(input.tenantId, 'rag-lock-acquire');
    const resourceType = safeResource(input.resourceType);
    const resourceId = safeResource(input.resourceId);
    const operation = safeResource(input.operation);
    const operationId = input.operationId || crypto.randomUUID();
    const idempotencyKey = input.idempotencyKey ? safeResource(input.idempotencyKey) : null;
    const lockKey = lockKeyFor({ tenantId, resourceType, resourceId });
    const maxWaitMs = input.failFast === true ? 0
        : Math.min(Number(input.maxWaitMs ?? config.maxWaitMs), config.maxWaitMs);
    const started = Date.now();

    if (idempotencyKey) {
        const existing = db.prepare(`
            SELECT * FROM rag_operations
            WHERE tenant_id = ? AND operation_type = ? AND idempotency_key = ?
        `).get(tenantId, operation, idempotencyKey);
        if (existing) {
            return { duplicate: true, operation: existing };
        }
    }

    try {
        db.prepare(`
            INSERT INTO rag_operations (
                operation_id, tenant_id, resource_type, resource_id,
                operation_type, status, lock_key, idempotency_key, instance_id
            ) VALUES (?, ?, ?, ?, ?, 'acquiring_lock', ?, ?, ?)
        `).run(operationId, tenantId, resourceType, resourceId, operation, lockKey, idempotencyKey, instanceId);
    } catch (error) {
        if (idempotencyKey && String(error.code).includes('SQLITE_CONSTRAINT')) {
            const existing = db.prepare(`
                SELECT * FROM rag_operations
                WHERE tenant_id = ? AND operation_type = ? AND idempotency_key = ?
            `).get(tenantId, operation, idempotencyKey);
            return { duplicate: true, operation: existing };
        }
        throw makeError('RAG_LOCK_SERVICE_UNAVAILABLE', 'RAG lock storage is unavailable.', { cause: error });
    }

    console.log(`[RAG Lock] Acquire requested tenant=${tenantId} lock=${lockKey} operationId=${operationId} instance=${instanceId}`);
    metrics.increment('ragLockAcquireTotal');
    let acquired;
    while (!acquired) {
        throwIfAborted(input.signal);
        try {
            acquired = tryAcquire({
                tenantId, resourceType, resourceId, operation,
                operationId, ttlMs: config.ttlMs, metadata: input.metadata
            });
        } catch (error) {
            metrics.increment('ragLockAcquireFailuresTotal');
            updateOperation(operationId, {
                status: 'failed', failedAt: new Date().toISOString(),
                errorCode: 'RAG_LOCK_SERVICE_UNAVAILABLE', errorMessage: error.message
            });
            console.error(`[RAG Lock] Storage unavailable tenant=${tenantId} lock=${lockKey} operationId=${operationId}`);
            throw makeError('RAG_LOCK_SERVICE_UNAVAILABLE', 'RAG lock storage is unavailable.', { cause: error });
        }
        if (acquired) break;
        metrics.increment('ragLockContentionTotal');
        if (Date.now() - started >= maxWaitMs) {
            updateOperation(operationId, {
                status: 'failed', failedAt: new Date().toISOString(),
                errorCode: 'RAG_OPERATION_IN_PROGRESS',
                errorMessage: 'Conflicting RAG operation is in progress.'
            });
            console.log(`[RAG Lock] Busy tenant=${tenantId} lock=${lockKey} operationId=${operationId}`);
            throw makeError('RAG_OPERATION_IN_PROGRESS', 'A conflicting RAG operation is already in progress.', {
                operation, waitDurationMs: Date.now() - started
            });
        }
        const jitter = Math.floor(Math.random() * Math.max(10, config.retryDelayMs / 2));
        await sleep(config.retryDelayMs + jitter, input.signal);
    }

    if (acquired.reclaimed) {
        metrics.increment('ragLockStaleReclaimsTotal');
        console.warn(`[RAG Lock] Stale lease reclaimed tenant=${tenantId} lock=${lockKey} operationId=${operationId}`);
    }
    metrics.observe('ragLockWaitDurationMs', Date.now() - started);
    metrics.increment('ragLockActiveCount');
    updateOperation(operationId, {
        status: 'running', fencingToken: acquired.fencingToken,
        startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString()
    });

    const controller = new AbortController();
    const externalAbort = () => controller.abort(input.signal?.reason);
    input.signal?.addEventListener('abort', externalAbort, { once: true });
    let stopped = false;

    const owns = () => {
        const row = db.prepare(`
            SELECT 1 FROM rag_operation_locks
            WHERE lock_key = ? AND owner_token = ? AND fencing_token = ? AND expires_at > ?
        `).get(acquired.lockKey, acquired.ownerToken, acquired.fencingToken, Date.now());
        return Boolean(row);
    };
    const assertOwnership = () => {
        if (!owns()) {
            metrics.increment('ragLockLostTotal');
            controller.abort(makeError('RAG_LOCK_LOST', 'RAG operation lease ownership was lost.'));
            console.error(`[RAG Lock] Ownership lost tenant=${tenantId} lock=${lockKey} operationId=${operationId}`);
            throw makeError('RAG_LOCK_LOST', 'RAG operation lease ownership was lost.');
        }
        return true;
    };
    const renew = () => {
        const now = Date.now();
        const changed = db.prepare(`
            UPDATE rag_operation_locks
            SET expires_at = ?, heartbeat_at = ?, updated_at = CURRENT_TIMESTAMP
            WHERE lock_key = ? AND owner_token = ? AND fencing_token = ? AND expires_at > ?
        `).run(
            now + config.ttlMs, now, acquired.lockKey, acquired.ownerToken,
            acquired.fencingToken, now
        ).changes;
        if (changed !== 1) {
            metrics.increment('ragLockHeartbeatFailuresTotal');
            assertOwnership();
        }
        updateOperation(operationId, { heartbeatAt: new Date().toISOString() });
        console.log(`[RAG Lock] Heartbeat renewed tenant=${tenantId} lock=${lockKey} operationId=${operationId}`);
        return true;
    };
    const heartbeat = setInterval(() => {
        if (stopped) return;
        try {
            renew();
        } catch (_) {
            // assertOwnership already aborts the operation signal. Do not keep
            // retrying after fencing proves this owner is stale.
            clearInterval(heartbeat);
        }
    }, config.heartbeatMs);
    heartbeat.unref?.();

    async function release(outcome = {}) {
        if (stopped) return false;
        stopped = true;
        clearInterval(heartbeat);
        input.signal?.removeEventListener('abort', externalAbort);
        let released = false;
        try {
            released = db.prepare(`
                UPDATE rag_operation_locks
                SET expires_at = 0, heartbeat_at = ?, updated_at = CURRENT_TIMESTAMP
                WHERE lock_key = ? AND owner_token = ? AND fencing_token = ?
            `).run(Date.now(), acquired.lockKey, acquired.ownerToken, acquired.fencingToken).changes === 1;
            if (!released) {
                console.error(`[RAG Lock] Release failed tenant=${tenantId} lock=${lockKey} operationId=${operationId}`);
            } else {
                console.log(`[RAG Lock] Released tenant=${tenantId} lock=${lockKey} operationId=${operationId}`);
            }
        } catch (error) {
            console.error(`[RAG Lock] Release failed tenant=${tenantId} lock=${lockKey} operationId=${operationId}`);
        } finally {
            metrics.increment('ragLockActiveCount', -1);
            updateOperation(operationId, outcome.error ? {
                status: outcome.status || 'failed', failedAt: new Date().toISOString(),
                errorCode: outcome.error.code || 'RAG_OPERATION_FAILED',
                errorMessage: String(outcome.error.message || outcome.error).slice(0, 1000),
                cleanupStatus: outcome.cleanupStatus || null
            } : {
                status: outcome.status || 'completed', completedAt: new Date().toISOString(),
                resultJson: outcome.result === undefined ? null : JSON.stringify(outcome.result)
            });
        }
        return released;
    }

    console.log(`[RAG Lock] Acquired tenant=${tenantId} lock=${lockKey} operationId=${operationId} fencing=${acquired.fencingToken} waitMs=${Date.now() - started}`);
    return {
        duplicate: false, tenantId, resourceType, resourceId, operation,
        operationId, lockKey, fencingToken: acquired.fencingToken,
        signal: controller.signal, renew, owns, assertOwnership, release
    };
}

function recoverStaleLeases() {
    const now = Date.now();
    const stale = db.prepare(`
        SELECT lock_key, tenant_id, resource_type, resource_id, operation, operation_id
        FROM rag_operation_locks WHERE expires_at > 0 AND expires_at <= ?
    `).all(now);
    for (const row of stale) {
        db.prepare(`
            UPDATE rag_operations
            SET status = 'abandoned', failed_at = CURRENT_TIMESTAMP,
                error_code = 'RAG_STALE_LEASE', updated_at = CURRENT_TIMESTAMP
            WHERE operation_id = ? AND status IN ('acquiring_lock', 'running', 'activating', 'cleanup')
        `).run(row.operation_id);
    }
    return stale;
}

function withSynchronousLease(input, work) {
    const config = getConfig();
    if (!config.enabled) {
        throw makeError('RAG_LOCK_SERVICE_UNAVAILABLE', 'Distributed RAG locking is disabled.');
    }
    const tenantId = safeResource(input.tenantId || 'global');
    const resourceType = safeResource(input.resourceType);
    const resourceId = safeResource(input.resourceId);
    const operation = safeResource(input.operation);
    const operationId = crypto.randomUUID();
    const lockKey = lockKeyFor({ tenantId, resourceType, resourceId });
    db.prepare(`
        INSERT INTO rag_operations (
            operation_id, tenant_id, resource_type, resource_id,
            operation_type, status, lock_key, instance_id
        ) VALUES (?, ?, ?, ?, ?, 'acquiring_lock', ?, ?)
    `).run(operationId, tenantId, resourceType, resourceId, operation, lockKey, instanceId);
    const acquired = tryAcquire({
        tenantId, resourceType, resourceId, operation, operationId,
        ttlMs: config.ttlMs, metadata: input.metadata
    });
    if (!acquired) {
        updateOperation(operationId, {
            status: 'failed', failedAt: new Date().toISOString(),
            errorCode: 'RAG_OPERATION_IN_PROGRESS',
            errorMessage: 'Conflicting migration is in progress.'
        });
        throw makeError('RAG_OPERATION_IN_PROGRESS', 'A conflicting RAG migration is in progress.');
    }
    updateOperation(operationId, {
        status: 'running', fencingToken: acquired.fencingToken,
        startedAt: new Date().toISOString()
    });
    const assertOwnership = () => {
        const owns = db.prepare(`
            SELECT 1 FROM rag_operation_locks
            WHERE lock_key = ? AND owner_token = ? AND fencing_token = ? AND expires_at > ?
        `).get(lockKey, acquired.ownerToken, acquired.fencingToken, Date.now());
        if (!owns) throw makeError('RAG_LOCK_LOST', 'RAG migration lease ownership was lost.');
    };
    try {
        const result = work({ operationId, fencingToken: acquired.fencingToken, assertOwnership });
        assertOwnership();
        updateOperation(operationId, {
            status: 'completed', completedAt: new Date().toISOString(),
            resultJson: result === undefined ? null : JSON.stringify(result)
        });
        return result;
    } catch (error) {
        updateOperation(operationId, {
            status: 'failed', failedAt: new Date().toISOString(),
            errorCode: error.code || 'RAG_OPERATION_FAILED',
            errorMessage: String(error.message || error).slice(0, 1000)
        });
        throw error;
    } finally {
        const released = db.prepare(`
            UPDATE rag_operation_locks SET expires_at = 0, updated_at = CURRENT_TIMESTAMP
            WHERE lock_key = ? AND owner_token = ? AND fencing_token = ?
        `).run(lockKey, acquired.ownerToken, acquired.fencingToken).changes;
        if (released !== 1) {
            console.error(`[RAG Lock] Release failed tenant=${tenantId} lock=${lockKey} operationId=${operationId}`);
        }
    }
}

let staleRecoveryTimer = null;
function startStaleLeaseRecovery() {
    const config = getConfig();
    if (!config.enabled || staleRecoveryTimer) return staleRecoveryTimer;
    const run = () => {
        try {
            const stale = recoverStaleLeases();
            if (stale.length) {
                console.warn(`[RAG Lock] Stale lease scan found=${stale.length} instance=${instanceId}`);
            }
        } catch (error) {
            console.error(`[RAG Lock] Storage unavailable during stale scan instance=${instanceId}`);
        }
    };
    run();
    staleRecoveryTimer = setInterval(run, config.staleScanIntervalMs);
    staleRecoveryTimer.unref?.();
    return staleRecoveryTimer;
}

function stopStaleLeaseRecovery() {
    if (staleRecoveryTimer) clearInterval(staleRecoveryTimer);
    staleRecoveryTimer = null;
}

module.exports = {
    acquireLease,
    lockKeyFor,
    getConfig,
    recoverStaleLeases,
    withSynchronousLease,
    startStaleLeaseRecovery,
    stopStaleLeaseRecovery,
    instanceId
};
