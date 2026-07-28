const { RagCancelledError } = require('./asyncControl');

let active = 0;
const queue = [];

function drain(limit) {
    while (active < limit && queue.length) {
        const entry = queue.shift();
        if (entry.signal?.aborted) {
            entry.cleanup();
            entry.reject(new RagCancelledError({ operation: 'embedding_queue' }));
            continue;
        }
        active++;
        entry.cleanup();
        entry.resolve(() => {
            if (entry.released) return;
            entry.released = true;
            active--;
            drain(entry.limit);
        });
    }
}

function acquire(limit, signal) {
    if (signal?.aborted) {
        return Promise.reject(new RagCancelledError({ operation: 'embedding_queue' }));
    }
    return new Promise((resolve, reject) => {
        const entry = {
            limit: Math.max(1, Number(limit) || 1), signal, resolve, reject, released: false
        };
        const onAbort = () => {
            const index = queue.indexOf(entry);
            if (index >= 0) queue.splice(index, 1);
            entry.cleanup();
            reject(new RagCancelledError({ operation: 'embedding_queue' }));
        };
        entry.cleanup = () => signal?.removeEventListener('abort', onAbort);
        signal?.addEventListener('abort', onAbort, { once: true });
        queue.push(entry);
        drain(entry.limit);
    });
}

function snapshot() {
    return { active, queued: queue.length };
}

function resetForTests() {
    for (const entry of queue.splice(0)) {
        entry.cleanup();
        entry.reject(new RagCancelledError({ operation: 'embedding_queue' }));
    }
    active = 0;
}

module.exports = { acquire, snapshot, resetForTests };
