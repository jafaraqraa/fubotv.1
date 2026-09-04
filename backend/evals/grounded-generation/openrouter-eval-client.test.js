'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { OpenRouterEvaluationClient } = require('./openrouter-eval-client');
const schema = require('./schema.json');

function client(mode = 'native_json_schema') {
    return new OpenRouterEvaluationClient({ apiKey: 'test-key', model: 'vendor/model', schema, structuredMode: mode });
}

test('native mode sends strict schema without exposing the API key in payload', async t => {
    const original = global.fetch; let request;
    global.fetch = async (_url, options) => {
        request = options;
        return new Response(JSON.stringify({ id: 'g1', model: 'vendor/model', choices: [{ message: { content: '{"decision":"NO_ANSWER","answer":"","claims":[],"missingInformation":[],"clarificationQuestion":null}' } }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    t.after(() => { global.fetch = original; });
    const result = await client().generate([{ role: 'user', content: 'سؤال' }]);
    const body = JSON.parse(request.body);
    assert.equal(body.response_format.type, 'json_schema');
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.provider.require_parameters, true);
    assert.equal(request.body.includes('test-key'), false);
    assert.equal(result.inputTokens, 10);
    assert.equal(result.cost, 0.001);
});

for (const status of [401, 402, 429, 503]) {
    test(`status ${status} is a fatal provider error`, async t => {
        const original = global.fetch;
        global.fetch = async () => new Response(JSON.stringify({ error: { message: 'provider failure' } }), { status, headers: { 'content-type': 'application/json' } });
        t.after(() => { global.fetch = original; });
        await assert.rejects(client().generate([]), error => error.fatal === true && error.status === status);
    });
}

test('empty and malformed provider responses fail instead of becoming accuracy failures', async t => {
    const original = global.fetch;
    global.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '' } }], usage: { prompt_tokens: 1, completion_tokens: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    t.after(() => { global.fetch = original; });
    await assert.rejects(client().generate([]), /OPENROUTER_EMPTY_RESPONSE/);
});

test('provider errors redact a full API key even if upstream echoes it', async t => {
    const original = global.fetch; const secret = 'test-key';
    global.fetch = async () => new Response(JSON.stringify({ error: { message: `invalid ${secret}` } }), { status: 401, headers: { 'content-type': 'application/json' } });
    t.after(() => { global.fetch = original; });
    await assert.rejects(client().generate([]), error => !error.message.includes(secret) && error.message.includes('[REDACTED]'));
});
