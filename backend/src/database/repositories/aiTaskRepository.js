const db = require('../connection');
const settingsRepository = require('./settingsRepository');

function getTaskConfig(task) {
    try {
        return db.prepare('SELECT task, provider, model, api_key_ref, enabled FROM ai_task_configs WHERE task = ?').get(task);
    } catch (err) {
        console.error(`Error in getTaskConfig(${task}):`, err.message);
        throw err;
    }
}

function getAllTaskConfigs() {
    try {
        return db.prepare('SELECT task, provider, model, api_key_ref, enabled FROM ai_task_configs').all();
    } catch (err) {
        console.error('Error in getAllTaskConfigs:', err.message);
        throw err;
    }
}

function saveTaskConfig({ task, provider, model, api_key_ref, enabled }) {
    try {
        db.prepare(`
            INSERT INTO ai_task_configs (task, provider, model, api_key_ref, enabled)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(task) DO UPDATE SET
                provider = excluded.provider,
                model = excluded.model,
                api_key_ref = excluded.api_key_ref,
                enabled = excluded.enabled
        `).run(task, provider, model, api_key_ref, enabled !== undefined ? Number(enabled) : 1);
        return true;
    } catch (err) {
        console.error(`Error in saveTaskConfig(${task}):`, err.message);
        throw err;
    }
}

function initializeTasks() {
    try {
        // Ensure table exists first (if database initialized already or is in process)
        db.exec(`
            CREATE TABLE IF NOT EXISTS ai_task_configs (
                task TEXT PRIMARY KEY,
                provider TEXT NOT NULL,
                model TEXT NOT NULL,
                api_key_ref TEXT,
                enabled INTEGER DEFAULT 1
            );
        `);

        console.log('🌱 Checking AI task configurations. Seeding missing standard tasks with backward compatibility...');

        // Resolve default/existing OpenRouter configuration for text generation
        const existingProvider = settingsRepository.getSetting('AI_PROVIDER') || process.env.AI_PROVIDER || 'openrouter';
        const existingModel = settingsRepository.getSetting('AI_MODEL') || settingsRepository.getSetting('OPENROUTER_MODEL') || process.env.AI_MODEL || process.env.OPENROUTER_MODEL || 'openrouter/free';

        let existingApiKeyRef = 'OPENROUTER_API_KEY';
        if (existingProvider === 'openai') {
            existingApiKeyRef = 'OPENAI_API_KEY';
        } else if (existingProvider === 'gemini') {
            existingApiKeyRef = 'GEMINI_API_KEY';
        }

        const defaultTasks = [
            {
                task: 'text_generation',
                provider: existingProvider,
                model: existingModel,
                api_key_ref: existingApiKeyRef,
                enabled: 1
            },
            {
                task: 'vision',
                provider: 'openai',
                model: 'gpt-4o-mini',
                api_key_ref: 'OPENAI_API_KEY',
                enabled: 1
            },
            {
                task: 'speech_to_text',
                provider: 'openai',
                model: 'whisper-1',
                api_key_ref: 'OPENAI_API_KEY',
                enabled: 1
            },
            {
                task: 'text_to_speech',
                provider: 'openai',
                model: 'tts-1',
                api_key_ref: 'OPENAI_API_KEY',
                enabled: 1
            },
            {
                task: 'embedding',
                provider: 'ollama',
                model: 'nomic-embed-text',
                api_key_ref: '',
                enabled: 1
            },
            {
                task: 'reranker',
                provider: 'ollama',
                model: 'bge-reranker-large',
                api_key_ref: '',
                enabled: 1
            }
        ];

        const stmt = db.prepare(`
            INSERT OR IGNORE INTO ai_task_configs (task, provider, model, api_key_ref, enabled)
            VALUES (?, ?, ?, ?, ?)
        `);

        const transaction = db.transaction((tasks) => {
            for (const t of tasks) {
                stmt.run(t.task, t.provider, t.model, t.api_key_ref, t.enabled);
            }
        });

        transaction(defaultTasks);
        console.log('🎉 Successfully seeded 6 default AI task configurations.');
    } catch (err) {
        console.error('❌ Failed to initialize/seed AI task configurations:', err.message);
        throw err;
    }
}

module.exports = {
    getTaskConfig,
    getAllTaskConfigs,
    saveTaskConfig,
    initializeTasks
};
