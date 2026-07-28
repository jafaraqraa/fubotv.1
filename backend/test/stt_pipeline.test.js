const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Force separate temporary test database before requiring connection
const testDbPath = path.resolve(__dirname, '..', 'data', 'test_stt_pipeline.db');
process.env.SQLITE_DB_PATH = testDbPath;

if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');

const db = require('../src/database/connection');
const { initializeDatabase } = require('../src/database/initialize');
const { getAIProviderForTask } = require('../src/services/aiProviders');
const { getAIResponse } = require('../src/services/ai');

const tempAudioPath = path.join(__dirname, 'temp_test_audio.ogg');

test.before(() => {
    // Bootstrap database schema
    initializeDatabase();

    // Write mock tiny audio file
    fs.writeFileSync(tempAudioPath, Buffer.alloc(100)); // 100 bytes
    process.env.OPENAI_API_KEY = 'mock-openai-key-123';
});

test.after(() => {
    if (fs.existsSync(tempAudioPath)) {
        fs.unlinkSync(tempAudioPath);
    }

    db.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
    if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');
});

test('STT Provider - Adapter formatting and transcription call', async (t) => {
    const sttProvider = getAIProviderForTask('speech_to_text');
    assert.ok(sttProvider);
    assert.strictEqual(sttProvider.constructor.name, 'OpenAIProvider');
    assert.strictEqual(sttProvider.model, 'whisper-1');

    let originalFetch = global.fetch;
    let urlRequested = '';

    global.fetch = async (url, config) => {
        urlRequested = String(url);
        return {
            ok: true,
            json: async () => ({
                text: 'هذا النص التجريبي من ملف الصوت'
            })
        };
    };

    try {
        const mediaObj = {
            localPath: tempAudioPath,
            mimeType: 'audio/ogg',
            fileName: 'temp_test_audio.ogg'
        };
        const transcript = await sttProvider.transcribe(mediaObj);
        assert.strictEqual(transcript, 'هذا النص التجريبي من ملف الصوت');
        assert.ok(urlRequested.includes('/audio/transcriptions'));
    } finally {
        global.fetch = originalFetch;
    }
});

test('STT Provider - OpenRouter transcription formatting and call', async (t) => {
    const { OpenRouterProvider } = require('../src/services/aiProviders');
    const openrouter = new OpenRouterProvider('openai/whisper-1', 'mock-key-123', 'https://openrouter.ai/api/v1');

    let originalFetch = global.fetch;
    let urlRequested = '';

    global.fetch = async (url, config) => {
        urlRequested = String(url);
        return {
            ok: true,
            json: async () => ({
                text: 'تفاريغ من أوبن روتر'
            })
        };
    };

    try {
        const mediaObj = {
            localPath: tempAudioPath,
            mimeType: 'audio/ogg',
            fileName: 'temp_test_audio.ogg'
        };
        const transcript = await openrouter.transcribe(mediaObj);
        assert.strictEqual(transcript, 'تفاريغ من أوبن روتر');
        assert.ok(urlRequested.includes('openrouter.ai/api/v1/audio/transcriptions'));
    } finally {
        global.fetch = originalFetch;
    }
});

test('Speech-to-Text Pipeline - Audio detection, routing, and text-pipeline handoff', async (t) => {
    // Configure text_generation and speech_to_text tasks in SQLite or defaults
    const { saveTaskConfig } = require('../src/database/repositories/aiTaskRepository');
    saveTaskConfig({
        task: 'text_generation',
        provider: 'openai',
        model: 'gpt-test-text-model',
        api_key_ref: 'OPENAI_API_KEY',
        enabled: 1
    });
    saveTaskConfig({
        task: 'speech_to_text',
        provider: 'openai',
        model: 'whisper-1',
        api_key_ref: 'OPENAI_API_KEY',
        enabled: 1
    });

    let originalFetch = global.fetch;
    let modelsCalled = [];
    let contentsPassed = [];

    global.fetch = async (url, config) => {
        const urlStr = String(url);

        // Handle STT fetch call
        if (urlStr.includes('/audio/transcriptions')) {
            return {
                ok: true,
                json: async () => ({ text: 'تفريغ صوتي حقيقي' })
            };
        }

        // Handle text completions fetch call
        if (urlStr.includes('/chat/completions')) {
            const bodyObj = JSON.parse(config.body);
            modelsCalled.push(bodyObj.model);
            contentsPassed.push(bodyObj.messages[bodyObj.messages.length - 1].content);
            return {
                ok: true,
                json: async () => ({
                    choices: [{ message: { content: 'تم إجابة سؤال الصوت بنجاح' } }]
                })
            };
        }

        // Return empty mock for embeddings / other REST calls
        return {
            ok: true,
            json: async () => ({ embedding: Array(768).fill(0) })
        };
    };

    try {
        const mediaObj = {
            localPath: tempAudioPath,
            mimeType: 'audio/ogg',
            fileName: 'temp_test_audio.ogg'
        };

        // Call the unified pipeline getAIResponse with messageType = 'audio'
        const response = await getAIResponse('test_user_audio_123', '', 'audio', mediaObj);

        // Assert transcript is generated and passed to the subsequent text pipeline
        assert.strictEqual(response, 'تم إجابة سؤال الصوت بنجاح');
        assert.deepStrictEqual(modelsCalled, ['gpt-test-text-model']);
        assert.ok(contentsPassed[0].includes('تفريغ صوتي حقيقي'));
    } finally {
        global.fetch = originalFetch;
    }
});
