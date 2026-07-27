const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Force isolated test DB
const testDbPath = path.resolve(__dirname, '..', 'data', 'test_ai_tasks_routing.db');
process.env.SQLITE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = 'test_ai_tasks_secret_123';
process.env.NODE_ENV = 'development';

if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');

const db = require('../src/database/connection');
const { initializeDatabase } = require('../src/database/initialize');
const { getTaskConfig, getAllTaskConfigs, saveTaskConfig, initializeTasks } = require('../src/database/repositories/aiTaskRepository');
const { getAIProviderForTask } = require('../src/services/aiProviders');

test('AI Task-Based Configuration and Routing Suite', async (t) => {

    await t.test('1. Initialize database migrations & task configurations', () => {
        initializeDatabase();

        // Check schema migration table exists
        const migrationRow = db.prepare("SELECT COUNT(*) as count FROM schema_migrations").get();
        assert.ok(migrationRow.count >= 1, "Schema migrations should be executed successfully");

        // Verify task table has been created and populated automatically on database init
        const taskRow = db.prepare("SELECT COUNT(*) as count FROM ai_task_configs").get();
        assert.strictEqual(taskRow.count, 6, "Should automatically seed exactly 6 AI task configurations");
    });

    await t.test('2. Get specific and all task configurations', () => {
        const textGen = getTaskConfig('text_generation');
        assert.ok(textGen, "Should successfully read text_generation config");
        assert.strictEqual(textGen.task, 'text_generation');

        const allConfigs = getAllTaskConfigs();
        assert.strictEqual(allConfigs.length, 6, "Should retrieve all 6 configurations");

        const tasksList = allConfigs.map(c => c.task);
        assert.ok(tasksList.includes('text_generation'));
        assert.ok(tasksList.includes('vision'));
        assert.ok(tasksList.includes('speech_to_text'));
        assert.ok(tasksList.includes('text_to_speech'));
        assert.ok(tasksList.includes('embedding'));
        assert.ok(tasksList.includes('reranker'));
    });

    await t.test('3. Save task configuration edits', () => {
        const payload = {
            task: 'vision',
            provider: 'openai',
            model: 'gpt-4o-mini-new',
            api_key_ref: 'OPENAI_API_KEY',
            enabled: 1
        };

        saveTaskConfig(payload);

        const updated = getTaskConfig('vision');
        assert.strictEqual(updated.model, 'gpt-4o-mini-new', "Should successfully update task configurations on conflict");
    });

    await t.test('4. Resolve AI provider per task (Model Routing)', () => {
        // Setup environment variables first for API keys
        process.env.OPENAI_API_KEY = 'mock_openai_api_key_xyz_123';
        process.env.OPENROUTER_API_KEY = 'mock_openrouter_api_key_xyz_123';
        process.env.GEMINI_API_KEY = 'mock_gemini_api_key_xyz_123';

        // Save Text Generation task as OpenRouter
        saveTaskConfig({
            task: 'text_generation',
            provider: 'openrouter',
            model: 'deepseek/deepseek-chat',
            api_key_ref: 'OPENROUTER_API_KEY',
            enabled: 1
        });

        // Save Embedding task as Ollama
        saveTaskConfig({
            task: 'embedding',
            provider: 'ollama',
            model: 'nomic-embed-text-v1',
            api_key_ref: '',
            enabled: 1
        });

        // 1. Text Generation Provider
        const textProvider = getAIProviderForTask('text_generation');
        assert.strictEqual(textProvider.constructor.name, 'OpenRouterProvider', "Should resolve to OpenRouter");
        assert.strictEqual(textProvider.model, 'deepseek/deepseek-chat', "Should use configured model");
        assert.strictEqual(textProvider.apiKey, 'mock_openrouter_api_key_xyz_123', "Should correctly load referenced API key");

        // 2. Embedding Provider
        const embeddingProvider = getAIProviderForTask('embedding');
        assert.strictEqual(embeddingProvider.constructor.name, 'OllamaProvider', "Should resolve to Ollama");
        assert.strictEqual(embeddingProvider.model, 'nomic-embed-text-v1', "Should use Ollama model");

        // 3. Vision Provider
        saveTaskConfig({
            task: 'vision',
            provider: 'openai',
            model: 'gpt-4.1-custom',
            api_key_ref: 'OPENAI_API_KEY',
            enabled: 1
        });
        const visionProvider = getAIProviderForTask('vision');
        assert.strictEqual(visionProvider.constructor.name, 'OpenAIProvider', "Should resolve to OpenAI");
        assert.strictEqual(visionProvider.model, 'gpt-4.1-custom');
        assert.strictEqual(visionProvider.apiKey, 'mock_openai_api_key_xyz_123');
    });

    await t.test('5. Backward Compatibility Fallback', () => {
        // Delete task config to simulate legacy/empty configurations state
        db.exec("DELETE FROM ai_task_configs WHERE task = 'text_generation'");

        // Setup process.env simulating legacy OpenRouter setups
        process.env.AI_PROVIDER = 'openrouter';
        process.env.OPENROUTER_MODEL = 'google/gemini-pro-legacy';
        process.env.OPENROUTER_API_KEY = 'legacy_mock_key';

        const provider = getAIProviderForTask('text_generation');
        assert.ok(provider, "Should gracefully resolve configuration");
        assert.strictEqual(provider.constructor.name, 'OpenRouterProvider');
        assert.strictEqual(provider.model, 'google/gemini-pro-legacy', "Should fall back to environment model configuration");
        assert.strictEqual(provider.apiKey, 'legacy_mock_key', "Should fall back to environment API Key configuration");
    });

    await t.test('6. Validate Provider/Model Combinations', () => {
        // Gemini provider with deepseek model should throw Configuration Error
        saveTaskConfig({
            task: 'text_generation',
            provider: 'gemini',
            model: 'deepseek/deepseek-chat',
            api_key_ref: 'GEMINI_API_KEY',
            enabled: 1
        });

        assert.throws(() => {
            getAIProviderForTask('text_generation');
        }, /Configuration Error/, "Invalid gemini/deepseek combination should be rejected");

        // OpenAI provider with slash model should throw Configuration Error
        saveTaskConfig({
            task: 'text_generation',
            provider: 'openai',
            model: 'deepseek/deepseek-chat',
            api_key_ref: 'OPENAI_API_KEY',
            enabled: 1
        });

        assert.throws(() => {
            getAIProviderForTask('text_generation');
        }, /Configuration Error/, "Invalid openai/deepseek combination should be rejected");

        // OpenRouter provider with simple model name should throw Configuration Error
        saveTaskConfig({
            task: 'text_generation',
            provider: 'openrouter',
            model: 'gpt-4o-mini',
            api_key_ref: 'OPENROUTER_API_KEY',
            enabled: 1
        });

        assert.throws(() => {
            getAIProviderForTask('text_generation');
        }, /Configuration Error/, "Invalid openrouter simple model name should be rejected");
    });

    t.after(() => {
        db.close();
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
        if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
        if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');
        console.log("🧹 Cleaned up isolated test database for AI tasks successfully!");
    });
});
