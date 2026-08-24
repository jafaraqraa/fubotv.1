require('dotenv').config();
const express = require('express');
const path = require('path');
const app = express();

const PORT = process.env.FRONTEND_PORT || 5173;
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001/api/v1';
const SOCKET_URL = process.env.SOCKET_URL || 'http://localhost:3001';

// Same-origin authenticated media proxy. Native media elements cannot attach
// the dashboard's custom authentication headers, so forward the HttpOnly
// session cookie to the protected backend endpoint server-side.
app.get('/api/media/:attachmentId/download', async (req, res) => {
    try {
        const backendUrl = `${API_BASE_URL.replace(/\/+$/, '')}/media/${encodeURIComponent(req.params.attachmentId)}/download`;
        const response = await fetch(backendUrl, {
            headers: {
                cookie: req.headers.cookie || '',
                ...(req.headers['x-session-id'] ? { 'x-session-id': req.headers['x-session-id'] } : {})
            }
        });
        const contentType = response.headers.get('content-type');
        const contentLength = response.headers.get('content-length');
        if (contentType) res.setHeader('Content-Type', contentType);
        if (contentLength) res.setHeader('Content-Length', contentLength);
        res.setHeader('Cache-Control', 'private, no-store');
        return res.status(response.status).send(Buffer.from(await response.arrayBuffer()));
    } catch (_) {
        return res.status(502).json({ success: false, error: 'تعذر تحميل المرفق من الخادم.' });
    }
});

// Serve the pinned sanitizer from the installed package. dashboard.html references
// this stable URL so production deployments never depend on a missing copied asset.
app.get('/vendor/dompurify.min.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'node_modules', 'dompurify', 'dist', 'purify.min.js'));
});

// Serve config.js dynamically
app.get('/config.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`window.ENV = {
  API_BASE_URL: ${JSON.stringify(API_BASE_URL)},
  SOCKET_URL: ${JSON.stringify(SOCKET_URL)}
};`);
});

// Serve static assets
app.use(express.static(path.join(__dirname, 'public')));

// Maintain compatibility and clean routing
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/login.html', (req, res) => {
    res.redirect('/login');
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/dashboard.html', (req, res) => {
    res.redirect('/dashboard');
});

// Fallback redirect for other unknown UI requests to /login
app.get('/', (req, res) => {
    res.redirect('/login');
});

app.listen(PORT, () => {
    console.log(`💻 Frontend application running on: http://localhost:${PORT}`);
});
