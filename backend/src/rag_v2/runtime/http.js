'use strict';

function abortError(message, code, cause) {
    const error = new Error(message, cause ? { cause } : undefined); error.code = code; return error;
}

async function fetchJson(url, options = {}) {
    const controller = new AbortController();
    const timeoutMs = Number(options.timeoutMs) || 10000;
    const timeout = setTimeout(() => controller.abort(abortError('request timed out', 'RAG_V2_TIMEOUT')), timeoutMs);
    const onAbort = () => controller.abort(options.signal?.reason || abortError('request cancelled', 'RAG_V2_CANCELLED'));
    options.signal?.addEventListener('abort', onAbort, { once: true });
    try {
        const response = await (options.fetch || global.fetch)(url, {
            method: options.method || 'GET', headers: options.headers,
            body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: controller.signal
        });
        let payload = null;
        try { payload = await response.json(); } catch (_) {}
        if (!response.ok) {
            const error = new Error(`dependency returned HTTP ${response.status}`);
            error.code = `RAG_V2_HTTP_${response.status}`; error.status = response.status;
            error.dependencyError = payload?.status?.error || payload?.message || payload?.error || null;
            error.retryable = [429, 502, 503, 504].includes(response.status); throw error;
        }
        return payload;
    } catch (error) {
        if (controller.signal.aborted && error?.code !== 'RAG_V2_CANCELLED') {
            const reason = controller.signal.reason;
            if (reason?.code) throw reason;
            throw abortError('request timed out or cancelled', 'RAG_V2_TIMEOUT', error);
        }
        throw error;
    } finally {
        clearTimeout(timeout); options.signal?.removeEventListener('abort', onAbort);
    }
}

module.exports = { fetchJson };
