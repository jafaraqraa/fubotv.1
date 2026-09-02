const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const SQLiteStore = require('./database/sessionStore');
const { requireAuth } = require('./middleware/requireAuth');
const { attachAccessContext } = require('./security/accessControl');
const { getOriginPolicy } = require('./security/originPolicy');
const runtimeState = require('./runtime/runtimeState');
const { httpObservability, requireMetricsToken } = require('./observability/httpObservability');
const runtimeMetrics = require('./observability/runtimeMetrics');
const { adminApiLimit, aiLimit, uploadLimit, webhookLimit } = require('./middleware/rateLimits');
const { getSessionCookieOptions } = require('./config/sessionCookieConfig');

const app = express();
const originPolicy = getOriginPolicy();
app.use(httpObservability);

// Trust reverse proxy (Cloud Run, Nginx, etc.) to allow secure cookies over HTTPS
app.set('trust proxy', 1);

// 1. Basic HTTP Security Headers (Task 20)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
    res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), payment=()');
    res.setHeader('Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; "
        + "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        + "font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; "
        + "connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});

// 2. Shared strict origin policy for HTTP and Socket.IO.
app.use((req, res, next) => {
    const origin = req.headers.origin;
    const decision = originPolicy.evaluate(origin, 'CORS');
    if (!decision.allowed) {
        return res.status(403).json({ success: false, error: 'Origin not allowed' });
    }

    if (origin) {
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Origin', decision.normalized);
        res.setHeader('Access-Control-Allow-Credentials', String(originPolicy.credentials));
        res.setHeader('Access-Control-Allow-Methods', originPolicy.methods.join(', '));
        res.setHeader('Access-Control-Allow-Headers', originPolicy.allowedHeaders.join(', '));
        res.setHeader('Access-Control-Expose-Headers', originPolicy.exposedHeaders.join(', '));
        res.setHeader('Access-Control-Max-Age', '600');
    }

    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});
app.originPolicy = originPolicy;

// Reject new application work while startup is incomplete or shutdown is in
// progress. Health/readiness remain available to supervisors.
app.use((req, res, next) => {
    if (['/health', '/ready', '/live', '/internal/metrics'].includes(req.path)) return next();
    const runtime = runtimeState.snapshot();
    if (!runtime.ready) {
        res.setHeader('Connection', 'close');
        return res.status(503).json({
            success: false,
            error: runtime.shuttingDown ? 'Server is shutting down' : 'Server is starting'
        });
    }
    next();
});

// 3. Configure server-side session authentication with custom SQLite Session Store (Task 8)
const sessionMiddleware = session({
    store: new SQLiteStore(),
    secret: require('./config/securityConfig').requireSessionSecret(),
    resave: false,
    saveUninitialized: false,
    name: 'connect.sid',
    cookie: getSessionCookieOptions()
});

// Optional iframe-development compatibility. Production authentication uses
// only the HttpOnly session cookie.
app.use((req, res, next) => {
    const sessionId = process.env.ALLOW_SESSION_TOKEN_FALLBACK === 'true'
        ? req.headers['x-session-id']
        : null;
    if (sessionId) {
        req.headers.cookie = `connect.sid=${sessionId}`;
    }
    next();
});

app.use(sessionMiddleware);

// Expose the configured session middleware to allow direct reuse in Socket.IO handshake validation (Phase 8 verification pass)
app.sessionMiddleware = sessionMiddleware;

// زيادة حجم استقبال البيانات لـ 50 ميجا بايت لدعم رفع الفيديوهات والملفات الكبيرة بصيغة Base64
app.use(express.json({
    limit: '50mb',
    verify: (req, res, buf, encoding) => {
        req.rawBody = buf;
    }
}));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Global Prototype Pollution Guard
const { prototypePollutionGuard } = require('./middleware/validation');
app.use(prototypePollutionGuard);

// 4. Redirect legacy dashboard layouts to the decoupled frontend application
app.get('/dashboard.html', (req, res) => {
    res.redirect('/login');
});

// Customer media is private. It is served only to an authenticated administrator
// and must never be exposed as an anonymous static directory.
app.use('/uploads', requireAuth, (req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    next();
}, express.static(path.join(__dirname, '..', 'public', 'uploads'), {
    dotfiles: 'deny',
    fallthrough: false,
    index: false
}));

// التأكد من وجود مجلد رفع وحفظ الوسائط الفورية في السيرفر
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// 5. Safe backend health endpoints (Section 18)
app.get('/live', (req, res) => {
    const runtime = runtimeState.snapshot();
    res.status(runtime.shuttingDown ? 503 : 200).json({
        status: runtime.shuttingDown ? 'SHUTTING_DOWN' : 'ALIVE',
        uptime: process.uptime()
    });
});

app.get('/health', (req, res) => {
    const runtime = runtimeState.snapshot();
    res.status(runtime.shuttingDown ? 503 : 200).json({
        status: runtime.shuttingDown ? 'SHUTTING_DOWN' : 'OK',
        uptime: process.uptime(),
        runtime: runtime.state
    });
});

app.get('/internal/metrics', requireMetricsToken, (req, res) => {
    res.type('text/plain; version=0.0.4; charset=utf-8').send(runtimeMetrics.prometheus());
});

app.get('/ready', (req, res) => {
    try {
        const runtime = runtimeState.snapshot();
        if (!runtime.ready) {
            return res.status(503).json({
                status: 'NOT_READY',
                runtime: runtime.state,
                reason: runtime.reason
            });
        }
        const db = require('./database/connection');
        const result = db.prepare("SELECT 1 as active").get();
        if (result && result.active === 1) {
            return res.json({ status: 'READY', database: 'connected' });
        }
        return res.status(500).json({ status: 'NOT_READY', error: 'Database inactive' });
    } catch (err) {
        return res.status(500).json({ status: 'NOT_READY', error: 'Database readiness check failed' });
    }
});

// استيراد مسارات الـ Webhooks والـ REST APIs والـ Authentication
const webhookRouter = require('./routes/webhooks');
const authRouter = require('./routes/auth');
const apiRouter = require('./routes/api');
const { csrfProtection } = require('./middleware/csrf');

// تركيب المسارات البرمجية بنظافة
app.use(['/webhook', '/whatsapp'], webhookLimit);
app.use('/', webhookRouter); // Webhooks are public (Task 14)
app.use(authRouter);         // Auth endpoints are public (Task 10) - contains support for both legacy /api/auth and versioned /api/v1/auth

// API routes: support both versioned /api/v1 and legacy /api paths (Section 6)
app.use(['/api/v1/rag/playground', '/api/rag/playground'], aiLimit);
app.use(['/api/v1/rag/documents/upload', '/api/rag/documents/upload'], uploadLimit);
app.use('/api/v1', adminApiLimit, requireAuth, csrfProtection, attachAccessContext, apiRouter);
app.use('/api', adminApiLimit, requireAuth, csrfProtection, attachAccessContext, apiRouter);

// Clean-Architecture Rebuilt Analytics Module Routes
const analyticsRouter = require('./analytics/analytics.routes');
app.use('/api/v1/analytics', requireAuth, csrfProtection, attachAccessContext, analyticsRouter);
app.use('/api/analytics', requireAuth, csrfProtection, attachAccessContext, analyticsRouter);

// ==========================================
// FRONTEND STATIC SERVING AND INTEGRATION (AI Studio Migration)
// ==========================================

// Serve config.js dynamically
app.get('/config.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    
    res.send(`window.ENV = {
  API_BASE_URL: '/api/v1',
  SOCKET_URL: ''
};`);
});

const frontendPublicDir = path.join(__dirname, '..', '..', 'frontend', 'public');

// Pinned, local sanitizer for the few reviewed UI fragments that require HTML.
app.get('/vendor/dompurify.min.js', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(require.resolve('dompurify/dist/purify.min.js'));
});

// Serve Chart.js locally so analytics remain available under the strict CSP
// and do not depend on a third-party CDN at runtime.
app.get('/vendor/chart.umd.min.js', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    const chartEntry = require.resolve('chart.js', {
        paths: [path.join(__dirname, '..', '..', 'frontend')]
    });
    res.sendFile(path.join(path.dirname(chartEntry), 'chart.umd.min.js'));
});

// Serve static assets
app.use(express.static(frontendPublicDir));

// Maintain compatibility and clean routing
app.get('/login', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(frontendPublicDir, 'login.html'));
});

app.get('/login.html', (req, res) => {
    res.redirect('/login');
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(frontendPublicDir, 'dashboard.html'));
});

app.get('/dashboard.html', (req, res) => {
    res.redirect('/dashboard');
});

// Fallback redirect for other unknown UI requests to /login
app.get('/', (req, res) => {
    res.redirect('/login');
});

// Final Express failure boundary. It must be last so route failures cannot
// escape as HTML stack traces or become unhandled promise/process failures.
app.use((err, req, res, _next) => {
    const uploadTooLarge = err?.code === 'LIMIT_FILE_SIZE';
    const status = uploadTooLarge ? 413 : Number(err?.status || err?.statusCode);
    const safeStatus = status >= 400 && status < 600 ? status : 500;
    console.error(JSON.stringify({
        level: 'error',
        event: 'http_request_failed',
        method: req.method,
        path: req.originalUrl,
        status: safeStatus,
        code: err?.code || null,
        message: err?.message || 'Unknown request failure'
    }));
    if (res.headersSent) return res.end();
    return res.status(safeStatus).json({
        success: false,
        code: uploadTooLarge ? 'PAYLOAD_TOO_LARGE' : (err?.code || 'REQUEST_FAILED'),
        error: safeStatus >= 500 ? 'Internal server error' : (err?.message || 'Request failed')
    });
});

module.exports = app;
