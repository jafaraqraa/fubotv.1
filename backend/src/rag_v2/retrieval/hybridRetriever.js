'use strict';

const { reciprocalRankFusion } = require('./rrf');

class HybridRetriever {
    constructor({ embeddings, qdrant, bm25 = null, reranker, config }) { Object.assign(this, { embeddings, qdrant, bm25, reranker, config }); }
    async retrieve({ originalQuestion, standaloneQuestion = originalQuestion, scope, sparseVector = null, signal }) {
        let vector = null;
        if (this.embeddings) {
            try {
                vector = await this.embeddings.embed(standaloneQuestion, { signal });
            } catch (embedError) {
                console.warn('[RAG v2] Dense embedding skipped:', embedError.message);
            }
        }
        const densePromise = (vector && this.qdrant)
            ? this.qdrant.dense(vector, scope, { limit: this.config.denseCandidates, signal }).catch(err => {
                console.warn('[RAG v2] Qdrant dense search skipped:', err.message);
                return [];
            })
            : Promise.resolve([]);
        const sparsePromise = (sparseVector && this.qdrant)
            ? this.qdrant.sparse(sparseVector, scope, { limit: this.config.sparseCandidates, signal }).catch(err => {
                console.warn('[RAG v2] Qdrant sparse search skipped, using BM25 fallback:', err.message);
                return this.bm25 ? this.bm25.search(standaloneQuestion, scope, this.config.sparseCandidates) : [];
            })
            : Promise.resolve(this.bm25 ? this.bm25.search(standaloneQuestion, scope, this.config.sparseCandidates) : []);
        const [dense, rawSparse] = await Promise.all([densePromise, sparsePromise]);
        let sparse = rawSparse;
        if ((!sparse || !sparse.length) && this.bm25) {
            sparse = this.bm25.search(standaloneQuestion, scope, this.config.sparseCandidates);
        }
        const fused = reciprocalRankFusion([dense, sparse], { k: this.config.rrfK, limit: this.config.fusedCandidates });
        const rerankerInput = fused.slice(0, this.config.rerankerCandidates);
        let reranked = [];
        if (rerankerInput.length && this.reranker) {
            try {
                reranked = await this.reranker.rerank({ originalQuestion, standaloneQuestion, candidates: rerankerInput, limit: this.config.rerankerCandidates, signal });
            } catch (rerankError) {
                console.warn('[RAG v2] Reranker skipped/failed, using fused ranking fallback:', rerankError.message);
                reranked = rerankerInput.map((candidate, index) => ({
                    ...candidate,
                    rerankerScore: Number.isFinite(candidate.rerankerScore) ? candidate.rerankerScore : Math.max(0.4, 0.9 - index * 0.05),
                    preRerankPosition: index + 1
                }));
            }
        }
        return { dense, sparse, fused, reranked };
    }
}

module.exports = { HybridRetriever };
