'use strict';

const { getProductionRuntime, KNOWLEDGE_BASE_ID } = require('../runtime/productionRuntime');
const db = require('../../database/connection');

async function syncExtractedDocumentToV2({ document, originalText, signal }) {
    if (process.env.RAG_IMPLEMENTATION !== 'v2') return { status: 'disabled' };
    if (!document?.tenant_id || !document?.document_key || !String(originalText || '').trim()) {
        const error = new Error('complete extracted document metadata is required for RAG v2 sync');
        error.code = 'RAG_V2_SYNC_INPUT_INVALID';
        throw error;
    }
    return getProductionRuntime().ingestion.ingest({
        tenantId: document.tenant_id,
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        documentId: document.logical_document_id || document.document_key,
        documentVersionId: document.version_id || `${document.document_key}:v${document.version || 1}`,
        versionNumber: Number(document.version || 1),
        sourceType: document.source_type || 'document',
        sourceUri: document.storage_path || null,
        language: document.language || 'und',
        title: document.display_name || document.original_name || document.document_key,
        permissions: [],
        originalText
    }, { signal, allowedQualityIssues: ['repeated_headers_or_footers'] });
}

async function syncManualKnowledgeToV2({ tenantId, originalText, sourceUri, signal }) {
    if (process.env.RAG_IMPLEMENTATION !== 'v2') return { status: 'disabled' };
    const current = db.prepare(`SELECT COALESCE(MAX(version_number),0) version
        FROM rag_v2_document_versions WHERE tenant_id=? AND knowledge_base_id=? AND document_id='knowledge.txt'`)
        .get(tenantId, KNOWLEDGE_BASE_ID);
    return getProductionRuntime().ingestion.ingest({
        tenantId, knowledgeBaseId: KNOWLEDGE_BASE_ID, documentId: 'knowledge.txt',
        versionNumber: Number(current.version) + 1, sourceType: 'txt', sourceUri,
        language: 'ar', title: 'knowledge.txt', permissions: [], originalText
    }, { signal, allowedQualityIssues: ['repeated_headers_or_footers'] });
}

module.exports = { syncExtractedDocumentToV2, syncManualKnowledgeToV2 };
