const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const SQLiteStore = require('./database/sessionStore');
const { requireAuth } = require('./middleware/requireAuth');
const { getOriginPolicy } = require('./security/originPolicy');

const app = express();
const originPolicy = getOriginPolicy();

// Trust reverse proxy (Cloud Run, Nginx, etc.) to allow secure cookies over HTTPS
app.set('trust proxy', 1);

// 1. Basic HTTP Security Headers (Task 20)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
    res.setHeader('X-XSS-Protection', '1; mode=block');
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
        res.setHeader('Access-Control-Max-Age', '600');
    }

    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});
app.originPolicy = originPolicy;

// 3. Configure server-side session authentication with custom SQLite Session Store (Task 8)
const sessionMiddleware = session({
    store: new SQLiteStore(),
    secret: process.env.SESSION_SECRET || 'futh_secure_fallback_secret_2026_xxxx',
    resave: false,
    saveUninitialized: false,
    name: 'connect.sid',
    cookie: {
        httpOnly: true,
        sameSite: 'none', // Required for cross-origin iframe preview in AI Studio
        secure: true,     // Required when SameSite=None is used
        maxAge: 28800000, // 8 hours session duration
        domain: process.env.COOKIE_DOMAIN || undefined
    }
});

// Interceptor to allow session identification via custom headers or query params when cookies are blocked by browsers in iframes
app.use((req, res, next) => {
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;
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

// Serves ONLY backend uploads/media static files publicly
app.use('/uploads', express.static(path.join(__dirname, '..', 'public', 'uploads')));

// التأكد من وجود مجلد رفع وحفظ الوسائط الفورية في السيرفر
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// 5. Safe backend health endpoints (Section 18)
app.get('/health', (req, res) => {
    res.json({ status: 'OK', uptime: process.uptime() });
});

app.get('/ready', (req, res) => {
    try {
        const db = require('./database/connection');
        const result = db.prepare("SELECT 1 as active").get();
        if (result && result.active === 1) {
            return res.json({ status: 'READY', database: 'connected' });
        }
        return res.status(500).json({ status: 'NOT_READY', error: 'Database inactive' });
    } catch (err) {
        return res.status(500).json({ status: 'NOT_READY', error: err.message });
    }
});

// استيراد مسارات الـ Webhooks والـ REST APIs والـ Authentication
const webhookRouter = require('./routes/webhooks');
const authRouter = require('./routes/auth');
const apiRouter = require('./routes/api');
const { csrfProtection } = require('./middleware/csrf');

// تركيب المسارات البرمجية بنظافة
app.use('/', webhookRouter); // Webhooks are public (Task 14)
app.use(authRouter);         // Auth endpoints are public (Task 10) - contains support for both legacy /api/auth and versioned /api/v1/auth

// API routes: support both versioned /api/v1 and legacy /api paths (Section 6)
app.use('/api/v1', requireAuth, csrfProtection, apiRouter);
app.use('/api', requireAuth, csrfProtection, apiRouter);

// Clean-Architecture Rebuilt Analytics Module Routes
const analyticsRouter = require('./analytics/analytics.routes');
app.use('/api/v1/analytics', requireAuth, csrfProtection, analyticsRouter);
app.use('/api/analytics', requireAuth, csrfProtection, analyticsRouter);

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

module.exports = app;
