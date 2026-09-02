#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');

const projectRoot = path.resolve(__dirname, '..', '..');
const backupRoot = path.resolve(
    process.env.FUTHING_BACKUP_DIR || path.join(projectRoot, 'backend', 'data', 'backups', 'production')
);
const retentionDays = Math.max(1, Number.parseInt(process.env.FUTHING_BACKUP_RETENTION_DAYS || '14', 10));
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const destination = path.join(backupRoot, `futhing-${stamp}`);

fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });

const environment = {
    ...process.env,
    QDRANT_URL: process.env.QDRANT_URL || 'http://127.0.0.1:6333',
    QDRANT_COLLECTION: process.env.QDRANT_COLLECTION || 'futhing_knowledge'
};

function run(script, args) {
    const result = spawnSync(process.execPath, [path.join(__dirname, script), ...args], {
        cwd: projectRoot,
        env: environment,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status !== 0) process.exit(result.status || 1);
}

run('production-backup.js', [`--output=${destination}`, '--allow-qdrant-rebuild']);
run('verify-production-backup.js', [destination]);

const archive = `${destination}.tar.gz`;
const packed = spawnSync('tar', ['-czf', archive, '-C', backupRoot, path.basename(destination)], {
    encoding: 'utf8'
});
if (packed.status !== 0) {
    process.stderr.write(packed.stderr || 'Unable to package backup for upload.\n');
    process.exit(packed.status || 1);
}
fs.chmodSync(archive, 0o600);
const archiveSha256 = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
fs.writeFileSync(`${archive}.sha256`, `${archiveSha256}  ${path.basename(archive)}\n`, { mode: 0o600 });

const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
for (const entry of fs.readdirSync(backupRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^futhing-\d{8}T\d{6}Z$/.test(entry.name)) continue;
    const target = path.join(backupRoot, entry.name);
    if (target === destination || fs.statSync(target).mtimeMs >= cutoff) continue;
    fs.rmSync(target, { recursive: true, force: false });
    for (const suffix of ['.tar.gz', '.tar.gz.sha256']) {
        const expired = `${target}${suffix}`;
        if (fs.existsSync(expired)) fs.rmSync(expired, { force: false });
    }
    console.log(`[Backup Retention] Removed expired verified backup: ${entry.name}`);
}

console.log(JSON.stringify({ success: true, destination, archive, archiveSha256, retentionDays }, null, 2));
