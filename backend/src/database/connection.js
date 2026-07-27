const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let dbPath = process.env.SQLITE_DB_PATH;
if (!dbPath) {
    dbPath = path.join(__dirname, '..', '..', 'data', 'app.db');
} else {
    // Resolve relative paths from the repository root
    if (!path.isAbsolute(dbPath)) {
        dbPath = path.resolve(__dirname, '..', '..', dbPath);
    }
}

// Automatically create the parent directory of the database when missing
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

console.log(`📡 Connecting to SQLite database at: ${dbPath}`);
const db = new Database(dbPath);

// Recommended SQLite connection configuration
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const journalResult = db.pragma('journal_mode = WAL');
const journalMode = journalResult[0] ? journalResult[0].journal_mode : 'unknown';
console.log(`🗳️ SQLite journal mode configured: ${journalMode}`);

module.exports = db;
