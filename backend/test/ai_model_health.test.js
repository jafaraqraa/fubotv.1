const assert = require('assert');
const {
    testAIModel,
    normalizeModelId,
    resetModelHealthCaches
} = require('../src/services/aiModelHealthService');

function response(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body
    };
}

function openRouter(model = 'cohere/rerank-4-pro') {
    return {
        constructor: { name: 'OpenRouterProvider' },
        model,
        apiKey: 'test-secret',
        baseUrl: 'https://openrouter.ai/api/v1'
    };
}

async function expectCode(status, code) {
    resetModelHealthCaches();
    await assert.rejects(
        () => testAIModel('reranker', {
            provider: openRouter(),
            fetchImpl: async url => url.includes('/models?')
                ? response({ data: [{ id: 'cohere/rerank-4-pro' }] })
                : response({ error: { code: 'provider_code', message: 'sensitive provider detail' } }, status)
        }),
        error => error.code === code && error.statusCode === status
    );
}

async function run() {
    // Canonical remote IDs are preserved; normalization trims only.
    assert.strictEqual(
        normalizeModelId('  cohere/rerank-4-pro  '),
        'cohere/rerank-4-pro'
    );
    assert.strictEqual(normalizeModelId('model:latest'), 'model:latest');

    // Ollama alone treats :latest as an installed alias.
    resetModelHealthCaches();
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

    // Rerank discovery and execution use capability-specific endpoints.
    resetModelHealthCaches();
    const calls = [];
    const rerankResult = await testAIModel('reranker', {
        provider: openRouter('  cohere/rerank-4-pro  '),
        fetchImpl: async (url, options) => {
            calls.push({ url, options });
            if (options.method === 'GET') {
                return response({ data: [{ id: 'cohere/rerank-4-pro' }] });
            }
            return response({
                model: 'cohere/rerank-4-pro',
                results: [{ index: 0, relevance_score: 0.99 }]
            });
        }
    });
    assert.strictEqual(rerankResult.success, true);
    assert.strictEqual(rerankResult.model, 'cohere/rerank-4-pro');
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(
        calls[0].url,
        'https://openrouter.ai/api/v1/models?output_modalities=rerank'
    );
    assert.strictEqual(calls[1].url, 'https://openrouter.ai/api/v1/rerank');
    assert(!calls.some(call => call.url.includes('chat/completions')));
    const requestBody = JSON.parse(calls[1].options.body);
    assert.deepStrictEqual(requestBody, {
        model: 'cohere/rerank-4-pro',
        query: 'test query',
        documents: [
            'A relevant test document.',
            'An unrelated test document.'
        ],
        top_n: 1
    });

    // Rerank models are never checked against the text discovery cache.
    resetModelHealthCaches();
    const discoveryUrls = [];
    const fetchByCapability = async (url, options) => {
        discoveryUrls.push(url);
        if (url.includes('output_modalities=text')) {
            return response({ data: [{ id: 'google/gemini-2.5-pro' }] });
        }
        if (url.includes('output_modalities=rerank')) {
            return response({ data: [{ id: 'cohere/rerank-4-pro' }] });
        }
        return response({ results: [{ index: 0, relevance_score: 0.8 }] });
    };
    await testAIModel('text_generation', {
        provider: openRouter('google/gemini-2.5-pro'),
        fetchImpl: fetchByCapability
    });
    await testAIModel('reranker', {
        provider: openRouter(),
        fetchImpl: fetchByCapability
    });
    assert(discoveryUrls.some(url => url.includes('output_modalities=text')));
    assert(discoveryUrls.some(url => url.includes('output_modalities=rerank')));

    // Vision is a supported OpenRouter chat capability and must use image
    // discovery instead of falling through to UNSUPPORTED_TASK_TYPE.
    resetModelHealthCaches();
    const visionCalls = [];
    const visionResult = await testAIModel('vision', {
        provider: openRouter('google/gemini-3.5-flash'),
        fetchImpl: async (url, options) => {
            visionCalls.push({ url, options });
            return response({ data: [{ id: 'google/gemini-3.5-flash' }] });
        }
    });
    assert.strictEqual(visionResult.success, true);
    assert.strictEqual(visionResult.capability, 'image');
    assert.strictEqual(visionCalls.length, 1);
    assert.strictEqual(
        visionCalls[0].url,
        'https://openrouter.ai/api/v1/models?input_modalities=image'
    );

    // Malformed rerank payloads fail instead of being treated as chat success.
    resetModelHealthCaches();
    await assert.rejects(
        () => testAIModel('reranker', {
            provider: openRouter(),
            fetchImpl: async url => url.includes('/models?')
                ? response({ data: [{ id: 'cohere/rerank-4-pro' }] })
                : response({ choices: [{ message: { content: 'wrong shape' } }] })
        }),
        error => error.code === 'INVALID_PROVIDER_RESPONSE' && error.statusCode === 502
    );

    await expectCode(400, 'INVALID_RERANK_REQUEST');
    await expectCode(401, 'INVALID_API_KEY');
    await expectCode(402, 'INSUFFICIENT_CREDITS');
    await expectCode(403, 'PERMISSION_DENIED');
    await expectCode(404, 'MODEL_NOT_FOUND');
    await expectCode(408, 'PROVIDER_TIMEOUT');
    await expectCode(429, 'RATE_LIMITED');
    await expectCode(503, 'PROVIDER_TEMPORARILY_UNAVAILABLE');

    // Identical concurrent tests share one execution (one discovery + one POST).
    resetModelHealthCaches();
    let requestCount = 0;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const slowFetch = async (url) => {
        requestCount += 1;
        await gate;
        return url.includes('/models?')
            ? response({ data: [{ id: 'cohere/rerank-4-pro' }] })
            : response({ results: [{ index: 0, relevance_score: 0.9 }] });
    };
    const first = testAIModel('reranker', { provider: openRouter(), fetchImpl: slowFetch });
    const second = testAIModel('reranker', { provider: openRouter(), fetchImpl: slowFetch });
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.strictEqual(firstResult.success, true);
    assert.strictEqual(secondResult.success, true);
    assert.strictEqual(requestCount, 2);

    // A missing capability model fails before the rerank POST.
    resetModelHealthCaches();
    let missingCalls = 0;
    await assert.rejects(
        () => testAIModel('reranker', {
            provider: openRouter(),
            fetchImpl: async () => {
                missingCalls += 1;
                return response({ data: [] });
            }
        }),
        error => error.code === 'MODEL_NOT_FOUND'
    );
    assert.strictEqual(missingCalls, 1);

    await assert.rejects(
        () => testAIModel('unknown', { provider: ollama }),
        /غير مدعومة/
    );

    console.log('✅ AI model health tests passed (routing, discovery, rerank response, errors, deduplication)');
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
