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
    const checksumKey = `${tenantId}:${fileName}:${crypto.createHash('sha256').update(content).digest('hex')}`;
    if (syncedChecksums.has(checksumKey)) return { status: 'already_synced' };

    const form = new FormData();
    form.append('file', new Blob([content], { type: 'text/plain; charset=utf-8' }), fileName);
    form.append('security_level', 'internal');
    const response = await platformFetch('/v1/documents', {
        method: 'POST', headers: { 'X-Tenant-ID': String(tenantId) }, body: form, signal
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
    const response = await platformFetch('/v1/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': String(tenantId) },
        body: JSON.stringify({ tenant_id: String(tenantId), query: String(question), user_id: userId || null }),
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
