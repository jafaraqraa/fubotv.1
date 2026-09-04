#!/usr/bin/env node
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const fs = require('node:fs');
const path = require('node:path');
const { getAIResponse } = require('../src/services/ai');
const { ARABIC_UNVERIFIED_MESSAGE } = require('../src/rag/intelligence/answerValidator');
const { ARABIC_CLARIFY_MESSAGE } = require('../src/rag/intelligence/evidenceDecisionGate');

const datasetPath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'evals', 'rag-production-ar.json'));
const tenantId = process.env.RAG_EVAL_TENANT_ID || 'default';

function normalizeForExpectedTerm(value) {
    return String(value || '').normalize('NFKC').toLowerCase()
        .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
        .replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
        .replace(/[^\p{L}\p{N}%]+/gu, ' ').replace(/\s+/g, ' ').trim()
        .split(' ').map(token => token.replace(/^ال(?=.{3})/, '').replace(/(?:ها|هم|كم|نا|ه|ك)$/u, ''))
        .join(' ');
}

async function main() {
    const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
    const rows = [];
    for (const item of dataset) {
        const started = performance.now();
        let answer = '';
        let error = null;
        const retrievalTelemetry = {};
        const decisionTelemetry = {};
        const validationTelemetry = {};
        const pipelineTelemetry = {};
        try {
            answer = await getAIResponse(`rag-eval-${item.id}`, item.query, 'text', null, {
                tenantId, channel: 'playground', knowledgeBaseOnly: true,
                retrievalTelemetry, decisionTelemetry, validationTelemetry, pipelineTelemetry
            });
        } catch (cause) {
            error = cause.code || cause.message;
        }
        const noAnswer = answer === ARABIC_UNVERIFIED_MESSAGE;
        const clarify = answer === ARABIC_CLARIFY_MESSAGE;
        const expectedDecision = item.expectedDecision
            || (item.expectNoAnswer ? 'NO_ANSWER' : 'ANSWER');
        const expectedTerms = item.expectedTerms || [];
        const normalizedAnswer = normalizeForExpectedTerm(answer);
        const answerCorrect = expectedDecision === 'NO_ANSWER' ? noAnswer
            : expectedDecision === 'CLARIFY' ? clarify
                : !noAnswer && !clarify && expectedTerms.every(term =>
                    normalizedAnswer.includes(normalizeForExpectedTerm(term))
                );
        rows.push({ id: item.id, expectedDecision, answerCorrect, noAnswer, clarify,
            answer, error, pipelineTelemetry, decisionTelemetry, validationTelemetry,
            retrieval: {
                mode: retrievalTelemetry.mode,
                metadata: retrievalTelemetry.metadata,
                topChunks: (retrievalTelemetry.profiling?.topChunks || []).map(chunk => ({
                    chunkId: chunk.chunkId || chunk.payload?.chunkId,
                    source: chunk.source || chunk.payload?.documentName,
                    tenantId: chunk.tenantId || chunk.payload?.tenantId,
                    score: chunk.finalScore ?? chunk.score ?? chunk.semanticScore
                }))
            },
            latencyMs: Number((performance.now() - started).toFixed(1)) });
    }
    const answerable = rows.filter(row => row.expectedDecision === 'ANSWER');
    const noAnswerRows = rows.filter(row => row.expectedDecision === 'NO_ANSWER');
    const clarifyRows = rows.filter(row => row.expectedDecision === 'CLARIFY');
    const incorrectUnsupported = rows.filter(row =>
        row.expectedDecision === 'NO_ANSWER' && !row.noAnswer && !row.clarify
    );
    const summary = {
        cases: rows.length,
        groundedAnswerAccuracy: answerable.filter(row => row.answerCorrect).length / answerable.length,
        noAnswerAccuracy: noAnswerRows.filter(row => row.answerCorrect).length / noAnswerRows.length,
        clarifyAccuracy: clarifyRows.filter(row => row.answerCorrect).length / clarifyRows.length,
        unsupportedClaimRate: incorrectUnsupported.length / rows.length,
        meanLatencyMs: Number((rows.reduce((sum, row) => sum + row.latencyMs, 0) / rows.length).toFixed(1)),
        errors: rows.filter(row => row.error).length
    };
    const output = `GENERATION_EVAL ${JSON.stringify({ summary, rows })}\n`;
    if (process.env.RAG_EVAL_OUTPUT_PATH) fs.writeFileSync(process.env.RAG_EVAL_OUTPUT_PATH, output);
    else process.stdout.write(output);
    if (summary.errors) process.exitCode = 2;
}
main().catch(error => { console.error(error); process.exitCode = 2; });
