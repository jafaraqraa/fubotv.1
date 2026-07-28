const state = {
    ollamaRequestDurationMs: [], qdrantRequestDurationMs: [],
    embeddingQueueDepth: 0, embeddingActiveWorkers: 0,
    embeddingFailuresTotal: 0, dependencyTimeoutsTotal: 0,
    dependencyRetriesTotal: 0, requestsCancelledTotal: 0,
    qdrantUploadBatchesTotal: 0,
    ragLockAcquireTotal: 0, ragLockAcquireFailuresTotal: 0,
    ragLockContentionTotal: 0, ragLockHeartbeatFailuresTotal: 0,
    ragLockLostTotal: 0, ragLockStaleReclaimsTotal: 0,
    ragLockActiveCount: 0, ragOperationConflictsTotal: 0,
    ragLockWaitDurationMs: []
};

function observe(name, value) {
    if (!Array.isArray(state[name])) return;
    state[name].push(Number(value));
    if (state[name].length > 1000) state[name].shift();
}
function increment(name, amount = 1) {
    if (typeof state[name] === 'number') state[name] += amount;
}
function setGauge(name, value) {
    if (typeof state[name] === 'number') state[name] = Number(value);
}
function percentile(sorted, fraction) {
    if (!sorted.length) return null;
    const index = Math.ceil(fraction * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}
function snapshot() {
    const result = {};
    for (const [key, value] of Object.entries(state)) {
        if (Array.isArray(value)) {
            const sorted = [...value].sort((a, b) => a - b);
            const enoughSamples = value.length >= 5;
            result[key] = {
                count: value.length,
                averageMs: value.length ? value.reduce((a, b) => a + b, 0) / value.length : null,
                maxMs: value.length ? Math.max(...value) : null,
                p50Ms: enoughSamples ? percentile(sorted, 0.50) : null,
                p95Ms: enoughSamples ? percentile(sorted, 0.95) : null,
                p99Ms: enoughSamples ? percentile(sorted, 0.99) : null,
                sampleStatus: enoughSamples ? 'available' : 'insufficient_samples',
                source: 'monotonic_process_observations',
                scope: 'process',
                exactness: 'sampled',
                includesFailedAttempts: true
            };
        } else result[key] = value;
    }
    return {
        instrumentationVersion: 1,
        aggregationScope: 'process',
        distributedSafe: false,
        warning: 'Runtime samples are process-local; logical counts use SQLite and Qdrant instead.',
        collectedAt: new Date().toISOString(),
        metrics: result
    };
}
function resetForTests() {
    for (const key of Object.keys(state)) state[key] = Array.isArray(state[key]) ? [] : 0;
}

module.exports = { observe, increment, setGauge, snapshot, resetForTests };
