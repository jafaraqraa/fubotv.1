const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-locks-'));
const dbPath = path.join(root, 'locks.db');
process.env.SQLITE_DB_PATH = dbPath;
process.env.RAG_DISTRIBUTED_LOCK_ENABLED = 'true';
process.env.RAG_LOCK_PROVIDER = 'sqlite';
process.env.RAG_LOCK_TTL_MS = '1000';
process.env.RAG_LOCK_HEARTBEAT_MS = '200';
process.env.RAG_LOCK_MAX_WAIT_MS = '150';
process.env.RAG_LOCK_RETRY_DELAY_MS = '20';
process.env.RAG_LOCK_STALE_SCAN_INTERVAL_MS = '1000';

require('../src/database/initialize').initializeDatabase();
const db = require('../src/database/connection');
const locks = require('../src/rag/runtime/distributedLockService');

function input(overrides = {}) {
    return {
        tenantId: 'tenant-a',
        resourceType: 'document',
        resourceId: 'doc-x',
        operation: 'document_replace',
        failFast: true,
        ...overrides
    };
}

function expire(lease) {
    db.prepare('UPDATE rag_operation_locks SET expires_at = ? WHERE lock_key = ?')
        .run(Date.now() - 1, lease.lockKey);
}

function worker(env = {}) {
    return fork(path.join(__dirname, 'helpers', 'rag_lock_worker.js'), [], {
        env: {
            ...process.env,
            RAG_LOCK_TEST_DB: dbPath,
            RAG_LOCK_TENANT: 'worker-tenant',
            RAG_LOCK_RESOURCE: 'worker-doc',
            ...env
        },
        stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    });
}

function message(child) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('worker timeout')), 5000);
        child.once('message', value => { clearTimeout(timer); resolve(value); });
        child.once('error', reject);
    });
}

test('SQLite distributed RAG leases', async t => {
    await t.test('free lock acquires and conflicting operation is rejected', async () => {
        const first = await locks.acquireLease(input());
        await assert.rejects(locks.acquireLease(input({ operation: 'document_delete' })),
            error => error.code === 'RAG_OPERATION_IN_PROGRESS');
        await first.release();
    });

    await t.test('different tenants and different documents do not conflict', async () => {
        const a = await locks.acquireLease(input());
        const b = await locks.acquireLease(input({ tenantId: 'tenant-b' }));
        const c = await locks.acquireLease(input({ resourceId: 'doc-y' }));
        await Promise.all([a.release(), b.release(), c.release()]);
    });

    await t.test('foreign owner cannot release and ownership token is enforced', async () => {
        const lease = await locks.acquireLease(input());
        db.prepare('UPDATE rag_operation_locks SET owner_token = ? WHERE lock_key = ?')
            .run('foreign-owner', lease.lockKey);
        assert.strictEqual(await lease.release(), false);
        expire(lease);
    });

    await t.test('expired lease is reclaimed with a higher fencing token', async () => {
        const stale = await locks.acquireLease(input());
        const oldFence = stale.fencingToken;
        expire(stale);
        const fresh = await locks.acquireLease(input());
        assert.ok(fresh.fencingToken > oldFence);
        assert.throws(() => stale.assertOwnership(), error => error.code === 'RAG_LOCK_LOST');
        await fresh.release();
    });

    await t.test('non-expired lease cannot be stolen', async () => {
        const lease = await locks.acquireLease(input());
        await assert.rejects(locks.acquireLease(input()), /conflicting RAG operation/i);
        assert.strictEqual(lease.owns(), true);
        await lease.release();
    });

    await t.test('heartbeat renews lease', async () => {
        const lease = await locks.acquireLease(input());
        const before = db.prepare('SELECT expires_at FROM rag_operation_locks WHERE lock_key = ?')
            .get(lease.lockKey).expires_at;
        await new Promise(resolve => setTimeout(resolve, 260));
        const after = db.prepare('SELECT expires_at FROM rag_operation_locks WHERE lock_key = ?')
            .get(lease.lockKey).expires_at;
        assert.ok(after > before);
        await lease.release();
    });

    await t.test('ownership loss aborts the operation signal and prevents commit', async () => {
        const lease = await locks.acquireLease(input());
        db.prepare('UPDATE rag_operation_locks SET fencing_token = fencing_token + 1 WHERE lock_key = ?')
            .run(lease.lockKey);
        assert.throws(() => lease.assertOwnership(), error => error.code === 'RAG_LOCK_LOST');
        assert.strictEqual(lease.signal.aborted, true);
        await lease.release();
        db.prepare('UPDATE rag_operation_locks SET expires_at = 0 WHERE lock_key = ?').run(lease.lockKey);
    });

    await t.test('release occurs on success and failure records operation state', async () => {
        const success = await locks.acquireLease(input());
        await success.release({ result: { ok: true } });
        assert.strictEqual(db.prepare('SELECT expires_at FROM rag_operation_locks WHERE lock_key = ?')
            .get(success.lockKey).expires_at, 0);
        const failure = await locks.acquireLease(input());
        await failure.release({ error: Object.assign(new Error('boom'), { code: 'TEST_FAILURE' }) });
        assert.strictEqual(db.prepare('SELECT status FROM rag_operations WHERE operation_id = ?')
            .get(failure.operationId).status, 'failed');
    });

    await t.test('lock storage outage fails closed', async () => {
        db.exec('ALTER TABLE rag_operation_locks RENAME TO rag_operation_locks_offline');
        await assert.rejects(locks.acquireLease(input()),
            error => error.code === 'RAG_LOCK_SERVICE_UNAVAILABLE');
        db.exec('ALTER TABLE rag_operation_locks_offline RENAME TO rag_operation_locks');
    });

    await t.test('client cancellation stops bounded waiting', async () => {
        const lease = await locks.acquireLease(input());
        const controller = new AbortController();
        const waiting = locks.acquireLease(input({
            failFast: false, maxWaitMs: 150, signal: controller.signal
        }));
        setTimeout(() => controller.abort(), 30);
        await assert.rejects(waiting, error => error.code === 'ABORT_ERR');
        await lease.release();
    });

    await t.test('maximum wait is bounded', async () => {
        const lease = await locks.acquireLease(input());
        const started = Date.now();
        await assert.rejects(locks.acquireLease(input({ failFast: false, maxWaitMs: 60 })),
            error => error.code === 'RAG_OPERATION_IN_PROGRESS');
        assert.ok(Date.now() - started < 500);
        await lease.release();
    });

    await t.test('only one racer reclaims an expired lease', async () => {
        const stale = await locks.acquireLease(input());
        expire(stale);
        const results = await Promise.allSettled(
            Array.from({ length: 10 }, (_, index) =>
                locks.acquireLease(input({ operation: `race_${index}` })))
        );
        assert.strictEqual(results.filter(item => item.status === 'fulfilled').length, 1);
        await results.find(item => item.status === 'fulfilled').value.release();
    });

    await t.test('tenant cleanup conflicts with active indexing but retrieval remains lock-free', async () => {
        const indexing = await locks.acquireLease(input());
        await assert.rejects(locks.acquireLease(input({
            resourceType: 'tenant_cleanup', resourceId: 'tenant-a',
            operation: 'reconciliation_cleanup'
        })), error => error.code === 'RAG_OPERATION_IN_PROGRESS');
        assert.strictEqual(db.prepare('SELECT 42 value').get().value, 42);
        await indexing.release();
    });

    await t.test('duplicate idempotency key returns existing operation', async () => {
        const first = await locks.acquireLease(input({ idempotencyKey: 'same-request' }));
        const duplicate = await locks.acquireLease(input({ idempotencyKey: 'same-request' }));
        assert.strictEqual(duplicate.duplicate, true);
        assert.strictEqual(duplicate.operation.operation_id, first.operationId);
        await first.release({ result: { ok: true } });
    });

    await t.test('startup stale recovery is idempotent', async () => {
        const stale = await locks.acquireLease(input());
        expire(stale);
        assert.strictEqual(locks.recoverStaleLeases().length, 1);
        assert.strictEqual(locks.recoverStaleLeases().length, 1);
        assert.strictEqual(db.prepare('SELECT status FROM rag_operations WHERE operation_id = ?')
            .get(stale.operationId).status, 'abandoned');
        const reclaimed = await locks.acquireLease(input());
        await reclaimed.release();
    });

    await t.test('20 same-resource requests produce one acquisition and no duplicate activation window', async () => {
        const results = await Promise.allSettled(Array.from({ length: 20 }, (_, index) =>
            locks.acquireLease(input({ operation: `load_same_${index}` }))));
        const winners = results.filter(item => item.status === 'fulfilled');
        assert.strictEqual(winners.length, 1);
        assert.strictEqual(results.filter(item => item.status === 'rejected').length, 19);
        await winners[0].value.release();
    });

    await t.test('20 requests across tenants can acquire concurrently', async () => {
        const leases = await Promise.all(Array.from({ length: 20 }, (_, index) =>
            locks.acquireLease(input({ tenantId: `tenant-${index}` }))));
        assert.strictEqual(leases.length, 20);
        await Promise.all(leases.map(lease => lease.release()));
    });

    await t.test('real two-process contention serializes the same tenant/document', async () => {
        const first = worker();
        const firstMessage = await message(first);
        assert.strictEqual(firstMessage.type, 'acquired');
        const second = worker();
        const secondMessage = await message(second);
        assert.strictEqual(secondMessage.code, 'RAG_OPERATION_IN_PROGRESS');
        first.send('release');
        await new Promise(resolve => first.once('exit', resolve));
        const retry = worker();
        const retryMessage = await message(retry);
        assert.strictEqual(retryMessage.type, 'acquired');
        assert.ok(retryMessage.fencingToken > firstMessage.fencingToken);
        retry.send('release');
        await new Promise(resolve => retry.once('exit', resolve));
    });

    await t.test('real processes allow equivalent resources for different tenants', async () => {
        const a = worker({ RAG_LOCK_TENANT: 'worker-a' });
        const b = worker({ RAG_LOCK_TENANT: 'worker-b' });
        const [ma, mb] = await Promise.all([message(a), message(b)]);
        assert.strictEqual(ma.type, 'acquired');
        assert.strictEqual(mb.type, 'acquired');
        a.send('release'); b.send('release');
        await Promise.all([
            new Promise(resolve => a.once('exit', resolve)),
            new Promise(resolve => b.once('exit', resolve))
        ]);
    });
});

test.after(() => {
    locks.stopStaleLeaseRecovery();
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
});

