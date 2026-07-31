const loggedDecisions = new Set();
let sharedPolicy = null;

function normalizeOrigin(value) {
    if (!value || !String(value).trim()) return null;
    const parsed = new URL(String(value).trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`Unsupported origin protocol: ${parsed.protocol}`);
    }
    return parsed.origin;
}

function parseAllowedOrigins(env = process.env) {
    const configured = [
        ...(env.ALLOWED_ORIGINS || '').split(','),
        env.FRONTEND_ORIGIN || ''
    ];
    const origins = new Set();
    for (const candidate of configured) {
        if (!String(candidate).trim()) continue;
        try {
            origins.add(normalizeOrigin(candidate));
        } catch (error) {
            throw new Error(`[Origin Policy] Invalid configured origin "${String(candidate).trim()}": ${error.message}`);
        }
    }
    return origins;
}

function logDecision(scope, decision, origin) {
    const key = `${scope}:${decision}:${origin}`;
    if (loggedDecisions.has(key)) return;
    loggedDecisions.add(key);
    console[decision === 'Allowed' ? 'log' : 'warn'](`[${scope}] ${decision} origin: ${origin}`);
}

function createOriginPolicy(env = process.env) {
    const allowedOrigins = parseAllowedOrigins(env);
    const isProduction = env.NODE_ENV === 'production';
    if (isProduction && allowedOrigins.size === 0) {
        throw new Error('[Origin Policy] Production startup refused: configure ALLOWED_ORIGINS or FRONTEND_ORIGIN.');
    }

    function evaluate(origin, scope = 'CORS') {
        if (!origin) {
            return { allowed: true, reason: 'non-browser' };
        }
        let normalized;
        try {
            normalized = normalizeOrigin(origin);
        } catch (_) {
            logDecision(scope, 'Rejected', String(origin));
            return { allowed: false, reason: 'invalid-origin' };
        }
        const allowed = allowedOrigins.has(normalized);
        logDecision(scope, allowed ? 'Allowed' : 'Rejected', normalized);
        return { allowed, normalized, reason: allowed ? 'allowlist' : 'not-allowlisted' };
    }

    return Object.freeze({
        allowedOrigins,
        credentials: true,
        methods: Object.freeze(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']),
        allowedHeaders: Object.freeze([
            'Content-Type',
            'X-CSRF-Token',
            'X-Session-ID',
            'X-Request-ID',
            'X-Correlation-ID'
        ]),
        exposedHeaders: Object.freeze([
            'X-Request-ID',
            'X-Correlation-ID',
            'RateLimit-Limit',
            'RateLimit-Remaining',
            'RateLimit-Reset',
            'Retry-After'
        ]),
        evaluate
    });
}

function getOriginPolicy() {
    if (!sharedPolicy) sharedPolicy = createOriginPolicy();
    return sharedPolicy;
}

module.exports = {
    normalizeOrigin,
    parseAllowedOrigins,
    createOriginPolicy,
    getOriginPolicy
};
