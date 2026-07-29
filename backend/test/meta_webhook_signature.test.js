const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const dbPath = path.resolve(__dirname, '..', 'data', 'test_meta_webhook_signature.db');
process.env.SQLITE_DB_PATH = dbPath;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'meta_webhook_test_session_secret_32_chars';
process.env.META_APP_SECRET = 'meta-webhook-app-secret';
process.env.META_VERIFY_TOKEN = 'meta-webhook-verify-token';

for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(dbPath + suffix)) fs.unlinkSync(dbPath + suffix);
}

const db = require('../src/database/connection');
require('../src/database/initialize').initializeDatabase();
const app = require('../src/app');

function signature(payload, secret = process.env.META_APP_SECRET) {
    return `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
}

test('Meta webhook always fails closed and rejects replay', async (t) => {
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/webhook`;
    const payload = JSON.stringify({ object: 'page', entry: [] });

    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        db.close();
        for (const suffix of ['', '-wal', '-shm']) {
            if (fs.existsSync(dbPath + suffix)) fs.unlinkSync(dbPath + suffix);
        }
    });

    const send = (body, header) => fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(header ? { 'X-Hub-Signature-256': header } : {})
        },
        body
    });

    assert.strictEqual((await send(payload, signature(payload))).status, 200);
    assert.strictEqual((await send(payload, signature(payload))).status, 409);
    assert.strictEqual((await send(payload, `sha256=${'0'.repeat(64)}`)).status, 401);
    assert.strictEqual((await send(payload)).status, 401);

    const previous = process.env.META_APP_SECRET;
    delete process.env.META_APP_SECRET;
    try {
        const unique = JSON.stringify({ object: 'page', entry: [{ id: 'missing-secret' }] });
        assert.strictEqual((await send(unique, `sha256=${'2'.repeat(64)}`)).status, 503);
    } finally {
        process.env.META_APP_SECRET = previous;
    }

    const challenge = await fetch(
        `${url}?hub.mode=subscribe&hub.verify_token=meta-webhook-verify-token&hub.challenge=ok`
    );
    assert.strictEqual(challenge.status, 200);
    assert.strictEqual(await challenge.text(), 'ok');
});
