'use strict';

const { fetchJson } = require('../runtime/http');
const { buildAuthorizationFilter, assertAuthorizedCandidate } = require('../security/filters');

class QdrantSearchAdapter {
    constructor(options) {
        this.baseUrl = String(options.baseUrl || '').replace(/\/$/, ''); this.collection = options.collection;
        this.apiKey = options.apiKey || ''; this.timeoutMs = options.timeoutMs; this.fetch = options.fetch;
        this.denseVectorName = options.denseVectorName || 'dense'; this.sparseVectorName = options.sparseVectorName || 'sparse';
        if (!this.baseUrl || !this.collection) throw new Error('Qdrant baseUrl and v2 collection are required');
    }
    headers() { return { 'content-type': 'application/json', ...(this.apiKey ? { 'api-key': this.apiKey } : {}) }; }
    async query(vector, scope, { kind = 'dense', limit = 40, signal } = {}) {
        const using = kind === 'sparse' ? this.sparseVectorName : this.denseVectorName;
        const payload = await fetchJson(`${this.baseUrl}/collections/${encodeURIComponent(this.collection)}/points/query`, {
            method: 'POST', headers: this.headers(), timeoutMs: this.timeoutMs, signal, fetch: this.fetch,
            body: { query: vector, using, filter: buildAuthorizationFilter(scope), limit, with_payload: true, with_vector: false }
        });
        const points = payload?.result?.points || payload?.result || [];
        return points.map(point => ({ ...point.payload,
            chunkId: point.payload?.chunk_id || point.payload?.chunkId || point.id,
            tenantId: point.payload?.tenant_id || point.payload?.tenantId,
            knowledgeBaseId: point.payload?.knowledge_base_id || point.payload?.knowledgeBaseId,
            documentId: point.payload?.document_id || point.payload?.documentId,
            documentVersionId: point.payload?.document_version_id || point.payload?.documentVersionId,
            isCurrent: point.payload?.is_current ?? point.payload?.isCurrent,
            originalText: point.payload?.original_text || point.payload?.originalText,
            retrievalText: point.payload?.retrieval_text || point.payload?.retrievalText,
            sectionPath: point.payload?.section_path || point.payload?.sectionPath || [],
            [`${kind}Score`]: point.score, retrievalSource: kind }))
            .filter(candidate => assertAuthorizedCandidate(candidate, scope)).slice(0, limit);
    }
    dense(vector, scope, options) { return this.query(vector, scope, { ...options, kind: 'dense' }); }
    sparse(vector, scope, options) { return this.query(vector, scope, { ...options, kind: 'sparse' }); }
}

module.exports = { QdrantSearchAdapter };
