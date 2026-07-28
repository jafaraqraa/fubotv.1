const metrics = require('./ragMetrics');

function createRequestCancellation(req, res) {
    const controller = new AbortController();
    const cancel = () => {
        if (controller.signal.aborted || res.writableEnded) return;
        metrics.increment('requestsCancelledTotal');
        console.warn('[RAG Cancel] Request cancelled');
        controller.abort(new Error('client disconnected'));
    };
    req.once('aborted', cancel);
    res.once('close', cancel);
    return {
        signal: controller.signal,
        cleanup() {
            req.removeListener('aborted', cancel);
            res.removeListener('close', cancel);
        }
    };
}

module.exports = { createRequestCancellation };
