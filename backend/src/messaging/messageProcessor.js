const { validateNormalizedMessage } = require('./validateMessage');
const { registerCustomerUser, findCustomerUser, incrementUnreadCount } = require('../database/repositories/customerRepository');
const { saveMessage, existsByExternalId } = require('../database/repositories/messageRepository');
const { addLog, reportError } = require('../services/logger');
const { getAIResponse } = require('../services/ai');
const { materializeProfileImage } = require('../services/profileImageService');

async function processIncomingMessage(normalizedMsg) {
    let persistedMessageId = null;
    try {
        // 1. Validate normalized payload
        validateNormalizedMessage(normalizedMsg);

        const { channel, externalMessageId, externalUserId, customer, messageType, content } = normalizedMsg;
        const tenantId = normalizedMsg.metadata && normalizedMsg.metadata.tenantId;

        if (channel === 'whatsapp' && !tenantId) {
            console.error(`[Outgoing Message] Missing tenantId for WhatsApp message. Sending aborted. messageId=${externalMessageId || 'unknown'} channel=${channel}`);
            throw new Error('Missing tenantId for WhatsApp message');
        }

        // 2. Prevent duplicate processing (Task 8)
        if (externalMessageId && await existsByExternalId(channel, externalMessageId, tenantId)) {
            console.log(`⚠️ Ignored duplicate incoming event: ${externalMessageId} on ${channel}`);
            return {
                status: 'duplicate',
                duplicate: true,
                channel,
                externalMessageId
            };
        }

        // 3. Materialize external profile images locally so provider access tokens
        // and administrator network details are never exposed to the browser.
        const profileData = { ...(customer.profileData || {}) };
        const profileImageRemoteUrl = profileData.profileImageRemoteUrl || null;
        delete profileData.profileImageRemoteUrl;

        // 4. Centralized customer profile lookup and register. Avatar retrieval is
        // intentionally non-blocking and cannot delay message processing or replies.
        registerCustomerUser(externalUserId, customer.displayName, channel, tenantId, profileData);
        if (profileImageRemoteUrl) {
            materializeProfileImage({
                channel,
                tenantId,
                externalUserId,
                remoteUrl: profileImageRemoteUrl
            }).then(avatarUrl => {
                if (avatarUrl) {
                    registerCustomerUser(
                        externalUserId,
                        customer.displayName,
                        channel,
                        tenantId,
                        { avatarUrl }
                    );
                }
            }).catch(() => {
                // Profile photos are optional; messaging must remain available.
            });
        }

        // 5. Inbound persistence in SQLite
        persistedMessageId = saveMessage(externalUserId, 'user', content, messageType, false, externalMessageId, {
            channel,
            tenantId,
            metadata: {
                ...(normalizedMsg.metadata || {}),
                ...(normalizedMsg.media ? { media: normalizedMsg.media } : {})
            }
        });
        incrementUnreadCount(externalUserId, tenantId || 'default');
        addLog(`رسالة جديدة من ${customer.displayName} عبر ${channel}`);

        // 6. Check AI automation status (Task 6)
        const user = findCustomerUser(externalUserId, channel, tenantId);
        const isAIEnabled = user ? user.isAIEnabled : true;
        const assignee = user ? user.assignee : 'ai';

        if (!isAIEnabled || assignee !== 'ai') {
            addLog(`🔔 رسالة [${channel}] واردة (الرد الآلي مغلق للعميل ${customer.displayName}) - بانتظار الرد اليدوي.`);
            return {
                status: 'waiting_for_agent',
                duplicate: false,
                channel,
                externalUserId,
                aiEnabled: false,
                responseSent: false,
                messageId: persistedMessageId
            };
        }

        // 7. AI automation mode is active
        let replyText = '';
        const textToProcess = (messageType !== 'text') ? content : content; // handles attachments captions or paths

        if (textToProcess || messageType === 'image' || messageType === 'audio' || messageType === 'voice') {
            const aiResponse = await getAIResponse(
                externalUserId,
                textToProcess || '',
                messageType,
                normalizedMsg.media,
                { tenantId: tenantId || 'default', channel }
            );
            if (!aiResponse || !String(aiResponse).trim()) {
                throw new Error('AI provider returned an empty response');
            }
            replyText = String(aiResponse).trim();
        } else {
            throw new Error('Incoming attachment has no processable content');
        }

        // 8. Dispatch AI response through unified outgoing handler
        const { sendOutgoingMessage } = require('./outgoingMessageService');
        const outgoingResult = await sendOutgoingMessage({
            channel,
            externalUserId,
            direction: 'outgoing',
            senderType: 'ai',
            messageType: 'text',
            content: replyText,
            media: null,
            tenantId
        });

        return {
            status: 'processed',
            duplicate: false,
            channel,
            externalUserId,
            aiEnabled: true,
            responseSent: outgoingResult.success,
            outgoingMessageId: outgoingResult.externalMessageId,
            messageId: persistedMessageId
        };

    } catch (err) {
        reportError(`معالجة رسالة واردة (${normalizedMsg ? normalizedMsg.channel : 'unknown'})`, err.message);
        return {
            status: persistedMessageId ? 'ai_failed' : 'failed',
            duplicate: false,
            error: err.message,
            messageId: persistedMessageId
        };
    }
}

module.exports = {
    processIncomingMessage
};
