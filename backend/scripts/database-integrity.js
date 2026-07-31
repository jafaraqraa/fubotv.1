#!/usr/bin/env node
const path = require('path');
const db = require('../src/database/connection');
const {
    runIntegrityAudit,
    createVerifiedBackup
} = require('../src/database/databaseIntegrityService');

async function main() {
    const backupArg = process.argv.find(value => value.startsWith('--backup='));
    const report = runIntegrityAudit(db);
    console.log(JSON.stringify({ mode: 'dry-run', report }, null, 2));
    if (!report.ok) process.exitCode = 2;

    if (backupArg) {
        const destination = path.resolve(backupArg.slice('--backup='.length));
        const result = await createVerifiedBackup(db, destination);
        console.log(JSON.stringify({
            backup: result.path,
            restoredIntegrity: result.verification.integrityCheck,
            restoredForeignKeyViolations: result.verification.foreignKeyViolations.length
        }, null, 2));
    }
}

main()
    .catch(error => {
        console.error(JSON.stringify({
            success: false,
            code: error.code || 'DATABASE_INTEGRITY_COMMAND_FAILED',
            error: error.message
        }));
        process.exitCode = 1;
    })
    .finally(() => {
        if (db.open) db.close();
    });
