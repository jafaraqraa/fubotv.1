function normalizeMetaMessage(webhookEvent, platform, profileName = null) {
    const senderPsid = String(webhookEvent.sender.id || '');
    const userText = webhookEvent.message.text || '';
    const messageId = String(webhookEvent.message.mid || '');

    const displayName = profileName || `عميل ${platform === 'messenger' ? 'ماسنجر' : 'انستجرام'}`;

    return {
        channel: platform, // 'messenger' or 'instagram'
        externalMessageId: messageId,
        externalUserId: senderPsid,
        customer: {
            displayName,
            username: null,
            phoneNumber: null,
            profileData: {}
        },
        direction: 'incoming',
        senderType: 'customer',
        messageType: 'text',
        content: userText,
        media: null,
        timestamp: new Date(webhookEvent.timestamp || Date.now()).toISOString(),
        metadata: {}
    };
}

module.exports = {
    normalizeMetaMessage
};
