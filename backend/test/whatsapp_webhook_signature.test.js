const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const testDbPath = path.resolve(__dirname, '..', 'data', 'test_whatsapp_webhook_signature.db');
process.env.SQLITE_DB_PATH = testDbPath;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test_whatsapp_webhook_session_secret';
process.env.WHATSAPP_APP_SECRET = 'test_whatsapp_meta_app_secret';
process.env.WHATSAPP_VERIFY_SIGNATURE = 'true';

for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
}

const db = require('../src/database/connection');
const { initializeDatabase } = require('../src/database/initialize');
initializeDatabase();

db.prepare(`
    INSERT INTO whatsapp_tenant_configs (tenant_id, provider_type, config_json, enabled)
    VALUES (?, 'cloud', ?, 1)
`).run('signature-test', JSON.stringify({
    verifyToken: 'verify-token',
    accessToken: 'test-access-token',
    phoneNumberId: 'test-phone-id'
}));

const app = require('../src/app');

function sign(payload) {
    return `sha256=${crypto
        .createHmac('sha256', process.env.WHATSAPP_APP_SECRET)
        .update(Buffer.from(payload))
        .digest('hex')}`;
}

test('WhatsApp Cloud webhook signature verification', async (t) => {
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const webhookUrl = `http://127.0.0.1:${port}/whatsapp/signature-test`;
    const payload = JSON.stringify({
        object: 'whatsapp_business_account',
        entry: []
    });

    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        db.close();
        for (const suffix of ['', '-wal', '-shm']) {
            if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
        }
    });

    await t.test('valid signature returns 200', async () => {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Hub-Signature-256': sign(payload)
            },
            body: payload
        });
        assert.strictEqual(response.status, 200);
    });

    await t.test('invalid signature returns 401', async () => {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Hub-Signature-256': `sha256=${'0'.repeat(64)}`
            },
            body: payload
        });
        assert.strictEqual(response.status, 401);
    });

    await t.test('missing signature returns 401', async () => {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload
        });
        assert.strictEqual(response.status, 401);
    });

    await t.test('tampered payload returns 401', async () => {
        const tamperedPayload = JSON.stringify({
            object: 'whatsapp_business_account',
            entry: [{ id: 'tampered' }]
        });
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Hub-Signature-256': sign(payload)
            },
            body: tamperedPayload
        });
        assert.strictEqual(response.status, 401);
    });

    await t.test('existing GET challenge verification still works', async () => {
        const response = await fetch(
            `${webhookUrl}?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=challenge-ok`
        );
        assert.strictEqual(response.status, 200);
        assert.strictEqual(await response.text(), 'challenge-ok');
    });
});
