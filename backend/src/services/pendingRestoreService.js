const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const backendRoot = path.resolve(__dirname, '..', '..');
const projectRoot = path.resolve(backendRoot, '..');
const markerPath = path.join(backendRoot, 'data', 'pending-restore.json');

function replacePath(source, destination) {
    if (!fs.existsSync(source)) return;
    fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, { recursive: true, preserveTimestamps: true });
}

function applyPendingRestore() {
    if (!fs.existsSync(markerPath)) return null;
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    const backup = path.resolve(marker.backupDirectory || '');
    const allowedRoot = path.join(backendRoot, 'data', 'restore-staging');
    if (!backup.startsWith(`${allowedRoot}${path.sep}`)) throw new Error('Unsafe pending restore path');
    const manifest = JSON.parse(fs.readFileSync(path.join(backup, 'manifest.json'), 'utf8'));

    const rollbackDir = path.join(backendRoot, 'data', 'backups', `pre-restore-${Date.now()}`);
    fs.mkdirSync(rollbackDir, { recursive: true, mode: 0o700 });
    const liveDb = process.env.SQLITE_DB_PATH || path.join(backendRoot, 'data', 'app.db');
    if (fs.existsSync(liveDb)) fs.copyFileSync(liveDb, path.join(rollbackDir, 'app.db'));

    replacePath(path.join(backup, manifest.database.file), liveDb);
    replacePath(path.join(backup, 'knowledge-documents'), path.join(backendRoot, 'data', 'knowledge-documents'));
    replacePath(path.join(backup, 'uploads'), path.join(backendRoot, 'public', 'uploads'));

    if (manifest.recovery?.whatsappSessionsArchive) {
        for (const entry of fs.readdirSync(backendRoot, { withFileTypes: true })) {
            if (entry.isDirectory() && entry.name.startsWith('.wwebjs_auth_tenant_')) {
                fs.rmSync(path.join(backendRoot, entry.name), { recursive: true, force: true });
            }
        }
        const result = spawnSync('tar', [
            '-xzf', path.join(backup, manifest.recovery.whatsappSessionsArchive),
            '--no-same-owner', '-C', backendRoot
        ], { encoding: 'utf8' });
        if (result.status !== 0) throw new Error(`WhatsApp restore failed: ${result.stderr}`);
    }

    const secrets = path.join(backup, 'secrets');
    replacePath(path.join(secrets, '.env'), path.join(projectRoot, '.env'));
    replacePath(path.join(secrets, 'backend__.env'), path.join(backendRoot, '.env'));
    fs.rmSync(markerPath, { force: true });
    return { restoredAt: new Date().toISOString(), rollbackDir, qdrantRebuildRequired: !!manifest.qdrant?.rebuildRequired };
}

module.exports = { applyPendingRestore, markerPath };
