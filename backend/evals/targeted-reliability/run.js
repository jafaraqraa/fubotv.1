// No outbound customer delivery. Run against an isolated SQLite snapshot.
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const root = __dirname;
const phase = process.argv[2];
if (!['before', 'after'].includes(phase)) throw new Error('Use before or after');
if (phase === 'after' && !fs.existsSync(path.resolve(root, '../../src/rag/intelligence/relationCoverage.js'))) {
    throw new Error('Candidate was rejected and rolled back; after replay is disabled. Do not deploy the archived patch.');
}
async function main() {
    const Database = require('better-sqlite3');
    const source = new Database(path.resolve(root, '../../data/app.db'), { readonly: true });
    const snapshot = path.join(root, `${phase}.sqlite`);
    if (fs.existsSync(snapshot)) throw new Error('Refusing to overwrite snapshot');
    await source.backup(snapshot);
    source.close();
    if (phase === 'after') {
        const db = new Database(snapshot);
        db.exec(fs.readFileSync(path.resolve(root, '../../src/database/migrations/033_rag_reliability_trace.sql'), 'utf8'));
        db.close();
    }
    process.env.SQLITE_DB_PATH = snapshot;
    const messages = require('../../src/database/repositories/messageRepository');
    let history = [];
    messages.getChatHistoryForAI = () => history;
    const { getAIResponse } = require('../../src/services/ai');
    const cases = require('./cases.json');
    const rows = [];
    for (const [suite, casesInSuite] of Object.entries(cases)) {
        if (!Array.isArray(casesInSuite)) continue;
        for (const [index, item] of casesInSuite.entries()) {
            const c = Array.isArray(item) ? { id: `smoke-${index + 1}`, question: item[0], expected: item[1] } : item;
            history = (c.history || []).map(content => ({ role: 'user', content }));
            const pipelineTelemetry = {}, decisionTelemetry = {}, retrievalTelemetry = {}, validationTelemetry = {};
            const start = Date.now();
            let answer, error;
            try {
                answer = await getAIResponse(`targeted-${phase}-${c.id}`, c.question, 'text', null, {
                    tenantId: 'default', channel: 'offline_evaluation',
                    pipelineTelemetry, decisionTelemetry, retrievalTelemetry, validationTelemetry
                });
            } catch (e) { error = { code: e.code, message: e.message }; }
            rows.push({ suite, ...c, answer, error, latencyMs: Date.now() - start,
                pipelineTelemetry, decisionTelemetry, retrievalTelemetry, validationTelemetry });
            fs.writeFileSync(path.join(root, `${phase}.json`), JSON.stringify({ phase, rows }, null, 2));
            console.log('EVAL_ROW', c.id, JSON.stringify(answer || error));
        }
    }
    require('../../src/database/connection').close();
}
main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
