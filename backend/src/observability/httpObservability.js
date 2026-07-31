const crypto = require('node:crypto');
const metrics = require('./runtimeMetrics');

const SAFE_ID = /^[a-zA-Z0-9._:-]{1,128}$/;

function httpObservability(req, res, next) {
    const started = process.hrtime.bigint();
    const incomingRequestId = req.headers['x-request-id'];
    const incomingCorrelationId = req.headers['x-correlation-id'];
    req.requestId = SAFE_ID.test(String(incomingRequestId || ''))
        ? String(incomingRequestId)
        : crypto.randomUUID();
    req.correlationId = SAFE_ID.test(String(incomingCorrelationId || ''))
        ? String(incomingCorrelationId)
        : req.requestId;
    res.setHeader('X-Request-ID', req.requestId);
    res.setHeader('X-Correlation-ID', req.correlationId);

    res.once('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
        const route = metrics.normalizeRoute(req.route?.path || req.path);
        const labels = { method: req.method, route, status: res.statusCode };
        metrics.increment('http_requests_total', labels);
        metrics.observe('http_request_duration_milliseconds', durationMs, {
            method: req.method, route
        });
        if (res.statusCode >= 500) metrics.increment('http_errors_total', labels);
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: res.statusCode >= 500 ? 'error' : 'info',
            event: 'http_request_completed',
            requestId: req.requestId,
            correlationId: req.correlationId,
            method: req.method,
            route,
            status: res.statusCode,
            durationMs: Number(durationMs.toFixed(2)),
            userId: req.session?.userId || null,
            tenantId: req.tenantId || null
        }));
    });
    next();
}

function requireMetricsToken(req, res, next) {
    const configured = process.env.METRICS_TOKEN;
    if (!configured) return res.status(404).end();
    const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const left = Buffer.from(supplied);
    const right = Buffer.from(configured);
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
        return res.status(401).json({ success: false, error: 'Metrics authentication required' });
    }
    next();
}

module.exports = { httpObservability, requireMetricsToken };
