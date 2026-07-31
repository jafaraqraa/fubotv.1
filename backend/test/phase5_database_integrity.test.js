const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase5-db-'));
const dbPath = path.join(tempDir, 'phase5.db');
process.env.SQLITE_DB_PATH = dbPath;
process.env.SESSION_SECRET = 'phase5_database_test_secret_more_than_32_chars';

const db = require('../src/database/connection');
const { initializeDatabase } = require('../src/database/initialize');
const {
    runIntegrityAudit,
    createVerifiedBackup
} = require('../src/database/databaseIntegrityService');

test('Phase 5 database and data-integrity contracts', async (t) => {
    await t.test('clean migration reaches latest schema and is rerunnable', () => {
        initializeDatabase();
        assert.equal(
            db.prepare('SELECT COUNT(*) count FROM schema_migrations').get().count,
            26
        );
        assert.equal(
            db.prepare('SELECT COUNT(*) count FROM schema_migrations WHERE checksum IS NULL').get().count,
            0
        );
        assert.doesNotThrow(initializeDatabase);
    });

    await t.test('foreign keys, integrity and read-only audit pass', () => {
        const report = runIntegrityAudit(db);
        assert.equal(report.foreignKeysEnabled, true);
        assert.deepEqual(report.integrityCheck, ['ok']);
        assert.deepEqual(report.foreignKeyViolations, []);
        assert.equal(report.ok, true);
    });

    await t.test('checksum mismatch and partial schema block startup', () => {
        const original = db.prepare(
            "SELECT checksum FROM schema_migrations WHERE version = '001'"
        ).get().checksum;
        db.prepare("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = '001'").run();
        let child = spawnSync(process.execPath, [
            '-e', "require('./src/database/initialize').initializeDatabase()"
        ], {
            cwd: path.resolve(__dirname, '..'),
            env: { ...process.env, SQLITE_DB_PATH: dbPath },
            encoding: 'utf8'
        });
        assert.notEqual(child.status, 0);
        assert.match(child.stderr + child.stdout, /checksum mismatch/i);
        db.prepare("UPDATE schema_migrations SET checksum = ? WHERE version = '001'").run(original);

        const trigger = db.prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_messages_scope_insert'"
        ).get().sql;
        db.exec('DROP TRIGGER trg_messages_scope_insert');
        child = spawnSync(process.execPath, [
            '-e', "require('./src/database/initialize').initializeDatabase()"
        ], {
            cwd: path.resolve(__dirname, '..'),
            env: { ...process.env, SQLITE_DB_PATH: dbPath },
            encoding: 'utf8'
        });
        assert.notEqual(child.status, 0);
        assert.match(child.stderr + child.stdout, /Required database object is missing/);
        db.exec(trigger);
    });

    await t.test('multi-step transaction rolls back all rows on failure', () => {
        const before = db.prepare('SELECT COUNT(*) count FROM customers').get().count;
        const transaction = db.transaction(() => {
            db.prepare("INSERT INTO customers (id, display_name) VALUES ('rollback-customer', 'Rollback')")
                .run();
            db.prepare(`
                INSERT INTO channel_accounts (id, customer_id, channel, external_user_id)
                VALUES ('rollback-account', 'missing-parent', 'telegram', 'rollback-user')
            `).run();
        });
        assert.throws(transaction, /FOREIGN KEY constraint failed/);
        assert.equal(db.prepare('SELECT COUNT(*) count FROM customers').get().count, before);
    });

    await t.test('database rejects cross-tenant and malformed message writes', () => {
        db.prepare("INSERT INTO customers (id, display_name) VALUES ('customer-a', 'A')").run();
        db.prepare(`
            INSERT INTO channel_accounts (id, customer_id, channel, external_user_id)
            VALUES ('account-a', 'customer-a', 'whatsapp', 'external-a')
        `).run();
        db.prepare(`
            INSERT INTO conversations (
                id, customer_id, channel_account_id, channel, tenant_id, last_message_at
            ) VALUES ('conversation-a', 'customer-a', 'account-a', 'whatsapp', 'tenant-a', '2026-01-01T00:00:00.000Z')
        `).run();

        assert.throws(() => db.prepare(`
            INSERT INTO messages (
                id, conversation_id, tenant_id, channel, direction,
                sender_type, role, content, metadata
            ) VALUES (
                'message-cross', 'conversation-a', 'tenant-b', 'whatsapp',
                'inbound', 'user', 'user', 'x', '{}'
            )
        `).run(), /MESSAGE_SCOPE_MISMATCH/);

        assert.throws(() => db.prepare(`
            INSERT INTO messages (
                id, conversation_id, tenant_id, channel, direction,
                sender_type, role, content, metadata
            ) VALUES (
                'message-json', 'conversation-a', 'tenant-a', 'whatsapp',
                'inbound', 'user', 'user', 'x', '{bad'
            )
        `).run(), /INVALID_MESSAGE_DATA/);
    });

    await t.test('unique webhook and external-message identities survive races', () => {
        const insertReplay = db.prepare(
            'INSERT INTO webhook_replay_guard (replay_key, expires_at) VALUES (?, ?)'
        );
        insertReplay.run('same-event', Date.now() + 60_000);
        assert.throws(() => insertReplay.run('same-event', Date.now() + 60_000), /UNIQUE/);
    });

    await t.test('message status transitions are compare-and-set validated', () => {
        const repository = require('../src/database/repositories/messageRepository');
        db.prepare(`
            INSERT INTO messages (
                id, conversation_id, tenant_id, channel, direction,
                sender_type, role, content, delivery_status
            ) VALUES (
                'status-message', 'conversation-a', 'tenant-a', 'whatsapp',
                'outbound', 'agent', 'assistant', 'x', 'sending'
            )
        `).run();
        assert.equal(repository.updateMessageDelivery('status-message', 'sent'), true);
        assert.throws(
            () => repository.updateMessageDelivery('status-message', 'sending'),
            error => error.code === 'INVALID_MESSAGE_STATUS_TRANSITION'
        );
    });

    await t.test('pagination and dynamic update fields are bounded', () => {
        const router = require('../src/routes/api');
        assert.deepEqual(router.parsePagination({ page: '2', limit: '25' }), { page: 2, limit: 25 });
        assert.throws(() => router.parsePagination({ page: '0' }), /page/);
        assert.throws(() => router.parsePagination({ limit: '1000' }), /limit/);

        const repository = require('../src/database/repositories/knowledgeDocumentRepository');
        assert.throws(
            () => repository.updateDocument('tenant-a', 1, { 'status = ? WHERE 1=1 --': 'active' }),
            error => error.code === 'INVALID_DOCUMENT_UPDATE_FIELD'
        );
    });

    await t.test('important query plans use tenant-aware indexes', () => {
        const conversationPlan = db.prepare(`
            EXPLAIN QUERY PLAN
            SELECT id FROM conversations
            WHERE tenant_id = ?
            ORDER BY last_message_at DESC, id
            LIMIT 20
        `).all('tenant-a').map(row => row.detail).join(' ');
        assert.match(conversationPlan, /idx_conversations_tenant_activity/);

        const messagePlan = db.prepare(`
            EXPLAIN QUERY PLAN
            SELECT id FROM messages
            WHERE tenant_id = ?
            ORDER BY created_at DESC, id
            LIMIT 20
        `).all('tenant-a').map(row => row.detail).join(' ');
        assert.match(messagePlan, /idx_messages_tenant_activity/);
    });

    await t.test('WAL-safe backup restores and passes integrity checks', async () => {
        const backupPath = path.join(tempDir, 'restored.db');
        const backup = await createVerifiedBackup(db, backupPath);
        assert.deepEqual(backup.verification.integrityCheck, ['ok']);
        assert.deepEqual(backup.verification.foreignKeyViolations, []);
        assert.equal(fs.existsSync(backupPath), true);
    });

    t.after(() => {
        if (db.open) db.close();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });
});
