'use strict';

const { fetchJson } = require('../runtime/http');
const crypto = require('crypto');

function qdrantPointId(value) {
    const text = String(value || '');
    if (/^\d+$/.test(text) || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) return text;
    const hex = crypto.createHash('sha256').update(text).digest('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function toPayload(chunk) {
    return {
        tenant_id: chunk.tenantId, knowledge_base_id: chunk.knowledgeBaseId,
        document_id: chunk.documentId, document_version_id: chunk.documentVersionId,
        chunk_id: chunk.chunkId, parent_id: chunk.parentId, version_number: chunk.versionNumber,
        status: chunk.status, is_current: chunk.isCurrent, permissions: chunk.permissions || [],
        title: chunk.title, source_uri: chunk.sourceUri, section_path: chunk.sectionPath || [],
        page_number: chunk.pageNumber, language: chunk.language, original_text: chunk.originalText,
        retrieval_text: chunk.retrievalText, content_checksum: chunk.contentChecksum,
        valid_from: chunk.validFrom || null, valid_to: chunk.validTo || null
    };
}

class QdrantIndexer {
    constructor(options) {
        this.baseUrl = String(options.baseUrl || '').replace(/\/$/, ''); this.collection = options.collection;
        this.apiKey = options.apiKey || ''; this.timeoutMs = options.timeoutMs; this.fetch = options.fetch;
        this.denseVectorName = options.denseVectorName || 'dense'; this.sparseVectorName = options.sparseVectorName || 'sparse';
        if (!/_v\d+(?:_|$)/.test(this.collection) && !this.collection.endsWith('_v2')) { const e = new Error('index writes require an explicitly versioned v2 collection'); e.code = 'RAG_V2_UNSAFE_COLLECTION'; throw e; }
    }
    headers() { return { 'content-type': 'application/json', ...(this.apiKey ? { 'api-key': this.apiKey } : {}) }; }
    async upsert(records, options = {}) {
        if (!Array.isArray(records) || !records.length) throw new Error('index records are required');
        const points = records.map(record => {
            if (!record.chunk?.chunkId || !Array.isArray(record.denseVector)) throw new Error('chunk and denseVector are required');
            const vector = { [this.denseVectorName]: record.denseVector };
            if (record.sparseVector) vector[this.sparseVectorName] = record.sparseVector;
            return { id: qdrantPointId(record.pointId || record.chunk.chunkId), vector, payload: toPayload(record.chunk) };
        });
        return fetchJson(`${this.baseUrl}/collections/${encodeURIComponent(this.collection)}/points?wait=true`, {
            method: 'PUT', headers: this.headers(), body: { points }, timeoutMs: this.timeoutMs,
            signal: options.signal, fetch: this.fetch
        });
    }
    async deleteChunkIds(chunkIds, options = {}) {
        const points = [...new Set((chunkIds || []).map(qdrantPointId))];
        if (!points.length) return null;
        return fetchJson(`${this.baseUrl}/collections/${encodeURIComponent(this.collection)}/points/delete?wait=true`, {
            method: 'POST', headers: this.headers(), body: { points }, timeoutMs: this.timeoutMs,
            signal: options.signal, fetch: this.fetch
        });
    }
}

module.exports = { QdrantIndexer, toPayload, qdrantPointId };
