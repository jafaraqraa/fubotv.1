function normalizeWhatsAppMessage(
    msg,
    contact,
    localPath = null,
    mediaType = 'text',
    fileExt = '',
    profileImageRemoteUrl = null,
    resolvedPhoneNumber = null
) {
    const userId = String(msg.from || '');
    const isPhoneWid = /@(?:c\.us|s\.whatsapp\.net)$/i.test(userId);
    const rawPhoneNumber = resolvedPhoneNumber || (isPhoneWid ? userId.split('@')[0] : null);
    const phoneNumber = rawPhoneNumber
        ? String(rawPhoneNumber).replace(/@(?:c\.us|s\.whatsapp\.net)$/i, '').replace(/\D/g, '') || null
        : null;
    const displayName = contact.pushname || contact.name || (phoneNumber ? `+${phoneNumber}` : 'عميل واتساب');
    const userText = localPath || msg.body || '';

    let media = null;
    if (localPath) {
        media = {
            localPath: localPath,
            publicUrl: localPath,
            fileName: localPath.split('/').pop(),
            mimeType: getMimeTypeFromExt(fileExt),
            caption: msg.body || ''
        };
    }

    return {
        channel: 'whatsapp',
        externalMessageId: String(msg.id ? msg.id.id : ''),
        externalUserId: userId,
        customer: {
            displayName,
            username: null,
            phoneNumber,
            profileData: profileImageRemoteUrl ? { profileImageRemoteUrl } : {}
        },
        direction: 'incoming',
        senderType: 'customer',
        messageType: mediaType,
        content: userText,
        media,
        timestamp: new Date(msg.timestamp * 1000 || Date.now()).toISOString(),
        metadata: {
            hasMedia: msg.hasMedia || false
        }
    };
}

function getMimeTypeFromExt(ext) {
    const map = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'mp4': 'video/mp4',
        'webm': 'video/webm',
        'ogg': 'audio/ogg',
        'mp3': 'audio/mpeg',
        'm4a': 'audio/mp4',
        'amr': 'audio/amr',
        'pdf': 'application/pdf'
    };
    return map[ext.toLowerCase()] || 'application/octet-stream';
}

module.exports = {
    normalizeWhatsAppMessage
};
