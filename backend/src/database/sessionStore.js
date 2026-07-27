const session = require('express-session');
const db = require('./connection');

class SQLiteStore extends session.Store {
    constructor() {
        super();
    }

    get(sid, callback) {
        try {
            const row = db.prepare('SELECT sess, expired FROM sessions WHERE sid = ?').get(sid);
            if (!row) {
                return callback(null, null);
            }
            if (new Date(row.expired) < new Date()) {
                db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
                return callback(null, null);
            }
            return callback(null, JSON.parse(row.sess));
        } catch (err) {
            return callback(err);
        }
    }

    set(sid, sess, callback) {
        try {
            const maxAge = sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : 28800000;
            const expired = new Date(Date.now() + maxAge).toISOString();
            const sessStr = JSON.stringify(sess);

            db.prepare(`
                INSERT INTO sessions (sid, sess, expired) VALUES (?, ?, ?)
                ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expired = excluded.expired
            `).run(sid, sessStr, expired);

            return callback(null);
        } catch (err) {
            return callback(err);
        }
    }

    destroy(sid, callback) {
        try {
            db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
            return callback(null);
        } catch (err) {
            return callback(err);
        }
    }
}

module.exports = SQLiteStore;
