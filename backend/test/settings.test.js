const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Force isolated test DB
const testDbPath = path.resolve(__dirname, '..', 'data', 'test_settings_app.db');
process.env.SQLITE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = 'test_session_secret_123_32_characters';
process.env.NODE_ENV = 'development';

if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');

const db = require('../src/database/connection');
const { initializeDatabase } = require('../src/database/initialize');
const {
    saveSetting,
    getSetting,
    getAllSettings,
    SENSITIVE_KEYS,
    maskSecret,
    isMaskedPlaceholder,
    loadSettingsOnStartup
} = require('../src/services/settingsService');

test('SQLite Settings Persistence Suite', async (t) => {

    await t.test('1. Initialize database migrations', () => {
        initializeDatabase();
        const row = db.prepare("SELECT COUNT(*) as count FROM schema_migrations").get();
        assert.ok(row.count >= 1, "Migrations should be executed successfully");
    });

    await t.test('2. Save and retrieve non-secret setting', () => {
        saveSetting('OPENROUTER_MODEL', 'anthropic/claude-3-opus');
        const val = getSetting('OPENROUTER_MODEL');
        assert.strictEqual(val, 'anthropic/claude-3-opus', "Should successfully write and retrieve settings in SQLite");
    });

    await t.test('3. Database connection close & restart loads settings into process.env', () => {
        saveSetting('BOT_TOKEN', '123456:ABC-DEF');
        saveSetting('WA_AUTO_REPLY', 'true');

        // Clear process.env keys first
        delete process.env.BOT_TOKEN;
        delete process.env.WA_AUTO_REPLY;

        // Simulate startup
        loadSettingsOnStartup();

        assert.strictEqual(process.env.BOT_TOKEN, '123456:ABC-DEF');
        assert.strictEqual(process.env.WA_AUTO_REPLY, 'true');
    });

    await t.test('4. Secret masking validation', () => {
        assert.strictEqual(maskSecret(''), '');
        assert.strictEqual(maskSecret('123'), '••••••••');
        assert.strictEqual(maskSecret('super_secret_token_12345'), '••••••••2345');
    });

    await t.test('5. Masked placeholder check', () => {
        assert.strictEqual(isMaskedPlaceholder('••••••••'), true);
        assert.strictEqual(isMaskedPlaceholder('●●●●●●●●'), true);
        assert.strictEqual(isMaskedPlaceholder('not_masked_value'), false);
    });

    await t.test('6. Empty or masked placeholder preserves existing secrets', () => {
        // Setup initial secret
        saveSetting('MESSENGER_ACCESS_TOKEN', 'original_token_abc');
        process.env.MESSENGER_ACCESS_TOKEN = 'original_token_abc';

        // Simulate save settings call with empty or masked string
        const incomingTokenMasked = '••••••••';
        if (incomingTokenMasked && !isMaskedPlaceholder(incomingTokenMasked)) {
            saveSetting('MESSENGER_ACCESS_TOKEN', incomingTokenMasked);
        }

        assert.strictEqual(getSetting('MESSENGER_ACCESS_TOKEN'), 'original_token_abc', "Should preserve original secret if masked placeholder is passed");
    });

    await t.test('7. New real secret value replaces existing secret', () => {
        saveSetting('MESSENGER_ACCESS_TOKEN', 'original_token_abc');

        const incomingNewRealToken = 'new_awesome_token_xyz';
        if (incomingNewRealToken && !isMaskedPlaceholder(incomingNewRealToken)) {
            saveSetting('MESSENGER_ACCESS_TOKEN', incomingNewRealToken);
        }

        assert.strictEqual(getSetting('MESSENGER_ACCESS_TOKEN'), 'new_awesome_token_xyz', "Should update secret when real value is supplied");
    });

    await t.test('8. Meta signing secrets are classified as sensitive and load on startup', () => {
        assert.ok(SENSITIVE_KEYS.includes('META_APP_SECRET'));
        assert.ok(SENSITIVE_KEYS.includes('WHATSAPP_APP_SECRET'));

        saveSetting('META_APP_SECRET', '0123456789abcdef0123456789abcdef');
        delete process.env.META_APP_SECRET;
        loadSettingsOnStartup();

        assert.strictEqual(process.env.META_APP_SECRET, '0123456789abcdef0123456789abcdef');
        assert.strictEqual(maskSecret(process.env.META_APP_SECRET), '••••••••cdef');
    });

    t.after(() => {
        db.close();
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
        if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
        if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');
        console.log("🧹 Cleaned up isolated test database for settings successfully!");
    });
});
