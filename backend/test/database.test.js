const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// 1. Force a separate temporary test database path before requiring connection
const testDbPath = path.resolve(__dirname, '..', 'data', 'test_app.db');
process.env.SQLITE_DB_PATH = testDbPath;

// Clear any pre-existing test DB to ensure fresh runs
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');

const db = require('../src/database/connection');
const { initializeDatabase } = require('../src/database/initialize');
const customerRepo = require('../src/database/repositories/customerRepository');
const messageRepo = require('../src/database/repositories/messageRepository');
const logRepo = require('../src/database/repositories/logRepository');

test('SQLite Database Layer Suite', async (t) => {

    await t.test('1. Database initialization and migration run', () => {
        initializeDatabase();
        // Verify migration history exists and is filled
        const row = db.prepare("SELECT COUNT(*) as count FROM schema_migrations").get();
        assert.ok(row.count >= 1, "Migration version should be recorded");
    });

    await t.test('2. Migration execution idempotency', () => {
        // Running initialization again should not throw errors or recreate tables
        assert.doesNotThrow(() => {
            initializeDatabase();
        }, "Initialization should be fully idempotent");
    });

    await t.test('3. Customer and Channel Account creation', () => {
        customerRepo.registerCustomerUser('tg123', 'Ahmed', 'telegram');
        const user = customerRepo.findCustomerUser('tg123', 'telegram');
        assert.ok(user, "User should be found in SQLite");
        assert.strictEqual(user.name, 'Ahmed');
        assert.strictEqual(user.platform, 'telegram');
        assert.strictEqual(user.unreadCount, 0);
        assert.strictEqual(user.assignee, 'ai');
        assert.strictEqual(user.isAIEnabled, true);
    });

    await t.test('4. Repeated registration updates attributes safely', () => {
        customerRepo.registerCustomerUser('tg123', 'Ahmed Al-Bakri', 'telegram');
        const user = customerRepo.findCustomerUser('tg123', 'telegram');
        assert.strictEqual(user.name, 'Ahmed Al-Bakri', "Name should be updated to Al-Bakri");
    });

    await t.test('5. Uniqueness constraint prevents duplicate channel accounts', () => {
        // The registerCustomerUser uses transaction and safe exists check,
        // we can test directly inserting duplicate to verify constraint works!
        assert.throws(() => {
            db.prepare("INSERT INTO channel_accounts (id, customer_id, channel, external_user_id) VALUES ('any1', 'cust1', 'telegram', 'tg123')").run();
        }, /UNIQUE constraint/);
    });

    await t.test('6. AI-enabled state and Assignee state persistence', () => {
        customerRepo.updateAIEnabled('tg123', false);
        let user = customerRepo.findCustomerUser('tg123', 'telegram');
        assert.strictEqual(user.isAIEnabled, false, "AI should be disabled");

        customerRepo.updateAssignee('tg123', 'سارة');
        user = customerRepo.findCustomerUser('tg123', 'telegram');
        assert.strictEqual(user.assignee, 'سارة', "Assignee should be updated to سارة");
    });

    await t.test('7. Unread counts and Clear unread count updates', () => {
        customerRepo.incrementUnreadCount('tg123');
        customerRepo.incrementUnreadCount('tg123');
        let user = customerRepo.findCustomerUser('tg123', 'telegram');
        assert.strictEqual(user.unreadCount, 2, "Unread count should be 2");

        customerRepo.clearUnreadCount('tg123');
        user = customerRepo.findCustomerUser('tg123', 'telegram');
        assert.strictEqual(user.unreadCount, 0, "Unread count should be cleared to 0");
    });

    await t.test('8. Message and Media persistence including internal notes', () => {
        messageRepo.saveMessage('tg123', 'user', 'مرحبا بك', 'text');
        messageRepo.saveMessage('tg123', 'ai', 'يا هلا بالورد', 'text');
        messageRepo.saveMessage('tg123', 'admin', 'ملاحظة سرية', 'note', true);

        const list = messageRepo.listMessages('tg123');
        assert.strictEqual(list.length, 3, "Should have 3 messages saved");
        assert.strictEqual(list[0].text, 'مرحبا بك');
        assert.strictEqual(list[0].sender, 'user');
        assert.strictEqual(list[0].isNote, false);

        assert.strictEqual(list[1].text, 'يا هلا بالورد');
        assert.strictEqual(list[1].sender, 'admin'); // ai sender is mapped to admin compatibility
        assert.strictEqual(list[1].isNote, false);

        assert.strictEqual(list[2].text, 'ملاحظة سرية');
        assert.strictEqual(list[2].isNote, true);
    });

    await t.test('9. AI history ignores internal notes and filters correctly', () => {
        const aiHistory = messageRepo.getChatHistoryForAI('tg123');
        // It should contain 'مرحبا بك' and 'يا هلا بالورد' but NOT the internal note 'ملاحظة سرية'
        assert.strictEqual(aiHistory.length, 2, "Should contain only 2 messages (excluding note)");
        assert.strictEqual(aiHistory[0].content, 'مرحبا بك');
        assert.strictEqual(aiHistory[1].content, 'يا هلا بالورد');
    });

    await t.test('10. Duplicate external-message prevention', () => {
        // Save first external message
        messageRepo.saveMessage('tg123', 'user', 'سؤال مكرر', 'text', false, 'ext999');
        assert.strictEqual(messageRepo.existsByExternalId('telegram', 'ext999'), true);

        // Attempting to insert another message with same external ID should fail uniquely
        assert.throws(() => {
            db.prepare(`
                INSERT INTO messages (id, conversation_id, channel, external_message_id, direction, sender_type, role, content)
                VALUES ('msgNew', 'convId', 'telegram', 'ext999', 'inbound', 'user', 'user', 'تكرار')
            `).run();
        }, /UNIQUE constraint/);
    });

    await t.test('11. Error logging and Solved state persistence', () => {
        logRepo.saveError(111, '12/7', '18:00', 'شبكة مفقودة', 'تفاصيل الخطأ');
        let errs = logRepo.listErrors();
        assert.ok(errs.length >= 1);
        assert.strictEqual(errs[0].type, 'شبكة مفقودة');
        assert.strictEqual(errs[0].solved, false);

        logRepo.solveError(111);
        errs = logRepo.listErrors();
        assert.strictEqual(errs[0].solved, true);
    });

    await t.test('12. Logs persistence', () => {
        logRepo.addLog('عملية فحص لقاعدة البيانات');
        const logs = logRepo.getRecentLogs();
        assert.ok(logs.length >= 1);
        assert.strictEqual(logs[0].action, 'عملية فحص لقاعدة البيانات');
    });

    await t.test('13. Persistence after closing and reopening database connection', () => {
        db.close();

        // Re-open and verify data is still there
        const Database = require('better-sqlite3');
        const dbNew = new Database(testDbPath);

        const rowCust = dbNew.prepare("SELECT display_name FROM customers WHERE id IN (SELECT customer_id FROM channel_accounts WHERE external_user_id = 'tg123')").get();
        assert.strictEqual(rowCust.display_name, 'Ahmed Al-Bakri', "Customer display name should persist");

        const rowMsg = dbNew.prepare("SELECT content FROM messages WHERE is_internal_note = 1 LIMIT 1").get();
        assert.strictEqual(rowMsg.content, 'ملاحظة سرية', "Internal notes should persist");

        dbNew.close();
    });

    // Cleanup files safely after test suite finishes
    t.after(() => {
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
        if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
        if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');
        console.log("🧹 Cleaned up separate temporary verification test database files successfully!");
    });
});
