const crypto = require('crypto');
const { requireSessionSecret } = require('../config/securityConfig');

const PREFIX = 'enc:v1:';

function encryptionKey() {
    const source = process.env.CREDENTIAL_ENCRYPTION_KEY || requireSessionSecret();
    return crypto.createHash('sha256').update(source, 'utf8').digest();
}

function encryptSecret(value) {
    if (!value || String(value).startsWith(PREFIX)) return value;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64url');
}

function decryptSecret(value) {
    if (!value || !String(value).startsWith(PREFIX)) return value;
    const payload = Buffer.from(String(value).slice(PREFIX.length), 'base64url');
    if (payload.length < 29) throw new Error('Encrypted credential payload is invalid');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), payload.subarray(0, 12));
    decipher.setAuthTag(payload.subarray(12, 28));
    return Buffer.concat([
        decipher.update(payload.subarray(28)),
        decipher.final()
    ]).toString('utf8');
}

module.exports = { PREFIX, encryptSecret, decryptSecret };
