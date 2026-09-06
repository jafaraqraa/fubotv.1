'use strict';

const { fetchJson } = require('../runtime/http');

function validateVector(vector, expectedDimensions) {
    if (!Array.isArray(vector) || !vector.length || vector.some(v => !Number.isFinite(v)) || vector.every(v => v === 0)) {
        const error = new Error('embedding provider returned an invalid vector'); error.code = 'RAG_V2_INVALID_EMBEDDING'; throw error;
    }
    if (expectedDimensions && vector.length !== expectedDimensions) {
        const error = new Error(`embedding dimension mismatch: expected ${expectedDimensions}, received ${vector.length}`); error.code = 'RAG_V2_EMBEDDING_DIMENSION_MISMATCH'; throw error;
    }
    return vector;
}

class DenseEmbeddingAdapter {
    constructor(options) {
        this.provider = options.provider; this.baseUrl = String(options.baseUrl || '').replace(/\/$/, '');
        this.model = options.model; this.expectedDimensions = options.expectedDimensions || null;
        this.timeoutMs = options.timeoutMs; this.apiKey = options.apiKey || ''; this.fetch = options.fetch;
        if (!this.baseUrl || !this.model) throw new Error('embedding baseUrl and model are required');
    }

    async embed(texts, options = {}) {
        const values = Array.isArray(texts) ? texts : [texts];
        if (!values.length || values.some(value => typeof value !== 'string' || !value.trim())) throw new Error('non-empty embedding text is required');
        let body; let url;
        if (this.provider === 'ollama') { url = `${this.baseUrl}/api/embed`; body = { model: this.model, input: values, truncate: false }; }
        else { url = `${this.baseUrl}/embeddings`; body = { model: this.model, input: values }; }
        const payload = await fetchJson(url, { method: 'POST', timeoutMs: this.timeoutMs, signal: options.signal, fetch: this.fetch,
            headers: { 'content-type': 'application/json', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) }, body });
        const vectors = this.provider === 'ollama' ? payload?.embeddings : (payload?.data || []).sort((a, b) => a.index - b.index).map(x => x.embedding);
        if (!Array.isArray(vectors) || vectors.length !== values.length) { const e = new Error('embedding batch cardinality mismatch'); e.code = 'RAG_V2_EMBEDDING_BATCH_MISMATCH'; throw e; }
        const valid = vectors.map(vector => validateVector(vector, this.expectedDimensions));
        return Array.isArray(texts) ? valid : valid[0];
    }

    async probeDimensions(options = {}) {
        const vector = await this.embed('__rag_v2_dimension_probe__', options); return vector.length;
    }
}

module.exports = { DenseEmbeddingAdapter, validateVector };
