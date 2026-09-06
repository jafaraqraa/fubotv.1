'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeForRetrieval, dualText } = require('../src/rag_v2/normalization/arabic');
const { chunkDocument } = require('../src/rag_v2/chunking/hierarchicalChunker');
const { buildAuthorizationFilter, assertAuthorizedCandidate } = require('../src/rag_v2/security/filters');
const { reciprocalRankFusion } = require('../src/rag_v2/retrieval/rrf');
const { buildContext } = require('../src/rag_v2/context/contextBuilder');
const { CLASSIFICATION, decideEvidence } = require('../src/rag_v2/evidence/evidenceGate');
const { validateResponseContract } = require('../src/rag_v2/generation/responseContract');
const { loadRagV2Config } = require('../src/rag_v2/config/ragV2Config');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

test('Arabic normalization preserves original and normalizes letters and digits', () => {
    const pair = dualText('إعْلان ١٢٣ ـ على');
    assert.equal(pair.originalText, 'إعْلان ١٢٣ ـ على');
    assert.equal(pair.retrievalText, 'اعلان 123 علي');
    assert.equal(normalizeForRetrieval('مدرسة'), 'مدرسة');
});

test('Arabic normalization expands the Mesh catalog alias', () => {
    assert.match(normalizeForRetrieval('عندكم جهاز ميش؟'), /ميش mesh/u);
});

test('hierarchical chunking preserves scope, headings, and deterministic ids', () => {
    const input = { tenantId: 't1', knowledgeBaseId: 'kb1', documentId: 'd1', documentVersionId: 'dv1', versionNumber: 2, originalText: '# الأسعار\n\nالسعر ١٠ شواكل فقط' };
    const cfg = { childChunkTokens: 3, overlapTokens: 1 };
    const a = chunkDocument(input, cfg); const b = chunkDocument(input, cfg);
    assert.deepEqual(a.map(x => x.chunkId), b.map(x => x.chunkId));
    assert.deepEqual(a[0].sectionPath, ['الأسعار']);
    assert.equal(a[0].tenantId, 't1'); assert.match(a[0].retrievalText, /10/);
});

test('authorization filter always embeds tenant, KB, active and current constraints', () => {
    const filter = buildAuthorizationFilter({ tenantId: 't1', knowledgeBaseId: 'kb1', permissionIds: ['reader'] });
    assert.equal(filter.must[0].match.value, 't1'); assert.equal(filter.must[1].match.value, 'kb1');
    assert.ok(filter.must.some(x => x.key === 'is_current'));
    assert.equal(assertAuthorizedCandidate({ tenantId: 't2', knowledgeBaseId: 'kb1', status: 'active', isCurrent: true, permissions: [] }, { tenantId: 't1', knowledgeBaseId: 'kb1' }), false);
});

test('RRF fuses ranks without comparing raw scores', () => {
    const result = reciprocalRankFusion([[{ chunkId: 'a' }, { chunkId: 'b' }], [{ chunkId: 'b' }]], { k: 60, limit: 2 });
    assert.equal(result[0].chunkId, 'b'); assert.equal(result[0].retrievalSources.length, 2);
});

test('context builder respects budget, deduplicates and emits stable labels', () => {
    const candidate = { chunkId: 'c1', documentVersionId: 'v1', originalText: 'short evidence', title: 'Policy', versionNumber: 1 };
    const result = buildContext([candidate, candidate], { contextTokenBudget: 20, maximumContextChunks: 8 });
    assert.equal(result.selected.length, 1); assert.match(result.text, /^\[S1\] Policy/);
});

test('evidence gate distinguishes authorization, partial, and sufficient evidence', () => {
    assert.equal(decideEvidence({ authorizationDenied: true }).classification, CLASSIFICATION.UNAUTHORIZED);
    assert.equal(decideEvidence({ questionComponents: ['price', 'date'], candidates: [{ documentVersionId: 'v1', coveredComponents: ['price'] }] }).classification, CLASSIFICATION.PARTIALLY_SUFFICIENT);
    assert.equal(decideEvidence({ questionComponents: ['price'], candidates: [{ documentVersionId: 'v1', coveredComponents: ['price'], retrievalSources: ['dense', 'sparse'] }] }).classification, CLASSIFICATION.SUFFICIENT);
});

test('response contract rejects invented citations and unsupported claims', () => {
    const result = validateResponseContract({ answer: 'x', decision: 'answer', claims: [{ text: 'x', source_ids: ['S2'], support: 'unsupported' }], citations: [] }, ['S1']);
    assert.equal(result.valid, false); assert.ok(result.errors.length >= 2);
});

test('configuration is fail-closed and legacy by default', () => {
    assert.equal(loadRagV2Config({}).implementation, 'legacy');
    assert.equal(loadRagV2Config({}).embeddingModel, 'nomic-embed-text:latest');
    assert.equal(loadRagV2Config({}).embeddingDimensions, 768);
    assert.throws(() => loadRagV2Config({ RAG_IMPLEMENTATION: 'v2', RAG_V2_OVERLAP_TOKENS: '9999' }), /Invalid RAG v2/);
});

test('RAG v2 foundation migration applies transactionally to an isolated database', () => {
    const db = new Database(':memory:');
    const sql = fs.readFileSync(path.join(__dirname, '../src/database/migrations/034_rag_v2_foundation.sql'), 'utf8');
    db.transaction(() => db.exec(sql))();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'rag_v2_%'").all().map(x => x.name);
    assert.deepEqual(tables.sort(), ['rag_v2_chunks', 'rag_v2_document_versions', 'rag_v2_evaluation_runs', 'rag_v2_index_versions', 'rag_v2_ingestion_jobs']);
    db.close();
});
