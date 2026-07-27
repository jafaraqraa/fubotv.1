const telegram = require('../channels/telegram');
const whatsappManager = require('../channels/whatsapp-providers/WhatsAppProviderManager');
const { sendMetaMessage } = require('../channels/meta');
const { saveMessage } = require('../database/repositories/messageRepository');
const { reportError } = require('../services/logger');

async function sendOutgoingMessage(outgoingMsg) {
    const { channel, externalUserId, senderType, messageType, content, media } = outgoingMsg;
    const tenantId = outgoingMsg.tenantId || 'default';

    try {
        let externalMessageId = null;
        let finalPath = media ? media.localPath : null;

        // Internal notes do not get dispatched to any external channels
        if (messageType === 'note' || outgoingMsg.isNote) {
            saveMessage(externalUserId, senderType, content, 'note', true);
            return { success: true, status: 'note_saved' };
        }

        if (channel === 'telegram') {
            const bot = telegram.getBot();
            if (bot) {
                let sentMsg;
                if (finalPath) {
                    if (messageType === 'image') {
                        sentMsg = await bot.telegram.sendPhoto(externalUserId, { source: finalPath }, { caption: content || '' });
                    } else if (messageType === 'video') {
                        sentMsg = await bot.telegram.sendVideo(externalUserId, { source: finalPath }, { caption: content || '' });
                    } else if (messageType === 'audio') {
                        sentMsg = await bot.telegram.sendAudio(externalUserId, { source: finalPath }, { caption: content || '' });
                    } else {
                        sentMsg = await bot.telegram.sendDocument(externalUserId, { source: finalPath }, { caption: content || '' });
                    }
                } else {
                    sentMsg = await bot.telegram.sendMessage(externalUserId, content);
                }
                if (sentMsg) {
                    externalMessageId = String(sentMsg.message_id || '');
                }
            } else {
                throw new Error('Telegram bot client is not initialized or offline');
            }
        } else if (channel === 'whatsapp') {
            // Retrieve dynamic provider via WhatsAppProviderManager
            const provider = await whatsappManager.getOrLoadProvider(tenantId);
            if (provider && provider.getStatus() === "متصل") {
                const sendResult = await provider.sendMessage({
                    recipientId: externalUserId,
                    messageType,
                    content,
                    media
                });
                if (sendResult && sendResult.success) {
                    externalMessageId = sendResult.externalMessageId;
                } else {
                    throw new Error('Failed to send WhatsApp message through provider');
                }
            } else {
                throw new Error('WhatsApp provider is not connected');
            }
        } else if (channel === 'messenger' || channel === 'instagram') {
            const finalContent = finalPath ? `${content || ''} ${finalPath}`.trim() : content;
            await sendMetaMessage(externalUserId, finalContent, channel);
            externalMessageId = `meta_${Date.now()}`;
        }

        // Save delivery output to SQLite message thread
        const textToSave = finalPath ? finalPath : content;
        saveMessage(externalUserId, senderType, textToSave, messageType, false, externalMessageId);

        return {
            success: true,
            status: 'sent',
            externalMessageId
        };

    } catch (err) {
        reportError(`إرسال رسالة صادرة (${channel})`, err.message);
        return {
            success: false,
            status: 'failed',
            error: err.message
        };
    }
}

module.exports = {
    sendOutgoingMessage
};
