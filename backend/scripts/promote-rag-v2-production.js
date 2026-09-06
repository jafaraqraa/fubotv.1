'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/database/connection');
const { createRagV2Runtime } = require('../src/rag_v2');
const { loadRagV2Config } = require('../src/rag_v2/config/ragV2Config');
const { TaskRerankerProvider } = require('../src/rag_v2/providers/rerankerProvider');
const { TaskGroundedGeneratorProvider } = require('../src/rag_v2/providers/groundedGeneratorProvider');
const { DeterministicClaimVerifierProvider } = require('../src/rag_v2/providers/claimVerifierProvider');
const { KNOWLEDGE_BASE_ID } = require('../src/rag_v2/runtime/productionRuntime');
const { updateEnvFile } = require('../src/utils/helpers');

function sourceText(row) {
    if (row.source_type === 'txt' && row.storage_path && fs.existsSync(row.storage_path)) {
        return fs.readFileSync(row.storage_path, 'utf8');
    }
    return String(row.media_transcript || row.media_description || '').trim();
}

async function main() {
    const config = loadRagV2Config({ ...process.env, RAG_IMPLEMENTATION: 'legacy' });
    if (config.collection === process.env.QDRANT_COLLECTION) throw new Error('v2 collection must differ from legacy collection');
    db.exec(fs.readFileSync(path.join(__dirname, '../src/database/migrations/034_rag_v2_foundation.sql'), 'utf8'));
    const runtime = createRagV2Runtime({
        db, config,
        reranker: new TaskRerankerProvider(),
        generator: new TaskGroundedGeneratorProvider(),
        verifier: new DeterministicClaimVerifierProvider()
    });
    let exists = true;
    try { await runtime.indexManager.inspect(); } catch (error) { if (error.status === 404) exists = false; else throw error; }
    if (!exists) await runtime.indexManager.create({ dimensions: config.embeddingDimensions, distance: config.distance });
    const rows = db.prepare(`SELECT * FROM knowledge_documents
        WHERE status='active' AND is_enabled=1 AND is_active=1 ORDER BY id`).all();
    const results = [];
    for (const row of rows) {
        const originalText = sourceText(row);
        if (!originalText.trim()) { results.push({ id: row.id, status: 'skipped-empty' }); continue; }
        results.push({ id: row.id, ...(await runtime.ingestion.ingest({
            tenantId: row.tenant_id,
            knowledgeBaseId: KNOWLEDGE_BASE_ID,
            documentId: row.logical_document_id || row.document_key,
            documentVersionId: row.version_id || undefined,
            versionNumber: Number(row.version || 1),
            sourceType: row.source_type,
            sourceUri: row.storage_path,
            language: row.language || 'und',
            title: row.display_name || row.original_name,
            permissions: [],
            originalText
        })) });
    }
    const manualPath = path.join(__dirname, '../knowledge.txt');
    if (fs.existsSync(manualPath) && fs.readFileSync(manualPath, 'utf8').trim()) {
        const originalText = fs.readFileSync(manualPath, 'utf8');
        results.push({ id: 'knowledge.txt', ...(await runtime.ingestion.ingest({
            tenantId: 'default', knowledgeBaseId: KNOWLEDGE_BASE_ID,
            documentId: 'knowledge.txt', versionNumber: 1, sourceType: 'txt',
            sourceUri: manualPath, language: 'ar', title: 'knowledge.txt',
            permissions: [], originalText
        }, { allowedQualityIssues: ['repeated_headers_or_footers'] })) });
    }
    const info = await runtime.indexManager.inspect();
    const indexed = db.prepare('SELECT count(*) n FROM rag_v2_chunks').get().n;
    if (!indexed || Number(info.points_count || 0) !== indexed) throw new Error(`validation failed: sqlite=${indexed} qdrant=${info.points_count || 0}`);
    await runtime.indexManager.switchAlias({ validated: true });
    updateEnvFile('RAG_V2_COLLECTION', config.collection);
    updateEnvFile('RAG_V2_ALIAS', config.alias);
    updateEnvFile('RAG_IMPLEMENTATION', 'v2');
    console.log(JSON.stringify({ promoted: true, collection: config.collection, alias: config.alias,
        documents: rows.length, indexedChunks: indexed, results }, null, 2));
}

main().catch(error => { console.error(JSON.stringify({ code: error.code || 'ERROR', message: error.message })); process.exitCode = 1; });
