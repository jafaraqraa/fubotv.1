'use strict';

const { RerankerProvider } = require('./contracts');
const { resolveTaskProvider, providerDescriptor } = require('./taskProviderResolver');

class TaskRerankerProvider extends RerankerProvider {
    constructor(options = {}) { super(); this.dependencies = options.dependencies || {}; this.provider = options.provider || null; }
    async rerank({ originalQuestion, standaloneQuestion, candidates, limit = 24 }) {
        const provider = this.provider || resolveTaskProvider('reranker', this.dependencies);
        const documents = candidates.map((candidate, index) => ({ index, chunkId: candidate.chunkId,
            text: [candidate.title, (candidate.sectionPath || []).join(' > '), candidate.retrievalText || candidate.originalText].filter(Boolean).join('\n') }));
        let rankings;
        if (typeof provider.rerank === 'function') {
            const query = originalQuestion === standaloneQuestion ? originalQuestion : `Original: ${originalQuestion}\nStandalone: ${standaloneQuestion}`;
            const results = await provider.rerank(query, documents.map(item => item.text), { topN: limit });
            rankings = results.map(result => ({ index: result.index, score: result.relevance_score ?? result.score }));
        } else {
            const schema = { type: 'object', additionalProperties: false, required: ['rankings'], properties: { rankings: { type: 'array', items: {
                type: 'object', additionalProperties: false, required: ['index','score'], properties: { index: { type: 'integer' }, score: { type: 'number' } }
            } } } };
            const content = await provider.generate([{ role: 'system', content: 'Rank evidence relevance. Return JSON only.' },
                { role: 'user', content: JSON.stringify({ originalQuestion, standaloneQuestion, documents }) }],
            { temperature: 0, maxTokens: Math.min(2048, 64 + documents.length * 24), jsonSchema: schema });
            let parsed; try { parsed = JSON.parse(content); } catch (_) { const e = new Error('reranker provider returned invalid JSON'); e.code = 'RAG_V2_INVALID_RERANK'; throw e; }
            rankings = parsed.rankings || [];
        }
        const seen = new Set();
        const ranked = rankings.filter(item => Number.isInteger(item.index) && candidates[item.index] && Number.isFinite(item.score) && !seen.has(item.index))
            .map(item => { seen.add(item.index); return { ...candidates[item.index], rerankerScore: item.score, preRerankPosition: item.index + 1 }; })
            .sort((a, b) => b.rerankerScore - a.rerankerScore || String(a.chunkId).localeCompare(String(b.chunkId))).slice(0, limit);
        if (!ranked.length) { const e = new Error('reranker provider returned no valid rankings'); e.code = 'RAG_V2_INVALID_RERANK'; throw e; }
        return ranked;
    }
    describe() { return providerDescriptor(this.provider || resolveTaskProvider('reranker', this.dependencies), 'rerank-via-structured-generation'); }
}

module.exports = { TaskRerankerProvider };
