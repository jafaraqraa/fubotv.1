const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dbPath = path.resolve(__dirname, '..', 'data', 'test_meta_media_support.db');
process.env.SQLITE_DB_PATH = dbPath;
process.env.MESSENGER_ACCESS_TOKEN = 'messenger-test-token';
process.env.INSTAGRAM_ACCESS_TOKEN = 'instagram-test-token';
process.env.META_MAX_ATTEMPTS = '1';
for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(dbPath + suffix)) fs.unlinkSync(dbPath + suffix);
}

const db = require('../src/database/connection');
const { initializeDatabase } = require('../src/database/initialize');
initializeDatabase();
const mediaRepo = require('../src/database/repositories/mediaAttachmentRepository');
const { sendMetaMessage, splitMetaText } = require('../src/channels/meta');
const webhookRouter = require('../src/routes/webhooks');

const originalFetch = global.fetch;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'futh-meta-media-'));

function response(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body)
    };
}

function fixture(name, bytes) {
    const filePath = path.join(directory, name);
    fs.writeFileSync(filePath, bytes);
    return filePath;
}

const fixtures = {
    image: {
        localPath: fixture('image.png', Buffer.from('89504e470d0a1a0a00000000', 'hex')),
        originalName: 'image.png', mimeType: 'image/png', messageType: 'image'
    },
    video: {
        localPath: fixture('video.mp4', Buffer.from('00000018667479706d70343200000000', 'hex')),
        originalName: 'video.mp4', mimeType: 'video/mp4', messageType: 'video'
    },
    audio: {
        localPath: fixture('audio.mp3', Buffer.from('49443304000000000000', 'hex')),
        originalName: 'audio.mp3', mimeType: 'audio/mpeg', messageType: 'audio'
    },
    file: {
        localPath: fixture('document.pdf', Buffer.from('%PDF-1.4\n%%EOF')),
        originalName: 'document.pdf', mimeType: 'application/pdf', messageType: 'document'
    }
};

test('Messenger and Instagram media use attachment upload and real send responses', async t => {
    for (const [platform, types] of [
        ['messenger', ['image', 'video', 'audio', 'file']],
        ['instagram', ['image', 'video']]
    ]) {
        for (const type of types) {
            await t.test(`${platform} ${type}`, async () => {
                const calls = [];
                global.fetch = async (url, options) => {
                    calls.push({ url: String(url), options });
                    return String(url).includes('/message_attachments')
                        ? response(200, { attachment_id: `${platform}-${type}-attachment` })
                        : response(200, { message_id: `${platform}-${type}-message` });
                };
                const result = await sendMetaMessage('recipient', 'caption', platform, fixtures[type]);
                assert.equal(result.success, true);
                assert.equal(result.messageId, `${platform}-${type}-message`);
                assert.equal(result.attachmentId, `${platform}-${type}-attachment`);
                assert.equal(calls.length, 2);
                assert.ok(calls.every(call => call.url.startsWith(
                    platform === 'instagram'
                        ? 'https://graph.instagram.com/'
                        : 'https://graph.facebook.com/'
                )));
                assert.ok(calls[0].options.body instanceof FormData);
                const sent = JSON.parse(calls[1].options.body);
                assert.equal(sent.message.attachment.payload.attachment_id,
                    `${platform}-${type}-attachment`);
            });
        }
    }

    await t.test('Instagram audio is rejected before Graph API', async () => {
        let called = false;
        global.fetch = async () => {
            called = true;
            return response(200, {});
        };
        const result = await sendMetaMessage('recipient', '', 'instagram', fixtures.audio);
        assert.equal(result.success, false);
        assert.match(result.error, /does not support audio/);
        assert.equal(called, false);
    });

    await t.test('Instagram arbitrary files are rejected before Graph API', async () => {
        let called = false;
        global.fetch = async () => { called = true; return response(200, {}); };
        const result = await sendMetaMessage('recipient', '', 'instagram', fixtures.file);
        assert.equal(result.success, false);
        assert.match(result.error, /does not support file/);
        assert.equal(called, false);
    });

    await t.test('upload failure never proceeds to send', async () => {
        let calls = 0;
        global.fetch = async () => {
            calls += 1;
            return response(400, { error: { code: 100, message: 'invalid attachment' } });
        };
        const result = await sendMetaMessage('recipient', '', 'messenger', fixtures.image);
        assert.equal(result.success, false);
        assert.equal(result.metaErrorCode, 100);
        assert.equal(calls, 1);
    });

    await t.test('Instagram HTTPS share URL sends without binary upload', async () => {
        const calls = [];
        global.fetch = async (url, options) => {
            calls.push({ url: String(url), options });
            return response(200, { message_id: 'instagram-share-message' });
        };
        const result = await sendMetaMessage('recipient', '', 'instagram', {
            shareUrl: 'https://example.com/image.jpg',
            messageType: 'image'
        });
        assert.equal(result.success, true);
        assert.equal(calls.length, 1);
        const sent = JSON.parse(calls[0].options.body);
        assert.equal(sent.message.attachment.payload.url, 'https://example.com/image.jpg');
    });
});

test('media attachment persistence is tenant isolated', () => {
    db.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES ('tenant-b', 'Tenant B')`).run();
    const stored = mediaRepo.createAttachment({
        tenantId: 'default',
        channel: 'messenger',
        originalFilename: 'image.png',
        storedFilename: 'stored.png',
        storagePath: path.join(directory, 'stored.png'),
        mimeType: 'image/png',
        sizeBytes: 12,
        checksum: 'a'.repeat(64)
    });
    assert.equal(mediaRepo.getAttachment(stored.id, 'default').id, stored.id);
    assert.equal(mediaRepo.getAttachment(stored.id, 'tenant-b'), undefined);
    assert.throws(
        () => mediaRepo.updateAttachment(stored.id, 'tenant-b', { status: 'failed' }),
        /not found/
    );
});

test('Messenger text longer than 2000 characters is split into ordered valid messages', async () => {
    const longText = `${'كلمة '.repeat(700)}النهاية`;
    const expectedParts = splitMetaText(longText);
    const sentParts = [];
    global.fetch = async (_url, options) => {
        sentParts.push(JSON.parse(options.body).message.text);
        return response(200, { message_id: `part-${sentParts.length}` });
    };
    try {
        const result = await sendMetaMessage('recipient', longText, 'messenger');
        assert.equal(result.success, true);
        assert.ok(sentParts.length > 1);
        assert.deepEqual(sentParts, expectedParts);
        assert.ok(sentParts.every(part => Array.from(part).length <= 2000));
        assert.deepEqual(result.messageIds, sentParts.map((_, index) => `part-${index + 1}`));
        assert.equal(result.messageId, `part-${sentParts.length}`);
    } finally {
        global.fetch = originalFetch;
    }
});

test('Meta media downloader follows only trusted redirects', async () => {
    const calls = [];
    global.fetch = async url => {
        calls.push(String(url));
        if (calls.length === 1) {
            return {
                ok: false,
                status: 302,
                headers: new Headers({ location: 'https://cdn.fbsbx.com/media/audio.ogg' })
            };
        }
        return { ok: true, status: 200, headers: new Headers() };
    };
    try {
        const result = await webhookRouter.fetchMetaMedia('https://facebook.com/attachment/1');
        assert.equal(result.status, 200);
        assert.deepEqual(calls, [
            'https://facebook.com/attachment/1',
            'https://cdn.fbsbx.com/media/audio.ogg'
        ]);
        await assert.rejects(
            webhookRouter.fetchMetaMedia('https://example.com/not-meta'),
            /not trusted/
        );
    } finally {
        global.fetch = originalFetch;
    }
});

test.after(() => {
    global.fetch = originalFetch;
    fs.rmSync(directory, { recursive: true, force: true });
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
        if (fs.existsSync(dbPath + suffix)) fs.unlinkSync(dbPath + suffix);
    }
});
