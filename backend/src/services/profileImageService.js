const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const uploadsDir = path.join(__dirname, '..', '..', 'public', 'uploads');
const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 5000;
const localCache = new Map();

const ALLOWED_HOST_SUFFIXES = Object.freeze({
    telegram: ['telegram.org'],
    whatsapp: ['whatsapp.net', 'whatsapp.com'],
    messenger: ['facebook.com', 'fbcdn.net', 'fbsbx.com'],
    instagram: ['facebook.com', 'fbcdn.net', 'fbsbx.com', 'cdninstagram.com']
});

function isAllowedRemoteUrl(remoteUrl, channel) {
    try {
        const parsed = new URL(String(remoteUrl || ''));
        if (parsed.protocol !== 'https:') return false;
        const hostname = parsed.hostname.toLowerCase();
        return (ALLOWED_HOST_SUFFIXES[channel] || []).some(
            suffix => hostname === suffix || hostname.endsWith(`.${suffix}`)
        );
    } catch (_) {
        return false;
    }
}

function extensionForContentType(contentType) {
    const normalized = String(contentType || '').split(';')[0].trim().toLowerCase();
    return {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif'
    }[normalized] || null;
}

async function readBoundedBody(response) {
    const reader = response.body?.getReader();
    if (!reader) {
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > MAX_PROFILE_IMAGE_BYTES) throw new Error('Profile image exceeds size limit');
        return buffer;
    }

    const chunks = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_PROFILE_IMAGE_BYTES) {
            await reader.cancel();
            throw new Error('Profile image exceeds size limit');
        }
        chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
}

async function fetchAllowedImage(remoteUrl, channel, signal) {
    let currentUrl = String(remoteUrl);
    for (let redirects = 0; redirects <= 3; redirects++) {
        if (!isAllowedRemoteUrl(currentUrl, channel)) return null;
        const response = await fetch(currentUrl, {
            signal,
            redirect: 'manual',
            headers: { Accept: 'image/*' }
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) return response;
        const location = response.headers.get('location');
        if (!location) return null;
        currentUrl = new URL(location, currentUrl).toString();
    }
    return null;
}

async function materializeProfileImage({ channel, tenantId, externalUserId, remoteUrl }) {
    const cacheKey = `${channel}:${tenantId || 'default'}:${externalUserId}`;
    if (localCache.has(cacheKey)) return localCache.get(cacheKey);
    if (!isAllowedRemoteUrl(remoteUrl, channel)) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const response = await fetchAllowedImage(remoteUrl, channel, controller.signal);
        if (!response || !response.ok) return null;

        const extension = extensionForContentType(response.headers.get('content-type'));
        if (!extension) return null;
        const declaredLength = Number(response.headers.get('content-length') || 0);
        if (declaredLength > MAX_PROFILE_IMAGE_BYTES) return null;

        const buffer = await readBoundedBody(response);
        if (!buffer.length) return null;
        fs.mkdirSync(uploadsDir, { recursive: true });
        const fingerprint = crypto
            .createHash('sha256')
            .update(cacheKey)
            .digest('hex')
            .slice(0, 24);
        const fileName = `profile_${fingerprint}.${extension}`;
        fs.writeFileSync(path.join(uploadsDir, fileName), buffer);
        const localUrl = `/uploads/${fileName}`;
        localCache.set(cacheKey, localUrl);
        return localUrl;
    } catch (error) {
        console.warn(`[Profile Image] Fetch skipped channel=${channel}: ${error.name || 'error'}`);
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

module.exports = {
    materializeProfileImage,
    isAllowedRemoteUrl,
    MAX_PROFILE_IMAGE_BYTES
};
