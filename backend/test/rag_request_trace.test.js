const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { initializeDatabase } = require('../src/database/initialize');
const traceRepo = require('../src/database/repositories/ragRequestTraceRepository');

initializeDatabase();

test('persists request-level RAG trace without secret-like tokens', () => {
    const requestId = crypto.randomUUID();
    traceRepo.createTrace({ requestId, tenantId: 'default', retrievalQuery: 'سؤال' });
    traceRepo.updateTrace(requestId, {
        route: 'COMPANY_KNOWLEDGE',
        raw_model_output: 'جواب Bearer secret.value and sk-abcdefghijklmnop',
        retrieved_chunks_json: [{ id: 'chunk-1', score: 0.9 }],
        claims_json: [{ text: 'ادعاء', matchedEvidenceId: 'chunk-1' }]
    });
    const row = traceRepo.getTrace(requestId);
    assert.equal(row.route, 'COMPANY_KNOWLEDGE');
    assert.deepEqual(JSON.parse(row.retrieved_chunks_json), [{ id: 'chunk-1', score: 0.9 }]);
    assert.match(row.raw_model_output, /\[REDACTED\]/);
    assert.doesNotMatch(row.raw_model_output, /secret\.value|sk-abcdefghijklmnop/);
});
