const db = require('./connection');
const fs = require('fs');
const path = require('path');

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

        for (const file of files) {
            const version = file.split('_')[0]; // e.g. "001"

            // Check if this migration was already applied
            const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(version);
            if (applied) {
                continue;
            }

            console.log(`🚀 Applying database migration: ${file}`);
            const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

            // Apply migration in a transaction
            const transaction = db.transaction(() => {
                db.exec(sql);
                db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)')
                  .run(version, file);
            });
            transaction();
            console.log(`✅ Successfully applied migration: ${file}`);
        }

        // Legacy RAG ownership is never guessed. Production startup fails while
        // ambiguous rows remain; single-tenant installs must opt in explicitly.
        const { applyExplicitLegacyTenantMigration } = require('../rag/security/legacyTenantMigration');
        applyExplicitLegacyTenantMigration();

        // Initialize and seed AI tasks configuration
        try {
            const { initializeTasks } = require('./repositories/aiTaskRepository');
            initializeTasks();
        } catch (taskErr) {
            console.error('⚠️ Failed to initialize AI tasks:', taskErr.message);
        }

        console.log('🎉 SQLite database is fully initialized and migrated successfully!');
    } catch (error) {
        console.error('❌ Critical database initialization or migration failure:', error.message);
        process.exit(1); // Exit with a non-zero status to prevent starting Express with broken persistence
    }
}

module.exports = {
    initializeDatabase
};
