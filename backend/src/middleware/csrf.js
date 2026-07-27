// Session-Bound Cryptographic CSRF Validation Middleware (Task 4)
const crypto = require('crypto');

function csrfProtection(req, res, next) {
    // 1. Bypass read-only HTTP methods
    const readOnlyMethods = ['GET', 'HEAD', 'OPTIONS'];
    if (readOnlyMethods.includes(req.method)) {
        return next();
    }

    // 2. Reject if no session is active or no CSRF token is bound
    if (!req.session || !req.session.csrfToken) {
        return res.status(403).json({ success: false, error: 'CSRF token invalid or missing session' });
    }

    const clientToken = req.headers['x-csrf-token'];
    if (!clientToken) {
        return res.status(403).json({ success: false, error: 'CSRF token missing' });
    }

    let clientTokenBuf;
    const sessionTokenBuf = Buffer.from(req.session.csrfToken, 'hex');

    try {
        clientTokenBuf = Buffer.from(clientToken, 'hex');
    } catch (e) {
        return res.status(403).json({ success: false, error: 'Invalid CSRF token format' });
    }

    // 3. Check buffer size parity before running timingSafeEqual to avoid signature errors
    if (clientTokenBuf.length !== sessionTokenBuf.length) {
        return res.status(403).json({ success: false, error: 'CSRF token mismatch' });
    }

    if (!crypto.timingSafeEqual(clientTokenBuf, sessionTokenBuf)) {
        return res.status(403).json({ success: false, error: 'CSRF token mismatch' });
    }

    next();
}

module.exports = {
    csrfProtection
};
