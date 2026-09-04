const test = require('node:test');
const assert = require('node:assert/strict');
const { isKnowledgeOperation } = require('../src/rag/security/ragAccessPolicy');

test('RAG access policy distinguishes knowledge operations from protected settings', () => {
    for (const requestPath of [
        '/documents/upload',
        '/documents/doc-1',
        '/reindex',
        '/reconciliation/reindex',
        '/rag/documents/upload',
        '/rag/reindex'
    ]) {
        assert.equal(isKnowledgeOperation(requestPath), true, requestPath);
    }

    for (const requestPath of ['/settings', '/access/unlock', '/metrics', '/documents-unsafe']) {
        assert.equal(isKnowledgeOperation(requestPath), false, requestPath);
    }
});
