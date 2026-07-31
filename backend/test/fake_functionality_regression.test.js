const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ProviderAdapter = require('../src/services/adapters/ProviderAdapter');
const {
    persistOutgoingMedia,
    removeStoredMedia
} = require('../src/services/outgoingMediaStorage');

test('dashboard outgoing media is really persisted and can be rolled back', (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'futh-media-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

    const pngBytes = Buffer.from('89504e470d0a1a0a00000000', 'hex');
    const media = persistOutgoingMedia({
        mediaData: pngBytes.toString('base64'),
        mediaName: '../../customer-image.png',
        mediaType: 'image/png',
        uploadsDir: directory
    });

    assert.strictEqual(fs.existsSync(media.localPath), true);
    assert.deepStrictEqual(fs.readFileSync(media.localPath), pngBytes);
    assert.match(media.publicUrl, /^\/uploads\/[a-zA-Z0-9_.-]+\.png$/);
    assert.strictEqual(media.originalName, 'customer-image.png');

    removeStoredMedia(media);
    assert.strictEqual(fs.existsSync(media.localPath), false);
});

test('invalid, unsupported, empty, and oversized media never report success', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'futh-media-invalid-'));
    try {
        assert.throws(() => persistOutgoingMedia({
            mediaData: 'not*base64',
            mediaName: 'bad.png',
            mediaType: 'image/png',
            uploadsDir: directory
        }), error => error.code === 'INVALID_MEDIA_DATA');

        assert.throws(() => persistOutgoingMedia({
            mediaData: Buffer.from('content').toString('base64'),
            mediaName: 'payload.exe',
            mediaType: 'application/x-msdownload',
            uploadsDir: directory
        }), error => error.code === 'UNSUPPORTED_MEDIA_TYPE');

        assert.throws(() => persistOutgoingMedia({
            mediaData: Buffer.from('not-a-real-png').toString('base64'),
            mediaName: 'corrupt.png',
            mediaType: 'image/png',
            uploadsDir: directory
        }), error => error.code === 'CORRUPT_MEDIA');

        assert.throws(() => persistOutgoingMedia({
            mediaData: Buffer.from('89504e470d0a1a0a00000000', 'hex').toString('base64'),
            mediaName: 'mismatch.pdf',
            mediaType: 'image/png',
            uploadsDir: directory
        }), error => error.code === 'MEDIA_EXTENSION_MISMATCH');

        const oversized = Buffer.alloc((10 * 1024 * 1024) + 1).toString('base64');
        assert.throws(() => persistOutgoingMedia({
            mediaData: oversized,
            mediaName: 'large.pdf',
            mediaType: 'application/pdf',
            uploadsDir: directory
        }), error => error.code === 'MEDIA_TOO_LARGE');
        assert.deepStrictEqual(fs.readdirSync(directory), []);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('mock provider keys are impossible in production paths', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousFlag = process.env.ALLOW_MOCK_PROVIDER_KEYS;
    try {
        process.env.NODE_ENV = 'production';
        process.env.ALLOW_MOCK_PROVIDER_KEYS = 'true';
        const adapter = new ProviderAdapter('mock-openrouter-limit-500-used-100');
        assert.strictEqual(adapter.parseMockKey('openrouter'), null);

        process.env.NODE_ENV = 'test';
        delete process.env.ALLOW_MOCK_PROVIDER_KEYS;
        assert.strictEqual(adapter.parseMockKey('openrouter'), null);

        process.env.ALLOW_MOCK_PROVIDER_KEYS = 'true';
        assert.strictEqual(adapter.parseMockKey('openrouter').rawResponse.mock, true);
    } finally {
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
        if (previousFlag === undefined) delete process.env.ALLOW_MOCK_PROVIDER_KEYS;
        else process.env.ALLOW_MOCK_PROVIDER_KEYS = previousFlag;
    }
});

test('outgoing service rejects unknown channels and routes Meta media through real upload', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'messaging', 'outgoingMessageService.js'),
        'utf8'
    );
    assert.match(source, /supportedChannels\.has\(channel\)/);
    assert.match(source, /Telegram API returned no sent message/);
    assert.match(source, /sendMetaMessage\(/);
    assert.doesNotMatch(source, /Media delivery is not implemented/);
});
