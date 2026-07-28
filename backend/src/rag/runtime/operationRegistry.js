const { RagCancelledError } = require('./asyncControl');

let accepting = true;
const active = new Set();

function registerOperation(operation, parentSignal) {
    if (!accepting) throw new RagCancelledError({ operation: 'shutdown_reject_new' });
    const controller = new AbortController();
    const entry = { operation, controller };
    const onAbort = () => controller.abort(parentSignal.reason);
    parentSignal?.addEventListener('abort', onAbort, { once: true });
    active.add(entry);
    return {
        signal: controller.signal,
        done() {
            parentSignal?.removeEventListener('abort', onAbort);
            active.delete(entry);
        }
    };
}

async function beginShutdown(graceMs) {
    accepting = false;
    const deadline = Date.now() + graceMs;
    while (active.size && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (active.size) {
        for (const entry of active) entry.controller.abort(new Error('shutdown'));
        console.warn(`[RAG Cancel] Shutdown grace expired; aborted=${active.size}`);
    }
}

function resetForTests() {
    accepting = true;
    for (const entry of active) entry.controller.abort();
    active.clear();
}

module.exports = {
    registerOperation, beginShutdown, resetForTests,
    getActiveCount: () => active.size,
    isAccepting: () => accepting
};
