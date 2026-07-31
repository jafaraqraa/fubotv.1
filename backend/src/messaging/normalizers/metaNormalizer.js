function normalizeMetaMessage(webhookEvent, platform, profile = null, tenantId = 'default', materializedMedia = null) {
    const senderPsid = String(webhookEvent.sender.id || '');
    const attachment = webhookEvent.message.attachments?.[0] || null;
    const providerType = attachment?.type === 'file' ? 'document' : attachment?.type;
    const userText = webhookEvent.message.text || materializedMedia?.caption || '';
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
        messageType: materializedMedia ? (providerType || 'document') : 'text',
        content: materializedMedia?.publicUrl || userText,
        media: materializedMedia,
        timestamp: new Date(webhookEvent.timestamp || Date.now()).toISOString(),
        metadata: { tenantId }
    };
}

module.exports = {
    normalizeMetaMessage
};
