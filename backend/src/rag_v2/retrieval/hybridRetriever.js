'use strict';

const { reciprocalRankFusion } = require('./rrf');

class HybridRetriever {
    constructor({ embeddings, qdrant, bm25 = null, reranker, config }) { Object.assign(this, { embeddings, qdrant, bm25, reranker, config }); }
    async retrieve({ originalQuestion, standaloneQuestion = originalQuestion, scope, sparseVector = null, signal }) {
        const vector = await this.embeddings.embed(standaloneQuestion, { signal });
        const densePromise = this.qdrant.dense(vector, scope, { limit: this.config.denseCandidates, signal });
        const sparsePromise = sparseVector
            ? this.qdrant.sparse(sparseVector, scope, { limit: this.config.sparseCandidates, signal })
            : Promise.resolve(this.bm25 ? this.bm25.search(standaloneQuestion, scope, this.config.sparseCandidates) : []);
        const [dense, sparse] = await Promise.all([densePromise, sparsePromise]);
        const fused = reciprocalRankFusion([dense, sparse], { k: this.config.rrfK, limit: this.config.fusedCandidates });
        const rerankerInput = fused.slice(0, this.config.rerankerCandidates);
        const reranked = rerankerInput.length
            ? await this.reranker.rerank({ originalQuestion, standaloneQuestion, candidates: rerankerInput, limit: this.config.rerankerCandidates, signal })
            : [];
        return { dense, sparse, fused, reranked };
    }
}

module.exports = { HybridRetriever };
