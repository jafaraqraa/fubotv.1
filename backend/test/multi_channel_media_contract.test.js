const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'futh-media-contract-'));
process.env.SQLITE_DB_PATH = path.join(temp, 'media.db');

const db = require('../src/database/connection');
const { initializeDatabase } = require('../src/database/initialize');
const mediaRepo = require('../src/database/repositories/mediaAttachmentRepository');
const { CAPABILITIES, assertMediaCapability } = require('../src/messaging/mediaCapabilities');
initializeDatabase();

test('provider capabilities are explicit and backend enforced', () => {
    assert.deepEqual(Object.keys(CAPABILITIES).sort(), ['instagram', 'messenger', 'telegram', 'whatsapp']);
    assert.doesNotThrow(() => assertMediaCapability('telegram', 'audio/ogg', 100));
    assert.doesNotThrow(() => assertMediaCapability('whatsapp', 'application/pdf', 100));
    assert.throws(
        () => assertMediaCapability('instagram', 'application/pdf', 100),
        error => error.code === 'UNSUPPORTED_CHANNEL_MEDIA' && error.statusCode === 415
    );
    assert.throws(
        () => assertMediaCapability('messenger', 'image/png', CAPABILITIES.messenger.maxBytes + 1),
        error => error.code === 'MEDIA_TOO_LARGE' && error.statusCode === 413
    );
});

test('unified media records support every channel and remain tenant isolated', () => {
    db.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES ('media-tenant', 'Media Tenant')`).run();
    for (const channel of Object.keys(CAPABILITIES)) {
        const record = mediaRepo.createAttachment({
            tenantId: 'media-tenant', channel, direction: 'outgoing',
            mediaType: 'image', originalFilename: `${channel}.png`,
            storedFilename: `${channel}-random.png`, storagePath: path.join(temp, `${channel}.png`),
            mimeType: 'image/png', extension: 'png', sizeBytes: 10,
            checksum: channel.padEnd(64, '0'), idempotencyKey: `media-key-${channel}`
        });
        assert.equal(record.channel, channel);
        assert.equal(record.tenant_id, 'media-tenant');
        assert.equal(mediaRepo.findByIdempotencyKey('media-tenant', `media-key-${channel}`).id, record.id);
        assert.equal(mediaRepo.getAttachment(record.id, 'default'), undefined);
        assert.throws(() => mediaRepo.createAttachment({
            tenantId: 'media-tenant', channel, direction: 'outgoing', mediaType: 'image',
            originalFilename: 'duplicate.png', storedFilename: `duplicate-${channel}.png`,
            storagePath: path.join(temp, `duplicate-${channel}.png`), mimeType: 'image/png',
            sizeBytes: 10, checksum: 'a'.repeat(64), idempotencyKey: `media-key-${channel}`
        }), /UNIQUE constraint/);
    }
});

test.after(() => {
    db.close();
    fs.rmSync(temp, { recursive: true, force: true });
});
