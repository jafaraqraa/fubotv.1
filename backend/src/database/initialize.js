const db = require('./connection');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function migrationChecksum(sql) {
    return crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
}

function assertDatabaseIntegrity() {
    if (db.pragma('foreign_keys', { simple: true }) !== 1) {
        throw new Error('SQLite foreign key enforcement is disabled.');
    }
    const integrity = db.pragma('integrity_check');
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
        throw new Error('SQLite integrity_check failed.');
    }
    const foreignKeyViolations = db.pragma('foreign_key_check');
    if (foreignKeyViolations.length) {
        throw new Error(`SQLite foreign_key_check found ${foreignKeyViolations.length} violation(s).`);
    }
    const requiredObjects = [
        ['trigger', 'trg_messages_scope_insert'],
        ['trigger', 'trg_conversations_scope_insert'],
        ['index', 'idx_conversations_tenant_activity'],
        ['index', 'idx_messages_tenant_activity']
    ];
    for (const [type, name] of requiredObjects) {
        const row = db.prepare(
            'SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?'
        ).get(type, name);
        if (!row) throw new Error(`Required database object is missing: ${name}`);
    }
}

function initializeDatabase() {
    try {
        console.log('🏗️ Initializing SQLite Database tables and migrations...');

        // 1. Ensure migrations history table exists
        db.exec(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 2. Scan migrations directory
        const migrationsDir = path.join(__dirname, 'migrations');
        const files = fs.readdirSync(migrationsDir)
            .filter(f => f.endsWith('.sql'))
            .sort(); // Apply in deterministic alphabetical/version order
        const versions = files.map(file => file.split('_')[0]);
        if (new Set(versions).size !== versions.length) {
            throw new Error('Duplicate database migration version detected.');
        }

        for (const file of files) {
            const version = file.split('_')[0]; // e.g. "001"
            const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
            const checksum = migrationChecksum(sql);

            // Check if this migration was already applied
            const applied = db.prepare('SELECT * FROM schema_migrations WHERE version = ?').get(version);
            if (applied) {
                if (applied.name !== file) {
                    throw new Error(`Migration history name mismatch for version ${version}.`);
                }
                const hasChecksum = db.pragma("table_info('schema_migrations')")
                    .some(column => column.name === 'checksum');
                if (hasChecksum && applied.checksum && applied.checksum !== checksum) {
                    throw new Error(`Migration checksum mismatch for ${file}.`);
                }
                if (hasChecksum && !applied.checksum) {
                    db.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = ?')
                        .run(checksum, version);
                }
                continue;
            }

            console.log(`🚀 Applying database migration: ${file}`);

            // Apply migration in a transaction
            const transaction = db.transaction(() => {
                db.exec(sql);
                const hasChecksum = db.pragma("table_info('schema_migrations')")
                    .some(column => column.name === 'checksum');
                if (hasChecksum) {
                    db.prepare('INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)')
                        .run(version, file, checksum);
                } else {
                    db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)')
                        .run(version, file);
                }
            });
            transaction();
            console.log(`✅ Successfully applied migration: ${file}`);
        }
        if (db.pragma("table_info('schema_migrations')").some(column => column.name === 'checksum')) {
            const updateChecksum = db.prepare(
                'UPDATE schema_migrations SET checksum = ? WHERE version = ? AND checksum IS NULL'
            );
            for (const file of files) {
                const version = file.split('_')[0];
                const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
                updateChecksum.run(migrationChecksum(sql), version);
            }
        }

        // Legacy RAG ownership is never guessed. Production startup fails while
        // ambiguous rows remain; single-tenant installs must opt in explicitly.
        const { applyExplicitLegacyTenantMigration } = require('../rag/security/legacyTenantMigration');
        applyExplicitLegacyTenantMigration();

        // Initialize and seed AI tasks configuration
        const { initializeTasks } = require('./repositories/aiTaskRepository');
        initializeTasks();
        assertDatabaseIntegrity();

        console.log('🎉 SQLite database is fully initialized and migrated successfully!');
    } catch (error) {
        console.error('❌ Critical database initialization or migration failure:', error.message);
        process.exit(1); // Exit with a non-zero status to prevent starting Express with broken persistence
    }
}

module.exports = {
    initializeDatabase,
    assertDatabaseIntegrity,
    migrationChecksum
};
