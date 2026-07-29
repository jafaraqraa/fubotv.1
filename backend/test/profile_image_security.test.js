const test = require('node:test');
const assert = require('node:assert/strict');
const {
    isAllowedRemoteUrl,
    MAX_PROFILE_IMAGE_BYTES
} = require('../src/services/profileImageService');

test('profile image source security policy', () => {
    assert.strictEqual(isAllowedRemoteUrl('https://api.telegram.org/file/bot-redacted/photo.jpg', 'telegram'), true);
    assert.strictEqual(isAllowedRemoteUrl('https://pps.whatsapp.net/v/photo.jpg', 'whatsapp'), true);
    assert.strictEqual(isAllowedRemoteUrl('https://scontent.xx.fbcdn.net/photo.jpg', 'messenger'), true);
    assert.strictEqual(isAllowedRemoteUrl('https://cdninstagram.com/photo.jpg', 'instagram'), true);

    assert.strictEqual(isAllowedRemoteUrl('http://api.telegram.org/photo.jpg', 'telegram'), false);
    assert.strictEqual(isAllowedRemoteUrl('https://evil.example/photo.jpg', 'telegram'), false);
    assert.strictEqual(isAllowedRemoteUrl('https://telegram.org.evil.example/photo.jpg', 'telegram'), false);
    assert.strictEqual(isAllowedRemoteUrl('file:///etc/passwd', 'whatsapp'), false);
    assert.strictEqual(MAX_PROFILE_IMAGE_BYTES, 5 * 1024 * 1024);
});
