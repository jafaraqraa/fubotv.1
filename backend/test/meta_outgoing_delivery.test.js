const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const testDbPath = path.resolve(__dirname, '..', 'data', 'test_meta_outgoing_delivery.db');
process.env.SQLITE_DB_PATH = testDbPath;
process.env.MESSENGER_ACCESS_TOKEN = 'test-meta-token';
process.env.META_REQUEST_TIMEOUT_MS = '10';
for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
}

const db = require('../src/database/connection');
const { initializeDatabase } = require('../src/database/initialize');
initializeDatabase();
const { sendOutgoingMessage } = require('../src/messaging/outgoingMessageService');

const originalFetch = global.fetch;

function response(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body)
    };
}

function latestMessage(content) {
    return db.prepare(`
        SELECT delivery_status, external_message_id, metadata
        FROM messages
        WHERE content = ?
        ORDER BY created_at DESC, rowid DESC
        LIMIT 1
    `).get(content);
}

async function send(content) {
    return sendOutgoingMessage({
        channel: 'messenger',
        externalUserId: 'meta-test-recipient',
        senderType: 'agent',
        messageType: 'text',
        content
    });
}

test('Meta outgoing delivery states', async t => {
    await t.test('HTTP 200 stores sent with the real Meta message ID', async () => {
        global.fetch = async () => response(200, { recipient_id: 'recipient', message_id: 'mid.200' });
        const result = await send('case-200');
        const stored = latestMessage('case-200');
        assert.equal(result.success, true);
        assert.equal(result.externalMessageId, 'mid.200');
        assert.equal(stored.delivery_status, 'sent');
        assert.equal(stored.external_message_id, 'mid.200');
        assert.equal(JSON.parse(stored.metadata).httpStatus, 200);
    });

    await t.test('media response follows the same verified Meta result path', async () => {
        let requestBody;
        global.fetch = async (_url, options) => {
            requestBody = JSON.parse(options.body);
            return response(200, { recipient_id: 'recipient', message_id: 'mid.media' });
        };
        const result = await sendOutgoingMessage({
            channel: 'messenger',
            externalUserId: 'meta-test-recipient',
            senderType: 'agent',
            messageType: 'image',
            content: 'caption',
            media: { localPath: '/uploads/example.jpg' }
        });
        const stored = latestMessage('/uploads/example.jpg');
        assert.equal(result.success, true);
        assert.equal(stored.delivery_status, 'sent');
        assert.match(requestBody.message.text, /caption.*example\.jpg/);
    });

    for (const testCase of [
        { status: 400, code: 100, label: 'validation' },
        { status: 401, code: 190, label: 'authentication' },
        { status: 429, code: 4, label: 'rate-limit' },
        { status: 500, code: 2, label: 'server' }
    ]) {
        await t.test(`HTTP ${testCase.status} stores failed and preserves Meta error`, async () => {
            global.fetch = async () => response(testCase.status, {
                error: { message: `${testCase.label} error`, code: testCase.code }
            });
            const content = `case-${testCase.status}`;
            const result = await send(content);
            const stored = latestMessage(content);
            const metadata = JSON.parse(stored.metadata);
            assert.equal(result.success, false);
            assert.equal(result.statusCode, testCase.status);
            assert.equal(result.metaErrorCode, testCase.code);
            assert.equal(stored.delivery_status, 'failed');
            assert.equal(stored.external_message_id, null);
            assert.equal(metadata.httpStatus, testCase.status);
            assert.equal(metadata.metaErrorCode, testCase.code);
            assert.equal(metadata.metaErrorMessage, `${testCase.label} error`);
        });
    }

    await t.test('network timeout stores failed, never sent', async () => {
        global.fetch = (_url, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => {
                const error = new Error('aborted');
                error.name = 'AbortError';
                reject(error);
            });
        });
        const result = await send('case-timeout');
        const stored = latestMessage('case-timeout');
        assert.equal(result.success, false);
        assert.match(result.error, /timed out/);
        assert.equal(stored.delivery_status, 'failed');
        assert.equal(stored.external_message_id, null);
    });

    const failedStoredAsSent = db.prepare(`
        SELECT COUNT(*) AS count
        FROM messages
        WHERE content LIKE 'case-%' AND content != 'case-200' AND delivery_status = 'sent'
    `).get();
    assert.equal(failedStoredAsSent.count, 0);
});

test.after(() => {
    global.fetch = originalFetch;
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
        if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
});
