function normalizeMetaMessage(webhookEvent, platform, profile = null) {
    const senderPsid = String(webhookEvent.sender.id || '');
    const userText = webhookEvent.message.text || '';
    const messageId = String(webhookEvent.message.mid || '');

    const displayName = profile?.displayName || `عميل ${platform === 'messenger' ? 'ماسنجر' : 'انستجرام'}`;

    return {
        channel: platform, // 'messenger' or 'instagram'
        externalMessageId: messageId,
        externalUserId: senderPsid,
        customer: {
            displayName,
            username: null,
            phoneNumber: null,
            profileData: profile?.profileImageRemoteUrl
                ? { profileImageRemoteUrl: profile.profileImageRemoteUrl }
                : {}
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
