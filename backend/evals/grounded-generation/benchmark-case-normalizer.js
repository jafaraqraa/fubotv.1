'use strict';

function normalizeBenchmarkCase(item, suiteConfig = {}) {
    const question = item?.question ?? item?.query;
    const expectedFacts = item?.expectedFacts ?? item?.expectedTerms ?? [];
    const tenantId = item?.tenantId ?? suiteConfig.configuredRegressionTenant;
    if (typeof question !== 'string' || !question.trim()) throw new Error(`INVALID_BENCHMARK_QUESTION:${item?.id || 'unknown'}`);
    if (!tenantId || !String(tenantId).trim()) throw new Error(`INVALID_BENCHMARK_TENANT:${item?.id || 'unknown'}`);
    if (!Array.isArray(expectedFacts)) throw new Error(`INVALID_BENCHMARK_EXPECTED_FACTS:${item?.id || 'unknown'}`);
    return { ...item, question: question.trim(), expectedFacts, tenantId: String(tenantId), expectedDecision: item.expectedDecision };
}

function normalizeBenchmarkDataset(items, suiteConfig = {}) {
    if (!Array.isArray(items)) throw new Error('INVALID_BENCHMARK_DATASET');
    return items.map(item => normalizeBenchmarkCase(item, suiteConfig));
}

module.exports = { normalizeBenchmarkCase, normalizeBenchmarkDataset };
