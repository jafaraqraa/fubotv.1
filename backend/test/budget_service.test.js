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
const { getProviderBudget, getAllProviderBudgets, updateProviderBudget } = require('../src/services/budgetService');

test('Budget and Real-time Usage tracking Suite', async (t) => {

    // Bootstrap database schema
    initializeDatabase();

    await t.test('1. Default budget loading and remaining calculation', () => {
        // Clear any previous settings to verify default fallback
        db.prepare("DELETE FROM settings WHERE key = 'BUDGET_OPENAI'").run();

        const stats = getProviderBudget('openai');
        assert.strictEqual(stats.provider, 'openai');
        assert.strictEqual(stats.budget, 100.0);
        assert.strictEqual(typeof stats.used, 'number');
        assert.strictEqual(stats.remaining >= 0, true);
    });

    await t.test('2. Budget update and persistence', () => {
        const updated = updateProviderBudget('openai', 150.0);
        assert.strictEqual(updated.provider, 'openai');
        assert.strictEqual(updated.budget, 150.0);

        // Verify loaded again matches
        const stats = getProviderBudget('openai');
        assert.strictEqual(stats.budget, 150.0);
    });

    await t.test('3. Retrive all budgets', () => {
        const all = getAllProviderBudgets();
        assert.ok(all.openrouter);
        assert.ok(all.openai);
        assert.ok(all.gemini);
        assert.ok(all.ollama);
        assert.strictEqual(all.openai.budget, 150.0);
    });

    // Cleanup files safely after test suite finishes
    t.after(() => {
        db.close();
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
        if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
        if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');
    });
});
