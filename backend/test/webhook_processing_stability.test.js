const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const express = require('express');

const dbPath = path.join(__dirname, '..', 'data', 'test_webhook_processing_stability.db');
process.env.SQLITE_DB_PATH = dbPath;
process.env.META_APP_SECRET = 'phase3-meta-signing-secret';
process.env.SESSION_SECRET = 'phase3_runtime_session_secret_32_chars';
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });

const { initializeDatabase } = require('../src/database/initialize');
const db = require('../src/database/connection');
initializeDatabase();

const processorPath = require.resolve('../src/messaging/messageProcessor');
const originalProcessor = require(processorPath);
let processCalls = 0;
require.cache[processorPath].exports = {
    ...originalProcessor,
    processIncomingMessage: async () => {
        processCalls += 1;
        return { status: 'failed', error: 'durable persistence failed' };
    }
};
delete require.cache[require.resolve('../src/routes/webhooks')];
const webhookRouter = require('../src/routes/webhooks');

function signature(payload) {
    return `sha256=${crypto.createHmac('sha256', process.env.META_APP_SECRET).update(payload).digest('hex')}`;
}

test('failed webhook work returns 500 and releases replay reservation for retry', async (t) => {
    const app = express();
    app.use(express.json({ verify: (req, _res, buffer) => { req.rawBody = buffer; } }));
    app.use(webhookRouter);
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
        require.cache[processorPath].exports = originalProcessor;
        await new Promise(resolve => server.close(resolve));
        db.close();
        for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
    });

    const payload = JSON.stringify({
        object: 'page',
        entry: [{
            messaging: [
                { sender: { id: 'sender-a' }, message: { text: 'one' } },
                { sender: { id: 'sender-b' }, message: { text: 'two' } }
            ]
        }]
    });
    const url = `http://127.0.0.1:${server.address().port}/webhook`;
    const send = () => fetch(url, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-hub-signature-256': signature(payload)
        },
        body: payload
    });

    assert.equal((await send()).status, 500);
    assert.equal((await send()).status, 500, 'retry must be processed, not rejected as replay');
    assert.equal(processCalls, 2);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM webhook_replay_guard').get().count, 0);
});
