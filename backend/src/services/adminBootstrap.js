const bcrypt = require('bcryptjs');
const { anyAdminExists, createAdmin } = require('../database/repositories/adminRepository');

const STRONG_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9])(?=.{12,128}$)/;
const VALID_USERNAME = /^[A-Za-z0-9._-]{3,64}$/;

function bootstrapAdminAccount() {
    if (anyAdminExists()) {
        console.log('👤 Existing administrator accounts verified. Bypassing account bootstrap.');
        return { created: false, reason: 'existing-admin' };
    }

    const username = process.env.ADMIN_BOOTSTRAP_USERNAME;
    const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
    const displayName = process.env.ADMIN_BOOTSTRAP_DISPLAY_NAME || 'Administrator';

    if (!username || !password) {
        const message =
            'No administrator exists. Configure ADMIN_BOOTSTRAP_USERNAME and ADMIN_BOOTSTRAP_PASSWORD for one-time bootstrap.';
        if (process.env.NODE_ENV === 'production') {
            const error = new Error(message);
            error.code = 'ADMIN_BOOTSTRAP_REQUIRED';
            throw error;
        }
        console.warn(`⚠️ [Admin Bootstrap] ${message}`);
        return { created: false, reason: 'configuration-missing' };
    }

    if (!VALID_USERNAME.test(username)) {
        const error = new Error('ADMIN_BOOTSTRAP_USERNAME must be 3-64 safe characters.');
        error.code = 'INVALID_ADMIN_BOOTSTRAP_USERNAME';
        throw error;
    }
    if (!STRONG_PASSWORD.test(password) || password.includes(username)) {
        const error = new Error(
            'ADMIN_BOOTSTRAP_PASSWORD must be 12-128 characters with upper, lower, number, symbol, and must not contain the username.'
        );
        error.code = 'WEAK_ADMIN_BOOTSTRAP_PASSWORD';
        throw error;
    }

    const hash = bcrypt.hashSync(password, 12);
    createAdmin(username, hash, displayName);
    delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
    console.log(`✅ [Admin Bootstrap] One-time administrator created: ${username}`);
    console.log('🔐 [Admin Bootstrap] ADMIN_BOOTSTRAP_PASSWORD removed from process environment.');
    return { created: true, username };
}

module.exports = {
    bootstrapAdminAccount,
    STRONG_PASSWORD,
    VALID_USERNAME
};
