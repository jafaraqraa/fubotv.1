const RETRYABLE_NETWORK_CODES = new Set([
    'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET'
]);

function isRetryableStatus(status) {
    return status === 429 || status === 408 || status === 425 || (status >= 500 && status <= 599);
}

function isRetryableError(error) {
    if (!error) return false;
    if (error.name === 'AbortError' || error.code === 'PROVIDER_TIMEOUT') return true;
    return RETRYABLE_NETWORK_CODES.has(error.code)
        || RETRYABLE_NETWORK_CODES.has(error.cause?.code);
}

function delay(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason || new Error('Request aborted'));
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(signal.reason || new Error('Request aborted'));
        }, { once: true });
    });
}

async function reliableFetch(url, options = {}, policy = {}) {
    const timeoutMs = Number(policy.timeoutMs || process.env.PROVIDER_REQUEST_TIMEOUT_MS) || 15000;
    const maxAttempts = Math.max(1, Number(policy.maxAttempts || process.env.PROVIDER_MAX_ATTEMPTS) || 2);
    const baseDelayMs = Math.max(1, Number(policy.baseDelayMs) || 200);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const timeoutController = new AbortController();
        const timeout = setTimeout(() => {
            const error = Object.assign(new Error(`Provider request timed out after ${timeoutMs}ms`), {
                code: 'PROVIDER_TIMEOUT'
            });
            timeoutController.abort(error);
        }, timeoutMs);

        const signals = [options.signal, timeoutController.signal].filter(Boolean);
        const signal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);
        try {
            const response = await fetch(url, { ...options, signal });
            if (!isRetryableStatus(response.status) || attempt === maxAttempts) {
                return response;
            }
            await response.body?.cancel?.().catch(() => {});
            console.warn(JSON.stringify({
                level: 'warn',
                event: 'provider_retry',
                attempt,
                maxAttempts,
                status: response.status
            }));
        } catch (error) {
            const normalized = timeoutController.signal.aborted && !options.signal?.aborted
                ? timeoutController.signal.reason
                : error;
            if (attempt === maxAttempts || !isRetryableError(normalized) || options.signal?.aborted) {
                throw normalized;
            }
            console.warn(JSON.stringify({
                level: 'warn',
                event: normalized.code === 'PROVIDER_TIMEOUT' ? 'provider_timeout_retry' : 'provider_retry',
                attempt,
                maxAttempts,
                code: normalized.code || normalized.cause?.code || null
            }));
        } finally {
            clearTimeout(timeout);
        }

        const jitter = Math.floor(Math.random() * baseDelayMs);
        await delay((baseDelayMs * (2 ** (attempt - 1))) + jitter, options.signal);
    }
    throw new Error('Provider request exhausted retry policy');
}

module.exports = {
    reliableFetch,
    isRetryableStatus,
    isRetryableError
};
