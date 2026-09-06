'use strict';

const { normalizeForRetrieval } = require('../normalization/arabic');
const { retrievalCaseMetrics, reciprocalRank, ndcg, evaluateRun } = require('./metrics');

function containsFact(answer, fact) { return normalizeForRetrieval(answer).includes(normalizeForRetrieval(fact)); }

async function runEvaluation(dataset, executeCase) {
    const evaluated = [];
    for (const testCase of dataset.cases || []) {
        const started = performance.now(); let output;
        try { output = await executeCase(testCase); }
        catch (error) { output = { failed: true, timeout: error.code === 'RAG_V2_TIMEOUT', errorCode: error.code || 'ERROR', retrieval: [], decision: 'error' }; }
        const results = output.retrieval || []; const r5 = retrievalCaseMetrics(testCase, results, 5);
        const r10 = retrievalCaseMetrics(testCase, results, 10); const r20 = retrievalCaseMetrics(testCase, results, 20);
        const requiredFacts = testCase.required_facts || []; const claims = output.claims || [];
        const expectedCitations = new Set(testCase.expected_citations || []);
        const actualCitations = new Set((output.citations || []).map(c => c.document_id || c.source_id).filter(Boolean));
        const citationMatches = [...actualCitations].filter(id => expectedCitations.has(id)).length;
        const isExpectedAbstain = testCase.expected_answer_type === 'abstain'; const isAbstain = output.decision === 'abstain';
        const decisionCorrect = testCase.expected_answer_type === 'answer'
            ? ['answer', 'partial_answer'].includes(output.decision)
            : output.decision === testCase.expected_answer_type;
        evaluated.push({ id: testCase.id, expectedAnswerType: testCase.expected_answer_type, decision: output.decision,
            recall5: r5.recall, recall10: r10.recall, recall20: r20.recall, precision5: r5.precision,
            ndcg10: ndcg(testCase, results), mrr: reciprocalRank(testCase, results),
            answerCorrectness: requiredFacts.length ? requiredFacts.filter(f => containsFact(output.answer || '', f)).length / requiredFacts.length : Number(decisionCorrect),
            citationPrecision: actualCitations.size ? citationMatches / actualCitations.size : (expectedCitations.size ? 0 : 1),
            citationRecall: expectedCitations.size ? citationMatches / expectedCitations.size : 1,
            unsupportedClaimRate: claims.length ? claims.filter(c => c.support === 'unsupported').length / claims.length : 0,
            abstentionPrecision: isAbstain ? Number(isExpectedAbstain) : null, abstentionRecall: isExpectedAbstain ? Number(isAbstain) : null,
            crossTenantLeak: (output.retrieval || []).some(item => String(item.tenantId) !== String(testCase.tenant_id)),
            latencyMs: output.latencyMs ?? performance.now() - started, tokens: output.tokens ?? null, cost: output.cost ?? null,
            failed: output.failed === true, timeout: output.timeout === true, errorCode: output.errorCode || null });
    }
    return { schemaVersion: 1, datasetVersion: dataset.dataset_version, createdAt: new Date().toISOString(), metrics: evaluateRun(evaluated), cases: evaluated };
}

module.exports = { runEvaluation, containsFact };
