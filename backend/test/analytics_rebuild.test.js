const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Force isolated test DB for analytics rebuild verification
const testDbPath = path.resolve(__dirname, '..', 'data', 'test_analytics_rebuild.db');
process.env.SQLITE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = 'test_session_secret_analytics';
process.env.NODE_ENV = 'development';

if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');

const db = require('../src/database/connection');
const { initializeDatabase } = require('../src/database/initialize');

// Import rebuilt modules
const analyticsRepository = require('../src/analytics/analytics.repository');
const analyticsService = require('../src/analytics/analytics.service');
const analyticsWebSocket = require('../src/analytics/analytics.websocket');

// Mock central event publisher to capture socket transmissions
const eventPublisher = require('../src/realtime/eventPublisher');
let broadcastedEvents = [];
const originalPublish = eventPublisher.publish;
eventPublisher.publish = (eventName, rawData) => {
    broadcastedEvents.push({ eventName, rawData });
    return { eventId: 'mock_id', occurredAt: new Date().toISOString(), data: rawData };
};

test('Rebuilt Clean-Architecture Analytics Module Integration Suite', async (t) => {

    await t.test('1. Database setup, schema initialization and index verification', () => {
        initializeDatabase();

        // Trigger manual index optimization now that table exists
        analyticsRepository.optimizeIndexes();

        // Verify indexes are successfully created
        const indexList = db.prepare("PRAGMA index_list('ai_usage')").all();
        const hasTimeIdx = indexList.some(idx => idx.name === 'idx_ai_usage_tenant_time');
        const hasProvModelIdx = indexList.some(idx => idx.name === 'idx_ai_usage_provider_model');

        assert.ok(hasTimeIdx, "Performance index idx_ai_usage_tenant_time should exist");
        assert.ok(hasProvModelIdx, "Performance index idx_ai_usage_provider_model should exist");
    });

    await t.test('2. Single AI request record usage and verify exactly one row inserted', () => {
        const initialCountRow = db.prepare("SELECT COUNT(*) as count FROM ai_usage").get();
        const initialCount = initialCountRow.count;

        const result = analyticsRepository.recordUsage({
            provider: 'openai',
            model: 'gpt-4o',
            task: 'text_generation',
            tenant_id: 'default',
            request_time: new Date(),
            prompt_tokens: 100,
            completion_tokens: 150,
            total_tokens: 250,
            cost: 0.0005,
            success: 1
        });

        assert.strictEqual(result.success, true);
        assert.ok(result.id !== undefined);

        const finalCountRow = db.prepare("SELECT COUNT(*) as count FROM ai_usage").get();
        assert.strictEqual(finalCountRow.count, initialCount + 1, "Successful AI request should create exactly one row in ai_usage");
    });

    await t.test('3. Real-time event publishing validation', () => {
        broadcastedEvents = []; // reset log

        const result = analyticsWebSocket.broadcastUsageUpdate({
            provider: 'openai',
            model: 'gpt-4o',
            task: 'text_generation',
            total_tokens: 250
        });

        assert.ok(result !== null);
        assert.strictEqual(broadcastedEvents.length, 1, "Should publish exactly one WebSocket event");
        assert.strictEqual(broadcastedEvents[0].eventName, 'ai_usage_updated');
        assert.strictEqual(broadcastedEvents[0].rawData.provider, 'openai');
        assert.strictEqual(broadcastedEvents[0].rawData.model, 'gpt-4o');
    });

    await t.test('4. REST API Endpoint Overview logic verification', () => {
        const overview = analyticsService.getOverview('default');

        // Verify friendly key layout
        assert.ok(overview["Today's Requests"] !== undefined);
        assert.ok(overview["Today's Tokens"] !== undefined);
        assert.ok(overview["Today's Cost"] !== undefined);
        assert.ok(overview["Monthly Requests"] !== undefined);
        assert.ok(overview["Monthly Tokens"] !== undefined);
        assert.ok(overview["Monthly Cost"] !== undefined);
        assert.ok(overview["Total Requests"] !== undefined);
        assert.ok(overview["Total Tokens"] !== undefined);
        assert.ok(overview["Total Cost"] !== undefined);

        // Verify values are correct (reflecting our single inserted request)
        assert.strictEqual(overview["Today's Requests"], 1);
        assert.strictEqual(overview["Today's Tokens"], 250);
        assert.strictEqual(overview["Today's Cost"], 0.0005);
    });

    await t.test('5. REST API Endpoint Providers logic verification', () => {
        const providers = analyticsService.getProviders('default');

        assert.ok(providers.openai !== undefined);
        assert.strictEqual(providers.openai.requests, 1);
        assert.strictEqual(providers.openai.tokens, 250);
        assert.strictEqual(providers.openai.prompt_tokens, 100);
        assert.strictEqual(providers.openai.completion_tokens, 150);
        assert.strictEqual(providers.openai.cost, 0.0005);

        // Ensure non-active providers default gracefully to 0 to prevent UI crashes
        assert.ok(providers.openrouter !== undefined);
        assert.strictEqual(providers.openrouter.requests, 0);
    });

    await t.test('6. REST API Endpoint Models logic verification', () => {
        const models = analyticsService.getModels('default');

        assert.strictEqual(models.length, 1);
        assert.strictEqual(models[0].model, 'gpt-4o');
        assert.strictEqual(models[0].provider, 'openai');
        assert.strictEqual(models[0].requests, 1);
        assert.strictEqual(models[0].prompt_tokens, 100);
        assert.strictEqual(models[0].completion_tokens, 150);
        assert.strictEqual(models[0].totalTokens, 250);
        assert.strictEqual(models[0].totalCost, 0.0005);
        assert.strictEqual(models[0].successRate, 100);
    });

    await t.test('7. REST API Endpoint History logic verification', () => {
        const history = analyticsService.getHistory('default');

        assert.strictEqual(history.length, 1);
        const todayStr = new Date().toISOString().substring(0, 10);
        assert.strictEqual(history[0].date, todayStr);
        assert.strictEqual(history[0].requests, 1);
        assert.strictEqual(history[0].cost, 0.0005);
        assert.strictEqual(history[0].tokens, 250);
    });

    await t.test('8. REST API Endpoint Live requests logic verification', () => {
        const live = analyticsService.getLive('default');

        assert.strictEqual(live.length, 1, "Should return exactly 1 live request record");
        assert.strictEqual(live[0].provider, 'openai');
        assert.strictEqual(live[0].model, 'gpt-4o');
        assert.strictEqual(live[0].prompt_tokens, 100);
        assert.strictEqual(live[0].completion_tokens, 150);
        assert.strictEqual(live[0].total_tokens, 250);
        assert.strictEqual(live[0].cost, 0.0005);
        assert.ok(live[0].created_at !== undefined);
    });

    t.after(() => {
        // Restore Event Publisher
        eventPublisher.publish = originalPublish;

        db.close();
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
        if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
        if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');
        console.log("🧹 Cleaned up analytics rebuild isolated test database successfully!");
    });
});
