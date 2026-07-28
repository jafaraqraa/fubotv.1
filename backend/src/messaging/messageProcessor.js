const { validateNormalizedMessage } = require('./validateMessage');
const { registerCustomerUser, findCustomerUser, incrementUnreadCount } = require('../database/repositories/customerRepository');
const { saveMessage, existsByExternalId } = require('../database/repositories/messageRepository');
const { addLog, reportError } = require('../services/logger');
const { getAIResponse } = require('../services/ai');

async function processIncomingMessage(normalizedMsg) {
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

        // 3. Centralized customer profile lookup and register
        registerCustomerUser(externalUserId, customer.displayName, channel, tenantId);

        // 4. Inbound persistence in SQLite
        saveMessage(externalUserId, 'user', content, messageType, false, externalMessageId, {
            channel,
            tenantId,
            metadata: {
                ...(normalizedMsg.metadata || {}),
                ...(normalizedMsg.media ? { media: normalizedMsg.media } : {})
            }
        });
        incrementUnreadCount(externalUserId, tenantId || 'default');
        addLog(`رسالة جديدة من ${customer.displayName} عبر ${channel}`);

        // 5. Check AI automation status (Task 6)
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
                responseSent: false
            };
        }

        // 6. AI automation mode is active
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
            replyText = aiResponse || `شكراً لتواصلك معنا. تم استلام رسالتك وجاري مراجعتها قريباً.`;
        } else {
            replyText = `تم استلام الملف بنجاح، جاري المراجعة والرد عليك قريباً.`;
        }

        // 7. Dispatch AI response through unified outgoing handler
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
            outgoingMessageId: outgoingResult.externalMessageId
        };

    } catch (err) {
        reportError(`معالجة رسالة واردة (${normalizedMsg ? normalizedMsg.channel : 'unknown'})`, err.message);
        return {
            status: 'failed',
            duplicate: false,
            error: err.message
        };
    }
}

module.exports = {
    processIncomingMessage
};
