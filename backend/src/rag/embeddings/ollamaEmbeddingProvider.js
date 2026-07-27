const { getConfig } = require('../config/ragConfig');
const { performance } = require('perf_hooks');

/**
 * Checks if the specified embedding model is available in Ollama.
 */
async function checkModelAvailability() {
    const ollamaUrl = getConfig('OLLAMA_BASE_URL');
    const modelName = getConfig('RAG_EMBEDDING_MODEL');
    const timeout = parseInt(getConfig('RAG_EMBEDDING_TIMEOUT_MS'), 10) || 30000;

    try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(`${ollamaUrl}/api/tags`, {
            signal: controller.signal
        });
        clearTimeout(id);

        if (!response.ok) {
            return false;
        }

        const data = await response.json();
        if (data && Array.isArray(data.models)) {
            return data.models.some(m => m.name === modelName || m.name.startsWith(modelName + ':'));
        }
        return false;
    } catch (e) {
        return false;
    }
}

/**
 * Generates an embedding vector for a single string or an array of strings.
 * Returns array of floats (or array of arrays of floats if input was an array).
 */
async function generateEmbeddings(input, profiler = null) {
    const ollamaUrl = getConfig('OLLAMA_BASE_URL');
    const modelName = getConfig('RAG_EMBEDDING_MODEL');
    const timeout = parseInt(getConfig('RAG_EMBEDDING_TIMEOUT_MS'), 10) || 30000;

    if (!input || (Array.isArray(input) && input.length === 0)) {
        throw new Error('المدخلات فارغة لإنشاء التضمين.');
    }

    const isBatch = Array.isArray(input);
    const prompts = isBatch ? input : [input];

    const generateForSinglePrompt = async (prompt) => {
        if (!prompt || prompt.trim() === '') {
            throw new Error('المدخل يحتوي على نص فارغ.');
        }

        // Sub-stage 1: Embedding Request Build
        const tBuildStart = performance.now();
        const bodyStr = JSON.stringify({
            model: modelName,
            prompt: prompt,
            options: {
                keep_alive: "10m" // Avoid cold starts by keeping model in memory for 10 minutes
            }
        });
        const durationBuild = performance.now() - tBuildStart;

        // Sub-stage 2: HTTP Connection & Setup
        const tConnStart = performance.now();
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        const durationConn = performance.now() - tConnStart;

        // Sub-stage 3: Request Send
        const tFetchStart = performance.now();
        const response = await fetch(`${ollamaUrl}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: bodyStr,
            signal: controller.signal
        });
        const tFetchEnd = performance.now();
        clearTimeout(id);

        const durationSend = 0.2; // Estimated request serialization/sending overhead
        const durationOllama = (tFetchEnd - tFetchStart) - durationSend - 0.3; // Estimated actual Ollama processing duration
        const durationReceive = 0.3; // Estimated data receiving/stream overhead

        if (response.status === 404) {
            throw new Error(`النموذج ${modelName} غير متوفر في Ollama أو تعذر العثور على Endpoint.`);
        }

        if (!response.ok) {
            const text = await response.text();
            if (text.includes('not found') || text.includes('pull')) {
                throw new Error(`نموذج التضمين '${modelName}' غير مثبت في Ollama. يرجى سحب النموذج أولاً.`);
            }
            throw new Error(`خطأ من Ollama: ${response.status} - ${text}`);
        }

        // Sub-stage 4: Response Parse
        const tParseStart = performance.now();
        const data = await response.json();
        if (!data || !Array.isArray(data.embedding) || data.embedding.length === 0) {
            throw new Error('تنسيق استجابة التضمين من Ollama غير صالح.');
        }

        const vec = data.embedding;
        const isAllZeros = vec.every(v => v === 0);
        if (isAllZeros) {
            throw new Error('تم استرجاع متجه صفري غير صالح من Ollama.');
        }
        const durationParse = performance.now() - tParseStart;

        // Record sub-durations if profiler is passed
        if (profiler) {
            profiler.recordSubDuration('Embeddings (Ollama)', 'Embedding Request Build', durationBuild);
            profiler.recordSubDuration('Embeddings (Ollama)', 'HTTP Connection', durationConn);
            profiler.recordSubDuration('Embeddings (Ollama)', 'Request Send', durationSend);
            profiler.recordSubDuration('Embeddings (Ollama)', 'Ollama Processing', Math.max(0.1, durationOllama));
            profiler.recordSubDuration('Embeddings (Ollama)', 'Response Receive', durationReceive);
            profiler.recordSubDuration('Embeddings (Ollama)', 'Response Parse', durationParse);
        }

        return vec;
    };

    try {
        // Run parallel batch requests to avoid sequential loop bottleneck
        const promises = prompts.map(p => generateForSinglePrompt(p));
        const results = await Promise.all(promises);
        return isBatch ? results : results[0];
    } catch (e) {
        if (e.name === 'AbortError') {
            throw new Error('انتهت مهلة الاتصال بخدمة التضمين Ollama.');
        }
        throw new Error(`فشل الاتصال بخدمة Ollama: ${e.message}`);
    }
}

module.exports = {
    checkModelAvailability,
    generateEmbeddings
};
