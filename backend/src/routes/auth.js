const express = require('express');
const router = express.Router();
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { authenticate } = require('../services/authService');
const adminRepo = require('../database/repositories/adminRepository');
const { requireAuth } = require('../middleware/requireAuth');
const { requireSessionSecret } = require('../config/securityConfig');
const { getSessionCookieClearOptions } = require('../config/sessionCookieConfig');
const { getMemberships, audit } = require('../security/accessControl');

// Persistent SQLite-backed Login Rate Limiter (Task 5)
function rateLimitLogin(req, res, next) {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const now = Date.now();

    // Async cleanup of stale expired rate limit rows to prevent database bloating
    try {
        adminRepo.cleanupExpiredRateLimits();
    } catch (e) {
        console.error('⚠️ Rate limit cleanup error:', e.message);
    }

    const limit = adminRepo.getRateLimit(ip);

    if (limit.lockoutUntil && limit.lockoutUntil > now) {
        const remainingMinutes = Math.ceil((limit.lockoutUntil - now) / 60000);
        return res.status(429).json({
            success: false,
            error: `محاولات دخول كثيرة خاطئة. تم حظر محاولات الدخول من جهازك مؤقتاً. يرجى المحاولة مجدداً بعد ${remainingMinutes} دقيقة.`
        });
    }

    // Attach hook trackers to request
    req.recordFailedLoginAttempt = () => {
        adminRepo.incrementFailedAttempts(ip);
    };

    req.recordSuccessfulLogin = () => {
        adminRepo.resetFailedAttempts(ip);
    };

    next();
}

// 1. GET /login removed so frontend routing can handle serving login page directly

// 2. POST /api/auth/login and /api/v1/auth/login -> Handles credentials submission safely (Section 6)
router.post(['/api/auth/login', '/api/v1/auth/login'], rateLimitLogin, (req, res) => {
    const { username, password } = req.body;

    // Validate inputs exist before proceeding
    if (!username || !password) {
        return res.status(400).json({ success: false, error: 'الرجاء إدخال اسم المستخدم وكلمة المرور' });
    }

    const result = authenticate(username, password);
    if (!result.success) {
        if (req.recordFailedLoginAttempt) {
            req.recordFailedLoginAttempt();
        }
        audit({ action: 'login', outcome: 'failure' });
        // Generic failure response without exposing whether user exists
        return res.status(401).json({
            success: false,
            error: 'اسم المستخدم أو كلمة المرور غير صحيحة'
        });
    }

    // Reset failed attempts state after successful authentication
    if (req.recordSuccessfulLogin) {
        req.recordSuccessfulLogin();
    }

    // Regenerate session to prevent session fixation attacks (Task 8)
    req.session.regenerate((err) => {
        if (err) {
            return res.status(500).json({ success: false, error: 'حدث خطأ في الخادم' });
        }
        req.session.userId = result.user.id;
        req.session.username = result.user.username;
        req.session.displayName = result.user.displayName;
        const memberships = getMemberships(result.user.id);
        if (!memberships.length) {
            return req.session.destroy(() => res.status(403).json({
                success: false,
                error: 'No active tenant membership'
            }));
        }
        req.session.tenantId = memberships[0].tenantId;
        req.session.allowedTenantIds = memberships.map(item => item.tenantId);
        req.session.rolesByTenant = Object.fromEntries(
            memberships.map(item => [item.tenantId, item.role])
        );
        req.session.absoluteExpiresAt = Date.now() + (24 * 60 * 60 * 1000);

        // Generate cryptographically strong, session-bound CSRF token (Task 4)
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');

        // Create a signed session ID to return to the client as an iframe cookie-bypass fallback
        const SESSION_SECRET = requireSessionSecret();
        const signatureStr = crypto
            .createHmac('sha256', SESSION_SECRET)
            .update(req.sessionID)
            .digest('base64')
            .replace(/=+$/, '');
        const signedSessionId = 's:' + req.sessionID + '.' + signatureStr;

        audit({
            actorId: result.user.id, tenantId: memberships[0].tenantId,
            action: 'login', outcome: 'success'
        });
        const response = {
            success: true,
            user: {
                ...result.user,
                tenantId: memberships[0].tenantId,
                role: memberships[0].role,
                tenants: memberships.map(({ tenantId, role }) => ({ tenantId, role }))
            }
        };
        if (process.env.ALLOW_SESSION_TOKEN_FALLBACK === 'true') {
            response.sessionId = signedSessionId;
        }
        res.json(response);
    });
});

// 3. POST /api/auth/logout and /api/v1/auth/logout -> Secures session destruction (Section 6)
router.post(['/api/auth/logout', '/api/v1/auth/logout'], (req, res) => {
    if (req.session) {
        const actorId = req.session.userId;
        const tenantId = req.session.tenantId;
        require('../realtime/socketServer').disconnectAdministrator(actorId);
        req.session.destroy((err) => {
            res.clearCookie('connect.sid', getSessionCookieClearOptions());
            if (err) {
                return res.status(500).json({ success: false, error: 'Failed logging out' });
            }
            audit({ actorId, tenantId, action: 'logout', outcome: 'success' });
            res.json({ success: true, message: 'Logged out successfully' });
        });
    } else {
        res.json({ success: true });
    }
});

// 4. GET /api/auth/me and /api/v1/auth/me -> Returns authenticated status (Section 6)
router.get(['/api/auth/me', '/api/v1/auth/me'], (req, res) => {
    if (req.session && req.session.userId) {
        return res.json({
            authenticated: true,
            user: {
                id: req.session.userId,
                username: req.session.username,
                displayName: req.session.displayName,
                tenantId: req.session.tenantId,
                role: req.session.rolesByTenant?.[req.session.tenantId]
            }
        });
    }
    return res.json({ authenticated: false });
});

// 5. POST /api/auth/change-password and /api/v1/auth/change-password -> Authenticated password change (Section 6)
router.post(['/api/auth/change-password', '/api/v1/auth/change-password'], requireAuth, (req, res) => {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ success: false, error: 'الرجاء إدخال كلمة المرور الحالية والجديدة' });
    }

    const admin = adminRepo.findAdminByUsername(req.session.username);
    if (!admin) {
        return res.status(404).json({ success: false, error: 'لم يتم العثور على الحساب' });
    }

    const valid = bcrypt.compareSync(currentPassword, admin.passwordHash);
    if (!valid) {
        return res.status(400).json({ success: false, error: 'كلمة المرور الحالية غير صحيحة' });
    }

    if (currentPassword === newPassword) {
        return res.status(400).json({ success: false, error: 'كلمة المرور الجديدة يجب أن تختلف عن كلمة المرور الحالية' });
    }

    const strongRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#\$%\^&\*])(?=.{10,})/;
    if (!strongRegex.test(newPassword)) {
        return res.status(400).json({
            success: false,
            error: 'كلمة المرور الجديدة ضعيفة. يجب أن تتكون من 10 خانات على الأقل وتضم حروفاً كبيرة وصغيرة وأرقاماً ورموزاً خاصة.'
        });
    }

    const hash = bcrypt.hashSync(newPassword, 10);
    adminRepo.updatePassword(admin.id, hash);
    adminRepo.revokeSessionsForAdministrator(admin.id);
    require('../realtime/socketServer').disconnectAdministrator(admin.id);
    audit({
        actorId: admin.id, tenantId: req.session.tenantId,
        action: 'password_change', outcome: 'success'
    });
    console.log(`🔒 Password changed successfully for administrator: ${admin.username}`);

    res.clearCookie('connect.sid', getSessionCookieClearOptions());
    res.json({ success: true, reauthenticationRequired: true, message: 'تم تغيير كلمة المرور بنجاح!' });
});

// 6. GET /api/auth/csrf-token and /api/v1/auth/csrf-token -> Provides session-bound CSRF token (Section 6)
router.get(['/api/auth/csrf-token', '/api/v1/auth/csrf-token'], requireAuth, (req, res) => {
    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }
    res.json({
        success: true,
        csrfToken: req.session.csrfToken
    });
});

module.exports = router;
