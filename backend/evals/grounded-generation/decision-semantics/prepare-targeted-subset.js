#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { normalizeBenchmarkDataset } = require('../benchmark-case-normalizer');

const DIR = __dirname;
const EVALS = path.resolve(DIR, '../..');
const sourcePath = path.join(EVALS, 'rag-generalization-dev-ar-v1.json');
const adjudicationPath = path.join(EVALS, 'grounded-generation/adjudication/label-adjudication.json');
const replayPath = path.join(EVALS, 'grounded-generation/adjudication/adjudicated-replay-results.json');
const outputPath = path.join(DIR, 'targeted-subset.json');

const source = normalizeBenchmarkDataset(JSON.parse(fs.readFileSync(sourcePath, 'utf8')));
const adjudications = JSON.parse(fs.readFileSync(adjudicationPath, 'utf8'));
const replay = JSON.parse(fs.readFileSync(replayPath, 'utf8'));
const adjudicationById = new Map(adjudications.map(item => [item.caseId, item]));

const cases = source.map(item => {
    const adjudication = adjudicationById.get(item.id);
    return {
        ...item,
        expectedDecision: adjudication?.adjudicatedDecision || item.expectedDecision,
        expectedFacts: adjudication?.adjudicatedExpectedFacts || item.expectedFacts
    };
});

const replayRows = new Map();
for (const row of replay.remainingRows) {
    if (!replayRows.has(row.caseId)) replayRows.set(row.caseId, []);
    replayRows.get(row.caseId).push(row);
}

const targetedFailureIds = new Set([
    'clinic-a-11',
    'electronics-n-01',
    'professional_services-n-03'
]);
const selected = [];
const add = (item, cohort) => {
    if (selected.some(entry => entry.id === item.id)) return;
    selected.push({ ...item, experimentCohort: cohort });
};

for (const item of cases.filter(item => item.expectedDecision === 'CLARIFY')) add(item, 'ALL_CLARIFY');
for (const id of targetedFailureIds) {
    const item = cases.find(candidate => candidate.id === id);
    if (!item) throw new Error(`MISSING_TARGET_FAILURE:${id}`);
    add(item, item.expectedDecision === 'ANSWER' ? 'GENUINE_FALSE_NO_ANSWER' : 'GENUINE_FALSE_ANSWER');
}

function isStableAdjudicatedPass(item) {
    if (replayRows.has(item.id)) return false;
    return true;
}

function addStratifiedControls(decision) {
    const domains = [...new Set(cases.map(item => item.domain))].sort();
    for (const domain of domains) {
        const candidates = cases.filter(item =>
            item.domain === domain &&
            item.expectedDecision === decision &&
            isStableAdjudicatedPass(item) &&
            !targetedFailureIds.has(item.id)
        );
        if (candidates.length < 2) throw new Error(`INSUFFICIENT_${decision}_CONTROLS:${domain}`);
        for (const item of candidates.slice(0, 2)) add(item, `${decision}_CONTROL`);
    }
}

addStratifiedControls('ANSWER');
addStratifiedControls('NO_ANSWER');

const expected = { ANSWER: 0, NO_ANSWER: 0, CLARIFY: 0 };
for (const item of selected) {
    if (!item.id || !item.tenantId || !item.question || !expected.hasOwnProperty(item.expectedDecision)) {
        throw new Error(`INVALID_SELECTED_CASE:${item.id || 'unknown'}`);
    }
    expected[item.expectedDecision] += 1;
}
if (expected.CLARIFY !== 15) throw new Error(`EXPECTED_15_CLARIFY_GOT_${expected.CLARIFY}`);
if (selected.filter(item => item.experimentCohort === 'ANSWER_CONTROL').length < 10) throw new Error('ANSWER_CONTROL_UNDERSIZED');
if (selected.filter(item => item.experimentCohort === 'NO_ANSWER_CONTROL').length < 10) throw new Error('NO_ANSWER_CONTROL_UNDERSIZED');

fs.writeFileSync(outputPath, `${JSON.stringify(selected, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, cases: selected.length, expected }, null, 2));
