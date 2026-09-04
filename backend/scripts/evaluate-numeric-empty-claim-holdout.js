#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { validateDetailed, STATUS } = require('../src/rag/intelligence/answerValidator');
const { evaluateGroundingSafety } = require('../src/rag/security/groundingSafetyBoundary');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'evals', 'numeric-empty-claim-holdout-v1.json'), 'utf8'));
const rows = fixture.cases.map(item => {
    const evidence = item.evidence.map(entry => ({ id: entry.id, chunkId: entry.id,
        tenantId: entry.tenantId || fixture.tenantId, text: entry.text, active: true }));
    let validation;
    if (item.mode === 'VALIDATE') {
        validation = validateDetailed(item.answer, evidence, { tenantId: fixture.tenantId, question: item.question });
    } else if (item.mode === 'FOREIGN_CLAIM') {
        validation = { claims: [{ text: item.answer, sourceText: item.answer,
            propositionText: item.answer, factual: true, classification: STATUS.SUPPORTED,
            finalClassification: STATUS.SUPPORTED, evidenceChunkIds: [evidence[0].id],
            numericResult: { relation: 'ENTAILED', claimQuantities: [{ value: 90, unit: 'ILS' }] } }] };
    } else {
        validation = { claims: [] };
    }
    const boundary = evaluateGroundingSafety({ tenantId: fixture.tenantId, route: item.route,
        question: item.question, answer: item.answer, validatedAnswer: item.answer,
        serverEvidence: evidence, validation });
    return { id: item.id, validation: validation.overallStatus || 'NOT_APPLICABLE',
        boundary: boundary.decision, reasons: boundary.reasons,
        evidenceIds: [...new Set((validation.claims || []).flatMap(claim => claim.evidenceChunkIds || []))],
        correct: boundary.decision === item.expectedDecision };
});
const result = { suite: fixture.suite, cases: rows.length,
    passed: rows.filter(row => row.correct).length,
    accuracy: rows.filter(row => row.correct).length / rows.length,
    unsupportedDelivered: rows.filter(row => !row.correct && row.boundary === 'ALLOW').length,
    crossTenantDelivered: rows.filter(row => row.id === 'mixed-owner-unsafe' && row.boundary === 'ALLOW').length,
    rows };
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.passed === result.cases ? 0 : 1;
