#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

function fail(message) { throw new Error(message); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function copyIfPresent(source, destination) {
    if (!fs.existsSync(source)) return;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, { recursive: true, force: false, preserveTimestamps: true });
}

const backup = path.resolve(process.argv[2] || '');
const targetArg = process.argv.find(arg => arg.startsWith('--target='));
if (!backup || !targetArg) fail('Usage: restore-production-backup.js <backup-directory> --target=<empty-directory>');
const target = path.resolve(targetArg.slice('--target='.length));
const manifestPath = path.join(backup, 'manifest.json');
if (!fs.existsSync(manifestPath)) fail('Backup manifest not found');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.formatVersion !== 2) fail(`Unsupported backup format: ${manifest.formatVersion}`);

for (const item of manifest.files) {
    const file = path.resolve(backup, item.path);
    if (!file.startsWith(`${backup}${path.sep}`) || !fs.existsSync(file)) fail(`Missing or unsafe backup file: ${item.path}`);
    if (sha256(file) !== item.sha256) fail(`Checksum mismatch: ${item.path}`);
}
if (fs.existsSync(target) && fs.readdirSync(target).length) fail('Restore target must be empty');
fs.mkdirSync(target, { recursive: true, mode: 0o700 });

const archive = path.join(backup, manifest.recovery.applicationArchive);
const extract = spawnSync('tar', ['-xzf', archive, '-C', target], { encoding: 'utf8' });
if (extract.status !== 0) fail(`Application extraction failed: ${extract.stderr || 'tar error'}`);

copyIfPresent(path.join(backup, manifest.database.file), path.join(target, 'backend', 'data', 'app.db'));
copyIfPresent(path.join(backup, 'knowledge-documents'), path.join(target, 'backend', 'data', 'knowledge-documents'));
copyIfPresent(path.join(backup, 'uploads'), path.join(target, 'backend', 'public', 'uploads'));
if (manifest.recovery.whatsappSessionsArchive) {
    const sessionArchive = path.join(backup, manifest.recovery.whatsappSessionsArchive);
    const sessionExtract = spawnSync('tar', ['-xzf', sessionArchive, '-C', path.join(target, 'backend')], { encoding: 'utf8' });
    if (sessionExtract.status !== 0) fail(`WhatsApp session extraction failed: ${sessionExtract.stderr || 'tar error'}`);
}
const secrets = path.join(backup, 'secrets');
copyIfPresent(path.join(secrets, '.env'), path.join(target, '.env'));
copyIfPresent(path.join(secrets, 'backend__.env'), path.join(target, 'backend', '.env'));

console.log(JSON.stringify({
    success: true,
    target,
    qdrantSnapshot: manifest.qdrant.skipped ? null : manifest.qdrant.file,
    qdrantRebuildRequired: Boolean(manifest.qdrant.rebuildRequired),
    next: 'Run npm ci, then npm start. Restore the Qdrant snapshot when present; otherwise re-index knowledge documents.'
}, null, 2));
