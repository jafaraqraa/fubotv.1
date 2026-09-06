'use strict';

const { loadRagV2Config } = require('./config/ragV2Config');
const { DenseEmbeddingAdapter } = require('./embeddings/denseEmbeddingAdapter');
const { Bm25Index } = require('./retrieval/bm25Index');
const { QdrantSearchAdapter } = require('./retrieval/qdrantSearchAdapter');
const { HybridRetriever } = require('./retrieval/hybridRetriever');
const { RerankerAdapter } = require('./reranking/rerankerAdapter');
const { QdrantIndexManager } = require('./indexing/qdrantIndexManager');
const { QdrantIndexer } = require('./indexing/qdrantIndexer');
const { RagV2Repository } = require('./storage/ragV2Repository');
const { IngestionPipeline } = require('./ingestion/ingestionPipeline');
const { AnswerPipeline } = require('./generation/answerPipeline');

function createRagV2Runtime(options = {}) {
    const config = options.config || loadRagV2Config(options.env);
    const shared = { baseUrl: options.qdrantBaseUrl || process.env.QDRANT_URL || 'http://127.0.0.1:6333', collection: config.collection,
        apiKey: options.qdrantApiKey || process.env.QDRANT_API_KEY || '', timeoutMs: config.retrievalTimeoutMs,
        denseVectorName: config.denseVectorName, sparseVectorName: config.sparseVectorName, fetch: options.fetch };
    const embeddings = options.embeddings || new DenseEmbeddingAdapter({ provider: config.embeddingProvider, baseUrl: config.embeddingBaseUrl,
        model: config.embeddingModel, expectedDimensions: config.embeddingDimensions, timeoutMs: config.retrievalTimeoutMs,
        apiKey: options.embeddingApiKey, fetch: options.fetch });
    const qdrant = options.qdrant || new QdrantSearchAdapter(shared);
    const bm25 = options.bm25 || new Bm25Index();
    const reranker = options.reranker || new RerankerAdapter({ baseUrl: config.rerankerBaseUrl, model: config.rerankerModel,
        timeoutMs: config.rerankerTimeoutMs, apiKey: options.rerankerApiKey, fetch: options.fetch });
    const retriever = new HybridRetriever({ embeddings, qdrant, bm25, reranker, config });
    const indexer = new QdrantIndexer(shared);
    const runtime = { config, embeddings, qdrant, bm25, reranker, retriever,
        indexManager: new QdrantIndexManager({ ...shared, alias: config.alias }),
        indexer };
    if (options.db) {
        runtime.repository = new RagV2Repository(options.db);
        runtime.ingestion = new IngestionPipeline({ repository: runtime.repository, embeddings, indexer, config });
    }
    if (options.generator) runtime.answers = new AnswerPipeline({ retriever, generator: options.generator,
        verifier: options.verifier || null, config });
    return Object.freeze(runtime);
}

module.exports = { createRagV2Runtime };
