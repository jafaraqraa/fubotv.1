'use strict';

const { fetchJson } = require('../runtime/http');

class RerankerAdapter {
    constructor(options) { this.baseUrl = String(options.baseUrl || '').replace(/\/$/, ''); this.model = options.model; this.apiKey = options.apiKey || ''; this.timeoutMs = options.timeoutMs; this.fetch = options.fetch; }
    async rerank({ originalQuestion, standaloneQuestion, candidates, limit = 8, signal }) {
        if (!this.baseUrl) { const e = new Error('reranker endpoint is not configured'); e.code = 'RAG_V2_RERANKER_UNAVAILABLE'; throw e; }
        const query = originalQuestion === standaloneQuestion ? originalQuestion : `Original: ${originalQuestion}\nStandalone: ${standaloneQuestion}`;
        const documents = candidates.map(c => [`Title: ${c.title || ''}`, `Section: ${(c.sectionPath || []).join(' > ')}`, c.retrievalText || c.originalText].join('\n'));
        const payload = await fetchJson(`${this.baseUrl}/rerank`, { method: 'POST', timeoutMs: this.timeoutMs, signal, fetch: this.fetch,
            headers: { 'content-type': 'application/json', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
            body: { model: this.model, query, documents, top_n: Math.min(limit, documents.length), return_documents: false } });
        const results = payload?.results || payload?.data;
        if (!Array.isArray(results)) { const e = new Error('reranker returned malformed results'); e.code = 'RAG_V2_INVALID_RERANK'; throw e; }
        return results.map(result => ({ ...candidates[result.index], rerankerScore: result.relevance_score ?? result.score, preRerankPosition: result.index + 1 }))
            .filter(c => c.chunkId).sort((a, b) => b.rerankerScore - a.rerankerScore || String(a.chunkId).localeCompare(String(b.chunkId)));
    }
}

module.exports = { RerankerAdapter };
