const { getConfig } = require('../config/ragConfig');
const { reconcileRagIndex } = require('./ragReconciliationService');
const { configuredTenants } = require('../security/tenantContext');
const { disableTenantRag } = require('../security/tenantRagSafety');
const runtimeState = require('../../runtime/runtimeState');

let timer = null;
let runController = null;
const continuations = new Map();

async function runScheduledReconciliation() {
    if (runController || runtimeState.snapshot().shuttingDown) return false;
    runController = new AbortController();
    try {
        for (const tenantId of configuredTenants()) {
            if (runController.signal.aborted) break;
            try {
                const report = await reconcileRagIndex({
                    tenantId,
                    dryRun: true,
                    useLease: true,
                    signal: runController.signal,
                    operatorId: 'background-reconciliation',
                    continuationOffset: continuations.get(tenantId) ?? null
                });
                if (report.scanComplete) continuations.delete(tenantId);
                else continuations.set(tenantId, report.continuationOffset);
                if (report.issues.some(item => item.type === 'WRONG_TENANT_REFERENCE')) {
                    disableTenantRag(tenantId, 'Cross-tenant vector reference detected during startup reconciliation.');
                }
            } catch (error) {
                if (error.code !== 'RAG_REQUEST_CANCELLED' && error.code !== 'ABORT_ERR') {
                    console.error(JSON.stringify({
                        level: 'error',
                        event: 'background_job_failed',
                        job: 'rag_reconciliation',
                        tenantId,
                        error: error.message
                    }));
                }
            }
        }
        return true;
    } finally {
        runController = null;
    }
}

function startReconciliationScheduler() {
    if (String(getConfig('RAG_RECONCILIATION_ENABLED')) !== 'true' || timer) return false;
    const intervalMs = Math.max(1, Number(getConfig('RAG_RECONCILIATION_INTERVAL_HOURS')) || 24)
        * 60 * 60 * 1000;
    const run = () => runScheduledReconciliation().catch(error => {
        console.error(JSON.stringify({
            level: 'error',
            event: 'background_job_failed',
            job: 'rag_reconciliation',
            error: error.message
        }));
    });
    void run();
    timer = setInterval(run, intervalMs);
    timer.unref?.();
    return true;
}

function stopReconciliationScheduler() {
    if (timer) clearInterval(timer);
    timer = null;
    runController?.abort(new Error('shutdown'));
}

module.exports = {
    configuredTenants,
    runScheduledReconciliation,
    startReconciliationScheduler,
    stopReconciliationScheduler
};
