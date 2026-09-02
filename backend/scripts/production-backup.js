#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createVerifiedBackup } = require('../src/database/databaseIntegrityService');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..', '..');

function sha256(file) {
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(file));
    return hash.digest('hex');
}

function walk(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : [full];
    });
}

function copyIfPresent(source, destination) {
    if (!fs.existsSync(source)) return false;
    fs.cpSync(source, destination, { recursive: true, force: false, preserveTimestamps: true });
    return true;
}

function createApplicationArchive(destination) {
    const excludes = [
        '.git', 'node_modules', 'backend/node_modules', 'frontend/node_modules',
        'backend/data', 'backend/public/uploads', 'backend/.wwebjs_auth*',
        'backend/.wwebjs_cache', 'test-results', 'artifacts', '*.log'
    ];
    const args = ['-czf', destination, ...excludes.map(value => `--exclude=${value}`), '-C', projectRoot, '.'];
    const result = spawnSync('tar', args, { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`Application archive failed: ${result.stderr || 'tar error'}`);
}

async function main() {
    const outputArg = process.argv.find(arg => arg.startsWith('--output='));
    if (!outputArg) throw new Error('--output=<new-directory> is required');
    const output = path.resolve(outputArg.slice('--output='.length));
    if (fs.existsSync(output)) throw new Error(`Backup destination already exists: ${output}`);
    const staging = `${output}.partial-${process.pid}`;
    if (fs.existsSync(staging)) {
        throw new Error(`Backup staging destination already exists: ${staging}`);
    }
    fs.mkdirSync(staging, { recursive: false, mode: 0o700 });

    try {
        const db = require('../src/database/connection');
        const dbDestination = path.join(staging, 'app.db');
        const dbResult = await createVerifiedBackup(db, dbDestination);
        const uploadsSource = path.resolve(
            process.env.UPLOADS_DIR || path.join(__dirname, '..', 'public', 'uploads')
        );
        const uploadsDestination = path.join(staging, 'uploads');
        copyIfPresent(uploadsSource, uploadsDestination);

        const knowledgeSource = path.resolve(
            process.env.KNOWLEDGE_DOCUMENTS_DIR || path.join(__dirname, '..', 'data', 'knowledge-documents')
        );
        copyIfPresent(knowledgeSource, path.join(staging, 'knowledge-documents'));

        const sessionDirectories = fs.readdirSync(path.join(__dirname, '..'), { withFileTypes: true })
            .filter(entry => entry.isDirectory() && entry.name.startsWith('.wwebjs_auth_tenant_'));
        if (sessionDirectories.length) {
            const sessionArchive = path.join(staging, 'whatsapp-sessions.tar.gz');
            const args = [
                '-czf', sessionArchive, '--ignore-failed-read', '--warning=no-file-changed',
                '--exclude=*/SingletonCookie', '--exclude=*/SingletonLock',
                '--exclude=*/SingletonSocket', '--exclude=*.lock', '-C', path.join(__dirname, '..'),
                ...sessionDirectories.map(entry => entry.name)
            ];
            const result = spawnSync('tar', args, { encoding: 'utf8' });
            if (result.status !== 0) throw new Error(`WhatsApp session archive failed: ${result.stderr || 'tar error'}`);
        }

        const secretsDestination = path.join(staging, 'secrets');
        const secretFiles = [path.join(projectRoot, '.env'), path.join(projectRoot, 'backend', '.env')];
        for (const secret of secretFiles) {
            if (!fs.existsSync(secret)) continue;
            fs.mkdirSync(secretsDestination, { recursive: true, mode: 0o700 });
            const relative = path.relative(projectRoot, secret).replaceAll(path.sep, '__');
            fs.copyFileSync(secret, path.join(secretsDestination, relative), fs.constants.COPYFILE_EXCL);
        }

        createApplicationArchive(path.join(staging, 'application.tar.gz'));

        let qdrant = { skipped: true, reason: 'explicit --skip-qdrant' };
        if (!process.argv.includes('--skip-qdrant')) {
            const baseUrl = String(process.env.QDRANT_URL || '').replace(/\/$/, '');
            const collection = process.env.QDRANT_COLLECTION || 'futhing_knowledge';
            if (!baseUrl) throw new Error('QDRANT_URL is required unless --skip-qdrant is explicit');
            const headers = process.env.QDRANT_API_KEY
                ? { 'api-key': process.env.QDRANT_API_KEY }
                : {};
            try {
                const createResponse = await fetch(
                    `${baseUrl}/collections/${encodeURIComponent(collection)}/snapshots`,
                    { method: 'POST', headers, signal: AbortSignal.timeout(30_000) }
                );
                if (!createResponse.ok) throw new Error(`Qdrant snapshot failed: HTTP ${createResponse.status}`);
                const snapshot = (await createResponse.json()).result;
                const snapshotName = snapshot?.name;
                if (!snapshotName) throw new Error('Qdrant did not return a snapshot name');
                const download = await fetch(
                    `${baseUrl}/collections/${encodeURIComponent(collection)}/snapshots/${encodeURIComponent(snapshotName)}`,
                    { headers, signal: AbortSignal.timeout(120_000) }
                );
                if (!download.ok) throw new Error(`Qdrant snapshot download failed: HTTP ${download.status}`);
                const snapshotPath = path.join(staging, path.basename(snapshotName));
                fs.writeFileSync(snapshotPath, Buffer.from(await download.arrayBuffer()), { mode: 0o600 });
                qdrant = { skipped: false, collection, file: path.basename(snapshotPath), sha256: sha256(snapshotPath) };
            } catch (error) {
                if (!process.argv.includes('--allow-qdrant-rebuild')) throw error;
                qdrant = { skipped: true, rebuildRequired: true, collection, reason: error.message };
            }
        }

        const files = walk(staging)
            .filter(file => path.basename(file) !== 'manifest.json')
            .map(file => ({
                path: path.relative(staging, file),
                bytes: fs.statSync(file).size,
                sha256: sha256(file)
            }));
        const manifest = {
            formatVersion: 2,
            createdAt: new Date().toISOString(),
            recovery: {
                applicationArchive: 'application.tar.gz',
                includesSecrets: fs.existsSync(secretsDestination),
                includesWhatsappSessions: sessionDirectories.length > 0,
                whatsappSessionsArchive: sessionDirectories.length ? 'whatsapp-sessions.tar.gz' : null,
                qdrantRebuildRequired: Boolean(qdrant.rebuildRequired)
            },
            database: {
                file: 'app.db',
                integrity: dbResult.verification.integrityCheck,
                foreignKeyViolations: dbResult.verification.foreignKeyViolations.length
            },
            qdrant,
            files
        };
        fs.writeFileSync(
            path.join(staging, 'manifest.json'),
            `${JSON.stringify(manifest, null, 2)}\n`,
            { mode: 0o600 }
        );
        fs.renameSync(staging, output);
        console.log(JSON.stringify({ success: true, output, files: files.length, qdrant }, null, 2));
    } catch (error) {
        fs.rmSync(staging, { recursive: true, force: true });
        throw error;
    }
}

main().catch(error => {
    console.error(JSON.stringify({ success: false, error: error.message }));
    process.exitCode = 1;
});
