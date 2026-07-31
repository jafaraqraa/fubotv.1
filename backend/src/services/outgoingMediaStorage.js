const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const MIME_EXTENSIONS = new Map([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/gif', 'gif'],
    ['image/webp', 'webp'],
    ['audio/mpeg', 'mp3'],
    ['audio/ogg', 'ogg'],
    ['audio/wav', 'wav'],
    ['audio/mp4', 'm4a'],
    ['video/mp4', 'mp4'],
    ['video/webm', 'webm'],
    ['application/pdf', 'pdf'],
    ['text/plain', 'txt'],
    ['text/csv', 'csv'],
    ['application/zip', 'zip'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx']
]);
const EXTENSION_ALIASES = new Map([
    ['jpeg', 'jpg'], ['oga', 'ogg'], ['wave', 'wav'], ['m4v', 'mp4']
]);

function hasExpectedSignature(buffer, mimeType) {
    const ascii = (start, end) => buffer.subarray(start, end).toString('ascii');
    if (mimeType === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if (mimeType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
    if (mimeType === 'image/gif') return ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a';
    if (mimeType === 'image/webp') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    if (mimeType === 'application/pdf') return ascii(0, 5) === '%PDF-';
    if (mimeType === 'audio/ogg') return ascii(0, 4) === 'OggS';
    if (mimeType === 'audio/wav') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE';
    if (mimeType === 'audio/mpeg') {
        return ascii(0, 3) === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
    }
    if (mimeType === 'audio/mp4' || mimeType === 'video/mp4') return ascii(4, 8) === 'ftyp';
    if (mimeType === 'video/webm') return buffer.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'));
    if (mimeType === 'application/zip'
        || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        return buffer[0] === 0x50 && buffer[1] === 0x4b
            && [0x03, 0x05, 0x07].includes(buffer[2]);
    }
    if (mimeType === 'text/plain' || mimeType === 'text/csv') {
        return !buffer.includes(0) && !buffer.toString('utf8').includes('\uFFFD');
    }
    return false;
}

function decodeBase64Media(mediaData) {
    if (typeof mediaData !== 'string' || !mediaData.trim()) {
        throw Object.assign(new Error('بيانات الملف المرفق غير صالحة.'), { code: 'INVALID_MEDIA_DATA' });
    }

    const normalized = mediaData.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
        throw Object.assign(new Error('ترميز الملف المرفق غير صالح.'), { code: 'INVALID_MEDIA_DATA' });
    }

    const buffer = Buffer.from(normalized, 'base64');
    if (buffer.length === 0 || buffer.length > MAX_MEDIA_BYTES) {
        throw Object.assign(
            new Error(buffer.length > MAX_MEDIA_BYTES
                ? 'حجم الملف المرفق يتجاوز الحد الأقصى 10 ميجابايت.'
                : 'الملف المرفق فارغ.'),
            { code: buffer.length > MAX_MEDIA_BYTES ? 'MEDIA_TOO_LARGE' : 'EMPTY_MEDIA' }
        );
    }
    return buffer;
}

function persistOutgoingMedia({ mediaData, mediaName, mediaType, uploadsDir }) {
    const normalizedType = String(mediaType || '').toLowerCase().split(';')[0].trim();
    const extension = MIME_EXTENSIONS.get(normalizedType);
    if (!extension) {
        throw Object.assign(new Error('نوع الملف المرفق غير مدعوم.'), { code: 'UNSUPPORTED_MEDIA_TYPE' });
    }
    if (typeof mediaName !== 'string' || !mediaName.trim()) {
        throw Object.assign(new Error('اسم الملف المرفق مطلوب.'), { code: 'INVALID_MEDIA_NAME' });
    }

    const buffer = decodeBase64Media(mediaData);
    const originalName = path.basename(mediaName);
    const suppliedExtension = path.extname(originalName).slice(1).toLowerCase();
    const normalizedExtension = EXTENSION_ALIASES.get(suppliedExtension) || suppliedExtension;
    if (!suppliedExtension || normalizedExtension !== extension) {
        throw Object.assign(
            new Error('امتداد الملف لا يطابق نوع المحتوى المعلن.'),
            { code: 'MEDIA_EXTENSION_MISMATCH' }
        );
    }
    if (!hasExpectedSignature(buffer, normalizedType)) {
        throw Object.assign(
            new Error('محتوى الملف تالف أو لا يطابق نوعه.'),
            { code: 'CORRUPT_MEDIA' }
        );
    }
    fs.mkdirSync(uploadsDir, { recursive: true });
    const fileName = `${Date.now()}_${crypto.randomUUID()}.${extension}`;
    const localPath = path.join(uploadsDir, fileName);
    fs.writeFileSync(localPath, buffer, { flag: 'wx' });

    return {
        localPath,
        publicUrl: `/uploads/${fileName}`,
        fileName,
        originalName,
        mimeType: normalizedType,
        size: buffer.length,
        checksum: crypto.createHash('sha256').update(buffer).digest('hex')
    };
}

function removeStoredMedia(media) {
    if (!media?.localPath) return;
    try {
        if (fs.existsSync(media.localPath)) fs.unlinkSync(media.localPath);
    } catch (error) {
        console.error('[Outgoing Media] Failed to roll back stored media:', error.message);
    }
}

module.exports = {
    MAX_MEDIA_BYTES,
    decodeBase64Media,
    hasExpectedSignature,
    persistOutgoingMedia,
    removeStoredMedia
};
