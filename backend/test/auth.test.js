const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

// Force test database configuration before requiring models
const testDbPath = path.resolve(__dirname, '..', 'data', 'test_auth.db');
process.env.SQLITE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = 'test_secret_cookie_xxxxx';

if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');

const db = require('../src/database/connection');
const { initializeDatabase } = require('../src/database/initialize');
const { bootstrapAdminAccount } = require('../src/services/adminBootstrap');
const adminRepo = require('../src/database/repositories/adminRepository');
const { authenticate } = require('../src/services/authService');

test('SQLite Administrator Hashing & Authentication Suite', async (t) => {

    await t.test('1. Setup schema and bootstrap initial admin account', () => {
        initializeDatabase();
        bootstrapAdminAccount();

        // Assert table has admin row
        const row = db.prepare('SELECT id, username, password_hash FROM administrators WHERE username = ?').get('admin');
        assert.ok(row, "Admin account should be bootstrapped");
        assert.strictEqual(row.username, 'admin');
        assert.ok(row.password_hash.startsWith('$2a$') || row.password_hash.startsWith('$2b$'), "Password must be hashed with bcrypt");
        assert.notStrictEqual(row.password_hash, 'Admin@123456', "Plain password must never be stored");
    });

    await t.test('2. Idempotent bootstrap bypasses duplicate creations', () => {
        // Run bootstrap again, should not create duplicate or fail
        assert.doesNotThrow(() => {
            bootstrapAdminAccount();
        });
        const rows = db.prepare('SELECT COUNT(*) as count FROM administrators WHERE username = ?').get('admin');
        assert.strictEqual(rows.count, 1, "Should never create duplicate admin rows");
    });

    await t.test('3. Authenticate with correct credentials', () => {
        const result = authenticate('admin', 'Admin@123456');
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.user.username, 'admin');
        assert.strictEqual(result.user.displayName, 'Administrator');
        assert.strictEqual(result.user.passwordHash, undefined, "User payload must never expose password hash");
    });

    await t.test('4. Authenticate fails with incorrect username or password', () => {
        const resultWrongUser = authenticate('non_existent', 'Admin@123456');
        assert.strictEqual(resultWrongUser.success, false);
        assert.strictEqual(resultWrongUser.error, 'اسم المستخدم أو كلمة المرور غير صحيحة');

        const resultWrongPass = authenticate('admin', 'wrong_pass');
        assert.strictEqual(resultWrongPass.success, false);
        assert.strictEqual(resultWrongPass.error, 'اسم المستخدم أو كلمة المرور غير صحيحة');
    });

    await t.test('5. Change password route validates current password and requirements', () => {
        const adminObj = adminRepo.findAdminByUsername('admin');
        assert.ok(adminObj);

        // Weak password validation test
        const weakPass = '123456';
        const strongRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#\$%\^&\*])(?=.{10,})/;
        assert.strictEqual(strongRegex.test(weakPass), false, "Weak password should fail regex strength requirement");

        // Strong password verification
        const strongPass = 'NewAdmin@2026!';
        assert.strictEqual(strongRegex.test(strongPass), true, "Strong password should satisfy regex requirements");

        // Update password and test new login
        const newHash = bcrypt.hashSync(strongPass, 10);
        adminRepo.updatePassword(adminObj.id, newHash);

        const newAuth = authenticate('admin', strongPass);
        assert.strictEqual(newAuth.success, true, "New password should authenticate successfully");

        const oldAuth = authenticate('admin', 'Admin@123456');
        assert.strictEqual(oldAuth.success, false, "Old password should fail now");
    });

    t.after(() => {
        db.close();
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
        if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
        if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');
        console.log("🧹 Auth verification database cleared cleanly!");
    });
});
