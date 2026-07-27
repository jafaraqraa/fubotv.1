const db = require('../connection');

function saveSetting(key, value) {
    db.prepare(`
        INSERT INTO settings (key, value, value_type, updated_at)
        VALUES (?, ?, 'string', CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = CURRENT_TIMESTAMP
    `).run(key, value !== undefined && value !== null ? String(value) : '');
}

function getSetting(key) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
}

function getAllSettings() {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const row of rows) {
        settings[row.key] = row.value;
    }
    return settings;
}

module.exports = {
    saveSetting,
    getSetting,
    getAllSettings
};
