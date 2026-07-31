#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createVerifiedBackup } = require('../src/database/databaseIntegrityService');

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
        if (fs.existsSync(uploadsSource)) {
            fs.cpSync(uploadsSource, uploadsDestination, { recursive: true, force: false });
        }

        let qdrant = { skipped: true, reason: 'explicit --skip-qdrant' };
        if (!process.argv.includes('--skip-qdrant')) {
            const baseUrl = String(process.env.QDRANT_URL || '').replace(/\/$/, '');
            const collection = process.env.QDRANT_COLLECTION || 'futhing_knowledge';
            if (!baseUrl) throw new Error('QDRANT_URL is required unless --skip-qdrant is explicit');
            const headers = process.env.QDRANT_API_KEY
                ? { 'api-key': process.env.QDRANT_API_KEY }
                : {};
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
        }

        const files = walk(staging)
            .filter(file => path.basename(file) !== 'manifest.json')
            .map(file => ({
                path: path.relative(staging, file),
                bytes: fs.statSync(file).size,
                sha256: sha256(file)
            }));
        const manifest = {
            formatVersion: 1,
            createdAt: new Date().toISOString(),
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
