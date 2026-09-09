'use strict';
// Synthetic conversations only; this does not create citizen records or send messages.
const fs = require('fs');
const path = require('path');
if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = fs.readFileSync(path.join(__dirname, '../data/.local-session-secret'), 'utf8').trim();
const { resolveSemanticContext } = require('../src/conversation/semanticContext');
const provider = require('../src/services/aiProviders').getAIProviderForTask('text_generation');
const cases = require('../test/municipal_context_cases.json');
(async () => {
    let failures = 0;
    for (const item of cases) {
        const result = await resolveSemanticContext(item.question, item.history.map(content => ({ role: 'user', content })), provider);
        const passed = item.clarify ? Boolean(result.clarification) : !result.clarification && result.question.includes(item.expected);
        console.log(JSON.stringify({ passed, input: item.question, result }));
        if (!passed) failures++;
    }
    process.exitCode = failures ? 1 : 0;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
