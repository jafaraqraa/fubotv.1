const telegram = require('../channels/telegram');
const whatsappManager = require('../channels/whatsapp-providers/WhatsAppProviderManager');
const { sendMetaMessage } = require('../channels/meta');
const { saveMessage, updateMessageDelivery } = require('../database/repositories/messageRepository');
const { reportError } = require('../services/logger');

async function sendOutgoingMessage(outgoingMsg) {
    const { channel, externalUserId, senderType, messageType, content, media } = outgoingMsg;
    const tenantId = outgoingMsg.tenantId;

    let persistedMessageId = null;
    try {
        if (channel === 'whatsapp' && !tenantId) {
            console.error(`[Outgoing Message] Missing tenantId for WhatsApp message. Sending aborted. messageId=${outgoingMsg.externalMessageId || 'unknown'} channel=${channel}`);
            throw new Error('Missing tenantId for WhatsApp message');
        }

        let externalMessageId = null;
        let finalPath = media ? media.localPath : null;

        // Internal notes do not get dispatched to any external channels
        if (messageType === 'note' || outgoingMsg.isNote) {
            saveMessage(externalUserId, senderType, content, 'note', true, null, { channel, tenantId });
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
            persistedMessageId = saveMessage(
                externalUserId,
                senderType,
                finalPath || content,
                messageType,
                false,
                null,
                {
                    channel,
                    tenantId,
                    deliveryStatus: 'sending',
                    metadata: { provider: 'meta' }
                }
            );
            const metaResult = await sendMetaMessage(externalUserId, finalContent, channel);
            if (!metaResult || !metaResult.success) {
                const failure = metaResult || {
                    error: 'Meta sender returned no result',
                    statusCode: null,
                    metaErrorCode: null,
                    rawResponse: null
                };
                updateMessageDelivery(persistedMessageId, 'failed', {
                    provider: 'meta',
                    httpStatus: failure.statusCode,
                    metaErrorCode: failure.metaErrorCode,
                    metaErrorMessage: failure.error,
                    rawResponse: failure.rawResponse
                });
                const error = new Error(failure.error || 'Meta Graph API send failed');
                error.deliveryDetails = failure;
                throw error;
            }
            externalMessageId = metaResult.messageId || null;
            updateMessageDelivery(persistedMessageId, 'sent', {
                provider: 'meta',
                httpStatus: metaResult.statusCode,
                externalMessageId,
                rawResponse: metaResult.rawResponse
            });
        }

        // Save delivery output to SQLite message thread
        if (!persistedMessageId) {
            const textToSave = finalPath ? finalPath : content;
            saveMessage(externalUserId, senderType, textToSave, messageType, false, externalMessageId, {
                channel,
                tenantId
            });
        }

        return {
            success: true,
            status: 'sent',
            externalMessageId,
            tenantId: tenantId || null
        };

    } catch (err) {
        if (persistedMessageId && !err.deliveryDetails) {
            updateMessageDelivery(persistedMessageId, 'failed', {
                error: err.message
            });
        }
        reportError(`إرسال رسالة صادرة (${channel})`, err.message);
        const details = err.deliveryDetails || {};
        return {
            success: false,
            status: 'failed',
            error: err.message,
            statusCode: details.statusCode === undefined ? null : details.statusCode,
            metaErrorCode: details.metaErrorCode === undefined ? null : details.metaErrorCode
        };
    }
}

module.exports = {
    sendOutgoingMessage
};
