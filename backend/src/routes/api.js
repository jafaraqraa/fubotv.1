const express = require('express');
const router = express.Router();
router.parsePagination = parsePagination;
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { execFile } = require('node:child_process');
const os = require('node:os');
const crypto = require('node:crypto');
const { addLog, reportError, getRecentLogs, listErrors, getActiveErrorsCount, solveError } = require('../services/logger');
const { getIsValidToken, startBot } = require('../channels/telegram');
const { getWaClient, getWaStatus, setWaStatus, getLastQrCodeUrl, setLastQrCodeUrl } = require('../channels/whatsapp');
const { updateEnvFile } = require('../utils/helpers');
const { requireRagTenant } = require('../rag/security/tenantContext');
const { getManualKnowledgePath } = require('../rag/storage/tenantKnowledgeStorage');
const { requirePermission } = require('../security/accessControl');
const { audit } = require('../security/accessControl');
const bcrypt = require('bcryptjs');
const { isKnowledgeOperation } = require('../rag/security/ragAccessPolicy');

const RAG_ACCESS_TTL_MS = 30 * 60 * 1000;
const RAG_ACCESS_PASSWORD_HASH = process.env.RAG_ACCESS_PASSWORD_HASH
    || '$2b$12$YiRtO7SdgHveh9roBE9riu0K1TjYPSJbq3KAk7kt/hqWkWHQtINpG';

function hasActiveRagAccess(req) {
    const unlockedAt = Number(req.session?.ragAccessUnlockedAt || 0);
    return unlockedAt > 0 && Date.now() - unlockedAt < RAG_ACCESS_TTL_MS;
}

function requireRagAccess(req, res, next) {
    if (hasActiveRagAccess(req)) return next();
    return res.status(423).json({
        success: false,
        code: 'RAG_ACCESS_LOCKED',
        error: 'إعدادات RAG محمية بكلمة مرور.'
    });
}

function addRAGAuditLog(user, action, target, result) {
    try {
        const logString = `[RAG] المستخدم: ${user} | الإجراء: ${action} | المستهدف: ${target} | النتيجة: ${result}`;
        addLog(logString);
    } catch (err) {
        console.error('Failed to log audit action:', err.message);
    }
}

const {
    findCustomerUserByIdOnly,
    listCustomerUsers,
    updateAssignee,
    updateAIEnabled,
    clearUnreadCount,
    deleteConversation
} = require('../database/repositories/customerRepository');

const {
    saveMessage,
    listMessages,
    getMessagesCount,
    getMessageForRetry,
    updateMessageDelivery,
    resolveManagementRequest,
    updateInternalNote,
    deleteInternalNote
} = require('../database/repositories/messageRepository');
const mediaAttachmentRepo = require('../database/repositories/mediaAttachmentRepository');
const { CAPABILITIES, assertMediaCapability, categoryForMime } = require('../messaging/mediaCapabilities');

const { sendOutgoingMessage } = require('../messaging/outgoingMessageService');
const {
    persistOutgoingMedia,
    removeStoredMedia
} = require('../services/outgoingMediaStorage');
const { saveSetting, getSetting, maskSecret, isMaskedPlaceholder } = require('../services/settingsService');
const budgetService = require('../services/budgetService');

const productionBackupRoot = path.join(__dirname, '..', '..', 'data', 'backups', 'production');
const productionBackupRunner = path.join(__dirname, '..', '..', 'scripts', 'run-scheduled-backup.js');
const productionBackupVerifier = path.join(__dirname, '..', '..', 'scripts', 'verify-production-backup.js');
const { markerPath: pendingRestoreMarker } = require('../services/pendingRestoreService');
let productionBackupInProgress = false;
let productionBackupLastError = null;
const restoreUpload = multer({
    dest: path.join(os.tmpdir(), 'fubot-restore-uploads'),
    limits: { fileSize: 1024 * 1024 * 1024, files: 1 }
});

function directorySize(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
        const target = path.join(directory, entry.name);
        return total + (entry.isDirectory() ? directorySize(target) : fs.statSync(target).size);
    }, 0);
}

function latestBackupSummary() {
    if (!fs.existsSync(productionBackupRoot)) return null;
    const candidates = fs.readdirSync(productionBackupRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && /^futhing-\d{8}T\d{6}Z$/.test(entry.name))
        .map(entry => entry.name)
        .sort()
        .reverse();
    for (const id of candidates) {
        const directory = path.join(productionBackupRoot, id);
        const manifestPath = path.join(directory, 'manifest.json');
        if (!fs.existsSync(manifestPath)) continue;
        try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            return {
                id,
                createdAt: manifest.createdAt,
                sizeBytes: directorySize(directory),
                files: Array.isArray(manifest.files) ? manifest.files.length : 0,
                qdrantIncluded: manifest.qdrant?.skipped === false,
                verified: manifest.database?.integrity?.includes('ok')
                    && manifest.database?.foreignKeyViolations === 0
            };
        } catch (_) { /* Ignore incomplete or unreadable directories. */ }
    }
    return null;
}

const privateMediaDir = path.join(__dirname, '..', '..', 'data', 'private-media');
const mediaUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 10 }
});
function parseSingleMedia(req, res, next) {
    mediaUpload.single('file')(req, res, error => {
        if (!error) return next();
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ success: false, error: 'Media file exceeds the upload limit.' });
        }
        return res.status(400).json({ success: false, error: 'Malformed media upload.' });
    });
}

function providerFailureHttpStatus(result) {
    if (result?.error?.toLowerCase().includes('timed out')) return 504;
    if (result?.statusCode === 429 || result?.statusCode >= 500) return 503;
    return 502;
}

function parsePagination(query, { defaultLimit = 10, maxLimit = 100 } = {}) {
    const page = Number.parseInt(query.page ?? '1', 10);
    const limit = Number.parseInt(query.limit ?? String(defaultLimit), 10);
    if (!/^\d+$/.test(String(query.page ?? '1')) || !Number.isSafeInteger(page) || page < 1) {
        const error = new Error('page يجب أن يكون عدداً صحيحاً موجباً.');
        error.code = 'INVALID_PAGINATION';
        throw error;
    }
    if (!/^\d+$/.test(String(query.limit ?? defaultLimit))
        || !Number.isSafeInteger(limit) || limit < 1 || limit > maxLimit) {
        const error = new Error(`limit يجب أن يكون بين 1 و${maxLimit}.`);
        error.code = 'INVALID_PAGINATION';
        throw error;
    }
    return { page, limit };
}

// 1. مسار إسناد المحادثة للموظفين (Chat Assignment Endpoint)
router.post('/chat/assign', requirePermission('conversations:write'), (req, res) => {
    const { userId, assignee } = req.body;
    if (!userId || !assignee) return res.status(400).json({ success: false, error: 'بيانات ناقصة' });

    const user = findCustomerUserByIdOnly(userId, req.tenantId);
    if (user) {
        updateAssignee(userId, assignee, user.tenantId);
        const isAI = assignee === 'ai';
        addLog(`تم إسناد محادثة العميل ${user.name} إلى: ${assignee === 'ai' ? 'وكيل الذكاء الاصطناعي' : assignee}`);
        res.json({ success: true, isAIEnabled: isAI });
    } else {
        res.status(404).json({ success: false, error: 'المستخدم غير موجود بالذاكرة.' });
    }
});

router.post('/chat/management/resolve', requirePermission('conversations:write'), (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false, error: 'معرف العميل مطلوب.' });
    const user = findCustomerUserByIdOnly(userId, req.tenantId);
    if (!user) return res.status(404).json({ success: false, error: 'المستخدم غير موجود.' });
    resolveManagementRequest(userId, user.tenantId, user.platform);
    updateAssignee(userId, 'ai', user.tenantId);
    addLog(`تمت معالجة طلب الإدارة للعميل ${user.name} وإعادة الإسناد للذكاء الاصطناعي.`);
    return res.json({ success: true, assignee: 'ai', isAIEnabled: true, managementRequested: false });
});

router.delete('/conversations/:conversationId', requirePermission('conversations:write'), (req, res) => {
    const deleted = deleteConversation(req.params.conversationId, req.tenantId);
    if (!deleted) {
        return res.status(404).json({ success: false, error: 'المحادثة غير موجودة.' });
    }

    const allowedRoots = [privateMediaDir, path.join(__dirname, '..', '..', 'public', 'uploads')]
        .map(root => path.resolve(root));
    for (const storagePath of deleted.storagePaths) {
        const resolved = path.resolve(storagePath);
        const isOwnedPath = allowedRoots.some(root => resolved.startsWith(`${root}${path.sep}`));
        if (!isOwnedPath) continue;
        try {
            if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
        } catch (error) {
            reportError('تنظيف ملفات المحادثة المحذوفة', error.message);
        }
    }

    audit({
        actorId: req.session.userId,
        tenantId: req.tenantId,
        action: 'conversation_delete',
        resourceType: 'conversation',
        resourceId: deleted.conversationId,
        outcome: 'success',
        metadata: { channel: deleted.channel }
    });
    const { EVENTS } = require('../realtime/events');
    const { publish, publishStats } = require('../realtime/eventPublisher');
    publish(EVENTS.CONVERSATION_DELETED, {
        conversationId: deleted.conversationId,
        userId: deleted.userId,
        tenantId: req.tenantId
    }, { tenantId: req.tenantId });
    publishStats(req.tenantId);
    return res.json({ success: true, conversationId: deleted.conversationId });
});

router.patch('/messages/:messageId/note', requirePermission('conversations:write'), (req, res) => {
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!content || content.length > 5000) {
        return res.status(400).json({
            success: false,
            error: content ? 'الملاحظة تتجاوز 5000 حرف.' : 'محتوى الملاحظة فارغ.'
        });
    }
    const note = updateInternalNote(req.params.messageId, req.tenantId, content);
    if (!note) {
        return res.status(404).json({ success: false, error: 'الملاحظة الداخلية غير موجودة.' });
    }
    audit({
        actorId: req.session.userId, tenantId: req.tenantId,
        action: 'internal_note_update', resourceType: 'message',
        resourceId: note.id, outcome: 'success'
    });
    const { EVENTS } = require('../realtime/events');
    require('../realtime/eventPublisher').publish(EVENTS.MESSAGE_UPDATED, {
        messageId: note.id, userId: note.external_user_id,
        content, isNote: true, tenantId: req.tenantId
    }, { tenantId: req.tenantId });
    return res.json({ success: true, messageId: note.id, content });
});

router.delete('/messages/:messageId/note', requirePermission('conversations:write'), (req, res) => {
    const note = deleteInternalNote(req.params.messageId, req.tenantId);
    if (!note) {
        return res.status(404).json({ success: false, error: 'الملاحظة الداخلية غير موجودة.' });
    }
    audit({
        actorId: req.session.userId, tenantId: req.tenantId,
        action: 'internal_note_delete', resourceType: 'message',
        resourceId: note.id, outcome: 'success'
    });
    const { EVENTS } = require('../realtime/events');
    const publisher = require('../realtime/eventPublisher');
    publisher.publish(EVENTS.MESSAGE_DELETED, {
        messageId: note.id, userId: note.external_user_id,
        isNote: true, tenantId: req.tenantId
    }, { tenantId: req.tenantId });
    publisher.publishStats(req.tenantId);
    return res.json({ success: true, messageId: note.id });
});

// 2. تحديث وتطوير مسار إرسال الرسائل الفردية والملاحظات والوسائط (Rich Media & Notes Support) - uses outgoingMessageService (Task 14)
async function sendDirectHandler(req, res) {
    const { userId, message, isNote, mediaData, mediaName, mediaType, shareUrl } = req.body;
    if (!userId) return res.status(400).json({ success: false, error: 'بيانات ناقصة' });

    const user = findCustomerUserByIdOnly(userId, req.tenantId);
    if (!user) return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });

    let mediaMetadata = null;
    try {
        const idempotencyKey = String(req.get('Idempotency-Key') || req.body.idempotencyKey || '').trim();
        if (idempotencyKey && (idempotencyKey.length < 8 || idempotencyKey.length > 128)) {
            return res.status(400).json({ success: false, error: 'Idempotency-Key is invalid.' });
        }
        const existingAttachment = mediaAttachmentRepo.findByIdempotencyKey(user.tenantId, idempotencyKey);
        if (existingAttachment) {
            const terminalSuccess = ['sent', 'delivered', 'read'].includes(existingAttachment.status);
            return res.status(terminalSuccess ? 200 : 409).json({
                success: terminalSuccess,
                duplicate: true,
                attachmentId: existingAttachment.id,
                messageId: existingAttachment.external_message_id || null,
                deliveryStatus: existingAttachment.status,
                error: terminalSuccess ? undefined : 'A media operation with this key already exists.'
            });
        }
        // If it is a private internal note, delegate to persistence save directly without sending
        if (isNote === true) {
            if (!message) return res.status(400).json({ success: false, error: 'محتوى الملاحظة فارغ' });
            saveMessage(userId, 'admin', message, 'note', true, null, {
                channel: user.platform,
                tenantId: user.tenantId
            });
            addLog(`تمت إضافة ملاحظة داخلية سرية على محادثة: ${user.name}`);
            return res.json({ success: true });
        }

        let finalMessageText = message;
        let localPath = null;
        let actualMediaType = 'text';
        if (shareUrl) {
            if (user.platform !== 'instagram') {
                return res.status(400).json({ success: false, error: 'Share URL is supported only for Instagram.' });
            }
            let parsedShareUrl;
            try {
                parsedShareUrl = new URL(shareUrl);
            } catch (_) {
                return res.status(400).json({ success: false, error: 'Share URL is invalid.' });
            }
            if (parsedShareUrl.protocol !== 'https:') {
                return res.status(400).json({ success: false, error: 'Share URL must use HTTPS.' });
            }
            mediaMetadata = { shareUrl: parsedShareUrl.toString(), publicUrl: parsedShareUrl.toString() };
            finalMessageText = parsedShareUrl.toString();
            actualMediaType = 'image';
        }
        // Persist dashboard media before dispatch. Failed sends roll the file back.
        if (mediaData && mediaName) {
            const estimatedSize = Math.floor(String(mediaData).replace(/\s+/g, '').length * 3 / 4);
            assertMediaCapability(user.platform, mediaType, estimatedSize);
            actualMediaType = categoryForMime(mediaType);
            if (actualMediaType === 'animation' && user.platform !== 'telegram') actualMediaType = 'image';
            mediaMetadata = persistOutgoingMedia({
                mediaData,
                mediaName,
                mediaType,
                uploadsDir: path.join(privateMediaDir, user.tenantId)
            });
            const attachment = mediaAttachmentRepo.createAttachment({
                    tenantId: user.tenantId,
                    channel: user.platform,
                    ownerAdministratorId: req.session.userId,
                    originalFilename: mediaMetadata.originalName,
                    storedFilename: mediaMetadata.fileName,
                    storagePath: mediaMetadata.localPath,
                    mimeType: mediaMetadata.mimeType,
                    sizeBytes: mediaMetadata.size,
                    checksum: mediaMetadata.checksum,
                    mediaType: actualMediaType,
                    caption: message || null,
                    extension: path.extname(mediaMetadata.fileName).slice(1),
                    idempotencyKey: idempotencyKey || null
            });
            mediaMetadata.attachmentId = attachment.id;
            mediaMetadata.publicUrl = `/api/media/${attachment.id}/download`;
            localPath = mediaMetadata.localPath;
            finalMessageText = mediaMetadata.publicUrl;

        }

        if (!finalMessageText && !localPath) {
            return res.status(400).json({ success: false, error: 'محتوى الإدخال فارغ.' });
        }

        // Delegate strictly to the unified outgoing message pipeline (Task 14)
        const outgoingResult = await sendOutgoingMessage({
            channel: user.platform,
            externalUserId: userId,
            direction: 'outgoing',
            senderType: 'agent',
            messageType: actualMediaType,
            content: message || '',
            media: mediaMetadata,
            tenantId: user.tenantId
        });

        if (outgoingResult.success) {
            // A successful direct reply from an administrator fulfills any
            // pending escalation for this conversation. Internal notes do not.
            const managementResolved = resolveManagementRequest(
                userId,
                user.tenantId,
                user.platform
            );
            audit({
                actorId: req.session.userId, tenantId: user.tenantId,
                action: 'media_send', resourceType: user.platform,
                resourceId: mediaMetadata?.attachmentId || outgoingResult.externalMessageId,
                outcome: 'success'
            });
            res.json({
                success: true,
                messageId: outgoingResult.externalMessageId || null,
                attachmentId: mediaMetadata?.attachmentId || null,
                deliveryStatus: outgoingResult.status,
                managementRequested: false,
                managementResolved
            });
        } else {
            audit({
                actorId: req.session.userId, tenantId: user.tenantId,
                action: 'media_send', resourceType: user.platform,
                resourceId: mediaMetadata?.attachmentId,
                outcome: 'failure'
            });
            res.status(providerFailureHttpStatus(outgoingResult)).json({
                success: false,
                error: outgoingResult.error || 'Failed sending outgoing reply',
                attachmentId: mediaMetadata?.attachmentId || null,
                retryable: Boolean(mediaMetadata?.attachmentId)
                    && (outgoingResult.statusCode === 429 || outgoingResult.statusCode >= 500
                        || outgoingResult.statusCode == null)
            });
        }

    } catch (err) {
        if (!mediaMetadata?.attachmentId) removeStoredMedia(mediaMetadata);
        reportError(`إرسال رسالة فردية (${user.platform})`, err.message);
        const validationCodes = new Set([
            'INVALID_MEDIA_DATA', 'EMPTY_MEDIA', 'MEDIA_TOO_LARGE',
            'UNSUPPORTED_MEDIA_TYPE', 'INVALID_MEDIA_NAME',
            'MEDIA_EXTENSION_MISMATCH', 'CORRUPT_MEDIA', 'INVALID_MEDIA_SIZE',
            'UNSUPPORTED_CHANNEL_MEDIA'
        ]);
        res.status(err.statusCode || (validationCodes.has(err.code) ? 400 : 500))
            .json({ success: false, error: `فشل الإرسال للعميل عبر ${user.platform}: ${err.message}` });
    }
}

router.post('/send-direct', requirePermission('messages:send'), sendDirectHandler);
router.post(
    '/conversations/:conversationId/messages/media',
    requirePermission('messages:send'),
    parseSingleMedia,
    (req, res, next) => {
        if (!req.file) return res.status(400).json({ success: false, error: 'Media file is required.' });
        req.body = {
            ...req.body,
            userId: req.params.conversationId,
            mediaData: req.file.buffer.toString('base64'),
            mediaName: req.file.originalname,
            mediaType: req.file.mimetype,
            message: req.body.caption || req.body.message || ''
        };
        return sendDirectHandler(req, res).catch(next);
    }
);

router.get('/media/capabilities', requirePermission('conversations:read'), (req, res) => {
    return res.json({ success: true, capabilities: CAPABILITIES });
});

router.get('/media/:attachmentId/download', requirePermission('conversations:read'), (req, res) => {
    const attachment = mediaAttachmentRepo.getAttachment(req.params.attachmentId, req.tenantId);
    if (!attachment || attachment.status === 'deleted') {
        return res.status(404).json({ success: false, error: 'Media attachment not found' });
    }
    const resolved = path.resolve(attachment.storage_path);
    const tenantRoot = path.resolve(privateMediaDir, req.tenantId);
    if (!resolved.startsWith(`${tenantRoot}${path.sep}`) || !fs.existsSync(resolved)) {
        return res.status(404).json({ success: false, error: 'Media file is unavailable' });
    }
    res.setHeader('Content-Type', attachment.mime_type);
    res.setHeader('Content-Length', attachment.size_bytes);
    res.setHeader('Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(attachment.original_filename)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.sendFile(resolved);
});

router.post('/media/:attachmentId/retry', requirePermission('messages:send'), async (req, res) => {
    const attachment = mediaAttachmentRepo.getAttachment(req.params.attachmentId, req.tenantId);
    if (!attachment || attachment.status !== 'failed' || !attachment.message_id) {
        return res.status(409).json({ success: false, error: 'Attachment is not retryable' });
    }
    const message = getMessageForRetry(attachment.message_id, req.tenantId);
    if (!message) {
        return res.status(404).json({ success: false, error: 'Original message not found' });
    }

    mediaAttachmentRepo.updateAttachment(attachment.id, req.tenantId, {
        status: 'sending',
        retryCount: attachment.retry_count + 1,
        lastError: null
    });
    updateMessageDelivery(message.id, 'sending', { retry: attachment.retry_count + 1 });
    const result = await sendOutgoingMessage({
        channel: message.channel,
        externalUserId: message.external_user_id,
        senderType: message.sender,
        messageType: message.message_type,
        content: attachment.caption || message.content || '',
        tenantId: req.tenantId,
        existingMessageId: message.id,
        media: {
        attachmentId: attachment.id,
        localPath: attachment.storage_path,
        originalName: attachment.original_filename,
        mimeType: attachment.mime_type,
        providerAttachmentId: attachment.provider_attachment_id
        }
    });
    if (!result.success) {
        return res.status(502).json({ success: false, error: result.error, retryable: true });
    }
    const managementResolved = resolveManagementRequest(
        message.external_user_id,
        req.tenantId,
        message.channel
    );
    audit({
        actorId: req.session.userId, tenantId: req.tenantId,
        action: 'media_retry', resourceType: message.channel,
        resourceId: attachment.id, outcome: 'success'
    });
    return res.json({
        success: true,
        attachmentId: attachment.id,
        messageId: result.externalMessageId,
        managementRequested: false,
        managementResolved
    });
});

router.delete('/media/:attachmentId', requirePermission('messages:send'), (req, res) => {
    const attachment = mediaAttachmentRepo.getAttachment(req.params.attachmentId, req.tenantId);
    if (!attachment || attachment.status === 'deleted') {
        return res.status(404).json({ success: false, error: 'Media attachment not found' });
    }
    if (['uploading', 'sending'].includes(attachment.status)) {
        return res.status(409).json({ success: false, error: 'Media attachment is currently in use' });
    }
    const resolved = path.resolve(attachment.storage_path);
    const tenantRoot = path.resolve(privateMediaDir, req.tenantId);
    if (!resolved.startsWith(`${tenantRoot}${path.sep}`)) {
        return res.status(403).json({ success: false, error: 'Media ownership mismatch' });
    }
    try {
        if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
        mediaAttachmentRepo.updateAttachment(attachment.id, req.tenantId, {
            status: 'deleted', lastError: null
        });
        audit({
            actorId: req.session.userId, tenantId: req.tenantId,
            action: 'media_delete', resourceType: attachment.channel,
            resourceId: attachment.id, outcome: 'success'
        });
        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ success: false, error: 'Failed to delete media attachment' });
    }
});

// 3. مسارات التهيئة وحفظ الإعدادات الفنية الفردية والموحدة لـ الـ SaaS
router.post('/config/settings', requirePermission('system:manage'), async (req, res) => {
    const {
        token, openrouterKey, model, systemPrompt, adminId, waAutoReply,
        messengerToken, instagramToken, metaVerifyToken, metaAppSecret, instagramAppSecret,
        messengerAutoReply, instagramAutoReply,
        ragChunkSize, ragChunkOverlap, ragEmbeddingModel, qdrantCollection,
        ragIndexOnStartup, qdrantUrl, ollamaBaseUrl,
        ragMinTopK, ragDefaultTopK, ragMaxTopK, ragCandidateMultiplier,
        ragSemanticWeight, ragKeywordWeight, ragSimilarityThreshold,
        ragNeighborExpansion, ragContextBudget,
        aiProvider, aiModel, aiApiKey, aiBaseUrl, aiCustomModels,
        publicBackendUrl,
        budgetOpenrouter, budgetOpenai, budgetGemini, budgetOllama
    } = req.body;

    const containsRagSettings = Object.keys(req.body || {}).some(key => key.startsWith('rag')
        || ['qdrantCollection', 'qdrantUrl', 'ollamaBaseUrl'].includes(key));
    if (containsRagSettings && !hasActiveRagAccess(req)) {
        return res.status(423).json({
            success: false,
            code: 'RAG_ACCESS_LOCKED',
            error: 'أدخل كلمة مرور RAG قبل تعديل هذه الإعدادات.'
        });
    }

    const { validateSetting, validateAllSettings, getConfig } = require('../rag');

    try {
        let normalizedMetaAppSecret = null;
        let normalizedInstagramAppSecret = null;
        if (metaAppSecret !== undefined && metaAppSecret !== '') {
            if (typeof metaAppSecret !== 'string') {
                return res.status(400).json({
                    success: false,
                    error: 'Meta App Secret غير صالح.'
                });
            }
            if (!isMaskedPlaceholder(metaAppSecret)) {
                normalizedMetaAppSecret = metaAppSecret.trim();
            }
        }
        if (normalizedMetaAppSecret !== null) {
            if (
                normalizedMetaAppSecret.length < 16 ||
                normalizedMetaAppSecret.length > 256 ||
                /[\r\n\0]/.test(normalizedMetaAppSecret)
            ) {
                return res.status(400).json({
                    success: false,
                    error: 'Meta App Secret غير صالح.'
                });
            }
        }
        if (instagramAppSecret !== undefined && instagramAppSecret !== '' && !isMaskedPlaceholder(instagramAppSecret)) {
            normalizedInstagramAppSecret = String(instagramAppSecret).trim();
            if (normalizedInstagramAppSecret.length < 16 || normalizedInstagramAppSecret.length > 256 || /[\r\n\0]/.test(normalizedInstagramAppSecret)) {
                return res.status(400).json({ success: false, error: 'Instagram App Secret غير صالح.' });
            }
        }
        const metaSettingsRequested = metaVerifyToken !== undefined || metaAppSecret !== undefined;
        if (
            metaSettingsRequested &&
            normalizedMetaAppSecret === null &&
            !process.env.META_APP_SECRET
        ) {
            return res.status(400).json({
                success: false,
                error: 'Meta App Secret مطلوب لتفعيل التحقق من توقيع Webhook.'
            });
        }

        // RAG Settings Validation and Save
        const tempSettings = {
            RAG_CHUNK_SIZE: ragChunkSize !== undefined ? String(ragChunkSize) : (getConfig('RAG_CHUNK_SIZE') || '800'),
            RAG_CHUNK_OVERLAP: ragChunkOverlap !== undefined ? String(ragChunkOverlap) : (getConfig('RAG_CHUNK_OVERLAP') || '120'),
            RAG_EMBEDDING_MODEL: ragEmbeddingModel !== undefined ? String(ragEmbeddingModel) : (getConfig('RAG_EMBEDDING_MODEL') || 'nomic-embed-text'),
            QDRANT_COLLECTION: qdrantCollection !== undefined ? String(qdrantCollection) : (getConfig('QDRANT_COLLECTION') || 'futhing_knowledge'),
            QDRANT_URL: qdrantUrl !== undefined ? String(qdrantUrl) : (getConfig('QDRANT_URL') || 'http://127.0.0.1:6333'),
            OLLAMA_BASE_URL: ollamaBaseUrl !== undefined ? String(ollamaBaseUrl) : (getConfig('OLLAMA_BASE_URL') || 'http://127.0.0.1:11434'),
            RAG_MIN_TOP_K: ragMinTopK !== undefined ? String(ragMinTopK) : (getConfig('RAG_MIN_TOP_K') || '3'),
            RAG_DEFAULT_TOP_K: ragDefaultTopK !== undefined ? String(ragDefaultTopK) : (getConfig('RAG_DEFAULT_TOP_K') || '5'),
            RAG_MAX_TOP_K: ragMaxTopK !== undefined ? String(ragMaxTopK) : (getConfig('RAG_MAX_TOP_K') || '7'),
            RAG_CANDIDATE_MULTIPLIER: ragCandidateMultiplier !== undefined ? String(ragCandidateMultiplier) : (getConfig('RAG_CANDIDATE_MULTIPLIER') || '3'),
            RAG_SEMANTIC_WEIGHT: ragSemanticWeight !== undefined ? String(ragSemanticWeight) : (getConfig('RAG_SEMANTIC_WEIGHT') || '0.8'),
            RAG_KEYWORD_WEIGHT: ragKeywordWeight !== undefined ? String(ragKeywordWeight) : (getConfig('RAG_KEYWORD_WEIGHT') || '0.2'),
            RAG_SIMILARITY_THRESHOLD: ragSimilarityThreshold !== undefined ? String(ragSimilarityThreshold) : (getConfig('RAG_SIMILARITY_THRESHOLD') || '0.4'),
            RAG_NEIGHBOR_EXPANSION: ragNeighborExpansion !== undefined ? String(ragNeighborExpansion) : (getConfig('RAG_NEIGHBOR_EXPANSION') || 'false'),
            RAG_CONTEXT_BUDGET: ragContextBudget !== undefined ? String(ragContextBudget) : (getConfig('RAG_CONTEXT_BUDGET') || '3000')
        };

        // Validate individual RAG settings
        for (const [key, val] of Object.entries(tempSettings)) {
            const vRes = validateSetting(key, val);
            if (!vRes.valid) {
                return res.status(400).json({ success: false, error: vRes.error });
            }
        }

        // Validate cross-dependencies (e.g. overlap < chunk size, weights add up to 1.0)
        const allRes = validateAllSettings(tempSettings);
        if (!allRes.valid) {
            return res.status(400).json({ success: false, error: allRes.error });
        }

        // Save RAG settings keys if provided
        if (ragChunkSize !== undefined) {
            saveSetting('RAG_CHUNK_SIZE', String(ragChunkSize));
            updateEnvFile('RAG_CHUNK_SIZE', String(ragChunkSize));
            process.env.RAG_CHUNK_SIZE = String(ragChunkSize);
        }
        if (ragChunkOverlap !== undefined) {
            saveSetting('RAG_CHUNK_OVERLAP', String(ragChunkOverlap));
            updateEnvFile('RAG_CHUNK_OVERLAP', String(ragChunkOverlap));
            process.env.RAG_CHUNK_OVERLAP = String(ragChunkOverlap);
        }
        if (ragEmbeddingModel !== undefined) {
            saveSetting('RAG_EMBEDDING_MODEL', String(ragEmbeddingModel));
            updateEnvFile('RAG_EMBEDDING_MODEL', String(ragEmbeddingModel));
            process.env.RAG_EMBEDDING_MODEL = String(ragEmbeddingModel);
        }
        if (qdrantCollection !== undefined) {
            saveSetting('QDRANT_COLLECTION', String(qdrantCollection));
            updateEnvFile('QDRANT_COLLECTION', String(qdrantCollection));
            process.env.QDRANT_COLLECTION = String(qdrantCollection);
        }
        if (qdrantUrl !== undefined) {
            saveSetting('QDRANT_URL', String(qdrantUrl));
            updateEnvFile('QDRANT_URL', String(qdrantUrl));
            process.env.QDRANT_URL = String(qdrantUrl);
        }
        if (ollamaBaseUrl !== undefined) {
            saveSetting('OLLAMA_BASE_URL', String(ollamaBaseUrl));
            updateEnvFile('OLLAMA_BASE_URL', String(ollamaBaseUrl));
            process.env.OLLAMA_BASE_URL = String(ollamaBaseUrl);
        }
        if (ragIndexOnStartup !== undefined) {
            const valStr = String(ragIndexOnStartup);
            saveSetting('RAG_INDEX_ON_STARTUP', valStr);
            updateEnvFile('RAG_INDEX_ON_STARTUP', valStr);
            process.env.RAG_INDEX_ON_STARTUP = valStr;
        }
        if (ragMinTopK !== undefined) {
            saveSetting('RAG_MIN_TOP_K', String(ragMinTopK));
            updateEnvFile('RAG_MIN_TOP_K', String(ragMinTopK));
            process.env.RAG_MIN_TOP_K = String(ragMinTopK);
        }
        if (ragDefaultTopK !== undefined) {
            saveSetting('RAG_DEFAULT_TOP_K', String(ragDefaultTopK));
            updateEnvFile('RAG_DEFAULT_TOP_K', String(ragDefaultTopK));
            process.env.RAG_DEFAULT_TOP_K = String(ragDefaultTopK);
        }
        if (ragMaxTopK !== undefined) {
            saveSetting('RAG_MAX_TOP_K', String(ragMaxTopK));
            updateEnvFile('RAG_MAX_TOP_K', String(ragMaxTopK));
            process.env.RAG_MAX_TOP_K = String(ragMaxTopK);
        }
        if (ragCandidateMultiplier !== undefined) {
            saveSetting('RAG_CANDIDATE_MULTIPLIER', String(ragCandidateMultiplier));
            updateEnvFile('RAG_CANDIDATE_MULTIPLIER', String(ragCandidateMultiplier));
            process.env.RAG_CANDIDATE_MULTIPLIER = String(ragCandidateMultiplier);
        }
        if (ragSemanticWeight !== undefined) {
            saveSetting('RAG_SEMANTIC_WEIGHT', String(ragSemanticWeight));
            updateEnvFile('RAG_SEMANTIC_WEIGHT', String(ragSemanticWeight));
            process.env.RAG_SEMANTIC_WEIGHT = String(ragSemanticWeight);
        }
        if (ragKeywordWeight !== undefined) {
            saveSetting('RAG_KEYWORD_WEIGHT', String(ragKeywordWeight));
            updateEnvFile('RAG_KEYWORD_WEIGHT', String(ragKeywordWeight));
            process.env.RAG_KEYWORD_WEIGHT = String(ragKeywordWeight);
        }
        if (ragSimilarityThreshold !== undefined) {
            saveSetting('RAG_SIMILARITY_THRESHOLD', String(ragSimilarityThreshold));
            updateEnvFile('RAG_SIMILARITY_THRESHOLD', String(ragSimilarityThreshold));
            process.env.RAG_SIMILARITY_THRESHOLD = String(ragSimilarityThreshold);
        }
        if (ragNeighborExpansion !== undefined) {
            const valStr = String(ragNeighborExpansion);
            saveSetting('RAG_NEIGHBOR_EXPANSION', valStr);
            updateEnvFile('RAG_NEIGHBOR_EXPANSION', valStr);
            process.env.RAG_NEIGHBOR_EXPANSION = valStr;
        }
        if (ragContextBudget !== undefined) {
            saveSetting('RAG_CONTEXT_BUDGET', String(ragContextBudget));
            updateEnvFile('RAG_CONTEXT_BUDGET', String(ragContextBudget));
            process.env.RAG_CONTEXT_BUDGET = String(ragContextBudget);
        }

        if (aiProvider !== undefined) {
            saveSetting('AI_PROVIDER', String(aiProvider));
            updateEnvFile('AI_PROVIDER', String(aiProvider));
            process.env.AI_PROVIDER = String(aiProvider);
        }
        if (aiModel !== undefined) {
            saveSetting('AI_MODEL', String(aiModel));
            updateEnvFile('AI_MODEL', String(aiModel));
            process.env.AI_MODEL = String(aiModel);
        }
        if (aiApiKey !== undefined) {
            if (!isMaskedPlaceholder(aiApiKey)) {
                saveSetting('AI_API_KEY', String(aiApiKey));
                updateEnvFile('AI_API_KEY', String(aiApiKey));
                process.env.AI_API_KEY = String(aiApiKey);
            }
        }
        if (aiBaseUrl !== undefined) {
            saveSetting('AI_BASE_URL', String(aiBaseUrl));
            updateEnvFile('AI_BASE_URL', String(aiBaseUrl));
            process.env.AI_BASE_URL = String(aiBaseUrl);
        }
        if (aiCustomModels !== undefined) {
            const { validateCustomModelsPayload } = require('../services/customModelValidation');
            const validatedCustomModels = validateCustomModelsPayload(aiCustomModels);
            saveSetting('AI_CUSTOM_MODELS', validatedCustomModels);
            updateEnvFile('AI_CUSTOM_MODELS', validatedCustomModels);
            process.env.AI_CUSTOM_MODELS = validatedCustomModels;
        }
        if (publicBackendUrl !== undefined) {
            saveSetting('PUBLIC_BACKEND_URL', String(publicBackendUrl));
            updateEnvFile('PUBLIC_BACKEND_URL', String(publicBackendUrl));
            process.env.PUBLIC_BACKEND_URL = String(publicBackendUrl);
        }

        // Save and update budgets
        if (budgetOpenrouter !== undefined) {
            budgetService.updateProviderBudget('openrouter', budgetOpenrouter);
        }
        if (budgetOpenai !== undefined) {
            budgetService.updateProviderBudget('openai', budgetOpenai);
        }
        if (budgetGemini !== undefined) {
            budgetService.updateProviderBudget('gemini', budgetGemini);
        }
        if (budgetOllama !== undefined) {
            budgetService.updateProviderBudget('ollama', budgetOllama);
        }

        // 1. تحديث التوكن لتيليجرام
        if (token !== undefined && token !== '') {
            if (!isMaskedPlaceholder(token)) {
                if (!/^[0-9]+:[a-zA-Z0-9_-]+$/.test(token)) {
                    return res.status(400).json({ success: false, error: 'صيغة توكن تيليجرام غير صالحة.' });
                }
                saveSetting('BOT_TOKEN', token);
                updateEnvFile('BOT_TOKEN', token);
                const success = await startBot(token);

                if (success) {
                    const tokenError = listErrors().find(e => e.type === "توكن تيليجرام مفقود" && !e.solved);
                    if (tokenError) {
                        solveError(tokenError.id);
                        addLog("✅ تم حل عطل توكن تيليجرام تلقائياً!");
                    }
                }
            }
        }

        // 2. تحديث مفتاح OpenRouter وحل المشكلة تلقائياً
        if (openrouterKey !== undefined && openrouterKey !== '') {
            if (!isMaskedPlaceholder(openrouterKey)) {
                saveSetting('OPENROUTER_API_KEY', openrouterKey);
                updateEnvFile('OPENROUTER_API_KEY', openrouterKey);

                // Clear/invalidate OpenRouter balance cache so that fresh credits are immediately loaded
                try {
                    const cacheRepo = require('../database/repositories/providerBalanceCacheRepository');
                    cacheRepo.deleteBalanceCache('openrouter');
                } catch (cacheErr) {
                    console.error('⚠️ Failed to invalidate balance cache on settings change:', cacheErr.message);
                }

                const apiKeyError = listErrors().find(e => e.type === "مفتاح الذكاء الاصطناعي مفقود" && !e.solved);
                if (apiKeyError) {
                    solveError(apiKeyError.id);
                    addLog("✅ تم حل عطل مفتاح الذكاء الاصطناعي تلقائياً!");
                }
            }
        }

        // 3. تحديث الموديل
        if (model) {
            saveSetting('OPENROUTER_MODEL', model);
            updateEnvFile('OPENROUTER_MODEL', model);
            addLog(`تم تعديل موديل الـ AI لـ [${model}]`);
        }

        // 4. تحديث الـ System Prompt
        if (systemPrompt !== undefined) {
            const promptPath = path.join(__dirname, '..', '..', 'system_prompt.txt');
            if (systemPrompt.trim() === '') {
                if (fs.existsSync(promptPath)) fs.unlinkSync(promptPath);
                addLog("تمت إعادة تعيين شخصية البوت للافتراضية");
            } else {
                fs.writeFileSync(promptPath, systemPrompt, 'utf8');
                addLog("تم تحديث تعليمات النظام (System Prompt) بنجاح");
            }
        }

        // 5. تحديث معرف المشرف لاستقبال إشعارات الأعطال
        if (adminId !== undefined && adminId !== '') {
            saveSetting('ADMIN_TELEGRAM_ID', adminId);
            updateEnvFile('ADMIN_TELEGRAM_ID', adminId);
            addLog("تعديل معرف المشرف لتلقي التنبيهات");
        }

        // 6. تعديل حالة الرد الآلي لواتساب في ملف .env
        if (waAutoReply !== undefined) {
            saveSetting('WA_AUTO_REPLY', waAutoReply);
            updateEnvFile('WA_AUTO_REPLY', waAutoReply);
            addLog(`تعديل حالة الرد الآلي لواتساب إلى: ${waAutoReply === 'true' ? 'مفعّل' : 'موقف'}`);
        }

        // 7. تحديث توكن فيسبوك ماسنجر
        if (messengerToken !== undefined && messengerToken !== '') {
            if (!isMaskedPlaceholder(messengerToken)) {
                saveSetting('MESSENGER_ACCESS_TOKEN', messengerToken);
                updateEnvFile('MESSENGER_ACCESS_TOKEN', messengerToken);
            }
        }

        // 8. تحديث توكن انستجرام
        if (instagramToken !== undefined && instagramToken !== '') {
            if (!isMaskedPlaceholder(instagramToken)) {
                saveSetting('INSTAGRAM_ACCESS_TOKEN', instagramToken);
                updateEnvFile('INSTAGRAM_ACCESS_TOKEN', instagramToken);
            }
        }

        // 9. تحديث مفتاح التحقق المشترك لـ Meta Webhook
        if (metaVerifyToken !== undefined && metaVerifyToken !== '') {
            if (!isMaskedPlaceholder(metaVerifyToken)) {
                saveSetting('META_VERIFY_TOKEN', metaVerifyToken);
                updateEnvFile('META_VERIFY_TOKEN', metaVerifyToken);
            }
        }

        // 10. تحديث سر تطبيق Meta المستخدم للتحقق من توقيع POST Webhooks
        if (normalizedMetaAppSecret !== null) {
            saveSetting('META_APP_SECRET', normalizedMetaAppSecret);
            updateEnvFile('META_APP_SECRET', normalizedMetaAppSecret);
        }
        if (normalizedInstagramAppSecret !== null) {
            saveSetting('INSTAGRAM_APP_SECRET', normalizedInstagramAppSecret);
            updateEnvFile('INSTAGRAM_APP_SECRET', normalizedInstagramAppSecret);
        }

        // 11. تعديل حالة الرد الآلي لماسينجر
        if (messengerAutoReply !== undefined) {
            saveSetting('MESSENGER_AUTO_REPLY', messengerAutoReply);
            updateEnvFile('MESSENGER_AUTO_REPLY', messengerAutoReply);
            addLog(`تعديل حالة الرد الآلي لماسنجر إلى: ${messengerAutoReply === 'true' ? 'مفعّل' : 'موقف'}`);
        }

        // 12. تعديل حالة الرد الآلي لانستجرام
        if (instagramAutoReply !== undefined) {
            saveSetting('INSTAGRAM_AUTO_REPLY', instagramAutoReply);
            updateEnvFile('INSTAGRAM_AUTO_REPLY', instagramAutoReply);
            addLog(`تعديل حالة الرد الآلي لانستجرام إلى: ${instagramAutoReply === 'true' ? 'مفعّل' : 'موقف'}`);
        }

        const updatedRAGKeys = [];
        if (ragChunkSize !== undefined) updatedRAGKeys.push('حجم المقطع');
        if (ragChunkOverlap !== undefined) updatedRAGKeys.push('تداخل المقاطع');
        if (ragEmbeddingModel !== undefined) updatedRAGKeys.push('نموذج الترميز');
        if (qdrantCollection !== undefined) updatedRAGKeys.push('مجموعة Qdrant');
        if (ragSemanticWeight !== undefined || ragKeywordWeight !== undefined) updatedRAGKeys.push('أوزان البحث الهجين');
        if (ragSimilarityThreshold !== undefined) updatedRAGKeys.push('حد التشابه');

        if (updatedRAGKeys.length > 0) {
            addRAGAuditLog('المشرف', 'تعديل إعدادات المعرفة', updatedRAGKeys.join('، '), 'نجاح');
        }

        // Trigger background sync of API keys after setting update asynchronously
        budgetService.syncAllConfiguredApiKeys().catch(err => {
            console.error('⚠️ Failed to sync API keys on settings update:', err.message);
        });

        res.json({
            success: true,
            message: 'تم حفظ وتحديث كافة الإعدادات والموديل والتعليمات وقنوات ميتّا بنجاح واشتغال البوت بالخلفية!',
            metaAppSecretConfigured: !!process.env.META_APP_SECRET
        });
    } catch (err) {
        reportError("حفظ الإعدادات العامة", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/backups/status', requirePermission('system:manage'), (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json({
        success: true,
        inProgress: productionBackupInProgress,
        restorePending: fs.existsSync(pendingRestoreMarker),
        lastError: productionBackupLastError,
        latest: latestBackupSummary()
    });
});

router.get('/backups/latest/download', requirePermission('system:manage'), (req, res) => {
    const latest = latestBackupSummary();
    if (!latest) return res.status(404).json({ success: false, error: 'لا توجد نسخة احتياطية جاهزة للتنزيل.' });
    const archive = path.join(productionBackupRoot, `${latest.id}.tar.gz`);
    if (!fs.existsSync(archive)) {
        return res.status(404).json({ success: false, error: 'ملف تنزيل آخر نسخة غير موجود. أنشئ نسخة جديدة أولاً.' });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.download(archive, `FuBot-backup-${latest.id.replace('futhing-', '')}.tar.gz`);
});

router.post('/backups', requirePermission('system:manage'), (req, res) => {
    if (productionBackupInProgress) {
        return res.status(409).json({ success: false, error: 'يوجد نسخ احتياطي قيد التنفيذ حالياً.' });
    }
    productionBackupInProgress = true;
    productionBackupLastError = null;
    execFile(process.execPath, [productionBackupRunner], {
        cwd: path.join(__dirname, '..', '..', '..'),
        env: {
            ...process.env,
            QDRANT_URL: process.env.QDRANT_URL || 'http://127.0.0.1:6333',
            QDRANT_COLLECTION: process.env.QDRANT_COLLECTION || 'futhing_knowledge'
        },
        timeout: 5 * 60 * 1000,
        maxBuffer: 2 * 1024 * 1024
    }, (error) => {
        productionBackupInProgress = false;
        if (error) {
            productionBackupLastError = 'تعذر إنشاء آخر نسخة احتياطية. راجع سجل النظام ثم أعد المحاولة.';
            reportError('إنشاء نسخة احتياطية يدوية', error.message);
            return;
        }
        productionBackupLastError = null;
        addLog('تم إنشاء نسخة احتياطية يدوية متحققة من لوحة الإعدادات.');
    });
    return res.status(202).json({ success: true, inProgress: true, message: 'بدأ إنشاء النسخة الاحتياطية.' });
});

router.post('/backups/restore', requirePermission('system:manage'), restoreUpload.single('backup'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'اختر ملف النسخة الاحتياطية أولاً.' });
    const stagingRoot = path.join(__dirname, '..', '..', 'data', 'restore-staging');
    const staging = path.join(stagingRoot, crypto.randomUUID());
    try {
        fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
        const listing = require('node:child_process').spawnSync('tar', ['-tzf', req.file.path], { encoding: 'utf8' });
        if (listing.status !== 0) throw new Error('الملف ليس نسخة FuBot صالحة.');
        const entries = listing.stdout.split(/\r?\n/).filter(Boolean);
        if (!entries.length || entries.some(name => name.startsWith('/') || name.split('/').includes('..'))) {
            throw new Error('النسخة تحتوي مسارات غير آمنة.');
        }
        const extract = require('node:child_process').spawnSync('tar', [
            '-xzf', req.file.path, '--no-same-owner', '-C', staging
        ], { encoding: 'utf8' });
        if (extract.status !== 0) throw new Error('تعذر فك النسخة الاحتياطية.');
        const roots = fs.readdirSync(staging, { withFileTypes: true }).filter(entry => entry.isDirectory());
        if (roots.length !== 1) throw new Error('بنية ملف النسخة غير صحيحة.');
        const backupDirectory = path.join(staging, roots[0].name);
        const verify = require('node:child_process').spawnSync(process.execPath, [productionBackupVerifier, backupDirectory], {
            encoding: 'utf8', timeout: 5 * 60 * 1000
        });
        if (verify.status !== 0) throw new Error('فشل فحص سلامة النسخة الاحتياطية.');
        fs.mkdirSync(path.dirname(pendingRestoreMarker), { recursive: true });
        fs.writeFileSync(pendingRestoreMarker, JSON.stringify({ backupDirectory, requestedAt: new Date().toISOString() }), { mode: 0o600 });
        addLog('تم رفع وفحص نسخة احتياطية وتجهيزها للاستعادة عند إعادة التشغيل.');
        const autoRestart = process.env.FUBOT_SUPERVISED === 'true';
        res.json({
            success: true,
            restartRequired: !autoRestart,
            autoRestart,
            message: autoRestart
                ? 'النسخة سليمة. سيُعاد تشغيل FuBot تلقائيًا وتُطبّق الاستعادة.'
                : 'النسخة سليمة وجاهزة. أعد تشغيل FuBot لتطبيق الاستعادة.'
        });
        if (autoRestart) setTimeout(() => process.emit('fubot:restore-ready'), 1000).unref();
        return;
    } catch (error) {
        fs.rmSync(staging, { recursive: true, force: true });
        reportError('رفع نسخة للاستعادة', error.message);
        return res.status(400).json({ success: false, error: error.message });
    } finally {
        fs.rmSync(req.file.path, { force: true });
    }
});

// 4. جلب الإحصائيات مع الحماية التامة وحظر إرسال التوكنات كاملة للواجهة لمنع الاختراق
router.get('/stats', requirePermission('settings:manage'), (req, res) => {
    const { getConfig } = require('../rag/config/ragConfig');
    const { resolveAuthorizedTenant } = require('../rag/security/tenantContext');
    const textGenerationConfig = require('../database/repositories/aiTaskRepository')
        .getTaskConfig('text_generation');
    const knowledgePath = getManualKnowledgePath(resolveAuthorizedTenant(req));
    const knowledgeText = fs.existsSync(knowledgePath) ? fs.readFileSync(knowledgePath, 'utf8') : '';

    const promptPath = path.join(__dirname, '..', '..', 'system_prompt.txt');
    const defaultPrompt = "أنت مساعد خدمة عملاء محترف وذكي يجيب باللغة العربية بلطف ومودة.";
    const systemPromptText = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf8') : defaultPrompt;

    const usersArray = listCustomerUsers(req.tenantId);
    const tgUsers = usersArray.filter(u => u.platform === 'telegram').length;
    const waUsers = usersArray.filter(u => u.platform === 'whatsapp').length;
    const msgUsers = usersArray.filter(u => u.platform === 'messenger').length;
    const igUsers = usersArray.filter(u => u.platform === 'instagram').length;
    const db = require('../database/connection');
    const weeklyMessages = db.prepare(`
        WITH RECURSIVE days(day) AS (
            SELECT date('now', 'localtime', '-6 days')
            UNION ALL
            SELECT date(day, '+1 day') FROM days WHERE day < date('now', 'localtime')
        )
        SELECT days.day, COUNT(messages.id) AS count
        FROM days
        LEFT JOIN messages
          ON date(messages.created_at, 'localtime') = days.day
         AND messages.tenant_id = ?
        GROUP BY days.day
        ORDER BY days.day ASC
    `).all(req.tenantId);

    res.json({
        usersCount: usersArray.length,
        messagesCount: getMessagesCount(req.tenantId),
        weeklyMessages,
        logs: getRecentLogs(),
        status: getIsValidToken() ? "نشط" : "غير مفعّل",
        currentModel: process.env.OPENROUTER_MODEL || "openrouter/free",
        knowledgeText: knowledgeText,
        systemPromptText: systemPromptText,
        adminId: process.env.ADMIN_TELEGRAM_ID || "",
        activeErrorsCount: getActiveErrorsCount(),
        waAutoReply: process.env.WA_AUTO_REPLY !== 'false',

        // Budgets
        budgetOpenrouter: budgetService.getProviderBudget('openrouter').limit || 100.0,
        budgetOpenai: budgetService.getProviderBudget('openai').limit || 100.0,
        budgetGemini: budgetService.getProviderBudget('gemini').limit || 100.0,
        budgetOllama: budgetService.getProviderBudget('ollama').limit || 100.0,

        // RAG Settings
        ragChunkSize: parseInt(getConfig('RAG_CHUNK_SIZE') || '800', 10),
        ragChunkOverlap: parseInt(getConfig('RAG_CHUNK_OVERLAP') || '120', 10),
        ragEmbeddingModel: getConfig('RAG_EMBEDDING_MODEL') || 'nomic-embed-text',
        qdrantCollection: getConfig('QDRANT_COLLECTION') || 'futhing_knowledge',
        ragIndexOnStartup: getConfig('RAG_INDEX_ON_STARTUP') !== 'false',
        qdrantUrl: getConfig('QDRANT_URL') || 'http://127.0.0.1:6333',
        ollamaBaseUrl: getConfig('OLLAMA_BASE_URL') || 'http://127.0.0.1:11434',
        ragMinTopK: parseInt(getConfig('RAG_MIN_TOP_K') || '3', 10),
        ragDefaultTopK: parseInt(getConfig('RAG_DEFAULT_TOP_K') || '5', 10),
        ragMaxTopK: parseInt(getConfig('RAG_MAX_TOP_K') || '7', 10),
        ragCandidateMultiplier: parseInt(getConfig('RAG_CANDIDATE_MULTIPLIER') || '3', 10),
        ragSemanticWeight: parseFloat(getConfig('RAG_SEMANTIC_WEIGHT') || '0.8'),
        ragKeywordWeight: parseFloat(getConfig('RAG_KEYWORD_WEIGHT') || '0.2'),
        ragSimilarityThreshold: parseFloat(getConfig('RAG_SIMILARITY_THRESHOLD') || '0.4'),
        ragNeighborExpansion: getConfig('RAG_NEIGHBOR_EXPANSION') === 'true',
        ragContextBudget: parseInt(getConfig('RAG_CONTEXT_BUDGET') || '3000', 10),

        // Masked sensitive fields (Category C)
        telegramToken: maskSecret(process.env.BOT_TOKEN),
        openrouterKey: maskSecret(process.env.OPENROUTER_API_KEY),
        messengerToken: maskSecret(process.env.MESSENGER_ACCESS_TOKEN),
        instagramToken: maskSecret(process.env.INSTAGRAM_ACCESS_TOKEN),
        metaVerifyToken: maskSecret(process.env.META_VERIFY_TOKEN),
        metaAppSecret: maskSecret(process.env.META_APP_SECRET),
        instagramAppSecret: maskSecret(process.env.INSTAGRAM_APP_SECRET),

        aiProvider: textGenerationConfig?.provider || process.env.AI_PROVIDER || 'openrouter',
        aiModel: textGenerationConfig?.model || process.env.AI_MODEL || process.env.OPENROUTER_MODEL || 'openrouter/free',
        aiApiKey: maskSecret(process.env.AI_API_KEY || ''),
        aiBaseUrl: process.env.AI_BASE_URL || '',
        aiCustomModels: process.env.AI_CUSTOM_MODELS || '[]',
        publicBackendUrl: getSetting('PUBLIC_BACKEND_URL') || process.env.PUBLIC_BACKEND_URL || "",

        messengerAutoReply: process.env.MESSENGER_AUTO_REPLY !== 'false',
        instagramAutoReply: process.env.INSTAGRAM_AUTO_REPLY !== 'false',

        isTelegramConfigured: !!process.env.BOT_TOKEN,
        isOpenRouterConfigured: !!process.env.OPENROUTER_API_KEY,
        isMessengerConfigured: !!process.env.MESSENGER_ACCESS_TOKEN,
        isInstagramConfigured: !!process.env.INSTAGRAM_ACCESS_TOKEN,
        isMetaVerifyConfigured: !!process.env.META_VERIFY_TOKEN && !!process.env.META_APP_SECRET,
        isMetaAppSecretConfigured: !!process.env.META_APP_SECRET,

        platformsCount: {
            telegram: tgUsers,
            whatsapp: waUsers,
            messenger: msgUsers,
            instagram: igUsers
        }
    });
});

router.get('/users', requirePermission('conversations:read'), (req, res) => {
    res.json(listCustomerUsers(req.tenantId));
});

router.get('/chat/:userId', requirePermission('conversations:read'), (req, res) => {
    const userId = req.params.userId;
    const user = findCustomerUserByIdOnly(userId, req.tenantId);
    if (!user) return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
    clearUnreadCount(userId, user.tenantId);
    res.json(listMessages(userId, user.tenantId, user.platform));
});

router.post('/chat/toggle-ai', requirePermission('conversations:write'), (req, res) => {
    const { userId } = req.body;
    const user = findCustomerUserByIdOnly(userId, req.tenantId);

    if (user) {
        const nextState = !user.isAIEnabled;
        updateAIEnabled(userId, nextState, user.tenantId);
        addLog(`تم ${nextState ? 'تفعيل' : 'إيقاف'} الذكاء الاصطناعي للعميل: ${user.name}`);
        res.json({ success: true, isAIEnabled: nextState });
    } else {
        res.status(404).json({ success: false, error: 'المستخدم غير موجود في الذاكرة حالياً.' });
    }
});

router.get('/errors', requirePermission('system:manage'), (req, res) => {
    res.json(listErrors());
});

router.post('/errors/solve', requirePermission('system:manage'), (req, res) => {
    const { id } = req.body;
    solveError(id);
    addLog(`تم تعليم العطل كـ 'تم الحل'`);
    res.json({ success: true });
});

router.post('/config/knowledge', requirePermission('knowledge:manage'), async (req, res) => {
    const { text } = req.body;
    let lease;
    try {
        const { resolveAuthorizedTenant } = require('../rag/security/tenantContext');
        const tenantId = resolveAuthorizedTenant(req);
        lease = await require('../rag/runtime/distributedLockService').acquireLease({
            tenantId, resourceType: 'knowledge_txt', resourceId: 'knowledge.txt',
            operation: 'knowledge_update', failFast: true,
            idempotencyKey: req.get('Idempotency-Key') || null
        });
        if (lease.duplicate) {
            return res.json({ success: true, duplicate: true, operationId: lease.operation.operation_id });
        }
        lease.assertOwnership();
        const filePath = getManualKnowledgePath(tenantId);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, text || '', 'utf8');
        addLog("تحديث قاعدة المعرفة بنجاح");
        addRAGAuditLog('المشرف', 'تحديث النص المعرفي اليدوي', 'knowledge.txt', 'نجاح');
        await lease.release({ result: { success: true } });
        lease = null;
        res.json({ success: true, message: 'تم حفظ وتحديث قاعدة المعرفة بنجاح!' });
    } catch (err) {
        if (lease && !lease.duplicate) await lease.release({ error: err });
        reportError("حفظ قاعدة المعرفة RAG", err.message);
        const conflict = err.code === 'RAG_OPERATION_IN_PROGRESS';
        if (conflict) res.set('Retry-After', '1');
        res.status(conflict ? 409 : 500).json({
            success: false, code: err.code, retryable: err.retryable === true, error: err.message
        });
    }
});

const { getRAGSystemStatus, reindexKnowledgeBase } = require('../rag');

// Custom in-memory rate-limiter for reindexing to avoid spam
const reindexRequests = new Map();
function rateLimitReindex(req, res, next) {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const now = Date.now();
    const timeframe = 60000; // 1 minute
    const maxAttempts = 5;

    let attempts = reindexRequests.get(ip) || [];
    attempts = attempts.filter(time => now - time < timeframe);

    if (attempts.length >= maxAttempts) {
        return res.status(429).json({
            success: false,
            error: 'محاولات إعادة الفهرسة كثيرة جداً. يرجى الانتظار لمدة دقيقة والمحاولة مرة أخرى.'
        });
    }

    attempts.push(now);
    reindexRequests.set(ip, attempts);
    next();
}

function ragMutationError(res, error, fallbackCode = 'RAG_MUTATION_FAILED') {
    const conflictCodes = new Set([
        'RAG_OPERATION_IN_PROGRESS', 'RAG_INDEX_ALREADY_RUNNING',
        'RAG_REPLACE_LOCKED', 'RAG_RECONCILIATION_LOCKED'
    ]);
    const conflict = conflictCodes.has(error.code);
    const unavailable = error.code === 'RAG_LOCK_SERVICE_UNAVAILABLE';
    if (conflict) res.set('Retry-After', '1');
    return res.status(conflict ? 409 : (unavailable ? 503 : 500)).json({
        success: false,
        code: conflict ? 'RAG_OPERATION_IN_PROGRESS' : (error.code || fallbackCode),
        operation: error.operation,
        retryable: error.retryable === true,
        stage: error.stage || 'unknown',
        error: error.message
    });
}

router.use('/rag', requireRagTenant);
router.use('/rag', (req, res, next) => {
    const permission = ['GET', 'HEAD'].includes(req.method)
        ? 'knowledge:read'
        : 'knowledge:manage';
    return requirePermission(permission)(req, res, next);
});

router.get('/rag/access/status', (req, res) => {
    res.json({ success: true, unlocked: hasActiveRagAccess(req) });
});

router.post('/rag/access/unlock', (req, res) => {
    const now = Date.now();
    const blockedUntil = Number(req.session.ragAccessBlockedUntil || 0);
    if (blockedUntil > now) {
        return res.status(429).json({
            success: false,
            error: 'محاولات كثيرة. حاول مرة أخرى بعد دقائق قليلة.'
        });
    }

    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!password || !bcrypt.compareSync(password, RAG_ACCESS_PASSWORD_HASH)) {
        req.session.ragAccessFailedAttempts = Number(req.session.ragAccessFailedAttempts || 0) + 1;
        if (req.session.ragAccessFailedAttempts >= 5) {
            req.session.ragAccessBlockedUntil = now + (5 * 60 * 1000);
            req.session.ragAccessFailedAttempts = 0;
        }
        audit({
            actorId: req.session.userId, tenantId: req.ragTenantId,
            action: 'rag_access_unlock', resourceType: 'rag', outcome: 'failure'
        });
        return res.status(401).json({ success: false, error: 'كلمة المرور غير صحيحة.' });
    }

    req.session.ragAccessUnlockedAt = now;
    req.session.ragAccessFailedAttempts = 0;
    req.session.ragAccessBlockedUntil = 0;
    audit({
        actorId: req.session.userId, tenantId: req.ragTenantId,
        action: 'rag_access_unlock', resourceType: 'rag', outcome: 'success'
    });
    return res.json({ success: true, unlocked: true, expiresInSeconds: RAG_ACCESS_TTL_MS / 1000 });
});

router.use('/rag', (req, res, next) => {
    if (['GET', 'HEAD'].includes(req.method)) return next();

    // Knowledge files and every reindex flow stay available to authorized
    // administrators without the secondary settings password.
    if (isKnowledgeOperation(req.path)) return next();

    return requireRagAccess(req, res, next);
});

// Authenticated by the parent API router and tenant-authorized here. Values are
// returned with source/scope/freshness metadata; unavailable metrics remain null.
router.get('/admin/rag/metrics-summary', requireRagTenant, async (req, res) => {
    try {
        const { getMetricsSummary } = require('../rag/services/ragObservabilityService');
        res.json({
            success: true,
            metrics: await getMetricsSummary(req.ragTenantId)
        });
    } catch (error) {
        res.status(503).json({
            success: false,
            code: error.code || 'RAG_METRICS_UNAVAILABLE',
            error: error.message
        });
    }
});

// GET /rag/status -> authenticated, returns RAG system stats
router.get('/rag/status', async (req, res) => {
    try {
        const status = await getRAGSystemStatus(req.ragTenantId);
        res.json({ success: true, status });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/rag/cache/metrics', (req, res) => {
    const retrievalCache = require('../rag/cache/retrievalCache');
    res.json({ success: true, metrics: retrievalCache.getMetrics(req.ragTenantId) });
});

router.get('/rag/injection/security-report', (req, res) => {
    try {
        const guard = require('../rag/security/promptInjectionGuard');
        res.json({
            success: true,
            scannerVersion: guard.SCANNER_VERSION,
            metrics: guard.getMetrics(),
            quarantined: guard.getQuarantineReport({
                tenantId: req.ragTenantId,
                isAdmin: true
            })
        });
    } catch (error) {
        res.status(403).json({ success: false, error: error.message });
    }
});

router.post('/rag/injection/override', (req, res) => {
    try {
        const guard = require('../rag/security/promptInjectionGuard');
        const result = guard.applyAdminOverride({
            quarantineId: req.body?.quarantineId,
            tenantId: req.ragTenantId,
            adminId: req.session.userId,
            reason: req.body?.reason,
            decision: req.body?.decision,
            isAdmin: true
        });
        addRAGAuditLog(req.session.userId, 'مراجعة تحذير حقن RAG',
            req.body?.quarantineId || 'unknown', 'نجاح');
        res.json({ success: true, result });
    } catch (error) {
        res.status(error.code === 'RAG_INJECTION_QUARANTINE_NOT_FOUND' ? 404 : 403)
            .json({ success: false, error: error.message });
    }
});

router.get('/rag/runtime/metrics', (req, res) => {
    const metrics = require('../rag/runtime/ragMetrics');
    res.json({ success: true, metrics: metrics.snapshot() });
});

router.get('/rag/reconciliation', (req, res) => {
    try {
        const { getReconciliationHistory } = require('../rag/services/ragReconciliationService');
        res.json({
            success: true,
            tenantId: req.ragTenantId,
            runs: getReconciliationHistory(req.ragTenantId, req.query.limit)
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/rag/reconciliation/run', rateLimitReindex, async (req, res) => {
    const cancellation = require('../rag/runtime/requestCancellation').createRequestCancellation(req, res);
    try {
        const { reconcileRagIndex } = require('../rag/services/ragReconciliationService');
        const report = await reconcileRagIndex({
            tenantId: req.ragTenantId,
            dryRun: true,
            includeLegacyAudit: req.body.includeLegacyAudit === true,
            continuationOffset: req.body.continuationOffset ?? null,
            signal: cancellation.signal,
            idempotencyKey: req.get('Idempotency-Key') || null,
            operatorId: req.session?.username || req.session?.userId || 'administrator'
        });
        if (!cancellation.signal.aborted) res.json({ success: true, report });
    } catch (error) {
        ragMutationError(res, error, 'RAG_RECONCILIATION_FAILED');
    } finally { cancellation.cleanup(); }
});

router.post('/rag/reconciliation/cleanup', rateLimitReindex, async (req, res) => {
    if (req.body.confirmCleanup !== true) {
        return res.status(400).json({
            success: false,
            code: 'RAG_CLEANUP_CONFIRMATION_REQUIRED',
            error: 'confirmCleanup=true is required for destructive reconciliation cleanup.'
        });
    }
    const cancellation = require('../rag/runtime/requestCancellation').createRequestCancellation(req, res);
    try {
        const { reconcileRagIndex } = require('../rag/services/ragReconciliationService');
        const report = await reconcileRagIndex({
            tenantId: req.ragTenantId,
            dryRun: false,
            confirmCleanup: true,
            includeLegacyAudit: req.body.includeLegacyAudit === true,
            continuationOffset: req.body.continuationOffset ?? null,
            signal: cancellation.signal,
            idempotencyKey: req.get('Idempotency-Key') || null,
            operatorId: req.session?.username || req.session?.userId || 'administrator'
        });
        const status = report.cleanup?.success ? 200 : 207;
        if (!cancellation.signal.aborted) {
            res.status(status).json({ success: report.cleanup?.success === true, report });
        }
    } catch (error) {
        ragMutationError(res, error, 'RAG_RECONCILIATION_FAILED');
    } finally { cancellation.cleanup(); }
});

router.post('/rag/reconciliation/reindex', rateLimitReindex, async (req, res) => {
    const cancellation = require('../rag/runtime/requestCancellation').createRequestCancellation(req, res);
    try {
        const result = await reindexKnowledgeBase(true, {
            tenantId: req.ragTenantId, signal: cancellation.signal,
            idempotencyKey: req.get('Idempotency-Key') || null
        });
        if (!['active', 'unchanged'].includes(result.status)) {
            const error = new Error(`حالة الفهرسة النهائية غير صالحة: ${result.status}`);
            error.code = 'RAG_FINAL_STATE_INVALID';
            error.stage = 'activation';
            throw error;
        }
        if (!cancellation.signal.aborted) res.status(200).json({
            success: true,
            tenantId: req.ragTenantId,
            result: {
                ...result,
                unchanged: result.status === 'unchanged',
                status: 'active'
            }
        });
    } catch (error) {
        ragMutationError(res, error, 'RAG_INDEX_FAILED');
    } finally { cancellation.cleanup(); }
});

// POST /rag/reindex -> authenticated, rate-limited, triggers reindexing
router.post('/rag/reindex', rateLimitReindex, async (req, res) => {
    const force = req.body.force === true;
    const cancellation = require('../rag/runtime/requestCancellation').createRequestCancellation(req, res);
    try {
        const result = await reindexKnowledgeBase(force, {
            tenantId: req.ragTenantId, signal: cancellation.signal,
            idempotencyKey: req.get('Idempotency-Key') || null
        });
        if (cancellation.signal.aborted) return;
        if (!['active', 'unchanged'].includes(result.status)) {
            const error = new Error(`حالة الفهرسة النهائية غير صالحة: ${result.status}`);
            error.code = 'RAG_FINAL_STATE_INVALID';
            error.stage = 'activation';
            throw error;
        }
        res.status(200).json({
            success: true,
            source: result.source || 'knowledge.txt',
            tenantId: result.tenantId || req.ragTenantId,
            indexVersionId: result.indexVersionId || null,
            status: 'active',
            unchanged: result.status === 'unchanged',
            chunkCount: result.chunkCount ?? result.totalVectors,
            previousVersionCleanup: result.previousVersionCleanup || 'completed',
            documentId: result.documentId,
            chunksCreated: result.chunksCreated,
            chunksUpdated: result.chunksUpdated,
            chunksDeleted: result.chunksDeleted,
            totalVectors: result.totalVectors,
            durationMs: result.durationMs
        });
    } catch (err) {
        ragMutationError(res, err, 'RAG_INDEX_FAILED');
    } finally { cancellation.cleanup(); }
});

router.get('/ai/ollama-models', async (req, res) => {
    const cancellation = require('../rag/runtime/requestCancellation').createRequestCancellation(req, res);
    try {
        const { listModels } = require('../rag/embeddings/ollamaEmbeddingProvider');
        const models = await listModels({ signal: cancellation.signal });
        if (!cancellation.signal.aborted) res.json({ success: true, models });
    } catch (err) {
        if (!cancellation.signal.aborted) res.status(503).json({
            success: false, models: [], code: err.code || 'RAG_OLLAMA_UNAVAILABLE',
            stage: err.stage || 'ollama_health', retryable: err.retryable === true
        });
    } finally { cancellation.cleanup(); }
});

router.get('/whatsapp/config', requirePermission('integrations:manage'), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const db = require('../database/connection');
        let row = db.prepare('SELECT * FROM whatsapp_tenant_configs WHERE tenant_id = ?').get(tenantId);
        if (!row) {
            row = { tenant_id: tenantId, provider_type: 'web', config_json: '{}' };
        }
        const config = JSON.parse(row.config_json || '{}');
        if (config.accessToken) {
            config.accessToken = maskSecret(config.accessToken);
        }

        // Generate the callback URL from PUBLIC_BACKEND_URL database setting or process fallback
        const publicBackendUrl = getSetting('PUBLIC_BACKEND_URL') || process.env.PUBLIC_BACKEND_URL || process.env.PUBLIC_BASE_URL || process.env.BACKEND_URL;
        let webhookUrl = null;
        let warning = null;

        if (publicBackendUrl) {
            const baseUrlClean = publicBackendUrl.replace(/\/$/, "");
            // Point strictly to the root webhook endpoint (/whatsapp/:tenantId) implemented in webhooks.js
            webhookUrl = `${baseUrlClean}/whatsapp/${tenantId}`;
        } else {
            warning = "تنبيه: لم يتم ضبط عنوان السيرفر العام (Public Backend URL). يرجى ملء حقل عنوان السيرفر العام أدناه لتوليد رابط الويب هوك الخاص بك بشكل صحيح.";
        }

        res.json({
            success: true,
            providerType: row.provider_type,
            config,
            webhookUrl,
            warning,
            publicBackendUrl: getSetting('PUBLIC_BACKEND_URL') || ""
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/whatsapp/config', requirePermission('integrations:manage'), async (req, res) => {
    const { providerType, config } = req.body;
    const targetTenantId = req.tenantId;
    if (!providerType) {
        return res.status(400).json({ success: false, error: 'نوع المزود مطلوب.' });
    }

    try {
        let finalConfig = config || {};
        if (providerType === 'cloud' && finalConfig.accessToken) {
            if (isMaskedPlaceholder(finalConfig.accessToken)) {
                // Retrieve the existing stored config to preserve the original token
                const db = require('../database/connection');
                const existingRow = db.prepare('SELECT config_json FROM whatsapp_tenant_configs WHERE tenant_id = ?').get(targetTenantId);
                if (existingRow) {
                    const existingConfig = JSON.parse(existingRow.config_json || '{}');
                    if (existingConfig.accessToken) {
                        finalConfig.accessToken = existingConfig.accessToken;
                    }
                }
            }
        }

        const manager = require('../channels/whatsapp-providers/WhatsAppProviderManager');
        await manager.switchProvider(targetTenantId, providerType, finalConfig);
        res.json({ success: true, message: 'تم تحديث إعدادات بوابة واتساب وتفعيل المزود بنجاح!' });
    } catch (err) {
        reportError(`تعديل إعدادات مزود واتساب (${targetTenantId})`, err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/whatsapp/status', requirePermission('integrations:manage'), (req, res) => {
    const provider = require('../channels/whatsapp-providers/WhatsAppProviderManager')
        .getProvider(req.tenantId);
    res.json({
        status: provider?.getStatus ? provider.getStatus() : getWaStatus(),
        qr: provider?.getQrCode ? provider.getQrCode() : getLastQrCodeUrl(),
        tenantId: req.tenantId
    });
});

// تسجيل خروج واتساب الذكي لإعادة توليد الـ QR
router.post('/whatsapp/logout', requirePermission('integrations:manage'), async (req, res) => {
    addLog("🧹 جاري إغلاق وفصل اتصال واتساب وإعادة تهيئة البوابات...");
    console.log("🧹 جاري إغلاق وفصل اتصال واتساب...");

    setWaStatus("جاري التحميل...");
    setLastQrCodeUrl("");

    try {
        const manager = require('../channels/whatsapp-providers/WhatsAppProviderManager');
        const currentClient = getWaClient();
        if (currentClient) {
            try {
                // LocalAuth.logout() clears the authenticated session intentionally.
                await currentClient.logout();
            } catch (e) {
                console.log("تم تسجيل خروج محرك واتساب أو كانت الجلسة مغلقة بالفعل.");
            }
        }

        const db = require('../database/connection');
        const row = db.prepare("SELECT provider_type, config_json FROM whatsapp_tenant_configs WHERE tenant_id = ?").get(req.tenantId);
        const providerType = row ? row.provider_type : 'web';
        const config = row ? JSON.parse(row.config_json || '{}') : {};
        await manager.switchProvider(req.tenantId, providerType, config);

        res.json({ success: true, message: "تم فصل الاتصال بنجاح وتصفير المحادثة، جاري توليد كود QR جديد..." });
    } catch (err) {
        reportError("فصل اتصال واتساب يدوياً", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /rag/playground -> testing playground for RAG query and LLM generation
router.post('/rag/playground', async (req, res) => {
    const { question } = req.body;
    if (!question) {
        return res.status(400).json({ success: false, error: 'الرجاء إدخال سؤال.' });
    }

    const startTime = Date.now();
    try {
        const { getAIResponse } = require('../services/ai');
        const { getConfig } = require('../rag/config/ragConfig');
        const retrievalTelemetry = {};

        // 1. Run the unified response generation pipeline exactly once
        let finalAnswer = 'لم يتم تهيئة مفتاح OpenRouter لتوليد الإجابة النهائية.';
        let aiResp = null;
        try {
            aiResp = await getAIResponse(
                'playground_temp_user',
                question,
                'text',
                null,
                {
                    tenantId: req.ragTenantId, channel: 'playground', retrievalTelemetry,
                    conversationId: `playground:${req.ragTenantId}`
                }
            );
            if (aiResp) {
                finalAnswer = aiResp;
            } else if (process.env.OPENROUTER_API_KEY) {
                finalAnswer = 'فشل الحصول على رد من الذكاء الاصطناعي.';
            }
        } catch (aiErr) {
            finalAnswer = `خطأ أثناء الاتصال بالذكاء الاصطناعي: ${aiErr.message}`;
        }

        // 2. Extract single-pass retrieval metadata, profiling, and chunks
        const rProfiling = retrievalTelemetry.profiling || null;
        const retrievalMode = retrievalTelemetry.mode || 'unavailable';

        // 3. Fallback to reading defaults if retrieval didn't run (unlikely)
        let dynamicTopK = parseInt(getConfig('RAG_DEFAULT_TOP_K'), 10) || 5;
        let similarityThreshold = parseFloat(getConfig('RAG_SIMILARITY_THRESHOLD')) || 0.4;
        let promptContext = '';
        let topChunks = [];

        if (rProfiling) {
            dynamicTopK = rProfiling.selectedTopK !== undefined ? rProfiling.selectedTopK : dynamicTopK;
            similarityThreshold = rProfiling.similarityThreshold !== undefined ? rProfiling.similarityThreshold : similarityThreshold;
            promptContext = rProfiling.optimizedContext || '';
            topChunks = rProfiling.topChunks || [];
        }

        const executionTime = Date.now() - startTime;

        // 4. Construct prompt info for debugger mapping
        const { getSystemPrompt } = require('../services/knowledge');
        let sysPrompt = getSystemPrompt() || '';
        if (promptContext) {
            sysPrompt += `\n\nأجب على سؤال المستخدم بناءً على معلومات سياق المعرفة المرفقة بالأسفل فقط...\n\nسياق المعرفة المسترجع:\n${promptContext}`;
        }
        const { redactSecrets } = require('../rag/security/promptInjectionGuard');
        const promptSent = redactSecrets(`[System Instructions]:\n${sysPrompt}\n\n[User Query]:\n${question}`);
        const tokensUsed = Math.ceil((promptSent.length + finalAnswer.length) / 4);

        res.json({
            success: true,
            retrievedChunks: topChunks.map((c, idx) => ({
                text: redactSecrets(c.text),
                similarityScore: c.semanticScore || c.score || c.similarityScore || 0,
                keywordScore: c.keywordScore || 0,
                rerankScore: c.rerankScore || c.score || 0,
                documentName: c.source || c.payload?.documentName || c.documentName || 'معرفة عامة',
                chunkId: c.chunkId || c.payload?.chunkId || '',
                finalRankOrder: idx + 1
            })),
            similarityThreshold,
            selectedTopK: dynamicTopK,
            promptContext: redactSecrets(promptContext),
            finalAnswer,
            executionTime: rProfiling ? rProfiling.totalDuration : executionTime,
            mode: rProfiling
                ? (rProfiling.intent !== 'General' ? `Hybrid (${rProfiling.intent})` : 'Hybrid')
                : retrievalMode,
            debug: {
                promptSent,
                tokensUsed,
                responseLatency: rProfiling ? `${rProfiling.totalDuration} ms` : `${executionTime} ms`,
                stages: rProfiling ? rProfiling.stages : null,
                visualization: rProfiling ? rProfiling.visualization : null,
                intent: rProfiling ? rProfiling.intent : null,
                variations: rProfiling ? rProfiling.variations : null
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: Number(require('../rag/config/ragConfig').getConfig('RAG_MAX_FILE_SIZE_BYTES'))
            || 10 * 1024 * 1024
    }
});
const kbDocService = require('../rag/services/knowledgeDocumentService');

// GET /rag/source-types -> returns dynamic expandable source types configuration
router.get('/rag/source-types', (req, res) => {
    const SOURCE_TYPES = {
        uploaded_file: { key: 'uploaded_file', label: 'ملف مرفوع', icon: 'fa-file-upload', status: 'active', description: 'ملفات مستندات مثل PDF, TXT, DOCX, MD' },
        manual_knowledge: { key: 'manual_knowledge', label: 'نص معرفي يدوي', icon: 'fa-edit', status: 'active', description: 'إدخال نصوص وتحريرها مباشرة في المنصة' },
        url: { key: 'url', label: 'رابط ويب (مستقبلي)', icon: 'fa-link', status: 'future', description: 'استيراد وسحب محتوى صفحات ومواقع الويب' },
        api: { key: 'api', label: 'واجهة برمجية API (مستقبلي)', icon: 'fa-plug', status: 'future', description: 'ربط وتغذية حية للبيانات عبر واجهات API' },
        database: { key: 'database', label: 'قاعدة بيانات (مستقبلي)', icon: 'fa-database', status: 'future', description: 'الاتصال المباشر بقواعد البيانات وجداول المعرفة' }
    };
    res.json({ success: true, sourceTypes: SOURCE_TYPES });
});

// GET /rag/chunks -> Chunk Inspector endpoint with query search and pagination
router.get('/rag/chunks', async (req, res) => {
    try {
        const search = req.query.search ? req.query.search.toLowerCase() : '';
        const documentId = req.query.documentId || '';
        const { page, limit } = parsePagination(req.query);

        const db = require('../database/connection');
        const docs = db.prepare(
            "SELECT * FROM knowledge_documents WHERE tenant_id = ? AND status = 'indexed'"
        ).all(req.ragTenantId);

        const kbPath = getManualKnowledgePath(req.ragTenantId);
        if (fs.existsSync(kbPath)) {
            const stat = fs.statSync(kbPath);
            docs.push({
                document_key: 'manual_text',
                original_name: 'النص المعرفي اليدوي (knowledge.txt)',
                source_type: 'manual',
                storage_path: kbPath,
                content_hash: 'manual_hash',
                status: 'indexed',
                tenant_id: req.ragTenantId,
                version: 1,
                created_at: stat.birthtime || stat.mtime
            });
        }

        const { extractTextFromBuffer } = require('../rag/loaders/documentExtractionService');
        const { cleanText } = require('../rag/processing/textCleaner');
        const { chunkDocument } = require('../rag/processing/documentChunker');
        const { getConfig } = require('../rag/config/ragConfig');

        let allChunks = [];

        for (const doc of docs) {
            if (documentId && doc.document_key !== documentId) continue;

            if (fs.existsSync(doc.storage_path)) {
                let text = '';
                if (doc.document_key === 'manual_text') {
                    text = fs.readFileSync(doc.storage_path, 'utf8');
                } else {
                    const fileBuffer = fs.readFileSync(doc.storage_path);
                    text = await extractTextFromBuffer(doc.source_type, fileBuffer);
                }

                const cleaned = cleanText(text);
                const virtualDoc = {
                    documentId: doc.document_key,
                    source: doc.original_name,
                    sourceType: doc.source_type === 'manual' ? 'manual_knowledge' : 'uploaded_document',
                    originalText: cleaned,
                    documentHash: doc.content_hash
                    ,tenantId: req.ragTenantId
                };

                const chunkSize = parseInt(getConfig('RAG_CHUNK_SIZE'), 10) || 800;
                const chunkOverlap = parseInt(getConfig('RAG_CHUNK_OVERLAP'), 10) || 120;

                const chunks = chunkDocument(virtualDoc, chunkSize, chunkOverlap);
                allChunks.push(...chunks);
            }
        }

        if (search) {
            allChunks = allChunks.filter(c =>
                c.text.toLowerCase().includes(search) ||
                c.normalizedText.toLowerCase().includes(search) ||
                c.chunkId.toLowerCase().includes(search)
            );
        }

        const total = allChunks.length;
        const offset = (page - 1) * limit;
        const paginatedChunks = allChunks.slice(offset, offset + limit);

        res.json({
            success: true,
            chunks: paginatedChunks,
            pagination: {
                total,
                page,
                limit
            }
        });
    } catch (err) {
        const validation = err.code === 'INVALID_PAGINATION';
        res.status(validation ? 400 : 500).json({
            success: false,
            code: err.code || 'RAG_CHUNKS_FAILED',
            error: validation ? err.message : 'تعذر تحميل المقاطع.'
        });
    }
});

// GET /rag/documents/:documentId/preview -> Knowledge Preview endpoint
router.get('/rag/documents/:documentId/preview', async (req, res) => {
    try {
        const documentId = req.params.documentId;
        let storagePath = '';
        let originalName = '';
        let sourceType = 'uploaded_file';
        let fileType = 'TXT';
        let contentHash = '';

        if (documentId === 'manual_text') {
            const kbPath = getManualKnowledgePath(req.ragTenantId);
            if (!fs.existsSync(kbPath)) {
                return res.status(404).json({ success: false, error: 'الملف اليدوي غير موجود.' });
            }
            storagePath = kbPath;
            originalName = 'النص المعرفي اليدوي (knowledge.txt)';
            sourceType = 'manual_knowledge';
            fileType = 'MANUAL';
            contentHash = 'manual_hash';
        } else {
            const db = require('../database/connection');
            const d = db.prepare(
                'SELECT * FROM knowledge_documents WHERE tenant_id = ? AND document_key = ?'
            ).get(req.ragTenantId, documentId);
            if (!d) {
                return res.status(404).json({ success: false, error: 'المستند غير موجود.' });
            }
            storagePath = d.storage_path;
            originalName = d.original_name;
            sourceType = 'uploaded_file';
            fileType = d.source_type ? d.source_type.toUpperCase() : 'TXT';
            contentHash = d.content_hash;
        }

        if (!fs.existsSync(storagePath)) {
            return res.status(404).json({ success: false, error: 'ملف المستند غير موجود على السيرفر.' });
        }

        const { extractTextFromBuffer } = require('../rag/loaders/documentExtractionService');
        const { cleanText } = require('../rag/processing/textCleaner');
        const { chunkDocument } = require('../rag/processing/documentChunker');
        const { getConfig } = require('../rag/config/ragConfig');

        let rawText = '';
        if (documentId === 'manual_text') {
            rawText = fs.readFileSync(storagePath, 'utf8');
        } else {
            const fileBuffer = fs.readFileSync(storagePath);
            const dRecord = require('../database/connection').prepare(
                'SELECT * FROM knowledge_documents WHERE tenant_id = ? AND document_key = ?'
            ).get(req.ragTenantId, documentId);
            rawText = await extractTextFromBuffer(dRecord.source_type, fileBuffer);
        }

        const cleanedText = cleanText(rawText);

        const virtualDoc = {
            documentId,
            source: originalName,
            sourceType,
            originalText: cleanedText,
            documentHash: contentHash
            ,tenantId: req.ragTenantId
        };

        const chunkSize = parseInt(getConfig('RAG_CHUNK_SIZE'), 10) || 800;
        const chunkOverlap = parseInt(getConfig('RAG_CHUNK_OVERLAP'), 10) || 120;

        const chunks = chunkDocument(virtualDoc, chunkSize, chunkOverlap);

        res.json({
            success: true,
            originalName,
            sourceType,
            fileType,
            originalText: rawText,
            cleanedText,
            chunksCount: chunks.length,
            chunks: chunks.map(c => ({
                chunkId: c.chunkId,
                index: c.chunkIndex,
                text: c.text,
                characterCount: c.text.length,
                estimatedTokens: Math.ceil(c.text.split(/\s+/).length * 1.3),
                previousChunkId: c.previousChunkId,
                nextChunkId: c.nextChunkId
            }))
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /rag/documents/:documentId/download -> authenticated original document download
router.get('/rag/documents/:documentId/download', (req, res) => {
    try {
        const documentId = req.params.documentId;
        let storagePath;
        let downloadName;

        if (documentId === 'manual_text') {
            storagePath = getManualKnowledgePath(req.ragTenantId);
            downloadName = 'knowledge.txt';
        } else {
            const db = require('../database/connection');
            const document = db.prepare(`
                SELECT storage_path, original_name
                FROM knowledge_documents
                WHERE tenant_id = ? AND document_key = ?
            `).get(req.ragTenantId, documentId);
            if (!document) {
                return res.status(404).json({ success: false, error: 'المستند غير موجود.' });
            }
            storagePath = document.storage_path;
            downloadName = document.original_name;
        }

        if (!storagePath || !fs.existsSync(storagePath)) {
            return res.status(404).json({ success: false, error: 'ملف المستند غير موجود على السيرفر.' });
        }

        return res.download(storagePath, downloadName, (error) => {
            if (error && !res.headersSent) {
                res.status(500).json({ success: false, error: 'تعذر تحميل ملف المستند.' });
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /rag/documents
router.get('/rag/documents', async (req, res) => {
    try {
        const pagination = parsePagination(req.query);
        const filters = {
            tenantId: req.ragTenantId,
            search: req.query.search,
            type: req.query.type,
            status: req.query.status,
            page: pagination.page,
            limit: pagination.limit
        };
        const documents = kbDocService.listDocuments(filters);
        const total = kbDocService.countDocuments(filters);

        // Format to metadata-only safe payload
        const safeDocs = documents.map(d => ({
            id: d.id,
            documentId: d.document_key,
            originalFilename: d.original_name,
            fileType: d.source_type ? d.source_type.toUpperCase() : 'TXT',
            sourceType: 'uploaded_file',
            fileSize: d.file_size,
            status: d.status,
            chunkCount: d.chunk_count,
            version: d.version || 1,
            createdAt: d.created_at,
            indexedAt: d.indexed_at,
            indexingError: d.indexing_error
        }));

        // Include manual knowledge.txt as a native document source for beautiful unified UI rendering
        const kbPath = getManualKnowledgePath(req.ragTenantId);
        if (fs.existsSync(kbPath)) {
            const stat = fs.statSync(kbPath);
            const { getIndexingState } = require('../rag/indexing/knowledgeIndexingService');
            const indexState = getIndexingState(req.ragTenantId, 'knowledge.txt');

            const manualDoc = {
                id: 9999,
                documentId: 'manual_text',
                originalFilename: 'النص المعرفي اليدوي (knowledge.txt)',
                fileType: 'MANUAL',
                sourceType: 'manual_knowledge',
                fileSize: stat.size,
                status: indexState ? indexState.last_status : 'uploaded',
                chunkCount: indexState ? indexState.total_chunks : 0,
                version: 1,
                createdAt: stat.birthtime || stat.mtime,
                indexedAt: indexState ? indexState.last_success_at : null,
                indexingError: indexState ? indexState.last_error : null
            };

            // Filter manualDoc if filters are active
            let includeManual = true;
            if (filters.search && !manualDoc.originalFilename.includes(filters.search)) {
                includeManual = false;
            }
            if (filters.type && filters.type !== 'manual_text' && filters.type !== 'manual') {
                includeManual = false;
            }
            if (filters.status && manualDoc.status !== filters.status) {
                includeManual = false;
            }

            if (includeManual) {
                safeDocs.unshift(manualDoc);
            }
        }

        res.json({
            success: true,
            documents: safeDocs,
            pagination: {
                total: total + (safeDocs.some(d => d.documentId === 'manual_text') ? 1 : 0),
                page: pagination.page,
                limit: pagination.limit
            }
        });
    } catch (err) {
        const validation = err.code === 'INVALID_PAGINATION';
        res.status(validation ? 400 : 500).json({
            success: false,
            code: err.code || 'RAG_DOCUMENT_LIST_FAILED',
            error: validation ? err.message : 'تعذر تحميل المستندات.'
        });
    }
});

// GET /rag/documents/:documentId
router.get('/rag/documents/:documentId', async (req, res) => {
    try {
        const db = require('../database/connection');
        const d = db.prepare(`
            SELECT * FROM knowledge_documents WHERE tenant_id = ? AND document_key = ?
        `).get(req.ragTenantId, req.params.documentId);
        if (!d) {
            return res.status(404).json({ success: false, error: 'المستند غير موجود' });
        }

        res.json({
            success: true,
            document: {
                id: d.id,
                documentId: d.document_key,
                originalFilename: d.original_name,
                fileType: d.source_type ? d.source_type.toUpperCase() : 'TXT',
                sourceType: 'uploaded_file',
                fileSize: d.file_size,
                status: d.status,
                chunkCount: d.chunk_count,
                version: d.version || 1,
                createdAt: d.created_at,
                indexedAt: d.indexed_at,
                indexingError: d.indexing_error
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /rag/documents/upload
router.post('/rag/documents/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'الرجاء إرفاق ملف للرفع.' });
    }

    const cancellation = require('../rag/runtime/requestCancellation').createRequestCancellation(req, res);
    try {
        const overwriteAction = req.body.overwriteAction || req.query.overwriteAction;
        const doc = await kbDocService.uploadAndRegisterDocument(
            req.file.originalname,
            req.file.mimetype,
            req.file.buffer,
            {
                overwriteAction, tenantId: req.ragTenantId, signal: cancellation.signal,
                idempotencyKey: req.get('Idempotency-Key') || null,
                mediaDescription: req.body.mediaDescription || null
            }
        );
        if (cancellation.signal.aborted) return;
        const { assertActiveDocument } = require('../rag/indexing/indexingLifecycle');
        assertActiveDocument(doc);

        addRAGAuditLog('المشرف', 'رفع مستند المعرفة', doc.original_name, 'نجاح');

        console.log('[Index] Response sent', {
            tenantId: req.ragTenantId,
            documentId: doc.logical_document_id || doc.document_key,
            versionId: doc.version_id || null,
            stage: 'active',
            durationMs: 0
        });
        res.status(200).json({
            success: true,
            documentId: doc.logical_document_id || doc.document_key,
            versionId: doc.version_id || null,
            status: doc.status,
            chunkCount: doc.chunk_count,
            oldVersionCleanup: doc.oldVersionCleanup || 'not_applicable',
            document: {
                id: doc.id,
                documentId: doc.document_key,
                originalFilename: doc.original_name,
                fileType: doc.source_type ? doc.source_type.toUpperCase() : 'TXT',
                sourceType: 'uploaded_file',
                fileSize: doc.file_size,
                status: doc.status,
                chunkCount: doc.chunk_count,
                version: doc.version || 1,
                createdAt: doc.created_at,
                indexedAt: doc.indexed_at
                , mediaDescription: doc.media_description || null
                , aiSendEnabled: doc.ai_send_enabled === 1
            }
        });
    } catch (err) {
        if (err.code === 'RAG_REPLACE_LOCKED') {
            return ragMutationError(res, err, 'RAG_REPLACE_FAILED');
        }
        if (err.previousVersionPreserved) {
            return res.status(500).json({
                success: false,
                stage: err.stage,
                error: err.message,
                previousVersionPreserved: true
            });
        }
        if (err.code === 'DUPLICATE_UPLOAD') {
            return res.status(409).json({
                success: false,
                code: 'DUPLICATE_UPLOAD',
                message: err.message,
                existing: err.existing
            });
        }
        if (err.code === 'DUPLICATE_DOCUMENT' || err.message.includes('موجود مسبقاً')) {
            return res.status(409).json({ success: false, code: err.code || 'DUPLICATE_DOCUMENT', error: err.message });
        }
        if (err.code === 'RAG_FILE_TOO_LARGE') {
            return res.status(413).json({ success: false, code: err.code, error: err.message });
        }
        if (err.code === 'UNSUPPORTED_FILE_TYPE' || err.code === 'INVALID_MIME_TYPE') {
            return res.status(415).json({ success: false, code: err.code, error: err.message });
        }
        if (!cancellation.signal.aborted) ragMutationError(res, err, 'RAG_INDEX_FAILED');
    } finally { cancellation.cleanup(); }
});

// POST /rag/documents/:documentId/reindex
router.post('/rag/documents/:documentId/reindex', async (req, res) => {
    const cancellation = require('../rag/runtime/requestCancellation').createRequestCancellation(req, res);
    try {
        if (req.params.documentId === 'manual_text') {
            const { reindexKnowledgeBase } = require('../rag/indexing/knowledgeIndexingService');
            const result = await reindexKnowledgeBase(true, {
                tenantId: req.ragTenantId, signal: cancellation.signal,
                idempotencyKey: req.get('Idempotency-Key') || null
            });
            if (cancellation.signal.aborted) return;
            if (!['active', 'unchanged'].includes(result.status)) {
                const error = new Error(`حالة الفهرسة النهائية غير صالحة: ${result.status}`);
                error.code = 'RAG_FINAL_STATE_INVALID';
                error.stage = 'activation';
                throw error;
            }
            const stat = fs.statSync(getManualKnowledgePath(req.ragTenantId));
            return res.json({
                success: true,
                document: {
                    id: 9999,
                    documentId: 'manual_text',
                    originalFilename: 'النص المعرفي اليدوي (knowledge.txt)',
                    fileType: 'MANUAL',
                    fileSize: stat.size,
                    status: result.status === 'unchanged' ? 'active' : result.status,
                    chunkCount: result.totalVectors,
                    createdAt: stat.birthtime || stat.mtime,
                    indexedAt: new Date().toISOString()
                }
            });
        }

        const doc = await kbDocService.reindexDocument(req.params.documentId, {
            tenantId: req.ragTenantId, signal: cancellation.signal,
            idempotencyKey: req.get('Idempotency-Key') || null,
            operationType: 'document_reindex'
        });
        if (cancellation.signal.aborted) return;
        require('../rag/indexing/indexingLifecycle').assertActiveDocument(doc);
        res.json({
            success: true,
            document: {
                id: doc.id,
                documentId: doc.document_key,
                originalFilename: doc.original_name,
                fileType: doc.source_type ? doc.source_type.toUpperCase() : 'TXT',
                fileSize: doc.file_size,
                status: doc.status,
                chunkCount: doc.chunk_count,
                createdAt: doc.created_at,
                indexedAt: doc.indexed_at
            }
        });
    } catch (err) {
        if (!cancellation.signal.aborted) ragMutationError(res, err, 'RAG_INDEX_FAILED');
    } finally { cancellation.cleanup(); }
});

// POST /rag/documents/:documentId/retry
router.post('/rag/documents/:documentId/retry', async (req, res) => {
    const cancellation = require('../rag/runtime/requestCancellation').createRequestCancellation(req, res);
    try {
        const doc = await kbDocService.retryFailedDocument(req.params.documentId, {
            tenantId: req.ragTenantId, signal: cancellation.signal,
            idempotencyKey: req.get('Idempotency-Key') || null,
            operationType: 'document_retry'
        });
        if (cancellation.signal.aborted) return;
        require('../rag/indexing/indexingLifecycle').assertActiveDocument(doc);
        res.json({
            success: true,
            document: {
                id: doc.id,
                documentId: doc.document_key,
                originalFilename: doc.original_name,
                fileType: doc.source_type ? doc.source_type.toUpperCase() : 'TXT',
                fileSize: doc.file_size,
                status: doc.status,
                chunkCount: doc.chunk_count,
                createdAt: doc.created_at,
                indexedAt: doc.indexed_at
            }
        });
    } catch (err) {
        if (!cancellation.signal.aborted) ragMutationError(res, err, 'RAG_INDEX_FAILED');
    } finally { cancellation.cleanup(); }
});

// DELETE /rag/documents/:documentId
router.delete('/rag/documents/:documentId', async (req, res) => {
    let manualLease;
    try {
        if (req.params.documentId === 'manual_text') {
            manualLease = await require('../rag/runtime/distributedLockService').acquireLease({
                tenantId: req.ragTenantId,
                resourceType: 'knowledge_txt',
                resourceId: 'knowledge.txt',
                operation: 'knowledge_delete',
                signal: req.signal,
                failFast: true,
                idempotencyKey: req.get('Idempotency-Key') || null
            });
            if (manualLease.duplicate) {
                return res.json({
                    success: true, duplicate: true,
                    operationId: manualLease.operation.operation_id
                });
            }
            // Delete manual knowledge.txt content safely
            const kbPath = getManualKnowledgePath(req.ragTenantId);
            const { deleteVectorsByDocument } = require('../rag/vector/qdrantVectorStore');
            manualLease.assertOwnership();
            await deleteVectorsByDocument(req.ragTenantId, 'knowledge.txt');
            manualLease.assertOwnership();
            if (fs.existsSync(kbPath)) fs.writeFileSync(kbPath, '', 'utf8');
            const retrievalCache = require('../rag/cache/retrievalCache');
            const { getConfig } = require('../rag/config/ragConfig');
            manualLease.assertOwnership();
            retrievalCache.invalidate({
                tenantId: req.ragTenantId,
                collection: getConfig('QDRANT_COLLECTION'),
                reason: 'manual-document-deleted'
            });

            const { getIndexingState } = require('../rag/indexing/knowledgeIndexingService');
            const state = getIndexingState(req.ragTenantId, 'knowledge.txt');
            if (state) {
                manualLease.assertOwnership();
                const db = require('../database/connection');
                db.prepare(
                    "DELETE FROM rag_indexing_state WHERE tenant_id = ? AND document_id = 'knowledge.txt'"
                ).run(req.ragTenantId);
            }

            try {
                const { publish } = require('../realtime/eventPublisher');
                publish('rag:document-deleted', { documentId: 'manual_text', status: 'deleted' });
            } catch (evErr) {}

            await manualLease.release({ result: { success: true, documentId: 'manual_text' } });
            manualLease = null;
            return res.json({ success: true, message: 'تم حذف النص المعرفي اليدوي بنجاح.' });
        }

        await kbDocService.deleteDocument(req.params.documentId, {
            tenantId: req.ragTenantId,
            idempotencyKey: req.get('Idempotency-Key') || null
        });
        res.json({ success: true, message: 'تم حذف المستند والمتجهات المرافقة بنجاح.' });
    } catch (err) {
        if (manualLease && !manualLease.duplicate) await manualLease.release({ error: err });
        ragMutationError(res, err, 'RAG_DELETE_FAILED');
    }
});

// Redesigned AI Provider API Key Management & Usage Limits APIs
router.get('/providers/api-keys', requirePermission('system:manage'), (req, res) => {
    try {
        const grouped = budgetService.getApiKeysGrouped();
        res.json({ success: true, apiKeys: grouped });
    } catch (err) {
        res.status(500).json({
            success: false,
            code: 'API_KEY_LIST_FAILED',
            error: 'تعذر تحميل المفاتيح البرمجية.'
        });
    }
});

router.post('/providers/api-keys', requirePermission('system:manage'), async (req, res) => {
    const { friendlyName, provider, apiKey, enabled } = req.body;
    try {
        const id = await budgetService.addApiKey(friendlyName, provider, apiKey, enabled !== false);
        const db = require('../database/connection');
        const stored = db.prepare(
            'SELECT error_message, last_sync_success FROM api_keys WHERE id = ?'
        ).get(id);
        res.json({
            success: true,
            id,
            syncSuccess: Boolean(stored?.last_sync_success) && !stored?.error_message,
            syncError: stored?.error_message || null,
            message: stored?.error_message
                ? 'تم حفظ المفتاح، لكن فشلت المزامنة مع المزود.'
                : 'تم حفظ المفتاح واكتملت مزامنة إمكانات المزود.'
        });
    } catch (err) {
        const validation = new Set([
            'INVALID_API_KEY_INPUT', 'INVALID_API_KEY_PROVIDER'
        ]).has(err.code);
        const conflict = err.code === 'SQLITE_CONSTRAINT_UNIQUE';
        res.status(conflict ? 409 : (validation ? 400 : 500)).json({
            success: false,
            code: err.code || 'API_KEY_CREATE_FAILED',
            error: validation || conflict ? err.message : 'تعذر حفظ المفتاح البرمجي.'
        });
    }
});

router.put('/providers/api-keys/:id', requirePermission('system:manage'), async (req, res) => {
    const id = req.params.id;
    const { friendlyName, enabled } = req.body;
    try {
        const db = require('../database/connection');
        const existing = db.prepare('SELECT provider FROM api_keys WHERE id = ?').get(id);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'المفتاح البرمجي غير موجود.' });
        }
        if (friendlyName !== undefined) {
            db.prepare('UPDATE api_keys SET friendly_name = ? WHERE id = ?').run(friendlyName, id);
        }
        if (enabled !== undefined) {
            db.prepare('UPDATE api_keys SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
        }

        // Sync right after toggling on
        if (enabled) {
            const syncResult = await budgetService.syncApiKey(id);
            if (!syncResult.success) {
                return res.status(502).json({
                    success: false,
                    persisted: true,
                    error: syncResult.errorMessage || 'تم تحديث الحالة لكن فشلت المزامنة.'
                });
            }
        } else {
            const row = db.prepare('SELECT provider FROM api_keys WHERE id = ?').get(id);
            if (row) {
                budgetService.broadcastProviderBudget(row.provider.toLowerCase());
            }
        }
        res.json({ success: true, message: 'تم تحديث حالة المفتاح بنجاح!' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/providers/api-keys/:id', requirePermission('system:manage'), (req, res) => {
    const id = req.params.id;
    try {
        const db = require('../database/connection');
        const row = db.prepare('SELECT provider FROM api_keys WHERE id = ?').get(id);
        if (!row) {
            return res.status(404).json({ success: false, error: 'المفتاح البرمجي غير موجود.' });
        }
        const deletion = db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
        if (deletion.changes !== 1) {
            return res.status(500).json({ success: false, error: 'تعذر حذف المفتاح البرمجي.' });
        }

        if (row) {
            budgetService.broadcastProviderBudget(row.provider.toLowerCase());
        }
        res.json({ success: true, message: 'تم حذف المفتاح البرمجي بنجاح.' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/providers/api-keys/:id/refresh', requirePermission('system:manage'), async (req, res) => {
    const id = req.params.id;
    try {
        const result = await budgetService.syncApiKey(id);
        if (!result.success) {
            const status = result.status === 'not_found' ? 404 : 502;
            return res.status(status).json({
                success: false,
                error: result.errorMessage || 'فشلت المزامنة مع المزود.'
            });
        }
        res.json({ success: true, sync: result, message: 'تمت المزامنة وتحديث البيانات من المزود بنجاح!' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/providers/usage-limits', requirePermission('system:manage'), (req, res) => {
    try {
        res.json({ success: true, limits: budgetService.getAllProviderBudgets() });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/providers/usage-limits/refresh', requirePermission('system:manage'), async (req, res) => {
    try {
        const summary = await budgetService.syncAllConfiguredApiKeys();
        const success = summary.failed === 0;
        res.status(success ? 200 : 502).json({
            success,
            summary,
            limits: budgetService.getAllProviderBudgets(),
            ...(success ? {} : { error: `فشلت مزامنة ${summary.failed} من أصل ${summary.total} مفاتيح.` })
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

const providerBalanceController = require('../controllers/providerBalanceController');
router.post('/providers/balance', requirePermission('system:manage'), (req, res, next) => {
    console.log(`[Balance Route] Incoming provider: ${req.body.provider}`);
    next();
}, providerBalanceController.getBalance);

const aiTaskRepository = require('../database/repositories/aiTaskRepository');

// GET /ai-tasks -> fetch all AI task model configurations
router.get('/ai-tasks', requirePermission('ai:manage'), (req, res) => {
    try {
        const configs = aiTaskRepository.getAllTaskConfigs();
        res.json({ success: true, tasks: configs });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /ai-tasks/test -> verify the saved provider/model without changing configuration
router.post('/ai-tasks/test', requirePermission('ai:manage'), async (req, res) => {
    const task = String(req.body.task || '').trim();
    try {
        const { testAIModel } = require('../services/aiModelHealthService');
        const result = await testAIModel(task);
        console.log(`[AI Model Test] Success. Task: ${task}, Provider: ${result.provider}, Model: ${result.model}`);
        res.json(result);
    } catch (err) {
        console.warn(`[AI Model Test] Failed. Task: ${task || 'missing'}, Code: ${err.code || 'UNKNOWN'}, Error: ${err.message}`);
        res.status(err.statusCode || 500).json({
            success: false,
            error: err.message || 'فشل اختبار الموديل.',
            code: err.code || 'MODEL_TEST_FAILED'
        });
    }
});

// POST /ai-tasks -> update specific AI task model configuration
router.post('/ai-tasks', requirePermission('ai:manage'), (req, res) => {
    const { task, provider, model, enabled } = req.body;
    if (!task || !provider || !model) {
        return res.status(400).json({ success: false, error: 'بيانات ناقصة لإعداد المهمة الذكية.' });
    }

    try {
        const supportedTasks = new Set([
            'text_generation', 'vision', 'speech_to_text',
            'text_to_speech', 'embedding', 'reranker'
        ]);
        const normalizedProvider = String(provider).toLowerCase().trim();
        const normalizedModel = String(model).trim();
        const providerKeyRefs = {
            openrouter: 'OPENROUTER_API_KEY',
            openai: 'OPENAI_API_KEY',
            gemini: 'GEMINI_API_KEY',
            ollama: ''
        };

        if (!supportedTasks.has(task)) {
            return res.status(400).json({ success: false, error: 'مهمة AI غير مدعومة.' });
        }
        if (!Object.prototype.hasOwnProperty.call(providerKeyRefs, normalizedProvider)) {
            return res.status(400).json({ success: false, error: 'مزود AI غير مدعوم.' });
        }
        if (!/^[A-Za-z0-9._:/-]+$/.test(normalizedModel)) {
            return res.status(400).json({ success: false, error: 'معرّف الموديل يحتوي على رموز غير صالحة.' });
        }

        const { validateProviderModelCombination } = require('../services/aiProviders');
        validateProviderModelCombination(normalizedProvider, normalizedModel);
        const api_key_ref = providerKeyRefs[normalizedProvider];

        aiTaskRepository.saveTaskConfig({
            task,
            provider: normalizedProvider,
            model: normalizedModel,
            api_key_ref,
            enabled
        });
        addLog(`[إعدادات AI] تم تحديث إعداد المهمة الذكية [${task}] لـ المزود: [${normalizedProvider}] والموديل: [${normalizedModel}]`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
