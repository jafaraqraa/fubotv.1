#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const datasetPath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'evals', 'rag-production-ar.json'));
const tenantId = process.env.RAG_EVAL_TENANT_ID || 'default';
const topK = 5;

function percentile(values, fraction) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function sourceOf(candidate) {
    return String(candidate?.source || candidate?.payload?.source || '');
}

async function main() {
    const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
    if (!Array.isArray(dataset) || !dataset.length) throw new Error('Evaluation dataset must be a non-empty array.');
    const { retrieveContextAsync } = require('../src/services/knowledge');
    const rows = [];

    for (const item of dataset) {
        const started = performance.now();
        const telemetry = {};
        let error = null;
        try {
            await retrieveContextAsync(item.query, null, { tenantId, telemetry });
        } catch (cause) {
            error = cause.code || cause.message;
        }
        const latencyMs = performance.now() - started;
        const candidates = (telemetry.profiling?.topChunks || []).slice(0, topK);
        const sources = candidates.map(sourceOf);
        const relevant = new Set(item.relevantSources || []);
        const firstRelevantIndex = sources.findIndex(source => relevant.has(source));
        const expectNoAnswer = item.expectNoAnswer === true || relevant.size === 0;
        rows.push({
            id: item.id,
            query: item.query,
            sources,
            recallAt5: expectNoAnswer ? null : firstRelevantIndex >= 0 ? 1 : 0,
            reciprocalRank: expectNoAnswer ? null : firstRelevantIndex >= 0 ? 1 / (firstRelevantIndex + 1) : 0,
            noAnswerCorrect: expectNoAnswer ? candidates.length === 0 : null,
            latencyMs: Number(latencyMs.toFixed(1)),
            retrievalMode: telemetry.mode || 'unknown',
            error
        });
    }

    const answerable = rows.filter(row => row.recallAt5 !== null);
    const noAnswer = rows.filter(row => row.noAnswerCorrect !== null);
    const latencies = rows.map(row => row.latencyMs);
    const summary = {
        dataset: path.relative(process.cwd(), datasetPath),
        tenantId,
        cases: rows.length,
        answerableCases: answerable.length,
        noAnswerCases: noAnswer.length,
        retrievalRecallAt5: answerable.reduce((sum, row) => sum + row.recallAt5, 0) / answerable.length,
        mrr: answerable.reduce((sum, row) => sum + row.reciprocalRank, 0) / answerable.length,
        noAnswerAccuracy: noAnswer.reduce((sum, row) => sum + Number(row.noAnswerCorrect), 0) / noAnswer.length,
        latencyMs: {
            mean: Number((latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(1)),
            p50: percentile(latencies, 0.5),
            p95: percentile(latencies, 0.95)
        },
        errors: rows.filter(row => row.error).length
    };
    process.stdout.write(`${JSON.stringify({ summary, rows }, null, 2)}\n`);
    if (summary.errors) process.exitCode = 2;
}

main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 2;
});
