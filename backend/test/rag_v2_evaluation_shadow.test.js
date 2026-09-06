'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runEvaluation } = require('../src/rag_v2/evaluation/evaluationRunner');
const { ShadowDispatcher } = require('../src/rag_v2/shadow/shadowDispatcher');

test('evaluation runner calculates retrieval, answer, citation, abstention and isolation metrics', async () => {
    const dataset = { dataset_version: 'test-v1', cases: [
        { id: 'a', tenant_id: 't1', expected_answer_type: 'answer', relevant_document_ids: ['d1'], required_facts: ['314'], expected_citations: ['d1'] },
        { id: 'b', tenant_id: 't1', expected_answer_type: 'abstain', relevant_document_ids: [], required_facts: [], expected_citations: [] }
    ] };
    const report = await runEvaluation(dataset, async item => item.id === 'a'
        ? { decision: 'answer', answer: '314', retrieval: [{ documentId: 'd1', tenantId: 't1' }], citations: [{ document_id: 'd1' }], claims: [{ support: 'supported' }], latencyMs: 10, tokens: 20, cost: .1 }
        : { decision: 'abstain', answer: '', retrieval: [], citations: [], latencyMs: 20, tokens: 2, cost: 0 });
    assert.equal(report.metrics.recall_at_10, 1); assert.equal(report.metrics.citation_precision, 1);
    assert.equal(report.metrics.false_answer_rate, 0); assert.equal(report.metrics.cross_tenant_leakage_rate, 0);
    assert.equal(report.metrics.latency_ms.p95, 20);
    assert.ok(report.metrics.ndcg_at_10 <= 1);
});

test('nDCG credits a relevant document only once when several chunks are retrieved', async () => {
    const report = await runEvaluation({ dataset_version: 'd', cases: [{ id: 'x', tenant_id: 't', expected_answer_type: 'answer',
        relevant_document_ids: ['d1'], required_facts: ['fact'], expected_citations: ['d1'] }] }, async () => ({
        decision: 'answer', answer: 'fact', retrieval: [{ documentId: 'd1', chunkId: 'a', tenantId: 't' }, { documentId: 'd1', chunkId: 'b', tenantId: 't' }],
        citations: [{ source_id: 'S1', document_id: 'd1' }]
    }));
    assert.equal(report.metrics.ndcg_at_10, 1); assert.equal(report.metrics.citation_precision, 1);
});

test('evaluation requires clarify decision for ambiguous cases', async () => {
    const report = await runEvaluation({ dataset_version: 'd', cases: [{ id: 'x', tenant_id: 't', expected_answer_type: 'clarify', required_facts: [] }] },
        async () => ({ decision: 'answer', answer: 'guessed', retrieval: [] }));
    assert.equal(report.metrics.answer_correctness, 0);
});

test('legacy mode never invokes shadow implementation', async () => {
    let v2Calls = 0; const dispatcher = new ShadowDispatcher({ implementation: 'legacy', legacy: async () => 'legacy', v2: async () => { v2Calls++; } });
    assert.equal(await dispatcher.execute({}), 'legacy'); await new Promise(resolve => setImmediate(resolve)); assert.equal(v2Calls, 0);
});

test('shadow mode returns legacy answer and records v2 asynchronously', async () => {
    let recorded; const dispatcher = new ShadowDispatcher({ implementation: 'shadow', legacy: async () => 'legacy', v2: async () => 'v2', record: async value => { recorded = value; } });
    assert.equal(await dispatcher.execute({ requestId: 'r1' }), 'legacy');
    await new Promise(resolve => setImmediate(resolve)); assert.equal(recorded.v2, 'v2'); assert.equal(recorded.requestId, 'r1');
});
