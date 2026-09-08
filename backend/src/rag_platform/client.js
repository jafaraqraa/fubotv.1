'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_URL = 'http://127.0.0.1:8000';
const syncedChecksums = new Set();

function baseUrl() {
    return String(process.env.RAG_PLATFORM_URL || DEFAULT_URL).replace(/\/+$/, '');
}

function requestTimeoutMs() {
    const value = Number(process.env.RAG_PLATFORM_TIMEOUT_MS || 45000);
    return Number.isFinite(value) && value > 0 ? value : 45000;
}

function taskConfig(task, fallback) {
    const config = require('../database/repositories/aiTaskRepository').getTaskConfig(task);
    if (!config || !config.enabled) return fallback;
    let apiKey = '';
    if (config.provider !== 'ollama') {
        apiKey = require('../services/budgetService').getApiKeyForProvider(config.provider)
            || process.env[config.api_key_ref] || '';
    }
    return { provider: config.provider, model: config.model, apiKey };
}

function embeddingConfig() {
    const config = require('../database/repositories/aiTaskRepository').getTaskConfig('embedding');
    if (!config || !config.enabled) return { provider: 'ollama', model: 'nomic-embed-text', apiKey: '' };
    let apiKey = '';
    if (config.provider !== 'ollama') {
        apiKey = require('../services/budgetService').getApiKeyForProvider(config.provider)
            || process.env[config.api_key_ref] || '';
    }
    return { provider: config.provider, model: config.model, apiKey };
}

async function platformFetch(url, options = {}) {
    const timeout = AbortSignal.timeout(requestTimeoutMs());
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const response = await fetch(`${baseUrl()}${url}`, { ...options, signal });
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        const error = new Error(`RAG Platform returned HTTP ${response.status}`);
        error.code = 'RAG_PLATFORM_HTTP_ERROR';
        error.status = response.status;
        error.responseBody = body.slice(0, 500);
        throw error;
    }
    return response;
}

async function syncText({ tenantId, text, fileName = 'knowledge.txt', signal }) {
    const content = String(text || '');
    if (!content.trim()) return { status: 'empty' };
    const embedding = embeddingConfig();
    const checksumKey = `${tenantId}:${fileName}:${embedding.provider}:${embedding.model}:${crypto.createHash('sha256').update(content).digest('hex')}`;
    if (syncedChecksums.has(checksumKey)) return { status: 'already_synced' };

    const form = new FormData();
    form.append('file', new Blob([content], { type: 'text/plain; charset=utf-8' }), fileName);
    form.append('security_level', 'internal');
    form.append('embedding_provider', embedding.provider);
    form.append('embedding_model', embedding.model);
    const response = await platformFetch('/v1/documents', {
        method: 'POST', headers: {
            'X-Tenant-ID': String(tenantId),
            ...(embedding.apiKey ? { 'X-Embedding-API-Key': embedding.apiKey } : {})
        }, body: form, signal
    });
    const result = await response.json();
    syncedChecksums.add(checksumKey);
    return result;
}

async function ensureDefaultKnowledge(tenantId, signal) {
    const knowledgePath = path.join(__dirname, '..', '..', 'knowledge.txt');
    if (!fs.existsSync(knowledgePath)) return;
    await syncText({ tenantId, text: fs.readFileSync(knowledgePath, 'utf8'), fileName: 'knowledge.txt', signal });
}

async function answerWithRagPlatform({ question, tenantId, userId, signal }) {
    await ensureDefaultKnowledge(tenantId, signal);
    const embedding = embeddingConfig();
    const reranker = taskConfig('reranker', { provider: 'local', model: 'bge-reranker-base', apiKey: '' });
    const generator = taskConfig('text_generation', { provider: 'ollama', model: 'llama3', apiKey: '' });
    const { getSystemPrompt } = require('../services/knowledge');
    const response = await platformFetch('/v1/query', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', 'X-Tenant-ID': String(tenantId),
            ...(embedding.apiKey ? { 'X-Embedding-API-Key': embedding.apiKey } : {}),
            ...(reranker.apiKey ? { 'X-Reranker-API-Key': reranker.apiKey } : {}),
            ...(generator.apiKey ? { 'X-Generator-API-Key': generator.apiKey } : {})
        },
        body: JSON.stringify({
            tenant_id: String(tenantId), query: String(question), user_id: userId || null,
            embedding_provider: embedding.provider, embedding_model: embedding.model,
            reranker_provider: reranker.provider, reranker_model: reranker.model,
            generator_provider: generator.provider, generator_model: generator.model,
            system_prompt: getSystemPrompt()
        }),
        signal
    });
    const result = await response.json();
    return {
        ...result,
        answer: result.status === 'answered'
            ? String(result.answer || '').replace(/\s*\[EVIDENCE_\d+\]/gi, '').trim()
            : 'المعلومة مش متوفرة عندي حاليًا.'
    };
}

module.exports = { answerWithRagPlatform, syncText, ensureDefaultKnowledge };
