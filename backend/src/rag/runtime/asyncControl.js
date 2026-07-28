const { performance } = require('perf_hooks');

class RagOperationError extends Error {
    constructor(message, details = {}) {
        super(message, { cause: details.cause });
        this.name = this.constructor.name;
        this.code = details.code || 'RAG_OPERATION_FAILED';
        this.operation = details.operation || 'unknown';
        this.timeoutMs = details.timeoutMs;
        this.retryable = details.retryable === true;
        this.stage = details.stage || this.operation;
        this.tenantId = details.tenantId;
        this.documentId = details.documentId;
        this.indexVersionId = details.indexVersionId;
    }
}

class RagTimeoutError extends RagOperationError {
    constructor(details = {}) {
        super(`RAG dependency timed out during ${details.operation}.`, {
            ...details, code: details.code || 'RAG_DEPENDENCY_TIMEOUT', retryable: true
        });
    }
}

class RagCancelledError extends RagOperationError {
    constructor(details = {}) {
        super(`RAG operation cancelled during ${details.operation}.`, {
            ...details, code: 'RAG_REQUEST_CANCELLED', retryable: false
        });
    }
}

class RagTransientError extends RagOperationError {
    constructor(message, details = {}) {
        super(message, { ...details, code: details.code || 'RAG_TRANSIENT_ERROR', retryable: true });
    }
}

class RagPermanentError extends RagOperationError {
    constructor(message, details = {}) {
        super(message, { ...details, code: details.code || 'RAG_PERMANENT_ERROR', retryable: false });
    }
}

async function withTimeout({ operation, timeoutMs, parentSignal, errorCode, context = {}, fn }) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new RagPermanentError(`Invalid timeout for ${operation}.`, {
            operation, code: 'RAG_INVALID_TIMEOUT'
        });
    }
    if (parentSignal?.aborted) throw new RagCancelledError({ operation, ...context });
    const controller = new AbortController();
    let timedOut = false;
    const onParentAbort = () => controller.abort(parentSignal.reason);
    parentSignal?.addEventListener('abort', onParentAbort, { once: true });
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error('timeout'));
    }, timeoutMs);
    const startedAt = performance.now();
    try {
        return await fn(controller.signal);
    } catch (error) {
        if (parentSignal?.aborted) {
            throw new RagCancelledError({ operation, cause: error, ...context });
        }
        if (timedOut) {
            throw new RagTimeoutError({
                operation, timeoutMs, code: errorCode, cause: error, ...context
            });
        }
        throw error;
    } finally {
        clearTimeout(timer);
        parentSignal?.removeEventListener('abort', onParentAbort);
        const durationMs = performance.now() - startedAt;
        if (durationMs >= timeoutMs) {
            console.warn(`[RAG Timeout] operation=${operation} durationMs=${durationMs.toFixed(1)}`);
        }
    }
}

function abortableDelay(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new RagCancelledError({ operation: 'retry_backoff' }));
        const timer = setTimeout(done, ms);
        function onAbort() {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            reject(new RagCancelledError({ operation: 'retry_backoff' }));
        }
        function done() {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

async function retryOperation({
    operation, fn, signal, maxAttempts = 3, baseDelayMs = 300,
    maxDelayMs = 3000, shouldRetry = error => error?.retryable === true,
    random = Math.random
}) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (signal?.aborted) throw new RagCancelledError({ operation });
        try {
            return await fn(attempt);
        } catch (error) {
            lastError = error;
            if (attempt >= maxAttempts || !shouldRetry(error) || signal?.aborted) throw error;
            const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
            const delayMs = Math.min(maxDelayMs, Math.max(1, Math.round(exponential * (0.75 + random() * 0.5))));
            console.warn(`[RAG Retry] operation=${operation} attempt=${attempt + 1}/${maxAttempts} delayMs=${delayMs}`);
            await abortableDelay(delayMs, signal);
        }
    }
    throw lastError;
}

async function runBoundedOrdered({
    items, concurrency, signal, worker, onProgress, operation = 'bounded_work'
}) {
    if (!Array.isArray(items)) throw new RagPermanentError('Items must be an array.', { operation });
    const limit = Math.max(1, Math.min(items.length || 1, Number(concurrency)));
    const results = new Array(items.length);
    const controller = new AbortController();
    const onParentAbort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', onParentAbort, { once: true });
    let nextIndex = 0;
    let completed = 0;
    let failed = 0;
    let active = 0;
    let fatalError = null;
    const report = () => onProgress?.({
        completed, total: items.length, failed, active, queued: items.length - completed - active
    });
    async function runner() {
        while (!fatalError && !controller.signal.aborted) {
            const index = nextIndex++;
            if (index >= items.length) return;
            active++; report();
            try {
                results[index] = await worker(items[index], index, controller.signal);
                completed++;
            } catch (error) {
                failed++;
                fatalError = error;
                controller.abort(error);
            } finally {
                active--; report();
            }
        }
    }
    try {
        await Promise.all(Array.from({ length: limit }, runner));
        if (signal?.aborted) throw new RagCancelledError({ operation });
        if (fatalError) throw fatalError;
        return results;
    } finally {
        signal?.removeEventListener('abort', onParentAbort);
    }
}

module.exports = {
    RagOperationError, RagTimeoutError, RagCancelledError,
    RagTransientError, RagPermanentError,
    withTimeout, retryOperation, runBoundedOrdered, abortableDelay
};
