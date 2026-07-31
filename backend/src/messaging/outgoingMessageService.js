const telegram = require('../channels/telegram');
const whatsappManager = require('../channels/whatsapp-providers/WhatsAppProviderManager');
const { sendMetaMessage } = require('../channels/meta');
const { saveMessage, updateMessageDelivery } = require('../database/repositories/messageRepository');
const { reportError } = require('../services/logger');
const mediaRepo = require('../database/repositories/mediaAttachmentRepository');

async function sendOutgoingMessage(outgoingMsg) {
    const { channel, externalUserId, senderType, messageType, content, media } = outgoingMsg;
    const tenantId = outgoingMsg.tenantId;
    const supportedChannels = new Set(['telegram', 'whatsapp', 'messenger', 'instagram']);

    let persistedMessageId = null;
    try {
        if (!supportedChannels.has(channel)) {
            throw new Error(`Unsupported outgoing channel: ${channel || 'missing'}`);
        }
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
                } else {
                    throw new Error('Telegram API returned no sent message');
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
            const finalContent = content;
            persistedMessageId = saveMessage(
                externalUserId,
                senderType,
                media?.publicUrl || finalPath || content,
                messageType,
                false,
                null,
                {
                    channel,
                    tenantId,
                    deliveryStatus: 'sending',
                    metadata: {
                        provider: 'meta',
                        attachmentId: media?.attachmentId || null,
                        fileName: media?.originalName || media?.fileName || null,
                        caption: content || null
                    },
                    media
                }
            );
            if (media?.attachmentId) {
                mediaRepo.updateAttachment(media.attachmentId, tenantId || 'default', {
                    messageId: persistedMessageId,
                    status: 'sending'
                });
            }
            const metaResult = await sendMetaMessage(
                externalUserId,
                finalContent,
                channel,
                media ? { ...media, messageType } : null
            );
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
                if (media?.attachmentId) {
                    mediaRepo.updateAttachment(media.attachmentId, tenantId || 'default', {
                        messageId: persistedMessageId,
                        status: 'failed',
                        providerAttachmentId: failure.attachmentId || null,
                        lastError: failure.error
                    });
                }
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
            if (media?.attachmentId) {
                try {
                    mediaRepo.updateAttachment(media.attachmentId, tenantId || 'default', {
                        messageId: persistedMessageId,
                        status: 'sent',
                        providerAttachmentId: metaResult.attachmentId || null,
                        externalMessageId,
                        lastError: null
                    });
                } catch (attachmentError) {
                    // Meta already accepted the message. Never rewrite the authoritative
                    // delivery result as failed because secondary attachment metadata failed.
                    reportError('تحديث سجل مرفق Meta بعد الإرسال', attachmentError.message);
                }
            }
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
