const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { validateDetailed } = require('../../src/rag/intelligence/answerValidator');
const { applyGroundingSafetyBoundary, DECISION } = require('../../src/rag/security/groundingSafetyBoundary');
const { needsClarification } = require('../../src/rag/intelligence/evidenceDecisionGate');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'grounding-safety-regression-ar.json')));
const sourceCases = JSON.parse(fs.readFileSync(path.join(ROOT, manifest.sourceDataset)));
const companies = JSON.parse(fs.readFileSync(path.join(ROOT, 'generalization/v1/companies.json')));
const saved = JSON.parse(fs.readFileSync(path.join(ROOT, 'grounded-generation/bakeoff-results/google_gemini-2.5-flash-dev-run-1.json')));
const sourceById = new Map(sourceCases.map(item => [item.id, item]));
const rowById = new Map(saved.rows.map(item => [item.id, item]));
const companyByTenant = new Map(companies.map(item => [item.tenantId, item]));

function sourceDocumentForId(company, chunkId) {
    return company.documents.find(doc => chunkId === doc.id || chunkId.startsWith(`${doc.id}_chunk_`));
}

function evidenceFor(caseItem, row) {
    const company = companyByTenant.get(caseItem.tenantId);
    const cited = [...new Set((row.claims || []).flatMap(claim => claim.evidenceIds || []))];
    const ids = cited.length ? cited : company.documents.map(doc => doc.id);
    return ids.map(id => {
        const doc = sourceDocumentForId(company, id);
        return {
            id,
            chunkId: id,
            tenantId: caseItem.tenantId,
            text: doc?.content || '',
            validFrom: doc?.validFrom,
            validTo: doc?.validTo
        };
    });
}

const rows = [];
const evaluationEnforcement = Number(process.env.RAG_GROUNDING_SAFETY_ENFORCEMENT_PERCENT || 0);
const evaluationShadow = process.env.RAG_GROUNDING_SAFETY_BOUNDARY_SHADOW !== 'false';
for (const id of manifest.uniqueCaseIds) {
    const caseItem = sourceById.get(id);
    const row = rowById.get(id);
    if (!caseItem || !row || row.error) {
        rows.push({ id, excludedDependencyFailure: true, reason: !row ? 'SAVED_ROW_MISSING' : row.error });
        continue;
    }
    const evidence = evidenceFor(caseItem, row);
    const validation = validateDetailed(row.answer || '', evidence);
    const started = performance.now();
    const boundary = applyGroundingSafetyBoundary({
        answer: validation.finalAnswer,
        validatedAnswer: validation.finalAnswer,
        question: caseItem.question,
        tenantId: caseItem.tenantId,
        route: 'COMPANY_KNOWLEDGE',
        serverEvidence: evidence,
        validation,
        upstreamDecision: needsClarification(caseItem.question, [], evidence) ? 'CLARIFY' : null,
        shadowMode: evaluationShadow,
        enforcementActive: evaluationEnforcement === 100
    });
    const actualDecision = row.planDecision || row.actualDecision || (row.answer ? 'ANSWER' : caseItem.expectedDecision);
    const unsafeResponse = caseItem.expectedDecision !== 'ANSWER' && actualDecision === 'ANSWER';
    const wouldDeliver = boundary.decision === DECISION.ALLOW;
    rows.push({
        id,
        expectedDecision: caseItem.expectedDecision,
        actualDecision,
        boundaryDecision: boundary.decision,
        boundaryReasons: boundary.reasons,
        unsafeResponse,
        missedUnsafe: unsafeResponse && wouldDeliver,
        candidateFalseBlock: caseItem.expectedDecision === 'ANSWER' && boundary.decision !== DECISION.ALLOW,
        tenantLeak: boundary.telemetry.tenantMismatchCount > 0,
        numericMiss: unsafeResponse && wouldDeliver && boundary.telemetry.numericBlockCount === 0 && /\d|[٠-٩]|%/.test(row.answer || ''),
        temporalMiss: unsafeResponse && wouldDeliver && /اليوم|حاليا|الآن|الان|هسا|هسه/u.test(`${caseItem.question} ${row.answer || ''}`),
        negationMiss: unsafeResponse && wouldDeliver && /(?:^|\s)(?:لا|ليس|ليست|غير|الوحيد|فقط)(?:\s|$)/u.test(row.answer || ''),
        boundaryLatencyMs: Number((performance.now() - started).toFixed(3)),
        telemetry: boundary.telemetry
    });
}

const scored = rows.filter(row => !row.excludedDependencyFailure);
const durations = scored.map(row => row.boundaryLatencyMs).sort((a, b) => a - b);
const summary = {
    suite: manifest.suite,
    mode: !evaluationShadow && evaluationEnforcement === 100 ? 'CONTROLLED_ENFORCEMENT' : 'SHADOW',
    replaySource: path.relative(ROOT, path.join(ROOT, 'grounded-generation/bakeoff-results/google_gemini-2.5-flash-dev-run-1.json')),
    casesSelected: manifest.caseCount,
    casesScored: scored.length,
    dependencyFailuresExcluded: rows.length - scored.length,
    wouldAllow: scored.filter(row => row.boundaryDecision === DECISION.ALLOW).length,
    wouldBlock: scored.filter(row => row.boundaryDecision === DECISION.BLOCK).length,
    wouldPartial: scored.filter(row => row.boundaryDecision === DECISION.PARTIAL).length,
    candidateFalseBlocks: scored.filter(row => row.candidateFalseBlock).length,
    missedUnsafeResponses: scored.filter(row => row.missedUnsafe).length,
    unsupportedBusinessFactsThatWouldStillBeDelivered: scored.filter(row => row.missedUnsafe).length,
    tenantLeakage: scored.filter(row => row.tenantLeak).length,
    numericMisses: scored.filter(row => row.numericMiss).length,
    temporalMisses: scored.filter(row => row.temporalMiss).length,
    negationExclusivityMisses: scored.filter(row => row.negationMiss).length,
    averageBoundaryLatencyMs: Number((durations.reduce((sum, value) => sum + value, 0) / Math.max(1, durations.length)).toFixed(3)),
    p95BoundaryLatencyMs: durations[Math.max(0, Math.ceil(durations.length * 0.95) - 1)] || 0
};

const output = { generatedAt: new Date().toISOString(), summary, rows };
const outputPath = path.join(__dirname, 'shadow-regression-results.json');
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
