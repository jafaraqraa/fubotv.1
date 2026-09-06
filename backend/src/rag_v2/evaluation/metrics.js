'use strict';

function mean(values) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }
function meanOrNull(values) { return values.length ? mean(values) : null; }
function percentile(values, p) { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.ceil(p * sorted.length) - 1]; }
function relevantSet(testCase) { return new Set([...(testCase.relevant_chunk_ids || []), ...(testCase.relevant_document_ids || [])]); }
function resultIdentity(result) { return [result.chunkId, result.documentId].filter(Boolean); }
function relevant(result, expected) { return resultIdentity(result).some(id => expected.has(id)); }

function retrievalCaseMetrics(testCase, results, k) {
    const expected = relevantSet(testCase); const top = (results || []).slice(0, k);
    if (!expected.size) return { recall: null, precision: top.length ? 0 : 1 };
    const found = new Set(top.flatMap(resultIdentity).filter(id => expected.has(id)));
    return { recall: found.size / expected.size, precision: top.filter(item => relevant(item, expected)).length / Math.max(1, top.length) };
}

function reciprocalRank(testCase, results) { const expected = relevantSet(testCase); if (!expected.size) return null; const rank = (results || []).findIndex(item => relevant(item, expected)); return rank < 0 ? 0 : 1 / (rank + 1); }
function ndcg(testCase, results, k = 10) {
    const expected = relevantSet(testCase); if (!expected.size) return null;
    const credited = new Set();
    const dcg = (results || []).slice(0, k).reduce((sum, item, index) => {
        const identity = resultIdentity(item).find(id => expected.has(id));
        if (!identity || credited.has(identity)) return sum;
        credited.add(identity); return sum + 1 / Math.log2(index + 2);
    }, 0);
    const ideal = Array.from({ length: Math.min(k, expected.size) }, (_, index) => 1 / Math.log2(index + 2)).reduce((a, b) => a + b, 0);
    return ideal ? dcg / ideal : 0;
}

function evaluateRun(cases) {
    const values = key => cases.map(item => item[key]).filter(Number.isFinite);
    const count = cases.length || 1;
    return {
        recall_at_5: mean(values('recall5')), recall_at_10: mean(values('recall10')), recall_at_20: mean(values('recall20')),
        precision_at_5: mean(values('precision5')), ndcg_at_10: mean(values('ndcg10')), mrr: mean(values('mrr')),
        answer_correctness: mean(values('answerCorrectness')), citation_precision: mean(values('citationPrecision')),
        citation_recall: mean(values('citationRecall')), unsupported_claim_rate: mean(values('unsupportedClaimRate')),
        abstention_precision: mean(values('abstentionPrecision')), abstention_recall: mean(values('abstentionRecall')),
        false_answer_rate: cases.filter(x => x.expectedAnswerType === 'abstain' && !['abstain','clarify'].includes(x.decision)).length / count,
        cross_tenant_leakage_rate: cases.filter(x => x.crossTenantLeak === true).length / count,
        latency_ms: { p50: percentile(values('latencyMs'), .5), p95: percentile(values('latencyMs'), .95) },
        failure_rate: cases.filter(x => x.failed).length / count, timeout_rate: cases.filter(x => x.timeout).length / count,
        tokens_per_request: meanOrNull(values('tokens')), cost_per_request: meanOrNull(values('cost'))
    };
}

module.exports = { retrievalCaseMetrics, reciprocalRank, ndcg, evaluateRun, percentile };
