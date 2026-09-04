#!/usr/bin/env node
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

process.env.SQLITE_DB_PATH = process.env.GENERALIZATION_SQLITE_DB_PATH
    || path.join(os.tmpdir(), 'fubot-generalization-v1.sqlite');
process.env.QDRANT_COLLECTION = process.env.GENERALIZATION_QDRANT_COLLECTION
    || 'fubot_generalization_v1';
process.env.RAG_EVIDENCE_GATE_ENABLED = 'true';

const { performance } = require('node:perf_hooks');
const { initializeDatabase } = require('../src/database/initialize');
const db = require('../src/database/connection');
const { chunkDocument } = require('../src/rag/processing/documentChunker');
const { generateEmbeddings } = require('../src/rag/embeddings/ollamaEmbeddingProvider');
const { initCollection, upsertVectors } = require('../src/rag/vector/qdrantVectorStore');
const { retrieveContextAsync } = require('../src/services/knowledge');
const { getAIResponse } = require('../src/services/ai');
const { saveMessage } = require('../src/database/repositories/messageRepository');
const { ARABIC_UNVERIFIED_MESSAGE } = require('../src/rag/intelligence/answerValidator');
const { ARABIC_CLARIFY_MESSAGE } = require('../src/rag/intelligence/evidenceDecisionGate');
const { getConfig } = require('../src/rag/config/ragConfig');

const evalDir = path.join(__dirname, '..', 'evals');
const companiesPath = path.join(evalDir, 'generalization', 'v1', 'companies.json');
const command = process.argv[2] || 'retrieval';
const split = process.argv[3] || 'dev';
const evaluationRunId = process.env.GENERALIZATION_RUN_ID
    || `${Date.now()}-${process.pid}`;
const datasetPath = path.join(evalDir, `rag-generalization-${split}-ar-v1.json`);
const fixturePath = process.env.GENERALIZATION_FIXTURE_PATH
    ? path.resolve(process.env.GENERALIZATION_FIXTURE_PATH) : null;
function loadEvaluationInputs() {
    if (fixturePath) {
        const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
        if (!Array.isArray(fixture.companies) || !Array.isArray(fixture.cases)) {
            throw new Error('Combined fixture must contain companies[] and cases[]');
        }
        return { companies: fixture.companies, cases: fixture.cases };
    }
    return {
        companies: JSON.parse(fs.readFileSync(companiesPath, 'utf8')),
        cases: JSON.parse(fs.readFileSync(datasetPath, 'utf8'))
    };
}
function emit(label, result) {
    const line = `${label} ${JSON.stringify(result)}\n`;
    if (process.env.GENERALIZATION_OUTPUT_PATH) fs.writeFileSync(process.env.GENERALIZATION_OUTPUT_PATH, line);
    else process.stdout.write(line);
}

const percentile = (values, p) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a,b)=>a-b);
    return sorted[Math.ceil((p / 100) * sorted.length) - 1];
};
const ratio = (n,d) => d ? Number((n/d).toFixed(4)) : null;
const CLOCK_WORD_VALUES = new Map([
    ['الواحده', 1], ['الثانيه', 2], ['الثالثه', 3], ['الرابعه', 4],
    ['الخامسه', 5], ['السادسه', 6], ['السابعه', 7], ['الثامنه', 8],
    ['التاسعه', 9], ['العاشره', 10], ['الحاديه عشره', 11], ['الثانيه عشره', 12]
]);
const normalizeClockWords = value => {
    let output = value;
    for (const [word, hour] of [...CLOCK_WORD_VALUES].sort((a, b) => b[0].length - a[0].length)) {
        output = output.replace(new RegExp(`${word}\\s+والنصف`, 'gu'), `${hour} 30`)
            .replace(new RegExp(word, 'gu'), String(hour));
    }
    return output;
};
const normalize = value => normalizeClockWords(String(value || '').normalize('NFKC').toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[إأآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه'))
    .replace(/لا\s+يمكن\s+ارجاع(?:ها|ه)/g, 'لا ترد')
    .replace(/(?:شيكلا|شيقل|ils)/gi, 'شيكل')
    .replace(/[^\p{L}\p{N}%]+/gu,' ').replace(/\s+/g,' ').trim();
const factMatches = (answer, fact) => {
    const a = normalize(answer); const f = normalize(fact);
    if (a.includes(f)) return true;
    const canonicalToken = token => {
        let value = token.replace(/^(?:لل|بال|وال|ال)/u, '');
        const feminineAdjective = value.match(/^([\u0621-\u064A])([\u0621-\u064A])([\u0621-\u064A])اء$/u);
        if (feminineAdjective) value = `ا${feminineAdjective[1]}${feminineAdjective[2]}${feminineAdjective[3]}`;
        return value;
    };
    const answerTokens = new Set(a.split(' ').filter(x=>x.length>1).map(canonicalToken));
    const tokens = f.split(' ').filter(x=>x.length>1).map(canonicalToken);
    return tokens.length > 0
        && tokens.filter(token => answerTokens.has(token)).length / tokens.length >= 0.75;
};
const answerMatchesExpectedFacts = (answer, facts = []) => {
    const ordinaryFacts = facts.filter(fact => !/(?:القائمه\s+(?:الكامله|الشامله)|complete\s+list)/iu.test(normalize(fact)));
    if (!ordinaryFacts.every(fact => factMatches(answer, fact))) return false;
    if (ordinaryFacts.length === facts.length) return true;
    const normalizedAnswer = normalize(answer);
    return /(?:فقط|كل|جميع|القائمه\s+(?:الكامله|الشامله))/u.test(normalizedAnswer)
        || /(?:الحاليه|المتاحه|المتوفره)\s+(?:هي|:)/u.test(normalizedAnswer);
};

async function setup() {
    initializeDatabase();
    const { companies } = loadEvaluationInputs();
    const info = db.pragma("table_info('tenants')");
    const cols = new Set(info.map(x=>x.name));
    for (const company of companies) {
        const fields = ['id']; const values = [company.tenantId];
        if (cols.has('name')) { fields.push('name'); values.push(company.company); }
        const q = `INSERT OR IGNORE INTO tenants (${fields.join(',')}) VALUES (${fields.map(()=>'?').join(',')})`;
        db.prepare(q).run(...values);
    }
    await initCollection(Number(process.env.RAG_EMBEDDING_DIMENSION) || 768);
    let chunksCount = 0;
    for (const company of companies) for (const doc of company.documents) {
        const chunks = chunkDocument({ documentId:doc.id, source:doc.id,
            sourceType:'uploaded_document', originalText:doc.content,
            documentHash:doc.id, ingestionVersion:'generalization-v1' }, 800, 120)
            .map(chunk=>({ ...chunk, tenantId:company.tenantId, documentName:doc.id,
                embeddingModel:getConfig('RAG_EMBEDDING_MODEL'), vectorDimension:768, lifecycle:'active',
                active:doc.active !== false, validFrom:doc.validFrom || null, validTo:doc.validTo || null }));
        const vectors = await generateEmbeddings(chunks.map(x=>x.text));
        await upsertVectors(chunks, vectors);
        chunksCount += chunks.length;
    }
    console.log(`GENERALIZATION_SETUP ${JSON.stringify({companies:companies.length,documents:companies.reduce((sum, company) => sum + company.documents.length, 0),chunks:chunksCount,collection:process.env.QDRANT_COLLECTION,database:process.env.SQLITE_DB_PATH})}`);
}

function importGenerationConfig() {
    const source = process.env.GENERALIZATION_CONFIG_DB;
    if (!source) return;
    db.prepare('ATTACH DATABASE ? AS production_config').run(path.resolve(source));
    try {
        db.exec(`DELETE FROM ai_task_configs;
            INSERT INTO ai_task_configs SELECT * FROM production_config.ai_task_configs;
            DELETE FROM api_keys;
            INSERT INTO api_keys SELECT * FROM production_config.api_keys;`);
    } finally { db.exec('DETACH DATABASE production_config'); }
}

function summarize(rows) {
    const answer = rows.filter(x=>x.expectedDecision==='ANSWER');
    const no = rows.filter(x=>x.expectedDecision==='NO_ANSWER');
    const clarify = rows.filter(x=>x.expectedDecision==='CLARIFY');
    const latencies = rows.map(x=>x.latencyMs);
    return { cases:rows.length, answerAccuracy:ratio(answer.filter(x=>x.correct).length,answer.length),
        noAnswerAccuracy:ratio(no.filter(x=>x.correct).length,no.length),
        clarifyAccuracy:ratio(clarify.filter(x=>x.correct).length,clarify.length),
        unsupportedOutputRate:ratio(no.filter(x=>x.decision==='ANSWER').length,rows.length),
        meanLatencyMs:Number((latencies.reduce((a,b)=>a+b,0)/latencies.length).toFixed(1)),
        p50LatencyMs:percentile(latencies,50),p95LatencyMs:percentile(latencies,95),
        tenantLeaks:rows.reduce((n,x)=>n+(x.tenantLeaks||0),0), errors:rows.filter(x=>x.error).length };
}

function breakdown(rows, field) {
    const keys = field==='company' ? [...new Set(rows.map(x=>x.company))] : [...new Set(rows.flatMap(x=>x.tags))];
    return Object.fromEntries(keys.sort().map(key=>{
        const selected = rows.filter(x=>field==='company' ? x.company===key : x.tags.includes(key));
        return [key, summarize(selected)];
    }));
}

async function retrieval() {
    const data = loadEvaluationInputs().cases; const rows=[];
    for (const item of data) {
        const telemetry={}; const started=performance.now(); let error=null;
        try { await retrieveContextAsync(item.question,null,{tenantId:item.tenantId,telemetry}); }
        catch(e){ error=e.code||e.message; }
        const chunks=(telemetry.profiling?.topChunks||[]).map(c=>({source:c.source||c.documentName||c.payload?.source||c.payload?.documentName,tenantId:c.tenantId||c.payload?.tenantId,score:c.finalScore??c.score}));
        const ranks=item.expectedEvidenceIds.map(id=>chunks.findIndex(c=>c.source===id)+1).filter(Boolean);
        rows.push({...item,error,chunks,rank:ranks.length?Math.min(...ranks):null,
            tenantLeaks:chunks.filter(c=>c.tenantId&&c.tenantId!==item.tenantId).length,
            latencyMs:Number((performance.now()-started).toFixed(1))});
    }
    const answer=rows.filter(x=>x.expectedDecision==='ANSWER');
    const summary={cases:rows.length,answerCases:answer.length,recallAt1:ratio(answer.filter(x=>x.rank===1).length,answer.length),
        recallAt5:ratio(answer.filter(x=>x.rank&&x.rank<=5).length,answer.length),
        mrr:Number((answer.reduce((n,x)=>n+(x.rank?1/x.rank:0),0)/answer.length).toFixed(4)),
        meanLatencyMs:Number((rows.reduce((n,x)=>n+x.latencyMs,0)/rows.length).toFixed(1)),
        p50LatencyMs:percentile(rows.map(x=>x.latencyMs),50),p95LatencyMs:percentile(rows.map(x=>x.latencyMs),95),
        tenantLeaks:rows.reduce((n,x)=>n+x.tenantLeaks,0),errors:rows.filter(x=>x.error).length};
    emit('GENERALIZATION_RETRIEVAL',{split,summary,byCompany:breakdown(rows,'company'),byTag:breakdown(rows,'tag'),rows});
}

async function generation() {
    initializeDatabase();
    importGenerationConfig();
    const data=loadEvaluationInputs().cases; const rows=[];
    for (const item of data) {
        const retrievalTelemetry={},decisionTelemetry={},validationTelemetry={},pipelineTelemetry={}; const started=performance.now(); let answer='',error=null;
        // Each benchmark execution must have fresh conversation identity. Reusing
        // case IDs can pull historical messages into later companies/runs and makes
        // the result neither isolated nor reproducible.
        const conversationId = `generalization-${split}-${evaluationRunId}-${item.id}`;
        try {
            for (const message of item.history || []) {
                saveMessage(conversationId, message.role === 'assistant' ? 'ai' : 'user', message.content,
                    'text', false, null, { tenantId: item.tenantId, channel: 'playground' });
            }
            answer=await getAIResponse(conversationId,item.question,'text',null,{tenantId:item.tenantId,channel:'playground',knowledgeBaseOnly:true,retrievalTelemetry,decisionTelemetry,validationTelemetry,pipelineTelemetry});
        }
        catch(e){error=e.code||e.message;}
        const decision=(decisionTelemetry.decision==='CLARIFY'
                || pipelineTelemetry.gateDecision==='CLARIFY')
            ? 'CLARIFY'
            : (answer===ARABIC_UNVERIFIED_MESSAGE || answer==='NO_ANSWER')
                ? 'NO_ANSWER'
                : 'ANSWER';
        const correct=item.expectedDecision===decision && (decision!=='ANSWER'||answerMatchesExpectedFacts(answer,item.expectedFacts));
        const chunks=(retrievalTelemetry.profiling?.topChunks||[]).map(c=>({source:c.source||c.documentName||c.payload?.source,tenantId:c.tenantId||c.payload?.tenantId,score:c.finalScore??c.score}));
        rows.push({...item,answer,decision,correct,error,pipelineTelemetry,retrievalTelemetry:{mode:retrievalTelemetry.mode,metadata:retrievalTelemetry.metadata,topChunks:chunks},decisionTelemetry,validationTelemetry,tenantLeaks:chunks.filter(c=>c.tenantId&&c.tenantId!==item.tenantId).length,latencyMs:Number((performance.now()-started).toFixed(1))});
    }
    emit('GENERALIZATION_GENERATION',{split,summary:summarize(rows),byCompany:breakdown(rows,'company'),byTag:breakdown(rows,'tag'),rows});
}

if (require.main === module) {
    ({setup,retrieval,generation}[command]||(()=>{throw Error(`Unknown command ${command}`);}))()
        .catch(e=>{console.error(e);process.exitCode=2;});
}

module.exports = { normalize, factMatches, answerMatchesExpectedFacts, summarize, setup, retrieval, generation };
