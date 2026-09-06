'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/database/connection');
const { loadRagV2Config } = require('../src/rag_v2/config/ragV2Config');
const { DenseEmbeddingAdapter } = require('../src/rag_v2/embeddings/denseEmbeddingAdapter');
const { chunkDocument } = require('../src/rag_v2/chunking/hierarchicalChunker');
const { encodeSparse } = require('../src/rag_v2/embeddings/sparseEncoder');
const { QdrantIndexManager } = require('../src/rag_v2/indexing/qdrantIndexManager');
const { QdrantIndexer } = require('../src/rag_v2/indexing/qdrantIndexer');
const { updateEnvFile } = require('../src/utils/helpers');

const target = process.argv[2];
if (!/^futhing_knowledge_v\d+$/.test(target || '')) throw new Error('safe versioned target collection argument is required');

function inputs() {
    const rows = db.prepare(`SELECT * FROM knowledge_documents WHERE status='active' AND is_enabled=1 AND is_active=1 ORDER BY id`).all();
    const result = rows.map(row => ({ row, text: row.source_type === 'txt' && fs.existsSync(row.storage_path)
        ? fs.readFileSync(row.storage_path, 'utf8') : String(row.media_transcript || row.media_description || '') })).filter(x => x.text.trim())
        .map(({ row, text }) => ({ tenantId: row.tenant_id, knowledgeBaseId: 'default', documentId: row.logical_document_id || row.document_key,
            documentVersionId: row.version_id, versionNumber: Number(row.version || 1), sourceUri: row.storage_path,
            language: row.language || 'und', title: row.display_name || row.original_name, permissions: [], originalText: text,
            status: 'active', isCurrent: true }));
    const manualPath = path.join(__dirname, '../knowledge.txt');
    if (fs.existsSync(manualPath)) {
        const version = db.prepare(`SELECT document_version_id,version_number FROM rag_v2_document_versions
            WHERE tenant_id='default' AND knowledge_base_id='default' AND document_id='knowledge.txt' AND is_current=1`).get();
        result.push({ tenantId: 'default', knowledgeBaseId: 'default', documentId: 'knowledge.txt',
            documentVersionId: version.document_version_id, versionNumber: version.version_number,
            sourceUri: manualPath, language: 'ar', title: 'knowledge.txt', permissions: [],
            originalText: fs.readFileSync(manualPath, 'utf8'), status: 'active', isCurrent: true });
    }
    return result;
}

async function main() {
    const base = loadRagV2Config();
    if (target === base.collection || target === process.env.QDRANT_COLLECTION) throw new Error('target must be a new collection');
    const config = { ...base, collection: target };
    const qdrantBaseUrl = process.env.QDRANT_URL || 'http://127.0.0.1:6333';
    const common = { baseUrl: qdrantBaseUrl, collection: target, alias: config.alias,
        apiKey: process.env.QDRANT_API_KEY || '', timeoutMs: 30000 };
    const manager = new QdrantIndexManager(common);
    await manager.create({ dimensions: config.embeddingDimensions, distance: config.distance });
    const indexer = new QdrantIndexer(common);
    const embeddings = new DenseEmbeddingAdapter({ provider: config.embeddingProvider, baseUrl: config.embeddingBaseUrl,
        model: config.embeddingModel, expectedDimensions: config.embeddingDimensions, timeoutMs: 30000 });
    const chunks = inputs().flatMap(input => chunkDocument(input, config));
    for (let start = 0; start < chunks.length; start += 32) {
        const batch = chunks.slice(start, start + 32);
        const dense = await embeddings.embed(batch.map(item => item.retrievalText));
        await indexer.upsert(batch.map((chunk, index) => ({ chunk, denseVector: dense[index], sparseVector: encodeSparse(chunk.retrievalText) })));
    }
    const info = await manager.inspect();
    if (Number(info.points_count || 0) !== chunks.length) throw new Error(`Qdrant validation failed: expected=${chunks.length} actual=${info.points_count}`);
    db.transaction(() => {
        db.prepare('DELETE FROM rag_v2_chunks').run();
        const insert = db.prepare(`INSERT INTO rag_v2_chunks
            (chunk_id,document_version_id,tenant_id,knowledge_base_id,parent_id,chunk_index,section_path_json,page_number,original_text,retrieval_text,content_checksum,token_count)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
        const counters = new Map();
        for (const chunk of chunks) {
            const index = counters.get(chunk.documentVersionId) || 0; counters.set(chunk.documentVersionId, index + 1);
            insert.run(chunk.chunkId, chunk.documentVersionId, chunk.tenantId, chunk.knowledgeBaseId, chunk.parentId, index,
                JSON.stringify(chunk.sectionPath || []), chunk.pageNumber, chunk.originalText, chunk.retrievalText, chunk.contentChecksum, chunk.tokenCount);
        }
    })();
    await manager.switchAlias({ validated: true });
    updateEnvFile('RAG_V2_COLLECTION', target);
    console.log(JSON.stringify({ rebuilt: true, collection: target, documents: inputs().length, chunks: chunks.length }, null, 2));
}

main().catch(error => { console.error(JSON.stringify({ code: error.code || 'ERROR', message: error.message })); process.exitCode = 1; });
