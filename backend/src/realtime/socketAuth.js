// Handshake cookies parsing utility functions (Task 6 & Handshake verification pass)
const db = require('../database/connection');

function parseCookies(cookieHeader) {
    const cookies = {};
    if (!cookieHeader) return cookies;

    cookieHeader.split(';').forEach(cookie => {
        const parts = cookie.split('=');
        if (parts.length >= 2) {
            const name = parts[0].trim();
            const value = parts.slice(1).join('=').trim();
            cookies[name] = decodeURIComponent(value);
        }
    });
    return cookies;
}

function getSessionFromCookie(cookieHeader) {
    const cookies = parseCookies(cookieHeader);
    const connectSid = cookies['connect.sid'];

    if (!connectSid || !connectSid.startsWith('s:')) {
        return null;
    }

    // Extract the unsigned session ID: s:sessionID.signature -> sessionID
    const sid = connectSid.slice(2).split('.')[0];

    try {
        const row = db.prepare('SELECT sess, expired FROM sessions WHERE sid = ?').get(sid);
        if (!row) {
            return null;
        }

        if (new Date(row.expired) < new Date()) {
            db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
            return null;
        }

        const sessionData = JSON.parse(row.sess);
        if (sessionData && sessionData.userId) {
            return {
                userId: sessionData.userId,
                username: sessionData.username,
                displayName: sessionData.displayName
            };
        }
    } catch (err) {
        console.error('⚠️ Real-time session validation error:', err.message);
    }

    return null;
}

module.exports = {
    parseCookies,
    getSessionFromCookie
};
