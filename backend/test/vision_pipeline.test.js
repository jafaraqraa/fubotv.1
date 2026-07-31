const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Force separate temporary test database before requiring connection
const testDbPath = path.resolve(__dirname, '..', 'data', 'test_vision_pipeline.db');
process.env.SQLITE_DB_PATH = testDbPath;

if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');

const db = require('../src/database/connection');
const { initializeDatabase } = require('../src/database/initialize');
const { validateIncomingImage } = require('../src/messaging/validateImage');
const { convertImageToBase64 } = require('../src/utils/imageHelper');
const { getAIProviderForTask } = require('../src/services/aiProviders');
const { getAIResponse } = require('../src/services/ai');

// Ensure directories and files exist for mock image tests
const tempImgPath = path.join(__dirname, 'temp_test_image.jpg');
const tempLargeImgPath = path.join(__dirname, 'temp_large_image.png');
const tempUnsupportedPath = path.join(__dirname, 'temp_test_unsupported.txt');

test.before(() => {
    // Bootstrap database schema
    initializeDatabase();

    // Populate mock API keys to bypass callOpenRouter validation checks
    process.env.OPENAI_API_KEY = 'mock-test-key-123';
    process.env.OPENROUTER_API_KEY = 'mock-test-key-123';

    // Write mock tiny files
    fs.writeFileSync(tempImgPath, Buffer.alloc(1024)); // 1KB
    fs.writeFileSync(tempLargeImgPath, Buffer.alloc(12 * 1024 * 1024)); // 12MB
    fs.writeFileSync(tempUnsupportedPath, 'mock text content');
});

test.after(() => {
    // Cleanup files
    if (fs.existsSync(tempImgPath)) fs.unlinkSync(tempImgPath);
    if (fs.existsSync(tempLargeImgPath)) fs.unlinkSync(tempLargeImgPath);
    if (fs.existsSync(tempUnsupportedPath)) fs.unlinkSync(tempUnsupportedPath);

    db.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
    if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');
});

test('Image input validation - supported types and sizes', (t) => {
    // 1. Supported image (under limit)
    const validResult = validateIncomingImage({
        localPath: tempImgPath,
        mimeType: 'image/jpeg'
    });
    assert.strictEqual(validResult.valid, true);
    assert.strictEqual(validResult.error, null);

    // 2. Unsupported format
    const unsupportedResult = validateIncomingImage({
        localPath: tempUnsupportedPath,
        mimeType: 'text/plain'
    });
    assert.strictEqual(unsupportedResult.valid, false);
    assert.match(unsupportedResult.error, /نوع الملف غير مدعوم/);

    // 3. File size exceeds default (10MB limit)
    const largeResult = validateIncomingImage({
        localPath: tempLargeImgPath,
        mimeType: 'image/png'
    });
    assert.strictEqual(largeResult.valid, false);
    assert.match(largeResult.error, /حجم الصورة المرفقة كبير جداً/);
});

test('Image Base64 conversion utility', (t) => {
    const base64Url = convertImageToBase64({
        localPath: tempImgPath,
        mimeType: 'image/jpeg'
    });
    assert.ok(base64Url);
    assert.ok(base64Url.startsWith('data:image/jpeg;base64,'));

    const content = base64Url.split(';base64,')[1];
    assert.ok(content.length > 0);
});

test('AI Provider Multimodal formatting - OpenAI and OpenRouter', async (t) => {
    const openAIProvider = getAIProviderForTask('vision');
    assert.ok(openAIProvider);

    // Simulate generation payload conversion for OpenAI
    const mockMessages = [{ role: 'user', content: 'What is this?' }];
    const mockOptions = {
        media: {
            localPath: tempImgPath,
            mimeType: 'image/jpeg'
        }
    };

    let originalFetch = global.fetch;
    // Mock fetch to capture what body is posted
    global.fetch = async (url, config) => {
        const bodyObj = JSON.parse(config.body);
        assert.strictEqual(bodyObj.model, openAIProvider.model);
        assert.strictEqual(bodyObj.messages[0].role, 'user');
        assert.ok(Array.isArray(bodyObj.messages[0].content));
        assert.strictEqual(bodyObj.messages[0].content[0].type, 'text');
        assert.strictEqual(bodyObj.messages[0].content[1].type, 'image_url');
        assert.ok(bodyObj.messages[0].content[1].image_url.url.startsWith('data:image/jpeg;base64,'));

        return {
            ok: true,
            json: async () => ({
                choices: [{ message: { content: 'Mock vision response' } }]
            })
        };
    };

    try {
        const result = await openAIProvider.generate(mockMessages, mockOptions);
        assert.strictEqual(result, 'Mock vision response');
    } finally {
        global.fetch = originalFetch;
    }
});

test('OpenRouter vision request contains the actual image', async () => {
    const { OpenRouterProvider } = require('../src/services/aiProviders');
    const provider = new OpenRouterProvider(
        'google/gemini-2.5-flash',
        'mock-openrouter-key',
        'https://openrouter.ai/api/v1'
    );
    const originalFetch = global.fetch;
    let capturedBody;
    global.fetch = async (_url, config) => {
        capturedBody = JSON.parse(config.body);
        return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({
                id: 'vision-generation',
                choices: [{ message: { content: 'OpenRouter vision response' } }]
            })
        };
    };
    try {
        const result = await provider.generate(
            [{ role: 'user', content: 'فسّر الصورة' }],
            { media: { localPath: tempImgPath, mimeType: 'image/jpeg' } }
        );
        assert.strictEqual(result, 'OpenRouter vision response');
        assert.strictEqual(capturedBody.model, 'google/gemini-2.5-flash');
        assert.strictEqual(capturedBody.max_tokens, 1024);
        assert.ok(Array.isArray(capturedBody.messages[0].content));
        assert.strictEqual(capturedBody.messages[0].content[1].type, 'image_url');
        assert.match(capturedBody.messages[0].content[1].image_url.url, /^data:image\/jpeg;base64,/);
    } finally {
        global.fetch = originalFetch;
    }
});

test('multimodal array content is extracted and failed requests clear stale telemetry', async () => {
    const {
        OpenRouterProvider, OpenAIProvider, getLastResponseMetadata
    } = require('../src/services/aiProviders');
    const originalFetch = global.fetch;
    const routerProvider = new OpenRouterProvider('google/gemini-2.5-flash', 'key', 'https://router.test');
    const openAIProvider = new OpenAIProvider('gpt-4o-mini', 'key', 'https://openai.test');
    try {
        global.fetch = async () => ({
            ok: true, status: 200, headers: new Headers(),
            json: async () => ({
                id: 'successful-generation', model: 'google/gemini-2.5-flash',
                choices: [{ message: { content: [{ type: 'text', text: 'تحليل' }, { type: 'text', text: 'ناجح' }] } }]
            })
        });
        assert.strictEqual(await routerProvider.generate([{ role: 'user', content: 'صورة' }]), 'تحليل\nناجح');
        assert.strictEqual(getLastResponseMetadata().id, 'successful-generation');

        global.fetch = async () => ({
            ok: false, status: 429, headers: new Headers(),
            json: async () => ({ error: { message: 'no credits' } })
        });
        await assert.rejects(
            openAIProvider.generate([{ role: 'user', content: 'صورة' }]),
            /no credits/
        );
        assert.strictEqual(getLastResponseMetadata(), null);
    } finally {
        global.fetch = originalFetch;
    }
});

test('AI Provider Multimodal formatting - Gemini REST specification', async (t) => {
    const { GeminiProvider } = require('../src/services/aiProviders');
    const gemini = new GeminiProvider('gemini-2.5-flash', 'mock-key', 'https://base.url');

    const mockMessages = [{ role: 'user', content: 'Analyze image' }];
    const mockOptions = {
        media: {
            localPath: tempImgPath,
            mimeType: 'image/png'
        }
    };

    let originalFetch = global.fetch;
    global.fetch = async (url, config) => {
        const bodyObj = JSON.parse(config.body);
        assert.ok(bodyObj.contents);
        const parts = bodyObj.contents[0].parts;
        assert.strictEqual(parts[0].text, 'Analyze image');
        assert.ok(parts[1].inlineData);
        assert.strictEqual(parts[1].inlineData.mimeType, 'image/png');
        assert.ok(parts[1].inlineData.data);

        return {
            ok: true,
            json: async () => ({
                candidates: [{ content: { parts: [{ text: 'Mock Gemini response' }] } }]
            })
        };
    };

    try {
        const result = await gemini.generate(mockMessages, mockOptions);
        assert.strictEqual(result, 'Mock Gemini response');
    } finally {
        global.fetch = originalFetch;
    }
});

test('AI Provider Multimodal formatting - Ollama local API', async (t) => {
    const { OllamaProvider } = require('../src/services/aiProviders');
    const ollama = new OllamaProvider('llava', 'no-key', 'http://127.0.0.1:11434');

    const mockMessages = [{ role: 'user', content: 'Scan' }];
    const mockOptions = {
        media: {
            localPath: tempImgPath,
            mimeType: 'image/jpeg'
        }
    };

    let originalFetch = global.fetch;
    global.fetch = async (url, config) => {
        const bodyObj = JSON.parse(config.body);
        assert.strictEqual(bodyObj.model, 'llava');
        const userMsg = bodyObj.messages[0];
        assert.strictEqual(userMsg.content, 'Scan');
        assert.ok(Array.isArray(userMsg.images));
        assert.ok(userMsg.images[0]); // Base64 data without prefix

        return {
            ok: true,
            json: async () => ({
                message: { content: 'Mock Ollama vision response' }
            })
        };
    };

    try {
        const result = await ollama.generate(mockMessages, mockOptions);
        assert.strictEqual(result, 'Mock Ollama vision response');
    } finally {
        global.fetch = originalFetch;
    }
});

test('Vision Routing Layer - Image vs Text messages', async (t) => {
    const { saveTaskConfig } = require('../src/database/repositories/aiTaskRepository');
    saveTaskConfig({
        task: 'text_generation',
        provider: 'openai',
        model: 'gpt-test-text-model',
        api_key_ref: 'OPENAI_API_KEY',
        enabled: 1
    });
    saveTaskConfig({
        task: 'vision',
        provider: 'openai',
        model: 'gpt-test-vision-model',
        api_key_ref: 'OPENAI_API_KEY',
        enabled: 1
    });

    const { getAIResponse } = require('../src/services/ai');

    let originalFetch = global.fetch;
    let lastModelRequested = '';

    global.fetch = async (url, config) => {
        const urlStr = String(url);
        if (urlStr.includes('/embeddings') || urlStr.includes('/tags')) {
            return {
                ok: true,
                json: async () => ({
                    embedding: [1, ...Array(767).fill(0)],
                    models: []
                })
            };
        }
        if (urlStr.includes('/points/search')) {
            return {
                ok: true,
                json: async () => ({
                    result: [{
                        id: 'vision-evidence',
                        score: 0.95,
                        payload: {
                            tenantId: 'default',
                            chunkId: 'vision-evidence',
                            text: 'The assistant may analyze supported customer images.',
                            sourceType: 'uploaded_document'
                        }
                    }]
                })
            };
        }

        const bodyObj = JSON.parse(config.body || '{}');
        if (bodyObj.model) {
            lastModelRequested = bodyObj.model;
        }
        return {
            ok: true,
            json: async () => ({
                choices: [{ message: { content: 'Mock response' } }],
                candidates: [{ content: { parts: [{ text: 'Mock response' }] } }],
                message: { content: 'Mock response' }
            })
        };
    };

    try {
        // 1. Text message query -> should use text_generation task (gpt-test-text-model)
        await getAIResponse('test_user_vision_1', 'Hello RAG', 'text', null, { tenantId: 'default' });
        assert.strictEqual(lastModelRequested, 'gpt-test-text-model');

        // 2. Image message query -> should use vision task (gpt-test-vision-model)
        const mediaObj = {
            localPath: tempImgPath,
            mimeType: 'image/jpeg',
            caption: 'What is this?'
        };
        await getAIResponse('test_user_vision_1', '', 'image', mediaObj, { tenantId: 'default' });
        assert.strictEqual(lastModelRequested, 'gpt-test-vision-model');
    } finally {
        global.fetch = originalFetch;
    }
});

test('Vision reaches its configured model when RAG returns no evidence', async () => {
    const { saveTaskConfig } = require('../src/database/repositories/aiTaskRepository');
    saveTaskConfig({
        task: 'vision', provider: 'openai', model: 'gpt-test-vision-no-rag',
        api_key_ref: 'OPENAI_API_KEY', enabled: 1
    });
    const originalFetch = global.fetch;
    let visionCalled = false;
    global.fetch = async (url, config = {}) => {
        const urlText = String(url);
        if (urlText.includes('/embeddings')) {
            return { ok: true, json: async () => ({ embedding: [1, ...Array(767).fill(0)] }) };
        }
        if (urlText.includes('/points/search')) {
            return { ok: true, json: async () => ({ result: [] }) };
        }
        const body = JSON.parse(config.body || '{}');
        if (body.model === 'gpt-test-vision-no-rag') {
            visionCalled = true;
            assert.ok(Array.isArray(body.messages.at(-1).content));
        }
        return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({ choices: [{ message: { content: 'تم تحليل الصورة' } }] })
        };
    };
    try {
        const answer = await getAIResponse('vision-no-rag-user', '', 'image', {
            localPath: tempImgPath,
            mimeType: 'image/jpeg',
            caption: ''
        }, { tenantId: 'default' });
        assert.strictEqual(visionCalled, true);
        assert.match(answer, /تم تحليل الصورة/);
    } finally {
        global.fetch = originalFetch;
    }
});
