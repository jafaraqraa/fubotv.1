const { getAIProviderForTask } = require('./aiProviders');

const SUPPORTED_TASKS = new Set([
    'text_generation', 'vision', 'speech_to_text',
    'text_to_speech', 'embedding', 'reranker'
]);

function normalizeModelId(value) {
    return String(value || '').trim().replace(/:latest$/i, '');
}

async function readError(response) {
    try {
        const body = await response.json();
        return body?.error?.message || body?.message || `HTTP ${response.status}`;
    } catch (_) {
        return `HTTP ${response.status}`;
    }
}

async function testAIModel(task, options = {}) {
    if (!SUPPORTED_TASKS.has(task)) {
        const error = new Error('مهمة AI غير مدعومة.');
        error.statusCode = 400;
        throw error;
    }

    const provider = options.provider || getAIProviderForTask(task);
    if (!provider) {
        const error = new Error('هذه المهمة غير مفعّلة.');
        error.statusCode = 409;
        throw error;
    }

    const fetchImpl = options.fetchImpl || fetch;
    const timeoutMs = options.timeoutMs || 12000;
    const providerName = provider.constructor.name
        .replace(/Provider$/, '')
        .toLowerCase()
        .replace('openrouter', 'openrouter');
    const model = String(provider.model || '').trim();

    if (!model) throw new Error('لم يتم تعيين موديل لهذه المهمة.');
    if (providerName !== 'ollama' && !provider.apiKey) {
        const error = new Error(`مفتاح ${providerName} غير متوفر.`);
        error.statusCode = 409;
        throw error;
    }

    let url;
    let headers = { Accept: 'application/json' };

    if (providerName === 'ollama') {
        url = `${String(provider.baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '')}/api/tags`;
    } else if (providerName === 'gemini') {
        url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}?key=${encodeURIComponent(provider.apiKey)}`;
    } else {
        const defaultBase = providerName === 'openai'
            ? 'https://api.openai.com/v1'
            : 'https://openrouter.ai/api/v1';
        const baseUrl = String(provider.baseUrl || defaultBase).replace(/\/+$/, '');
        url = providerName === 'openai'
            ? `${baseUrl}/models/${encodeURIComponent(model)}`
            : `${baseUrl}/models`;
        headers.Authorization = `Bearer ${provider.apiKey}`;
    }

    let response;
    try {
        response = await fetchImpl(url, {
            method: 'GET',
            headers,
            signal: AbortSignal.timeout(timeoutMs)
        });
    } catch (error) {
        const wrapped = new Error(error.name === 'TimeoutError'
            ? 'انتهت مهلة الاتصال بالمزوّد.'
            : 'تعذر الاتصال بالمزوّد.');
        wrapped.cause = error;
        throw wrapped;
    }

    if (!response.ok) {
        const error = new Error(await readError(response));
        error.statusCode = response.status === 401 || response.status === 403 ? 409 : 502;
        throw error;
    }

    if (providerName === 'ollama' || providerName === 'openrouter') {
        const body = await response.json();
        const models = providerName === 'ollama' ? body.models : body.data;
        const found = Array.isArray(models) && models.some(item => {
            const providerModelId = providerName === 'ollama' ? item?.name : item?.id;
            return normalizeModelId(providerModelId) === normalizeModelId(model);
        });
        if (!found) {
            const error = new Error(`الموديل ${model} غير متوفر لدى المزوّد.`);
            error.statusCode = 409;
            throw error;
        }
    }

    return { success: true, task, provider: providerName, model };
}

module.exports = { testAIModel, normalizeModelId };
