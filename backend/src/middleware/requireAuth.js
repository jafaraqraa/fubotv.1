function requireAuth(req, res, next) {
    if (req.session && req.session.userId) {
        return next();
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
