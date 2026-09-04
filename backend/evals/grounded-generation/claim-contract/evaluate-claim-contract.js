#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const BACKEND = path.resolve(__dirname, '../../..');
const ROOT = path.resolve(__dirname, '..');
const RUN = Number(process.argv[2] || 1);
const MODEL = 'google/gemini-2.5-flash';
const CONCURRENCY = 4;

const explicitKey = process.env.OPENROUTER_API_KEY || '';
require('dotenv').config({ path: path.join(BACKEND, '.env') });

const db = require('../../../src/database/connection');
const { validateDetailed, STATUS } = require('../../../src/rag/intelligence/answerValidator');
const { OpenRouterEvaluationClient } = require('../openrouter-eval-client');
const { resolveOpenRouterEvaluationKey } = require('../openrouter-key-resolver');

const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, 'targeted-subset.json'), 'utf8'));
const contractSchema = JSON.parse(fs.readFileSync(path.join(__dirname, 'claim-contract-schema.json'), 'utf8'));
const verdictSchema = JSON.parse(fs.readFileSync(path.join(__dirname, 'support-verdict-schema.json'), 'utf8'));
const answerSchema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schema.json'), 'utf8'));
const contractInstructions = fs.readFileSync(path.join(__dirname, 'claim-contract-instructions.txt'), 'utf8');
const verdictInstructions = fs.readFileSync(path.join(__dirname, 'support-verdict-instructions.txt'), 'utf8');
const answerInstructions = fs.readFileSync(path.join(__dirname, 'final-generation-instructions.txt'), 'utf8');
const equivalents = JSON.parse(fs.readFileSync(path.join(ROOT, 'adjudication/semantic-equivalence-fixture.json'), 'utf8'));

const key = resolveOpenRouterEvaluationKey({ explicitEnvKey: explicitKey, db });
const clients = {
    contract: new OpenRouterEvaluationClient({ apiKey: key.key, model: MODEL, schema: contractSchema, structuredMode: 'native_json_schema' }),
    verdict: new OpenRouterEvaluationClient({ apiKey: key.key, model: MODEL, schema: verdictSchema, structuredMode: 'native_json_schema' }),
    answer: new OpenRouterEvaluationClient({ apiKey: key.key, model: MODEL, schema: answerSchema, structuredMode: 'native_json_schema' })
};

const normalize = value => String(value || '').normalize('NFKC').toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[^\p{L}\p{N}%]+/gu, ' ')
    .replace(/\s+/g, ' ').trim();
function lexicalMatch(answer, fact) {
    const a = normalize(answer); const f = normalize(fact);
    if (a.includes(f)) return true;
    const tokens = f.split(' ').filter(token => token.length > 1);
    return Boolean(tokens.length && tokens.filter(token => a.includes(token)).length / tokens.length >= 0.75);
}
function factMatches(id, answer, fact) {
    if (lexicalMatch(answer, fact)) return true;
    return equivalents.filter(item => item.caseId === id && item.expectedFact === fact)
        .some(item => item.acceptedSemanticForms.some(form => lexicalMatch(answer, form)));
}
function parseJson(raw) {
    try { return JSON.parse(String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()); }
    catch { return null; }
}
function validContract(value) {
    return value && ['RESOLVED', 'AMBIGUOUS'].includes(value.referentStatus)
        && (value.referent === null || typeof value.referent === 'string')
        && Array.isArray(value.requestedPropositions)
        && (value.clarificationQuestion === null || typeof value.clarificationQuestion === 'string')
        && value.requestedPropositions.every(item => item && typeof item.id === 'string'
            && typeof item.proposition === 'string' && typeof item.requiredForAnswer === 'boolean');
}
function validVerdicts(value, contract, evidenceIds) {
    if (!value || !Array.isArray(value.verdicts)) return false;
    const propositionIds = new Set(contract.requestedPropositions.map(item => item.id));
    return value.verdicts.length === contract.requestedPropositions.length
        && value.verdicts.every(item => propositionIds.has(item.propositionId)
            && ['SUPPORTED', 'CONTRADICTED', 'NOT_PROVEN'].includes(item.verdict)
            && Array.isArray(item.supportingEvidenceIds)
            && item.supportingEvidenceIds.every(id => evidenceIds.has(String(id)))
            && typeof item.reason === 'string');
}
function validAnswer(value) {
    return value && value.decision === 'ANSWER' && typeof value.answer === 'string'
        && Array.isArray(value.claims) && Array.isArray(value.missingInformation)
        && value.claims.every(claim => claim && typeof claim.text === 'string' && Array.isArray(claim.evidenceIds));
}
const evidenceBlock = evidence => evidence.map(item =>
    `<VERIFIED_EVIDENCE id="${item.id}">\n${item.text}\n</VERIFIED_EVIDENCE>`).join('\n');

async function evaluate(item) {
    const started = performance.now();
    const usage = { input: 0, output: 0, cost: 0, calls: 0 };
    const track = response => {
        usage.input += response.inputTokens; usage.output += response.outputTokens;
        usage.cost = response.cost === null || usage.cost === null ? null : usage.cost + response.cost;
        usage.calls += 1; return response;
    };
    try {
        const contractResponse = track(await clients.contract.generate([
            { role: 'system', content: contractInstructions },
            { role: 'user', content: `USER_QUESTION:\n${item.question}` }
        ]));
        const contract = parseJson(contractResponse.content);
        if (!validContract(contract)) throw Object.assign(new Error('MALFORMED_CLAIM_CONTRACT'), { stage: 'stage1' });

        let verdicts = null;
        let answerPlan = null;
        let decision;
        if (contract.referentStatus === 'AMBIGUOUS') {
            decision = 'CLARIFY';
        } else {
            const evidenceIds = new Set(item.evidence.map(entry => String(entry.id)));
            const verdictResponse = track(await clients.verdict.generate([
                { role: 'system', content: verdictInstructions },
                { role: 'user', content: `CLAIM_CONTRACT:\n${JSON.stringify(contract)}\n\nVERIFIED_EVIDENCE:\n${evidenceBlock(item.evidence)}` }
            ]));
            verdicts = parseJson(verdictResponse.content);
            if (!validVerdicts(verdicts, contract, evidenceIds)) throw Object.assign(new Error('MALFORMED_SUPPORT_VERDICT'), { stage: 'stage2' });
            decision = verdicts.verdicts.some(entry => entry.verdict !== 'NOT_PROVEN') ? 'ANSWER' : 'NO_ANSWER';
            if (decision === 'ANSWER') {
                const answerResponse = track(await clients.answer.generate([
                    { role: 'system', content: answerInstructions },
                    { role: 'user', content: `CLAIM_CONTRACT:\n${JSON.stringify(contract)}\n\nSUPPORT_VERDICTS:\n${JSON.stringify(verdicts)}\n\nVERIFIED_EVIDENCE:\n${evidenceBlock(item.evidence)}` }
                ]));
                answerPlan = parseJson(answerResponse.content);
                if (!validAnswer(answerPlan)) throw Object.assign(new Error('MALFORMED_FINAL_ANSWER'), { stage: 'generation' });
            }
        }

        const answer = decision === 'ANSWER' ? answerPlan.answer : '';
        const claims = decision === 'ANSWER' ? answerPlan.claims : [];
        const evidenceIds = new Set(item.evidence.map(entry => String(entry.id)));
        const hallucinatedEvidenceIds = claims.reduce((sum, claim) =>
            sum + claim.evidenceIds.filter(id => !evidenceIds.has(String(id))).length, 0);
        const validation = validateDetailed(answer, item.evidence.map(entry => ({
            id: entry.id, text: entry.text, score: entry.score, rerankerScore: entry.score
        })));
        const decisionCorrect = decision === item.expectedDecision;
        const factCorrect = item.expectedDecision !== 'ANSWER'
            || item.expectedFacts.every(fact => factMatches(item.id, answer, fact));
        return {
            id: item.id, tenantId: item.tenantId, domain: item.domain, question: item.question,
            cohort: item.experimentCohort, expectedDecision: item.expectedDecision,
            expectedFacts: item.expectedFacts, contract, verdicts, decision, answer, claims,
            clarificationQuestion: decision === 'CLARIFY' ? contract.clarificationQuestion : null,
            correct: decisionCorrect && factCorrect, decisionCorrect, factCorrect,
            validatorStatus: validation.overallStatus,
            validatorAccepted: decision !== 'ANSWER' || validation.overallStatus === STATUS.SUPPORTED,
            hallucinatedEvidenceIds, tenantLeaks: 0, usage,
            latencyMs: Number((performance.now() - started).toFixed(1)), error: null
        };
    } catch (error) {
        return {
            id: item.id, tenantId: item.tenantId, domain: item.domain, question: item.question,
            cohort: item.experimentCohort, expectedDecision: item.expectedDecision,
            latencyMs: Number((performance.now() - started).toFixed(1)), usage,
            error: { stage: error.stage || 'provider', name: error.name, status: error.status || null, message: String(error.message).slice(0, 300) }
        };
    }
}

async function mapConcurrent(items, limit) {
    const results = new Array(items.length); let next = 0; let done = 0;
    async function worker() {
        while (true) {
            const index = next++;
            if (index >= items.length) return;
            results[index] = await evaluate(items[index]); done += 1;
            if (done % 5 === 0 || done === items.length) console.log(JSON.stringify({ event: 'progress', run: RUN, done, errors: results.filter(Boolean).filter(row => row.error).length }));
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

(async () => {
    if (!Number.isInteger(RUN) || RUN < 1 || RUN > 3) throw new Error('INVALID_RUN');
    const rows = await mapConcurrent(dataset, CONCURRENCY);
    const result = {
        experiment: 'claim-contract', run: RUN, model: MODEL, structuredMode: 'native_json_schema',
        policy: 'safe_partial', keySource: key.source, keyFingerprint: key.fingerprint, rows
    };
    const outputDir = path.join(__dirname, 'results');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, `run-${RUN}.json`), `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify({ event: 'complete', run: RUN, cases: rows.length, errors: rows.filter(row => row.error).length }));
})().catch(error => { console.error(error); process.exitCode = 2; });
