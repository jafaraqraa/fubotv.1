const path = require('path');

process.env.SQLITE_DB_PATH = process.env.RAG_LOCK_TEST_DB;
process.env.RAG_LOCK_TTL_MS = process.env.RAG_LOCK_TTL_MS || '2000';
process.env.RAG_LOCK_HEARTBEAT_MS = process.env.RAG_LOCK_HEARTBEAT_MS || '500';
process.env.RAG_LOCK_MAX_WAIT_MS = process.env.RAG_LOCK_MAX_WAIT_MS || '500';
process.env.RAG_LOCK_RETRY_DELAY_MS = process.env.RAG_LOCK_RETRY_DELAY_MS || '25';

require(path.join(__dirname, '..', '..', 'src', 'database', 'initialize')).initializeDatabase();
const service = require(path.join(__dirname, '..', '..', 'src', 'rag', 'runtime', 'distributedLockService'));

(async () => {
    try {
        const lease = await service.acquireLease({
            tenantId: process.env.RAG_LOCK_TENANT,
            resourceType: 'document',
            resourceId: process.env.RAG_LOCK_RESOURCE,
            operation: 'worker_replace',
            failFast: process.env.RAG_LOCK_FAIL_FAST !== 'false'
        });
        process.send?.({ type: 'acquired', fencingToken: lease.fencingToken });
        process.on('message', async message => {
            if (message === 'release') {
                await lease.release({ result: { worker: true } });
                process.exit(0);
            }
        });
    } catch (error) {
        process.send?.({ type: 'error', code: error.code, message: error.message });
        process.exit(2);
    }
})();

