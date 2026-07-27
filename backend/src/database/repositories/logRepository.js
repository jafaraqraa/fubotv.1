const db = require('../connection');
const { publish, publishStats } = require('../../realtime/eventPublisher');
const { EVENTS } = require('../../realtime/events');

function addLog(action) {
    const time = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    db.transaction(() => {
        db.prepare('INSERT INTO activity_logs (time, action) VALUES (?, ?)').run(time, action);
        // Retain only the last 50 logs to prevent infinite database growth
        db.prepare(`
            DELETE FROM activity_logs
            WHERE id NOT IN (SELECT id FROM activity_logs ORDER BY id DESC LIMIT 50)
        `).run();
    })();

    // Publish log creation event (Task 10)
    publish(EVENTS.ACTIVITY_LOG_CREATED, { time, action });
    publishStats();
}

function getRecentLogs(limit = 15) {
    return db.prepare('SELECT time, action FROM activity_logs ORDER BY id DESC LIMIT ?').all(limit);
}

function saveError(id, date, time, type, message) {
    // Prevent duplicate open errors
    const existing = db.prepare('SELECT 1 FROM application_errors WHERE type = ? AND solved = 0').get(type);
    if (existing) return;

    db.transaction(() => {
        db.prepare(`
            INSERT INTO application_errors (id, date, time, type, message, solved)
            VALUES (?, ?, ?, ?, ?, 0)
        `).run(id, date, time, type, message);

        // Limit retained error logs to last 20
        db.prepare(`
            DELETE FROM application_errors
            WHERE id NOT IN (SELECT id FROM application_errors ORDER BY id DESC LIMIT 20)
        `).run();
    })();

    // Publish error creation event strictly after successful database write (Task 10 & 25)
    publish(EVENTS.APPLICATION_ERROR_CREATED, {
        id,
        date,
        time,
        type,
        message,
        solved: false
    });
    publishStats();
}

function listErrors() {
    const rows = db.prepare('SELECT id, date, time, type, message, solved FROM application_errors ORDER BY id DESC').all();
    return rows.map(r => ({
        id: r.id,
        date: r.date,
        time: r.time,
        type: r.type,
        message: r.message,
        solved: r.solved === 1
    }));
}

function getActiveErrorsCount() {
    const row = db.prepare('SELECT COUNT(*) as count FROM application_errors WHERE solved = 0').get();
    return row ? row.count : 0;
}

function solveError(id) {
    db.prepare('UPDATE application_errors SET solved = 1, resolved_at = datetime(\'now\') WHERE id = ?').run(id);

    // Publish error updated/resolved event after database update (Task 10)
    publish(EVENTS.APPLICATION_ERROR_UPDATED, {
        id: Number(id),
        solved: true
    });
    publishStats();
}

module.exports = {
    addLog,
    getRecentLogs,
    saveError,
    listErrors,
    getActiveErrorsCount,
    solveError
};
