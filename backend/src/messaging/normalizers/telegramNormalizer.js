function normalizeTelegramMessage(
    ctx,
    localPath = null,
    mediaType = 'text',
    fileExt = '',
    profileImageRemoteUrl = null
) {
    const from = ctx.from || {};
    const message = ctx.message || {};
    const messageId = String(message.message_id || '');
    const userId = String(from.id || '');
    const displayName = [from.first_name, from.last_name].filter(Boolean).join(' ') || `Telegram_${userId}`;
    const username = from.username || null;
    const userText = localPath || message.text || message.caption || '';

    let media = null;
    if (localPath) {
        media = {
            localPath: localPath,
            publicUrl: localPath, // Already stored under uploads relative static path
            fileName: localPath.split('/').pop(),
            mimeType: getMimeTypeFromExt(fileExt),
            caption: message.caption || ''
        };
    }

    return {
        channel: 'telegram',
        externalMessageId: messageId,
        externalUserId: userId,
        customer: {
            displayName,
            username,
            phoneNumber: null,
            profileData: profileImageRemoteUrl ? { profileImageRemoteUrl } : {}
        },
        direction: 'incoming',
        senderType: 'customer',
        messageType: mediaType,
        content: userText,
        media,
        timestamp: new Date(message.date * 1000 || Date.now()).toISOString(),
        metadata: {
            tenantId: 'default',
            chatId: String(ctx.chat ? ctx.chat.id : '')
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
    normalizeTelegramMessage
};
