const STATES = Object.freeze({
    STARTING: 'starting',
    READY: 'ready',
    SHUTTING_DOWN: 'shutting_down'
});

// The reusable Express app is ready by default when embedded in tests/tools.
// The production entrypoint explicitly calls markStarting() before it loads
// the app, so production traffic remains fail-closed during initialization.
let state = STATES.READY;
let reason = null;

function markStarting() {
    state = STATES.STARTING;
    reason = null;
}

function markReady() {
    state = STATES.READY;
    reason = null;
}

function markShuttingDown(shutdownReason) {
    state = STATES.SHUTTING_DOWN;
    reason = shutdownReason || 'shutdown';
}

function snapshot() {
    return {
        state,
        reason,
        ready: state === STATES.READY,
        shuttingDown: state === STATES.SHUTTING_DOWN
    };
}

module.exports = {
    STATES,
    markStarting,
    markReady,
    markShuttingDown,
    snapshot
};
