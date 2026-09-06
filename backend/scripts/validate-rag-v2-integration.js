'use strict';

require('dotenv').config();

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { DenseEmbeddingAdapter } = require('../src/rag_v2/embeddings/denseEmbeddingAdapter');
const { QdrantIndexManager, REQUIRED_PAYLOAD_INDEXES } = require('../src/rag_v2/indexing/qdrantIndexManager');
const { QdrantIndexer } = require('../src/rag_v2/indexing/qdrantIndexer');
const { QdrantSearchAdapter } = require('../src/rag_v2/retrieval/qdrantSearchAdapter');
const { chunkDocument } = require('../src/rag_v2/chunking/hierarchicalChunker');
const { fetchJson } = require('../src/rag_v2/runtime/http');
const { tokenize } = require('../src/rag_v2/retrieval/bm25Index');
const { RagV2Repository } = require('../src/rag_v2/storage/ragV2Repository');
const { IngestionPipeline } = require('../src/rag_v2/ingestion/ingestionPipeline');
const { HybridRetriever } = require('../src/rag_v2/retrieval/hybridRetriever');
const { AnswerPipeline } = require('../src/rag_v2/generation/answerPipeline');
const { TaskRerankerProvider } = require('../src/rag_v2/providers/rerankerProvider');
const { TaskGroundedGeneratorProvider } = require('../src/rag_v2/providers/groundedGeneratorProvider');
const { DeterministicClaimVerifierProvider } = require('../src/rag_v2/providers/claimVerifierProvider');

const qdrantUrl = String(process.env.QDRANT_URL || 'http://127.0.0.1:6333').replace(/\/$/, '');
const ollamaUrl = String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const suffix = `${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
const collection = `futhing_rag_v2_integration_${suffix}`;
const alias = `${collection}_alias`;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'futhing-rag-v2-'));
const sqlitePath = path.join(tempDir, 'integration.sqlite');
const headers = { 'content-type': 'application/json', ...(process.env.QDRANT_API_KEY ? { 'api-key': process.env.QDRANT_API_KEY } : {}) };
const result = { startedAt: new Date().toISOString(), resources: { collection, alias, sqlitePath }, checks: {}, cleanup: {} };

function syntheticChunk(tenantId, id, text) {
    return chunkDocument({ tenantId, knowledgeBaseId: 'integration-kb', documentId: `doc-${id}`, documentVersionId: `version-${id}`,
        versionNumber: 1, status: 'active', isCurrent: true, permissions: [], title: `Synthetic ${id}`, language: 'ar',
        originalText: `# معلومات تجريبية\n\n${text}` }, { childChunkTokens: 450, overlapTokens: 60 })[0];
}

function sparseVector(text) {
    const counts = new Map();
    for (const token of tokenize(text)) {
        const digest = crypto.createHash('sha256').update(token).digest();
        const index = digest.readUInt32BE(0) & 0x7fffffff; counts.set(index, (counts.get(index) || 0) + 1);
    }
    const entries = [...counts.entries()].sort((a, b) => a[0] - b[0]);
    return { indices: entries.map(x => x[0]), values: entries.map(x => x[1]) };
}

async function main() {
    let created = false;
    let failure = null;
    try {
        const [qdrantRoot, ollamaVersion, tags] = await Promise.all([
            fetchJson(`${qdrantUrl}/`, { headers, timeoutMs: 5000 }),
            fetchJson(`${ollamaUrl}/api/version`, { timeoutMs: 5000 }),
            fetchJson(`${ollamaUrl}/api/tags`, { timeoutMs: 10000 })
        ]);
        result.versions = { qdrant: qdrantRoot.version, ollama: ollamaVersion.version,
            sqlite: new Database(':memory:').prepare('select sqlite_version() version').get().version,
            betterSqlite3: require('better-sqlite3/package.json').version };
        result.capabilities = { ollamaModels: (tags.models || []).map(m => ({ name: m.name, capabilities: m.capabilities || [], embeddingLength: m.details?.embedding_length || null })), rerankerService: false };

        const embedModel = (tags.models || []).find(m => (m.capabilities || []).includes('embedding'));
        if (!embedModel) throw new Error('No local embedding-capable Ollama model is installed');
        const expectedDimensions = embedModel.details?.embedding_length || null;
        const embeddings = new DenseEmbeddingAdapter({ provider: 'ollama', baseUrl: ollamaUrl, model: embedModel.name, expectedDimensions, timeoutMs: 30000 });
        const probe = await embeddings.embed('فحص تكامل اصطناعي لا يحتوي على بيانات عملاء');
        result.checks.embedding = { model: embedModel.name, dimensions: probe.length, valid: probe.every(Number.isFinite) };

        const db = new Database(sqlitePath); db.pragma('foreign_keys = ON');
        db.exec(fs.readFileSync(path.join(__dirname, '../src/database/migrations/034_rag_v2_foundation.sql'), 'utf8'));
        result.checks.sqliteMigration = db.prepare("SELECT count(*) count FROM sqlite_master WHERE type='table' AND name LIKE 'rag_v2_%'").get().count === 5;
        db.close();

        const manager = new QdrantIndexManager({ baseUrl: qdrantUrl, collection, alias, apiKey: process.env.QDRANT_API_KEY, timeoutMs: 30000 });
        await manager.create({ dimensions: probe.length, distance: 'Cosine' }); created = true;
        const info = await manager.inspect();
        result.checks.collection = { status: info.status, vectors: info.config?.params?.vectors, sparseVectors: info.config?.params?.sparse_vectors };

        result.stage = 'synthetic_ingestion';
        const own = syntheticChunk('integration-tenant-a', 'own', 'رمز الباقة التجريبية SYNTH-42 وسعرها 77 شيكل.');
        const foreign = syntheticChunk('integration-tenant-b', 'foreign', 'رمز سري اصطناعي SYNTH-42 وسعره 999 شيكل.');
        const dense = await embeddings.embed([own.retrievalText, foreign.retrievalText]);
        const indexer = new QdrantIndexer({ baseUrl: qdrantUrl, collection, apiKey: process.env.QDRANT_API_KEY, timeoutMs: 30000 });
        await indexer.upsert([{ chunk: own, denseVector: dense[0], sparseVector: sparseVector(own.retrievalText) }, { chunk: foreign, denseVector: dense[1], sparseVector: sparseVector(foreign.retrievalText) }]);

        result.stage = 'dense_sparse_search';
        const search = new QdrantSearchAdapter({ baseUrl: qdrantUrl, collection, apiKey: process.env.QDRANT_API_KEY, timeoutMs: 10000 });
        const queryText = 'كم سعر SYNTH-42؟'; const queryDense = await embeddings.embed(queryText);
        const scope = { tenantId: 'integration-tenant-a', knowledgeBaseId: 'integration-kb', permissionIds: [] };
        const denseHits = await search.dense(queryDense, scope, { limit: 10 });
        const sparseHits = await search.sparse(sparseVector(queryText), scope, { limit: 10 });
        result.checks.search = { denseIds: denseHits.map(x => x.chunkId), sparseIds: sparseHits.map(x => x.chunkId), tenantIsolation: [...denseHits, ...sparseHits].every(x => x.tenantId === 'integration-tenant-a') };

        result.stage = 'alias_switch';
        await manager.switchAlias({ validated: true });
        const aliasSearch = new QdrantSearchAdapter({ baseUrl: qdrantUrl, collection: alias, apiKey: process.env.QDRANT_API_KEY, timeoutMs: 10000 });
        const aliasHits = await aliasSearch.dense(queryDense, scope, { limit: 10 });
        result.checks.alias = { resolved: aliasHits.some(x => x.chunkId === own.chunkId) };
        result.checks.payloadIndexesRequested = Object.keys(REQUIRED_PAYLOAD_INDEXES);

        result.stage = 'ingestion_to_answer';
        const pipelineDb = new Database(sqlitePath); pipelineDb.pragma('foreign_keys = ON');
        const pipelineConfig = { childChunkTokens: 450, overlapTokens: 60, denseCandidates: 40, sparseCandidates: 40,
            fusedCandidates: 40, rrfK: 60, rerankerCandidates: 24, contextTokenBudget: 3000, maximumContextChunks: 8 };
        pipelineConfig.minimumRerankerScore = 0.35;
        const ingestion = new IngestionPipeline({ repository: new RagV2Repository(pipelineDb), embeddings, indexer, config: pipelineConfig });
        const ingested = await ingestion.ingest({ tenantId: 'integration-tenant-a', knowledgeBaseId: 'integration-kb',
            documentId: 'e2e-document', versionNumber: 1, sourceType: 'synthetic', sourceUri: 'fixture://e2e',
            language: 'ar', title: 'اختبار تكامل اصطناعي', permissions: [],
            originalText: '# نتيجة الاختبار\n\nرمز الاختبار E2E-88 وقيمته المؤكدة 314 وحدة.' });
        const retriever = new HybridRetriever({ embeddings, qdrant: search, reranker: new TaskRerankerProvider(), config: pipelineConfig });
        const generator = new TaskGroundedGeneratorProvider();
        const answerPipeline = new AnswerPipeline({ retriever, generator,
            verifier: new DeterministicClaimVerifierProvider(), config: pipelineConfig });
        const answer = await answerPipeline.answer({ question: 'ما القيمة المؤكدة للرمز E2E-88؟', scope, signal: undefined });
        result.checks.endToEnd = { ingested, decision: answer.decision, answer: answer.answer,
            verified: answer.verification?.valid === true, citations: answer.citations || [],
            rerankerMode: 'configured remote task provider' };
        pipelineDb.close();
        result.stage = 'complete';
    } catch (error) {
        failure = error;
        result.error = { message: error.message, code: error.code || null, status: error.status || null,
            dependencyError: error.dependencyError || null, stage: result.stage || null };
    } finally {
        if (created && collection.startsWith('futhing_rag_v2_integration_')) {
            try { await fetchJson(`${qdrantUrl}/collections/${encodeURIComponent(collection)}`, { method: 'DELETE', headers, timeoutMs: 10000 }); result.cleanup.collectionDeleted = true; }
            catch (error) { result.cleanup.collectionDeleted = false; result.cleanup.error = error.message; }
        }
        try { fs.rmSync(tempDir, { recursive: true, force: true }); result.cleanup.tempDatabaseDeleted = true; }
        catch (error) { result.cleanup.tempDatabaseDeleted = false; result.cleanup.sqliteError = error.message; }
        result.finishedAt = new Date().toISOString();
        const artifact = path.join(__dirname, '../evals/rag-v2-integration-latest.json');
        fs.writeFileSync(artifact, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
    if (failure) throw failure;
}

main().catch(() => { process.exitCode = 1; });
