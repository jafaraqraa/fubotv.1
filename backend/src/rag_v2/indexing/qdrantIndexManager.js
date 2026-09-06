'use strict';

const { fetchJson } = require('../runtime/http');

const REQUIRED_PAYLOAD_INDEXES = Object.freeze({
    tenant_id: 'keyword', knowledge_base_id: 'keyword', document_id: 'keyword',
    document_version_id: 'keyword', status: 'keyword', is_current: 'bool',
    language: 'keyword', permissions: 'keyword', valid_from: 'datetime', valid_to: 'datetime'
});

class QdrantIndexManager {
    constructor(options) {
        this.baseUrl = String(options.baseUrl || '').replace(/\/$/, ''); this.collection = options.collection;
        this.alias = options.alias; this.apiKey = options.apiKey || ''; this.timeoutMs = options.timeoutMs; this.fetch = options.fetch;
        if (!this.baseUrl || !this.collection || !this.alias) throw new Error('Qdrant v2 baseUrl, collection, and alias are required');
        if (!/_v\d+(?:_|$)/.test(this.collection) && !this.collection.endsWith('_v2')) { const e = new Error('v2 writes require an explicitly versioned collection'); e.code = 'RAG_V2_UNSAFE_COLLECTION'; throw e; }
    }
    headers() { return { 'content-type': 'application/json', ...(this.apiKey ? { 'api-key': this.apiKey } : {}) }; }
    call(path, method = 'GET', body, signal) { return fetchJson(`${this.baseUrl}${path}`, { method, body, signal, timeoutMs: this.timeoutMs, headers: this.headers(), fetch: this.fetch }); }
    async inspect(signal) {
        const data = await this.call(`/collections/${encodeURIComponent(this.collection)}`, 'GET', undefined, signal); return data?.result || data;
    }
    async create({ dimensions, distance, onDisk = false, signal }) {
        if (!Number.isInteger(dimensions) || dimensions < 1) throw new Error('verified embedding dimensions are required');
        await this.call(`/collections/${encodeURIComponent(this.collection)}`, 'PUT', {
            vectors: { dense: { size: dimensions, distance, on_disk: onDisk } },
            sparse_vectors: { sparse: { index: { on_disk: onDisk } } }
        }, signal);
        for (const [field_name, field_schema] of Object.entries(REQUIRED_PAYLOAD_INDEXES)) {
            await this.call(`/collections/${encodeURIComponent(this.collection)}/index`, 'PUT', { field_name, field_schema }, signal);
        }
        return this.inspect(signal);
    }
    async switchAlias({ validated, signal }) {
        if (validated !== true) { const e = new Error('alias switch requires an explicit validated manifest'); e.code = 'RAG_V2_INDEX_NOT_VALIDATED'; throw e; }
        return this.call('/collections/aliases', 'POST', { actions: [{ delete_alias: { alias_name: this.alias } }, { create_alias: { collection_name: this.collection, alias_name: this.alias } }] }, signal);
    }
}

module.exports = { QdrantIndexManager, REQUIRED_PAYLOAD_INDEXES };
