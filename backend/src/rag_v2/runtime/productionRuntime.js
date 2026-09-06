'use strict';

const db = require('../../database/connection');
const { createRagV2Runtime } = require('..');
const { loadRagV2Config } = require('../config/ragV2Config');
const { TaskRerankerProvider } = require('../providers/rerankerProvider');
const { TaskGroundedGeneratorProvider } = require('../providers/groundedGeneratorProvider');
const { DeterministicClaimVerifierProvider } = require('../providers/claimVerifierProvider');

const KNOWLEDGE_BASE_ID = 'default';
let cached;

function loadBm25Index(bm25, dbInstance) {
    if (!bm25) return;
    try {
        const rows = dbInstance.prepare(`
            SELECT c.*, v.title
            FROM rag_v2_chunks c
            JOIN rag_v2_document_versions v ON c.document_version_id = v.document_version_id
            WHERE v.is_current = 1 AND v.status = 'active'
            ORDER BY c.chunk_index ASC
        `).all();
        for (const row of rows) {
            bm25.add({
                chunkId: row.chunk_id,
                tenantId: row.tenant_id,
                knowledgeBaseId: row.knowledge_base_id,
                documentId: row.chunk_id,
                documentVersionId: row.document_version_id,
                parentId: row.parent_id,
                sectionPath: row.section_path_json ? JSON.parse(row.section_path_json) : [],
                originalText: row.original_text,
                retrievalText: row.retrieval_text,
                title: row.title || 'Knowledge',
                isCurrent: true,
                status: 'active',
                permissions: []
            });
        }
        if (rows.length > 0) {
            console.log(`[RAG v2] Populated BM25 index with ${rows.length} chunks from database.`);
        }
    } catch (err) {
        console.warn('[RAG v2] Failed to populate BM25 index:', err.message);
    }
}

function getProductionRuntime() {
    const config = loadRagV2Config();
    if (config.implementation !== 'v2') {
        const error = new Error('RAG v2 production runtime is not enabled');
        error.code = 'RAG_V2_NOT_ENABLED';
        throw error;
    }
    if (!cached) {
        cached = createRagV2Runtime({
            db,
            config,
            reranker: new TaskRerankerProvider(),
            generator: new TaskGroundedGeneratorProvider(),
            verifier: new DeterministicClaimVerifierProvider()
        });
        loadBm25Index(cached.bm25, db);
    }
    return cached;
}

async function answerWithRagV2({ question, history, tenantId, signal }) {
    const runtime = getProductionRuntime();
    const result = await runtime.answers.answer({
        question,
        history,
        scope: { tenantId, knowledgeBaseId: KNOWLEDGE_BASE_ID, permissionIds: [] },
        signal
    });
    return result;
}

module.exports = { KNOWLEDGE_BASE_ID, getProductionRuntime, answerWithRagV2 };
