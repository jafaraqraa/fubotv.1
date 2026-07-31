const db = require('../connection');
const crypto = require('crypto');
const { requireSessionSecret } = require('../../config/securityConfig');

function findAdminByUsername(username) {
    const row = db.prepare('SELECT id, username, password_hash, display_name, is_active FROM administrators WHERE username = ?').get(username);
    if (!row) return null;
    return {
        id: row.id,
        username: row.username,
        passwordHash: row.password_hash,
        displayName: row.display_name,
        isActive: row.is_active === 1
    };
}

function findAdminById(id) {
    const row = db.prepare('SELECT id, username, display_name, is_active FROM administrators WHERE id = ?').get(id);
    if (!row) return null;
    return {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        isActive: row.is_active === 1
    };
}

function anyAdminExists() {
    const row = db.prepare('SELECT COUNT(*) as count FROM administrators').get();
    return row && row.count > 0;
}

function createAdmin(username, passwordHash, displayName = 'Administrator') {
    db.transaction(() => {
        const result = db.prepare(`
            INSERT INTO administrators (username, password_hash, display_name, is_active, created_at, updated_at)
            VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))
        `).run(username, passwordHash, displayName);
        db.prepare(`
            INSERT INTO administrator_tenants (administrator_id, tenant_id, role)
            SELECT ?, id, 'super_admin' FROM tenants
        `).run(Number(result.lastInsertRowid));
    })();
}

// --- Persistent Login Rate Limiting (Task 5) ---

function hashIp(ip) {
    const salt = requireSessionSecret();
    return crypto.createHmac('sha256', salt).update(String(ip)).digest('hex');
}

function getRateLimit(ip) {
    const hashed = hashIp(ip);
    const row = db.prepare('SELECT failed_attempts, lockout_until FROM login_rate_limits WHERE hashed_ip = ?').get(hashed);
    if (!row) return { failedAttempts: 0, lockoutUntil: null };
    return {
        failedAttempts: row.failed_attempts,
        lockoutUntil: row.lockout_until ? new Date(row.lockout_until) : null
    };
}

function incrementFailedAttempts(ip, maxFailedAttempts = 5, windowMs = 15 * 60 * 1000) {
    const hashed = hashIp(ip);
    const now = Date.now();

    db.transaction(() => {
        const row = db.prepare('SELECT failed_attempts FROM login_rate_limits WHERE hashed_ip = ?').get(hashed);
        const attempts = row ? row.failed_attempts + 1 : 1;
        const lockoutUntil = (attempts >= maxFailedAttempts) ? new Date(now + windowMs).toISOString() : null;

        db.prepare(`
            INSERT INTO login_rate_limits (hashed_ip, failed_attempts, lockout_until, updated_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(hashed_ip) DO UPDATE SET
                failed_attempts = excluded.failed_attempts,
                lockout_until = excluded.lockout_until,
                updated_at = datetime('now')
        `).run(hashed, attempts, lockoutUntil);
    })();
}

function resetFailedAttempts(ip) {
    const hashed = hashIp(ip);
    db.prepare('DELETE FROM login_rate_limits WHERE hashed_ip = ?').run(hashed);
}

function cleanupExpiredRateLimits() {
    // Purges expired lockouts dynamically to prevent unbounded growth of rate-limit records (Task 5)
    db.prepare("DELETE FROM login_rate_limits WHERE lockout_until IS NOT NULL AND datetime(lockout_until) < datetime('now')").run();
}

function updateLastLogin(id) {
    db.prepare("UPDATE administrators SET last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);
}

function updatePassword(id, newPasswordHash) {
    db.prepare("UPDATE administrators SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(newPasswordHash, id);
}

function revokeSessionsForAdministrator(id) {
    const rows = db.prepare('SELECT sid, sess FROM sessions').all();
    const deleteSession = db.prepare('DELETE FROM sessions WHERE sid = ?');
    let revoked = 0;
    db.transaction(() => {
        for (const row of rows) {
            try {
                if (JSON.parse(row.sess)?.userId === id) {
                    revoked += deleteSession.run(row.sid).changes;
                }
            } catch (_) {
                revoked += deleteSession.run(row.sid).changes;
            }
        }
    })();
    return revoked;
}

module.exports = {
    findAdminByUsername,
    findAdminById,
    anyAdminExists,
    createAdmin,
    updateLastLogin,
    updatePassword,
    revokeSessionsForAdministrator,
    hashIp,
    getRateLimit,
    incrementFailedAttempts,
    resetFailedAttempts,
    cleanupExpiredRateLimits
};
