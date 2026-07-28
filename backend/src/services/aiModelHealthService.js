const { getAIProviderForTask } = require('./aiProviders');

const SUPPORTED_TASKS = new Set([
    'text_generation', 'chat', 'vision', 'speech_to_text',
    'text_to_speech', 'embedding', 'reranker'
]);
const DISCOVERY_TTL_MS = 5 * 60 * 1000;
const discoveryCache = new Map();
const inFlightTests = new Map();

const CAPABILITY_BY_TASK = Object.freeze({
    text_generation: 'text',
    chat: 'text',
    vision: 'image',
    speech_to_text: 'audio',
    text_to_speech: 'audio',
    embedding: 'embeddings',
    reranker: 'rerank'
});

const PROVIDER_ERROR_MAP = Object.freeze({
    400: 'INVALID_RERANK_REQUEST',
    401: 'INVALID_API_KEY',
    402: 'INSUFFICIENT_CREDITS',
    403: 'PERMISSION_DENIED',
    404: 'MODEL_NOT_FOUND',
    408: 'PROVIDER_TIMEOUT',
    429: 'RATE_LIMITED',
    500: 'PROVIDER_TEMPORARILY_UNAVAILABLE',
    502: 'PROVIDER_TEMPORARILY_UNAVAILABLE',
    503: 'PROVIDER_TEMPORARILY_UNAVAILABLE',
    504: 'PROVIDER_TEMPORARILY_UNAVAILABLE'
});

const CLIENT_MESSAGES = Object.freeze({
    INVALID_RERANK_REQUEST: 'طلب اختبار إعادة الترتيب غير صالح.',
    INVALID_API_KEY: 'مفتاح OpenRouter غير صالح.',
    INSUFFICIENT_CREDITS: 'رصيد OpenRouter غير كافٍ.',
    PERMISSION_DENIED: 'لا يملك المفتاح صلاحية استخدام هذا الموديل.',
    MODEL_NOT_FOUND: 'موديل إعادة الترتيب غير موجود لدى OpenRouter.',
    PROVIDER_TIMEOUT: 'انتهت مهلة اتصال OpenRouter.',
    RATE_LIMITED: 'تم تجاوز حد طلبات OpenRouter. حاول لاحقاً.',
    PROVIDER_TEMPORARILY_UNAVAILABLE: 'OpenRouter غير متاح مؤقتاً.',
    INVALID_PROVIDER_RESPONSE: 'أعاد OpenRouter استجابة غير صالحة لاختبار إعادة الترتيب.'
});

// Canonical remote model IDs are opaque. Normalization must never rewrite them.
function normalizeModelId(value) {
    return String(value || '').trim();
}

function providerNameOf(provider) {
    return provider.constructor.name
        .replace(/Provider$/, '')
        .toLowerCase();
}

function createHealthError(code, statusCode, details) {
    const error = new Error(CLIENT_MESSAGES[code] || details || 'فشل اختبار الموديل.');
    error.code = code;
    error.statusCode = statusCode;
    if (details) error.providerDetails = details;
    return error;
}

async function readResponseBody(response) {
    try {
        return await response.json();
    } catch (_) {
        return null;
    }
}

function mapProviderError(response, body, task) {
    const fallbackCode = task === 'reranker'
        ? 'INVALID_RERANK_REQUEST'
        : 'PROVIDER_TEMPORARILY_UNAVAILABLE';
    const code = PROVIDER_ERROR_MAP[response.status] || fallbackCode;
    const providerMessage = body?.error?.message || body?.message || `HTTP ${response.status}`;
    console.warn('[AI Model Test] Provider request failed.', {
        taskType: task,
        responseStatus: response.status,
        providerErrorCode: body?.error?.code || code,
        providerResponse: body
    });
    return createHealthError(code, response.status, providerMessage);
}

async function providerFetch(url, init, context) {
    console.log('[AI Model Test] Provider request.', {
        taskType: context.task,
        provider: context.provider,
        modelId: context.model,
        selectedEndpoint: url,
        discoveryUrl: context.discoveryUrl || null
    });

    let response;
    try {
        response = await context.fetchImpl(url, {
            ...init,
            signal: AbortSignal.timeout(context.timeoutMs)
        });
    } catch (error) {
        const isTimeout = error.name === 'TimeoutError' || error.name === 'AbortError';
        throw createHealthError(
            isTimeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_TEMPORARILY_UNAVAILABLE',
            isTimeout ? 408 : 503,
            error.message
        );
    }

    const body = await readResponseBody(response);
    console.log('[AI Model Test] Provider response.', {
        taskType: context.task,
        responseStatus: response.status,
        providerErrorCode: body?.error?.code || null
    });
    if (!response.ok) throw mapProviderError(response, body, context.task);
    return body;
}

async function discoverOpenRouterModel(context) {
    const cacheKey = `${context.provider}:${context.capability}`;
    const cached = discoveryCache.get(cacheKey);
    let models;

    if (cached && cached.expiresAt > Date.now()) {
        models = cached.models;
    } else {
        const discoveryUrl = `${context.baseUrl}/models?output_modalities=${encodeURIComponent(context.capability)}`;
        const body = await providerFetch(discoveryUrl, {
            method: 'GET',
            headers: context.headers
        }, { ...context, discoveryUrl });
        models = Array.isArray(body?.data)
            ? body.data.map(item => normalizeModelId(item?.id)).filter(Boolean)
            : [];
        discoveryCache.set(cacheKey, {
            models,
            expiresAt: Date.now() + DISCOVERY_TTL_MS
        });
    }

    if (!models.includes(context.model)) {
        throw createHealthError(
            'MODEL_NOT_FOUND',
            404,
            `Model ${context.model} was not returned for capability ${context.capability}.`
        );
    }
}

async function testOpenRouterReranker(context) {
    await discoverOpenRouterModel(context);
    const url = `${context.baseUrl}/rerank`;
    const body = await providerFetch(url, {
        method: 'POST',
        headers: { ...context.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: context.model,
            query: 'test query',
            documents: [
                'A relevant test document.',
                'An unrelated test document.'
            ],
            top_n: 1
        })
    }, context);

    const validResults = Array.isArray(body?.results)
        && body.results.every(result =>
            Number.isInteger(result?.index)
            && typeof result?.relevance_score === 'number'
            && Number.isFinite(result.relevance_score)
        );
    if (!validResults) {
        console.warn('[AI Model Test] Invalid OpenRouter rerank response.', { providerResponse: body });
        throw createHealthError('INVALID_PROVIDER_RESPONSE', 502);
    }
    return { returnedModel: body.model || null, resultCount: body.results.length };
}

async function testOpenRouterEmbedding(context) {
    const url = `${context.baseUrl}/embeddings`;
    await providerFetch(url, {
        method: 'POST',
        headers: { ...context.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: context.model, input: 'test embedding input' })
    }, context);
}

async function testOpenRouterTextModel(context) {
    await discoverOpenRouterModel(context);
}

async function executeTest(task, provider, options) {
    const fetchImpl = options.fetchImpl || fetch;
    const timeoutMs = options.timeoutMs || 12000;
    const providerName = providerNameOf(provider);
    const model = normalizeModelId(provider.model);
    const capability = CAPABILITY_BY_TASK[task];

    if (!model) throw new Error('لم يتم تعيين موديل لهذه المهمة.');
    if (providerName !== 'ollama' && !provider.apiKey) {
        const error = new Error(`مفتاح ${providerName} غير متوفر.`);
        error.statusCode = 409;
        error.code = 'MISSING_API_KEY';
        throw error;
    }

    console.log('[AI Model Test] Routing.', {
        taskType: task,
        provider: providerName,
        modelId: model,
        capability
    });

    if (providerName === 'openrouter') {
        const baseUrl = String(provider.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
        const context = {
            task,
            provider: providerName,
            model,
            capability,
            baseUrl,
            fetchImpl,
            timeoutMs,
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${provider.apiKey}`
            }
        };
        switch (task) {
            case 'reranker':
                await testOpenRouterReranker(context);
                break;
            case 'embedding':
                await testOpenRouterEmbedding(context);
                break;
            case 'text_generation':
            case 'chat':
                await testOpenRouterTextModel(context);
                break;
            default:
                throw createHealthError('UNSUPPORTED_TASK_TYPE', 400, task);
        }
    } else if (providerName === 'ollama') {
        const url = `${String(provider.baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '')}/api/tags`;
        const body = await providerFetch(url, {
            method: 'GET',
            headers: { Accept: 'application/json' }
        }, { task, provider: providerName, model, fetchImpl, timeoutMs });
        const found = Array.isArray(body?.models) && body.models.some(item => {
            const installed = normalizeModelId(item?.name);
            return installed === model || installed === `${model}:latest`;
        });
        if (!found) {
            const error = new Error(`الموديل ${model} غير متوفر لدى المزوّد.`);
            error.statusCode = 409;
            error.code = 'MODEL_NOT_FOUND';
            throw error;
        }
    } else if (providerName === 'gemini') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}?key=${encodeURIComponent(provider.apiKey)}`;
        await providerFetch(url, {
            method: 'GET',
            headers: { Accept: 'application/json' }
        }, { task, provider: providerName, model, fetchImpl, timeoutMs });
    } else if (providerName === 'openai') {
        const baseUrl = String(provider.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const url = `${baseUrl}/models/${encodeURIComponent(model)}`;
        await providerFetch(url, {
            method: 'GET',
            headers: { Accept: 'application/json', Authorization: `Bearer ${provider.apiKey}` }
        }, { task, provider: providerName, model, fetchImpl, timeoutMs });
    } else {
        throw createHealthError('UNSUPPORTED_PROVIDER', 400, providerName);
    }

    return { success: true, task, provider: providerName, model, capability };
}

function testAIModel(task, options = {}) {
    if (!SUPPORTED_TASKS.has(task)) {
        const error = new Error('مهمة AI غير مدعومة.');
        error.statusCode = 400;
        return Promise.reject(error);
    }

    const provider = options.provider || getAIProviderForTask(task);
    if (!provider) {
        const error = new Error('هذه المهمة غير مفعّلة.');
        error.statusCode = 409;
        return Promise.reject(error);
    }

    const providerName = providerNameOf(provider);
    const model = normalizeModelId(provider.model);
    const dedupeKey = `${providerName}:${task}:${model}`;
    if (inFlightTests.has(dedupeKey)) {
        console.log('[AI Model Test] Reusing identical in-flight test.', {
            provider: providerName,
            taskType: task,
            modelId: model
        });
        return inFlightTests.get(dedupeKey);
    }

    const pending = executeTest(task, provider, options)
        .finally(() => inFlightTests.delete(dedupeKey));
    inFlightTests.set(dedupeKey, pending);
    return pending;
}

function resetModelHealthCaches() {
    discoveryCache.clear();
    inFlightTests.clear();
}

module.exports = {
    testAIModel,
    normalizeModelId,
    resetModelHealthCaches,
    PROVIDER_ERROR_MAP
};
