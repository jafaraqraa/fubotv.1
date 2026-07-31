const MB = 1024 * 1024;

const COMMON_DOCUMENT_MIMES = Object.freeze([
    'application/pdf', 'text/plain', 'text/csv', 'application/zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);

const CAPABILITIES = Object.freeze({
    messenger: Object.freeze({
        categories: ['image', 'video', 'audio', 'document'],
        mimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'video/mp4', 'video/webm', 'audio/mpeg', 'audio/ogg', 'audio/wav',
            'audio/mp4', ...COMMON_DOCUMENT_MIMES],
        maxBytes: 10 * MB, caption: false, voiceNote: false,
        remoteUrl: false, attachmentReuse: true, delivered: true, read: true
    }),
    instagram: Object.freeze({
        categories: ['image', 'video'],
        mimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'video/mp4', 'video/webm'],
        maxBytes: 8 * MB, caption: false, voiceNote: false,
        remoteUrl: true, attachmentReuse: true, delivered: true, read: true
    }),
    telegram: Object.freeze({
        categories: ['image', 'video', 'audio', 'voice', 'document', 'animation', 'sticker'],
        mimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'video/mp4', 'video/webm', 'audio/mpeg', 'audio/ogg', 'audio/wav',
            'audio/mp4', ...COMMON_DOCUMENT_MIMES],
        maxBytes: 10 * MB, caption: true, voiceNote: true,
        remoteUrl: false, attachmentReuse: true, delivered: false, read: false
    }),
    whatsapp: Object.freeze({
        categories: ['image', 'video', 'audio', 'voice', 'document'],
        mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4',
            'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4', ...COMMON_DOCUMENT_MIMES],
        maxBytes: 10 * MB, caption: true, voiceNote: true,
        remoteUrl: false, attachmentReuse: true, delivered: true, read: true,
        providerSpecific: true
    })
});

function categoryForMime(mimeType) {
    const mime = String(mimeType || '').toLowerCase().split(';')[0].trim();
    if (mime.startsWith('image/')) return mime === 'image/gif' ? 'animation' : 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    return 'document';
}

function getMediaCapabilities(channel) {
    return CAPABILITIES[channel] || null;
}

function assertMediaCapability(channel, mimeType, sizeBytes, requestedCategory = null) {
    const capability = getMediaCapabilities(channel);
    if (!capability) throw Object.assign(new Error('Unsupported messaging channel.'), { code: 'UNSUPPORTED_CHANNEL' });
    const mime = String(mimeType || '').toLowerCase().split(';')[0].trim();
    const category = requestedCategory || categoryForMime(mime);
    if (!capability.categories.includes(category) || !capability.mimeTypes.includes(mime)) {
        throw Object.assign(
            new Error(`نوع الوسائط ${mime || category} غير مدعوم على قناة ${channel}.`),
            { code: 'UNSUPPORTED_CHANNEL_MEDIA', statusCode: 415 }
        );
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
        throw Object.assign(new Error('الملف فارغ أو حجمه غير صالح.'), { code: 'INVALID_MEDIA_SIZE', statusCode: 422 });
    }
    if (sizeBytes > capability.maxBytes) {
        throw Object.assign(new Error('حجم الملف يتجاوز حد القناة.'), { code: 'MEDIA_TOO_LARGE', statusCode: 413 });
    }
    return { capability, category, mimeType: mime };
}

module.exports = { CAPABILITIES, getMediaCapabilities, categoryForMime, assertMediaCapability };
