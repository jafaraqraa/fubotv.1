#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const directory = path.resolve(process.argv[2] || '');
const manifestPath = path.join(directory, 'manifest.json');
if (!fs.existsSync(manifestPath)) throw new Error('Backup manifest not found');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
for (const item of manifest.files) {
    const file = path.resolve(directory, item.path);
    if (!file.startsWith(`${directory}${path.sep}`) || !fs.existsSync(file)) {
        throw new Error(`Backup file missing or unsafe: ${item.path}`);
    }
    if (sha256(file) !== item.sha256) throw new Error(`Checksum mismatch: ${item.path}`);
}
const restored = new Database(path.join(directory, manifest.database.file), {
    readonly: true,
    fileMustExist: true
});
const integrity = restored.pragma('integrity_check');
restored.pragma('foreign_keys = ON');
const foreignKeyViolations = restored.pragma('foreign_key_check');
restored.close();
if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' || foreignKeyViolations.length) {
    throw new Error('Restored SQLite backup failed integrity verification');
}
console.log(JSON.stringify({
    success: true,
    files: manifest.files.length,
    integrity: 'ok',
    foreignKeyViolations: 0,
    qdrant: manifest.qdrant
}, null, 2));
