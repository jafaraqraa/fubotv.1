const { validateNormalizedMessage } = require('./validateMessage');
const { registerCustomerUser, findCustomerUser, incrementUnreadCount } = require('../database/repositories/customerRepository');
const { saveMessage, existsByExternalId } = require('../database/repositories/messageRepository');
const { addLog, reportError } = require('../services/logger');
const { getAIResponse } = require('../services/ai');
const { materializeProfileImage } = require('../services/profileImageService');
const fs = require('fs');
const path = require('path');
const knowledgeDocumentRepo = require('../database/repositories/knowledgeDocumentRepository');
const mediaAttachmentRepo = require('../database/repositories/mediaAttachmentRepository');
const { persistMediaBuffer, removeStoredMedia } = require('../services/outgoingMediaStorage');

function requestedKnowledgeMediaType(text) {
    const value = String(text || '').normalize('NFKC').toLowerCase();
    const action = '(?:ابعث|ارسل|أرسل|اعرض|ورجيني|فرجيني|شغل|بدي|اريد|أريد|send|show|play)';
    const image = '(?:صوره|صورة|صور|image|photo|picture)';
    const audio = '(?:صوت|صوتي|تسجيل|اغنيه|أغنية|انشوده|أنشودة|audio|voice|recording)';
    if (new RegExp(`${action}.{0,80}${audio}|${audio}.{0,80}${action}`, 'i').test(value)) return 'audio';
    if (new RegExp(`${action}.{0,80}${image}|${image}.{0,80}${action}`, 'i').test(value)) return 'image';
    return null;
}

function selectRetrievedRagMedia(tenantId, telemetry, requestedType) {
    const chunks = telemetry?.profiling?.topChunks;
    if (!Array.isArray(chunks)) return null;
    for (const chunk of chunks) {
        const documentId = chunk?.payload?.ragMediaDocumentId;
        if (!documentId || chunk?.payload?.ragMediaType !== requestedType) continue;
        const doc = knowledgeDocumentRepo.getDocumentByKey(tenantId, documentId);
        if (doc && doc.tenant_id === tenantId && doc.ai_send_enabled === 1
            && doc.is_active === 1 && ['active', 'indexed', 'cleanup_pending'].includes(doc.status)) {
            return doc;
        }
    }
    return null;
}

function createOutgoingMediaFromRagDocument(doc, channel, tenantId, mediaType) {
    const knowledgeRoot = path.resolve(__dirname, '..', '..', 'data', 'knowledge-documents');
    const sourcePath = path.resolve(doc.storage_path);
    if (!sourcePath.startsWith(`${knowledgeRoot}${path.sep}`) || !fs.existsSync(sourcePath)) {
        const error = new Error('ملف وسائط RAG غير موجود أو مساره غير صالح.');
        error.code = 'RAG_MEDIA_FILE_UNAVAILABLE';
        throw error;
    }
    const media = persistMediaBuffer({
        buffer: fs.readFileSync(sourcePath),
        mediaName: doc.original_name,
        mediaType: doc.mime_type,
        uploadsDir: path.join(__dirname, '..', '..', 'data', 'private-media', tenantId)
    });
    try {
        const attachment = mediaAttachmentRepo.createAttachment({
            tenantId,
            channel,
            provider: ['messenger', 'instagram'].includes(channel) ? 'meta' : channel,
            direction: 'outgoing',
            mediaType,
            originalFilename: media.originalName,
            storedFilename: media.fileName,
            storagePath: media.localPath,
            mimeType: media.mimeType,
            extension: path.extname(media.fileName).slice(1),
            sizeBytes: media.size,
            checksum: media.checksum,
            caption: doc.media_description || null,
            status: 'uploaded'
        });
        return {
            ...media,
            attachmentId: attachment.id,
            publicUrl: `/api/media/${attachment.id}/download`,
            ragDocumentId: doc.document_key,
            ragMediaType: mediaType
        };
    } catch (error) {
        removeStoredMedia(media);
        throw error;
    }
}

async function processIncomingMessage(normalizedMsg) {
    let persistedMessageId = null;
    try {
        // 1. Validate normalized payload
        validateNormalizedMessage(normalizedMsg);

        const { channel, externalMessageId, externalUserId, customer, messageType, content } = normalizedMsg;
        const suppliedTenantId = normalizedMsg.metadata && normalizedMsg.metadata.tenantId;

        if (channel === 'whatsapp' && !suppliedTenantId) {
            console.error(`[Outgoing Message] Missing tenantId for WhatsApp message. Sending aborted. messageId=${externalMessageId || 'unknown'} channel=${channel}`);
            throw new Error('Missing tenantId for WhatsApp message');
        }
        // Telegram currently belongs to the platform's default tenant. Normalize
        // the context once so persistence, AI retrieval and RAG media lookup all
        // operate inside the same tenant boundary.
        const tenantId = suppliedTenantId || 'default';

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
        const contactData = {
            username: customer.username || null,
            phoneNumber: customer.phoneNumber || null
        };
        registerCustomerUser(externalUserId, customer.displayName, channel, tenantId, profileData, contactData);
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
                        { avatarUrl },
                        contactData
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
        incrementUnreadCount(externalUserId, tenantId);
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
        let replyMedia = null;
        const textToProcess = (messageType !== 'text') ? content : content; // handles attachments captions or paths

        if (textToProcess || messageType === 'image' || messageType === 'audio' || messageType === 'voice') {
            const retrievalTelemetry = {};
            const aiResponse = await getAIResponse(
                externalUserId,
                textToProcess || '',
                messageType,
                normalizedMsg.media,
                { tenantId, channel, retrievalTelemetry }
            );
            if (!aiResponse || !String(aiResponse).trim()) {
                throw new Error('AI provider returned an empty response');
            }
            replyText = String(aiResponse).trim();
            const requestedMediaType = messageType === 'text'
                ? requestedKnowledgeMediaType(textToProcess)
                : null;
            if (requestedMediaType) {
                const mediaDocument = selectRetrievedRagMedia(
                    tenantId, retrievalTelemetry, requestedMediaType
                );
                if (mediaDocument) {
                    const { assertMediaCapability } = require('./mediaCapabilities');
                    try {
                        assertMediaCapability(channel, mediaDocument.mime_type, mediaDocument.file_size);
                        replyMedia = createOutgoingMediaFromRagDocument(
                            mediaDocument, channel, tenantId, requestedMediaType
                        );
                        console.log(`[AI Media] Selected RAG ${requestedMediaType} tenant=${tenantId} document=${mediaDocument.document_key} channel=${channel}`);
                    } catch (mediaError) {
                        if (mediaError.code !== 'UNSUPPORTED_CHANNEL_MEDIA') throw mediaError;
                        console.warn(`[AI Media] ${requestedMediaType} is unsupported on channel=${channel}; text reply retained.`);
                    }
                }
            }
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
            messageType: replyMedia ? (replyMedia.ragMediaType || 'document') : 'text',
            content: replyText,
            media: replyMedia,
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
            attachmentId: replyMedia?.attachmentId || null,
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
    processIncomingMessage,
    _test: {
        requestedKnowledgeMediaType,
        selectRetrievedRagMedia,
        createOutgoingMediaFromRagDocument,
        requestsKnowledgeImage: text => requestedKnowledgeMediaType(text) === 'image',
        selectRetrievedRagImage: (tenantId, telemetry) => selectRetrievedRagMedia(tenantId, telemetry, 'image'),
        createOutgoingMediaFromRagImage: (doc, channel, tenantId) =>
            createOutgoingMediaFromRagDocument(doc, channel, tenantId, 'image')
    }
};
