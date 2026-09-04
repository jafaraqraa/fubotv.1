'use strict';

const DEFAULT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const FATAL_STATUSES = new Set([401, 402, 429]);

class OpenRouterEvaluationError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'OpenRouterEvaluationError';
        Object.assign(this, details);
    }
}

class OpenRouterEvaluationClient {
    constructor({ apiKey, model, schema, structuredMode = 'native_json_schema', timeoutMs = 120000 }) {
        if (!apiKey) throw new OpenRouterEvaluationError('OPENROUTER_API_KEY_MISSING', { fatal: true });
        if (!model) throw new OpenRouterEvaluationError('OPENROUTER_GROUNDED_MODEL_MISSING', { fatal: true });
        this.apiKey = apiKey; this.model = model; this.schema = schema;
        this.structuredMode = structuredMode; this.timeoutMs = timeoutMs;
    }

    async generate(messages) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        const body = {
            model: this.model, messages,
            temperature: Number(process.env.AI_TEMPERATURE || 0.2),
            max_tokens: Number(process.env.AI_MAX_COMPLETION_TOKENS || 700),
            usage: { include: true },
            provider: { require_parameters: this.structuredMode === 'native_json_schema' }
        };
        if (this.structuredMode === 'native_json_schema') {
            body.response_format = { type: 'json_schema', json_schema: { name: 'grounded_answer_plan', strict: true, schema: this.schema } };
        } else if (this.structuredMode !== 'prompt_json') {
            throw new OpenRouterEvaluationError(`UNSUPPORTED_STRUCTURED_MODE:${this.structuredMode}`, { fatal: true });
        }
        let response;
        try {
            response = await fetch(DEFAULT_ENDPOINT, {
                method: 'POST',
                headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'http://localhost:3005', 'X-Title': 'FuBot Offline Grounded Generation Evaluation' },
                body: JSON.stringify(body), signal: controller.signal
            });
        } catch (error) {
            throw new OpenRouterEvaluationError(error.name === 'AbortError' ? 'OPENROUTER_TIMEOUT' : 'OPENROUTER_NETWORK_ERROR', { fatal: true, cause: error });
        } finally { clearTimeout(timer); }
        let payload;
        try { payload = await response.json(); }
        catch (error) { throw new OpenRouterEvaluationError('OPENROUTER_MALFORMED_PROVIDER_RESPONSE', { fatal: true, status: response.status, cause: error }); }
        if (!response.ok || payload?.error) {
            const status = response.status || Number(payload?.error?.code) || 0;
            const providerMessage = String(payload?.error?.message || `HTTP_${status}`).replaceAll(this.apiKey, '[REDACTED]').slice(0, 300);
            throw new OpenRouterEvaluationError(`OPENROUTER_PROVIDER_ERROR:${providerMessage}`, { fatal: FATAL_STATUSES.has(status) || status >= 500 || Boolean(payload?.error), status });
        }
        const content = payload?.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) throw new OpenRouterEvaluationError('OPENROUTER_EMPTY_RESPONSE', { fatal: true, status: response.status });
        if (!payload.usage || !Number.isFinite(Number(payload.usage.prompt_tokens)) || !Number.isFinite(Number(payload.usage.completion_tokens))) {
            throw new OpenRouterEvaluationError('OPENROUTER_MALFORMED_PROVIDER_USAGE', { fatal: true, status: response.status });
        }
        return {
            content, model: payload.model || this.model, provider: payload.provider || null,
            generationId: payload.id || null, inputTokens: Number(payload.usage.prompt_tokens),
            outputTokens: Number(payload.usage.completion_tokens),
            cost: Number.isFinite(Number(payload.usage.cost)) ? Number(payload.usage.cost) : null
        };
    }
}

module.exports = { OpenRouterEvaluationClient, OpenRouterEvaluationError };
