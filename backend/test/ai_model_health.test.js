const assert = require('assert');
const { testAIModel, normalizeModelId } = require('../src/services/aiModelHealthService');

function response(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body
    };
}

async function run() {
    assert.strictEqual(normalizeModelId('nomic-embed-text:latest'), 'nomic-embed-text');

    const ollama = {
        constructor: { name: 'OllamaProvider' },
        model: 'nomic-embed-text',
        baseUrl: 'http://127.0.0.1:11434'
    };
    const localResult = await testAIModel('embedding', {
        provider: ollama,
        fetchImpl: async (url, options) => {
            assert.strictEqual(url, 'http://127.0.0.1:11434/api/tags');
            assert.strictEqual(options.method, 'GET');
            return response({ models: [{ name: 'nomic-embed-text:latest' }] });
        }
    });
    assert.strictEqual(localResult.success, true);
    assert.strictEqual(localResult.provider, 'ollama');

    const openrouter = {
        constructor: { name: 'OpenRouterProvider' },
        model: 'google/gemini-2.5-pro',
        apiKey: 'test-secret',
        baseUrl: 'https://openrouter.ai/api/v1'
    };
    const routerResult = await testAIModel('text_generation', {
        provider: openrouter,
        fetchImpl: async () => response({
            data: [{
                id: 'google/gemini-2.5-pro',
                name: 'Google: Gemini 2.5 Pro'
            }]
        })
    });
    assert.strictEqual(routerResult.success, true);
    assert.strictEqual(routerResult.provider, 'openrouter');

    const gemini = {
        constructor: { name: 'GeminiProvider' },
        model: 'gemini-2.5-flash',
        apiKey: 'test-secret'
    };
    await testAIModel('text_generation', {
        provider: gemini,
        fetchImpl: async (url, options) => {
            assert(url.startsWith('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash?key='));
            assert.strictEqual(options.headers.Authorization, undefined);
            return response({ name: 'models/gemini-2.5-flash' });
        }
    });

    await assert.rejects(
        () => testAIModel('embedding', {
            provider: ollama,
            fetchImpl: async () => response({ models: [] })
        }),
        /غير متوفر/
    );

    await assert.rejects(
        () => testAIModel('unknown', { provider: ollama }),
        /غير مدعومة/
    );

    console.log('✅ AI model health tests passed');
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
