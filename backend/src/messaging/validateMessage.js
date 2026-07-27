function validateNormalizedMessage(msg) {
    const validChannels = ['telegram', 'whatsapp', 'messenger', 'instagram'];
    const validDirections = ['incoming', 'outgoing'];
    const validSenderTypes = ['customer', 'ai', 'agent', 'system'];
    const validMessageTypes = ['text', 'image', 'audio', 'video', 'document', 'note'];

    if (!msg) {
        throw new Error('Message object is null or undefined');
    }

    if (!validChannels.includes(msg.channel)) {
        throw new Error(`Invalid or unsupported channel: ${msg.channel}`);
    }

    if (!msg.externalUserId) {
        throw new Error('Missing externalUserId');
    }

    if (!validDirections.includes(msg.direction)) {
        throw new Error(`Invalid direction: ${msg.direction}`);
    }

    if (!validSenderTypes.includes(msg.senderType)) {
        throw new Error(`Invalid senderType: ${msg.senderType}`);
    }

    if (!validMessageTypes.includes(msg.messageType)) {
        throw new Error(`Invalid messageType: ${msg.messageType}`);
    }

    // Must have either content text, media path, or be a start command
    if (!msg.content && !msg.media && msg.messageType === 'text') {
        throw new Error('Message content and media are both empty');
    }

    if (msg.media) {
        if (!msg.media.localPath || !msg.media.fileName || !msg.media.mimeType) {
            throw new Error('Malformed media payload metadata');
        }
    }

    return true;
}

module.exports = {
    validateNormalizedMessage
};
