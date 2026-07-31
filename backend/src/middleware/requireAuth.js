function requireAuth(req, res, next) {
    if (req.session && req.session.userId) {
        const admin = require('../database/repositories/adminRepository')
            .findAdminById(req.session.userId);
        const absoluteExpiresAt = Number(req.session.absoluteExpiresAt || 0);
        if (admin?.isActive && (!absoluteExpiresAt || absoluteExpiresAt > Date.now())) {
            return next();
        }
        if (req.session) req.session.destroy(() => {});
    }

    // Check if the request is an API call or JSON request
    if (req.originalUrl.startsWith('/api/') || req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    // Otherwise, redirect HTML requests to login page
    return res.redirect('/login');
}

module.exports = {
    requireAuth
};
