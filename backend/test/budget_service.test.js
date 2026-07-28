const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Force separate temporary test database
const testDbPath = path.resolve(__dirname, '..', 'data', 'test_budget.db');
process.env.SQLITE_DB_PATH = testDbPath;

if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');

const db = require('../src/database/connection');
const { initializeDatabase } = require('../src/database/initialize');
const budgetService = require('../src/services/budgetService');
const ProviderAdapterFactory = require('../src/services/adapters/ProviderAdapterFactory');
const GeminiAdapter = require('../src/services/adapters/GeminiAdapter');
const OpenRouterAdapter = require('../src/services/adapters/OpenRouterAdapter');
const balanceCacheRepo = require('../src/database/repositories/providerBalanceCacheRepository');

test('Redesigned AI Provider Budget System Suite', async (t) => {

    // Bootstrap database schema & migrations
    initializeDatabase();

    await t.test('1. Database migration and seeding of existing keys', () => {
        // Run seeding
        budgetService.seedExistingKeysOnStartup();

        // Query api_keys table to make sure it exists and seeds gracefully
        const keys = db.prepare('SELECT * FROM api_keys').all();
        assert.ok(Array.isArray(keys));
    });

    await t.test('2. Retrieve grouped API Keys from database', () => {
        const grouped = budgetService.getApiKeysGrouped();
        assert.ok(typeof grouped === 'object');
    });

    await t.test('3. Register/Add a mock API Key and verify automatic synchronization', async () => {
        // We use a mock key prefix: mock-openrouter-limit-500-used-100-capabilities-supportsBalance-supportsResetDate
        const id = await budgetService.addApiKey(
            'أحمد - مبيعات المتجر',
            'openrouter',
            'mock-openrouter-limit-500-used-100-capabilities-supportsBalance-supportsResetDate'
        );

        assert.ok(id > 0);

        // Fetch the synced key info from DB
        const keyRow = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id);
        assert.strictEqual(keyRow.limits_available, 1);
        assert.strictEqual(keyRow.limit_val, 500.0);
        assert.strictEqual(keyRow.usage_val, 100.0);
        assert.strictEqual(keyRow.remaining_balance, 400.0);
        assert.strictEqual(keyRow.billing_period, 'Monthly');
        assert.strictEqual(keyRow.reset_date, '2026-04-01');

        const caps = JSON.parse(keyRow.capabilities);
        assert.strictEqual(caps.supportsBalance, true);
        assert.strictEqual(caps.supportsResetDate, true);
        assert.strictEqual(caps.supportsUsage, true);

        const source = JSON.parse(keyRow.source);
        assert.strictEqual(source.limit, 'provider');
        assert.strictEqual(source.usage, 'provider');
    });

    await t.test('4. Verify fallback and local tracking when provider does not expose limits', async () => {
        // OpenAI standard key (no mock prefix)
        const id = await budgetService.addApiKey(
            'سارة - خدمة العملاء',
            'openai',
            'sk-proj-openai-key-does-not-expose-limits'
        );

        assert.ok(id > 0);

        // Fetch from DB
        const keyRow = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id);
        assert.strictEqual(keyRow.limits_available, 0); // No limits exposed!

        // Query provider budget details
        const stats = budgetService.getProviderBudget('openai');
        assert.strictEqual(stats.limitsAvailable, false);
        assert.strictEqual(stats.limit, null); // Never invent limits!
        assert.strictEqual(stats.remaining, null);
        assert.strictEqual(stats.percentage, null);
        assert.strictEqual(typeof stats.used, 'number');
    });

    await t.test('5. Verify immediate balance decrement after request completes', () => {
        const apiKey = 'mock-openrouter-limit-500-used-100-capabilities-supportsBalance-supportsResetDate';
        const keyHash = budgetService.hashApiKey(apiKey);

        // Perform decrement
        budgetService.decrementBalanceAfterRequest(apiKey, 2.5);

        // Verify updated cache values
        const row = db.prepare('SELECT remaining_balance, usage_val, source FROM api_keys WHERE api_key_hash = ?').get(keyHash);
        assert.strictEqual(row.remaining_balance, 397.5);
        assert.strictEqual(row.usage_val, 102.5);

        const source = JSON.parse(row.source);
        assert.strictEqual(source.usage, 'estimated');
        assert.strictEqual(source.remaining, 'estimated');
    });

    await t.test('6. Retrieve all provider budgets with redesign structure', () => {
        const all = budgetService.getAllProviderBudgets();
        assert.ok(all.openrouter);
        assert.ok(all.openai);
        assert.ok(all.gemini);
        assert.ok(all.ollama);

        // OpenRouter uses our mock synced limits
        assert.strictEqual(all.openrouter.limitsAvailable, true);
        assert.strictEqual(all.openrouter.limit, 500.0);

        // OpenAI handles standard fallback elegantly
        assert.strictEqual(all.openai.limitsAvailable, false);
        assert.strictEqual(all.openai.limit, null);
    });

    await t.test('7. Adapter factory selects the requested provider without fallback', () => {
        assert.ok(ProviderAdapterFactory.getAdapter('gemini', 'gemini-key') instanceof GeminiAdapter);
        assert.ok(ProviderAdapterFactory.getAdapter('openrouter', 'openrouter-key') instanceof OpenRouterAdapter);
        assert.strictEqual(ProviderAdapterFactory.getAdapter('', 'key'), null);
        assert.strictEqual(ProviderAdapterFactory.getAdapter('unsupported', 'key'), null);
    });

    await t.test('8. Gemini balance routing never executes OpenRouter and caches by provider', async () => {
        await budgetService.addApiKey('Gemini Test', 'gemini', 'gemini-test-key');

        const geminiBalance = await budgetService.getProviderBalance('gemini', true);
        assert.strictEqual(geminiBalance.provider, 'gemini');
        assert.strictEqual(geminiBalance.success, true);
        assert.strictEqual(geminiBalance.capabilities.supportsBalance, false);

        const openRouterBalance = await budgetService.getProviderBalance('openrouter', true);
        assert.strictEqual(openRouterBalance.provider, 'openrouter');
        assert.strictEqual(openRouterBalance.success, true);
        assert.strictEqual(openRouterBalance.capabilities.supportsBalance, true);

        const geminiCache = balanceCacheRepo.getBalanceCache('gemini');
        const openRouterCache = balanceCacheRepo.getBalanceCache('openrouter');
        assert.ok(geminiCache);
        assert.ok(openRouterCache);
        assert.strictEqual(geminiCache.provider, 'gemini');
        assert.strictEqual(openRouterCache.provider, 'openrouter');
        assert.notStrictEqual(geminiCache.provider, openRouterCache.provider);
    });

    // Cleanup files safely after test suite finishes
    t.after(() => {
        db.close();
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
        if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
        if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');
    });
});
