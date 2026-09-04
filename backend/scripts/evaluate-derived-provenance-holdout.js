#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { validateDetailed } = require('../src/rag/intelligence/answerValidator');
const { evaluateGroundingSafety } = require('../src/rag/security/groundingSafetyBoundary');

const fixturePath = path.join(__dirname, '..', 'evals', 'derived-provenance-holdout-v1.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const rows = fixture.cases.map(item => {
    const evidence = item.evidence.map(entry => ({
        chunkId: entry.id, id: entry.id,
        tenantId: entry.tenantId || fixture.tenantId,
        text: entry.text, active: true
    }));
    const validation = validateDetailed(item.answer, evidence, {
        tenantId: fixture.tenantId, question: item.question
    });
    if (item.mutateEvidenceIds) validation.claims.forEach(claim => {
        claim.evidenceChunkIds = [...item.mutateEvidenceIds];
    });
    const boundary = evaluateGroundingSafety({
        tenantId: fixture.tenantId, route: 'COMPANY_KNOWLEDGE',
        question: item.question, answer: validation.finalAnswer,
        validatedAnswer: validation.finalAnswer,
        validation, serverEvidence: evidence
    });
    const evidenceIds = [...new Set(validation.claims.flatMap(claim => claim.evidenceChunkIds || []))].sort();
    const expectedIds = [...item.expectedEvidenceIds].sort();
    const correct = boundary.decision === item.expectedDecision
        && (item.expectedDecision !== 'ALLOW'
            || JSON.stringify(evidenceIds) === JSON.stringify(expectedIds));
    return { id: item.id, validation: validation.overallStatus,
        evidenceIds, boundary: boundary.decision, reasons: boundary.reasons, correct };
});
const result = { suite: fixture.suite, cases: rows.length,
    passed: rows.filter(row => row.correct).length,
    completeProvenanceRate: rows.filter(row => row.boundary === 'ALLOW').every(row => row.correct) ? 1 : 0,
    fakeEvidenceIdsAccepted: rows.filter(row => row.id === 'fake-id-negative' && row.boundary !== 'BLOCK').length,
    crossTenantAccepted: rows.filter(row => row.id === 'mixed-tenant-negative' && row.boundary !== 'BLOCK').length,
    rows };
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.passed === result.cases ? 0 : 1;
