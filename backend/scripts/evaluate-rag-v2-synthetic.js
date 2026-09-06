'use strict';

require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { loadRagV2Config } = require('../src/rag_v2/config/ragV2Config');
const { DenseEmbeddingAdapter } = require('../src/rag_v2/embeddings/denseEmbeddingAdapter');
const { QdrantIndexManager } = require('../src/rag_v2/indexing/qdrantIndexManager');
const { QdrantIndexer } = require('../src/rag_v2/indexing/qdrantIndexer');
const { QdrantSearchAdapter } = require('../src/rag_v2/retrieval/qdrantSearchAdapter');
const { RagV2Repository } = require('../src/rag_v2/storage/ragV2Repository');
const { IngestionPipeline } = require('../src/rag_v2/ingestion/ingestionPipeline');
const { HybridRetriever } = require('../src/rag_v2/retrieval/hybridRetriever');
const { TaskRerankerProvider } = require('../src/rag_v2/providers/rerankerProvider');
const { TaskGroundedGeneratorProvider } = require('../src/rag_v2/providers/groundedGeneratorProvider');
const { DeterministicClaimVerifierProvider } = require('../src/rag_v2/providers/claimVerifierProvider');
const { AnswerPipeline } = require('../src/rag_v2/generation/answerPipeline');
const { runEvaluation } = require('../src/rag_v2/evaluation/evaluationRunner');
const { fetchJson } = require('../src/rag_v2/runtime/http');

const root = path.join(__dirname, '..');
const dataset = JSON.parse(fs.readFileSync(path.join(root, 'evals/rag-v2-dataset-v1.json')));
const corpus = JSON.parse(fs.readFileSync(path.join(root, 'evals/rag-v2-synthetic-corpus-v1.json')));
const suffix = `${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
const collection = `futhing_rag_v2_integration_${suffix}`;
const alias = `${collection}_alias`; const qdrantUrl = process.env.QDRANT_URL || 'http://127.0.0.1:6333';
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-v2-eval-')); const sqlitePath = path.join(tempDir, 'eval.sqlite');
const cleanupHeaders = { ...(process.env.QDRANT_API_KEY ? { 'api-key': process.env.QDRANT_API_KEY } : {}) };

async function main() {
    let created = false; let db;
    try {
        const config = { ...loadRagV2Config(), implementation: 'legacy', collection, alias };
        db = new Database(sqlitePath); db.pragma('foreign_keys=ON');
        db.exec(fs.readFileSync(path.join(root, 'src/database/migrations/034_rag_v2_foundation.sql'), 'utf8'));
        const embeddings = new DenseEmbeddingAdapter({ provider: 'ollama', baseUrl: config.embeddingBaseUrl,
            model: config.embeddingModel, expectedDimensions: config.embeddingDimensions, timeoutMs: 30000 });
        const manager = new QdrantIndexManager({ baseUrl: qdrantUrl, collection, alias, apiKey: process.env.QDRANT_API_KEY, timeoutMs: 30000 });
        await manager.create({ dimensions: config.embeddingDimensions, distance: config.distance }); created = true;
        const indexer = new QdrantIndexer({ baseUrl: qdrantUrl, collection, apiKey: process.env.QDRANT_API_KEY, timeoutMs: 30000 });
        const ingestion = new IngestionPipeline({ repository: new RagV2Repository(db), embeddings, indexer, config });
        for (const doc of corpus.documents) await ingestion.ingest({ ...doc, sourceType: 'synthetic', sourceUri: `fixture://${doc.documentId}/${doc.versionNumber}`, language: 'ar', permissions: [], originalText: doc.text });
        const qdrant = new QdrantSearchAdapter({ baseUrl: qdrantUrl, collection, apiKey: process.env.QDRANT_API_KEY, timeoutMs: 10000 });
        const retriever = new HybridRetriever({ embeddings, qdrant, reranker: new TaskRerankerProvider(), config });
        const answers = new AnswerPipeline({ retriever, generator: new TaskGroundedGeneratorProvider(),
            verifier: new DeterministicClaimVerifierProvider(), config });
        const report = await runEvaluation(dataset, async testCase => {
            const started = performance.now();
            const result = await answers.answer({ question: testCase.question, history: testCase.conversation_context,
                scope: { tenantId: testCase.tenant_id, knowledgeBaseId: 'evaluation-kb', permissionIds: [] } });
            const sources = new Map((result.context?.selected || []).map(x => [x.sourceId, x.documentId]));
            const usage = result.generation?.metadata?.usage || {};
            return { decision: result.decision, answer: result.answer,
                retrieval: result.retrieval?.reranked || [], claims: result.claims || [],
                citations: (result.citations || []).map(c => ({ ...c, document_id: sources.get(c.source_id) || c.document_id })),
                tokens: usage.total_tokens ?? usage.totalTokens ?? null,
                cost: result.generation?.metadata?.cost ?? usage.cost ?? null,
                latencyMs: performance.now() - started };
        });
        report.corpusVersion = corpus.version; report.configuration = { embedding: config.embeddingModel,
            dimensions: config.embeddingDimensions, reranker: 'cohere/rerank-4-pro', generator: 'openai/gpt-4.1-mini', minimumRerankerScore: config.minimumRerankerScore };
        const artifact = path.join(root, 'evals/rag-v2-synthetic-results-v1.json');
        fs.writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
        process.stdout.write(`${JSON.stringify(report.metrics, null, 2)}\n`);
    } finally {
        try { db?.close(); } catch (_) {}
        if (created && collection.startsWith('futhing_rag_v2_integration_')) {
            try { await fetchJson(`${qdrantUrl}/collections/${encodeURIComponent(collection)}`, { method: 'DELETE', headers: cleanupHeaders, timeoutMs: 10000 }); } catch (_) {}
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

main().catch(error => { console.error(JSON.stringify({ code: error.code || 'ERROR', message: error.message })); process.exitCode = 1; });
