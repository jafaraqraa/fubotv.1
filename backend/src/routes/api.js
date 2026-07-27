const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { addLog, reportError, getRecentLogs, listErrors, getActiveErrorsCount, solveError } = require('../services/logger');
const { getBot, getIsValidToken, startBot } = require('../channels/telegram');
const { getWaClient, getWaStatus, setWaStatus, getLastQrCodeUrl, setLastQrCodeUrl, startWhatsApp } = require('../channels/whatsapp');
const { sendMetaMessage } = require('../channels/meta');
const { updateEnvFile } = require('../utils/helpers');

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
    clearUnreadCount
} = require('../database/repositories/customerRepository');

const {
    saveMessage,
    listMessages,
    getMessagesCount
} = require('../database/repositories/messageRepository');

const { sendOutgoingMessage } = require('../messaging/outgoingMessageService');
const { saveSetting, getSetting, maskSecret, isMaskedPlaceholder } = require('../services/settingsService');
const budgetService = require('../services/budgetService');

const uploadsDir = path.join(__dirname, '..', '..', 'public', 'uploads');

// 1. مسار إسناد المحادثة للموظفين (Chat Assignment Endpoint)
router.post('/chat/assign', (req, res) => {
    const { userId, assignee } = req.body;
    if (!userId || !assignee) return res.status(400).json({ success: false, error: 'بيانات ناقصة' });

    const user = findCustomerUserByIdOnly(userId);
    if (user) {
        updateAssignee(userId, assignee);
        const isAI = assignee === 'ai';
        addLog(`تم إسناد محادثة العميل ${user.name} إلى: ${assignee === 'ai' ? 'وكيل الذكاء الاصطناعي' : assignee}`);
        res.json({ success: true, isAIEnabled: isAI });
    } else {
        res.status(404).json({ success: false, error: 'المستخدم غير موجود بالذاكرة.' });
    }
});

// 2. تحديث وتطوير مسار إرسال الرسائل الفردية والملاحظات والوسائط (Rich Media & Notes Support) - uses outgoingMessageService (Task 14)
router.post('/send-direct', async (req, res) => {
    const { userId, message, isNote, mediaData, mediaName, mediaType } = req.body;
    if (!userId) return res.status(400).json({ success: false, error: 'بيانات ناقصة' });

    const user = findCustomerUserByIdOnly(userId);
    if (!user) return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });

    try {
        // If it is a private internal note, delegate to persistence save directly without sending
        if (isNote === true) {
            if (!message) return res.status(400).json({ success: false, error: 'محتوى الملاحظة فارغ' });
            saveMessage(userId, 'admin', message, 'note', true);
            addLog(`تمت إضافة ملاحظة داخلية سرية على محادثة: ${user.name}`);
            return res.json({ success: true });
        }

        let finalMessageText = message;
        let localPath = null;
        let actualMediaType = 'text';
        let mediaMetadata = null;

        // إذا كان هناك ملف ميديا مرسل من لوحة التحكم (Base64)
        if (mediaData && mediaName) {
            const fileExt = mediaName.split('.').pop();
            const fileName = `${Date.now()}_sent.${fileExt}`;
            const destPath = path.join(uploadsDir, fileName);

            // كتابة الملف محلياً في مجلد الرفع
            fs.writeFileSync(destPath, Buffer.from(mediaData, 'base64'));
            localPath = destPath;
            finalMessageText = `/uploads/${fileName}`;

            const mimeLower = String(mediaType).toLowerCase();
            if (mimeLower.startsWith('image/')) actualMediaType = 'image';
            else if (mimeLower.startsWith('audio/')) actualMediaType = 'audio';
            else if (mimeLower.startsWith('video/')) actualMediaType = 'video';
            else actualMediaType = 'document';

            mediaMetadata = {
                localPath: destPath,
                publicUrl: finalMessageText,
                fileName: fileName,
                mimeType: mediaType
            };
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
            media: mediaMetadata
        });

        if (outgoingResult.success) {
            res.json({ success: true });
        } else {
            res.status(500).json({ success: false, error: outgoingResult.error || 'Failed sending outgoing reply' });
        }

    } catch (err) {
        reportError(`إرسال رسالة فردية (${user.platform})`, err.message);
        res.status(500).json({ success: false, error: `فشل الإرسال للعميل عبر ${user.platform}: ${err.message}` });
    }
});

// 3. مسارات التهيئة وحفظ الإعدادات الفنية الفردية والموحدة لـ الـ SaaS
router.post('/config/settings', async (req, res) => {
    const {
        token, openrouterKey, model, systemPrompt, adminId, waAutoReply,
        messengerToken, instagramToken, metaVerifyToken, messengerAutoReply, instagramAutoReply,
        ragChunkSize, ragChunkOverlap, ragEmbeddingModel, qdrantCollection,
        ragIndexOnStartup, ragLegacyFallback, qdrantUrl, ollamaBaseUrl,
        ragMinTopK, ragDefaultTopK, ragMaxTopK, ragCandidateMultiplier,
        ragSemanticWeight, ragKeywordWeight, ragSimilarityThreshold,
        ragNeighborExpansion, ragContextBudget,
        aiProvider, aiModel, aiApiKey, aiBaseUrl, aiCustomModels,
        publicBackendUrl,
        budgetOpenrouter, budgetOpenai, budgetGemini, budgetOllama
    } = req.body;

    const { validateSetting, validateAllSettings, getConfig } = require('../rag');

    try {
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
        if (ragLegacyFallback !== undefined) {
            const valStr = String(ragLegacyFallback);
            saveSetting('RAG_LEGACY_FALLBACK', valStr);
            updateEnvFile('RAG_LEGACY_FALLBACK', valStr);
            process.env.RAG_LEGACY_FALLBACK = valStr;
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
            saveSetting('AI_CUSTOM_MODELS', String(aiCustomModels));
            updateEnvFile('AI_CUSTOM_MODELS', String(aiCustomModels));
            process.env.AI_CUSTOM_MODELS = String(aiCustomModels);
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
                const success = startBot(token);

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

        // 10. تعديل حالة الرد الآلي لماسينجر
        if (messengerAutoReply !== undefined) {
            saveSetting('MESSENGER_AUTO_REPLY', messengerAutoReply);
            updateEnvFile('MESSENGER_AUTO_REPLY', messengerAutoReply);
            addLog(`تعديل حالة الرد الآلي لماسنجر إلى: ${messengerAutoReply === 'true' ? 'مفعّل' : 'موقف'}`);
        }

        // 11. تعديل حالة الرد الآلي لانستجرام
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

        res.json({ success: true, message: 'تم حفظ وتحديث كافة الإعدادات والموديل والتعليمات وقنوات ميتّا بنجاح واشتغال البوت بالخلفية!' });
    } catch (err) {
        reportError("حفظ الإعدادات العامة", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. جلب الإحصائيات مع الحماية التامة وحظر إرسال التوكنات كاملة للواجهة لمنع الاختراق
router.get('/stats', (req, res) => {
    const { getConfig } = require('../rag/config/ragConfig');
    const knowledgePath = path.join(__dirname, '..', '..', 'knowledge.txt');
    const knowledgeText = fs.existsSync(knowledgePath) ? fs.readFileSync(knowledgePath, 'utf8') : '';

    const promptPath = path.join(__dirname, '..', '..', 'system_prompt.txt');
    const defaultPrompt = "أنت مساعد خدمة عملاء محترف وذكي يجيب باللغة العربية بلطف ومودة.";
    const systemPromptText = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf8') : defaultPrompt;

    const usersArray = listCustomerUsers();
    const tgUsers = usersArray.filter(u => u.platform === 'telegram').length;
    const waUsers = usersArray.filter(u => u.platform === 'whatsapp').length;
    const msgUsers = usersArray.filter(u => u.platform === 'messenger').length;
    const igUsers = usersArray.filter(u => u.platform === 'instagram').length;

    res.json({
        usersCount: usersArray.length,
        messagesCount: getMessagesCount(),
        logs: getRecentLogs(),
        status: getIsValidToken() ? "نشط" : "غير مفعّل",
        currentModel: process.env.OPENROUTER_MODEL || "openrouter/free",
        knowledgeText: knowledgeText,
        systemPromptText: systemPromptText,
        adminId: process.env.ADMIN_TELEGRAM_ID || "",
        activeErrorsCount: getActiveErrorsCount(),
        waAutoReply: process.env.WA_AUTO_REPLY !== 'false',

        // Budgets
        budgetOpenrouter: parseFloat(getSetting('BUDGET_OPENROUTER') || '100'),
        budgetOpenai: parseFloat(getSetting('BUDGET_OPENAI') || '100'),
        budgetGemini: parseFloat(getSetting('BUDGET_GEMINI') || '100'),
        budgetOllama: parseFloat(getSetting('BUDGET_OLLAMA') || '100'),

        // RAG Settings
        ragChunkSize: parseInt(getConfig('RAG_CHUNK_SIZE') || '800', 10),
        ragChunkOverlap: parseInt(getConfig('RAG_CHUNK_OVERLAP') || '120', 10),
        ragEmbeddingModel: getConfig('RAG_EMBEDDING_MODEL') || 'nomic-embed-text',
        qdrantCollection: getConfig('QDRANT_COLLECTION') || 'futhing_knowledge',
        ragIndexOnStartup: getConfig('RAG_INDEX_ON_STARTUP') !== 'false',
        ragLegacyFallback: getConfig('RAG_LEGACY_FALLBACK') !== 'false',
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

        aiProvider: process.env.AI_PROVIDER || 'openrouter',
        aiModel: process.env.AI_MODEL || process.env.OPENROUTER_MODEL || 'openrouter/free',
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
        isMetaVerifyConfigured: !!process.env.META_VERIFY_TOKEN,

        platformsCount: {
            telegram: tgUsers,
            whatsapp: waUsers,
            messenger: msgUsers,
            instagram: igUsers
        }
    });
});

router.get('/users', (req, res) => {
    res.json(listCustomerUsers());
});

router.get('/chat/:userId', (req, res) => {
    const userId = req.params.userId;
    clearUnreadCount(userId);
    res.json(listMessages(userId));
});

router.post('/chat/toggle-ai', (req, res) => {
    const { userId } = req.body;
    const user = findCustomerUserByIdOnly(userId);

    if (user) {
        const nextState = !user.isAIEnabled;
        updateAIEnabled(userId, nextState);
        addLog(`تم ${nextState ? 'تفعيل' : 'إيقاف'} الذكاء الاصطناعي للعميل: ${user.name}`);
        res.json({ success: true, isAIEnabled: nextState });
    } else {
        res.status(404).json({ success: false, error: 'المستخدم غير موجود في الذاكرة حالياً.' });
    }
});

router.get('/errors', (req, res) => {
    res.json(listErrors());
});

router.post('/errors/solve', (req, res) => {
    const { id } = req.body;
    solveError(id);
    addLog(`تم تعليم العطل كـ 'تم الحل'`);
    res.json({ success: true });
});

// بث جماعي ذكي ومفلتر يوجه الرسائل تلقائياً لجميع القنوات بدقة متناهية
router.post('/broadcast', async (req, res) => {
    const { message } = req.body;
    const usersArray = listCustomerUsers();
    if (usersArray.length === 0) return res.json({ success: false, error: 'لا يوجد مستخدمون متصلون بالمنصة حالياً لبث الإعلان.' });

    const broadcastStats = {
        telegram: { success: 0, fail: 0 },
        whatsapp: { success: 0, fail: 0 },
        messenger: { success: 0, fail: 0 },
        instagram: { success: 0, fail: 0 }
    };

    addLog(`📢 جاري البدء في بث جماعي ذكي للإعلان لـ ${usersArray.length} مشترك...`);

    for (const user of usersArray) {
        const userId = user.id;
        try {
            if (user.platform === 'telegram' && getBot() && getIsValidToken()) {
                await getBot().telegram.sendMessage(userId, `📢 إعلان جماعي من الإدارة:\n\n${message}`);
                broadcastStats.telegram.success++;
            } else if (user.platform === 'whatsapp' && getWaClient() && getWaStatus() === "متصل") {
                await getWaClient().sendMessage(userId, `📢 إعلان جماعي من الإدارة:\n\n${message}`);
                broadcastStats.whatsapp.success++;
            } else if (user.platform === 'messenger' || user.platform === 'instagram') {
                await sendMetaMessage(userId, message, user.platform);
                broadcastStats[user.platform].success++;
            } else {
                broadcastStats[user.platform ? user.platform : 'telegram'].fail++;
            }
        } catch (e) {
            const platformName = user.platform ? user.platform : 'telegram';
            broadcastStats[platformName].fail++;
            reportError("إرسال بث جماعي", `فشل الإرسال للمستخدم ${userId}: ${e.message}`);
        }
    }

    addLog(`✅ اكتمل البث الجماعي للإعلان بنجاح!`);
    res.json({
        success: true,
        message: 'اكتمل إرسال البث الجماعي لكافة القنوات المفعّلة بنجاح!',
        stats: broadcastStats
    });
});

router.post('/config/knowledge', (req, res) => {
    const { text } = req.body;
    try {
        const filePath = path.join(__dirname, '..', '..', 'knowledge.txt');
        fs.writeFileSync(filePath, text || '', 'utf8');
        addLog("تحديث قاعدة المعرفة بنجاح");
        addRAGAuditLog('المشرف', 'تحديث النص المعرفي اليدوي', 'knowledge.txt', 'نجاح');
        res.json({ success: true, message: 'تم حفظ وتحديث قاعدة المعرفة بنجاح!' });
    } catch (err) {
        reportError("حفظ قاعدة المعرفة RAG", err.message);
        res.status(500).json({ success: false, error: err.message });
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

// GET /rag/status -> authenticated, returns RAG system stats
router.get('/rag/status', async (req, res) => {
    try {
        const status = await getRAGSystemStatus();
        res.json({ success: true, status });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /rag/reindex -> authenticated, rate-limited, triggers reindexing
router.post('/rag/reindex', rateLimitReindex, async (req, res) => {
    const force = req.body.force === true;
    try {
        const result = await reindexKnowledgeBase(force);
        res.json({
            success: true,
            status: result.status,
            documentId: result.documentId,
            chunksCreated: result.chunksCreated,
            chunksUpdated: result.chunksUpdated,
            chunksDeleted: result.chunksDeleted,
            totalVectors: result.totalVectors,
            durationMs: result.durationMs
        });
    } catch (err) {
        if (err.code === 'RAG_INDEX_ALREADY_RUNNING') {
            return res.status(409).json({
                success: false,
                code: 'RAG_INDEX_ALREADY_RUNNING',
                message: err.message
            });
        }
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/ai/ollama-models', async (req, res) => {
    try {
        const { getConfig } = require('../rag/config/ragConfig');
        const ollamaUrl = getConfig('OLLAMA_BASE_URL') || 'http://127.0.0.1:11434';

        const response = await fetch(`${ollamaUrl}/api/tags`, {
            signal: AbortSignal.timeout(3000) // 3 seconds timeout
        });

        if (response.ok) {
            const data = await response.json();
            if (data && Array.isArray(data.models)) {
                const models = data.models.map(m => m.name);
                return res.json({ success: true, models });
            }
        }
        res.json({ success: true, models: [] });
    } catch (err) {
        // Fall back gracefully with empty list if Ollama is offline or unreachable
        res.json({ success: true, models: [] });
    }
});

router.get('/whatsapp/config', async (req, res) => {
    try {
        const tenantId = req.query.tenantId || 'default';
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

router.post('/whatsapp/config', async (req, res) => {
    const { tenantId, providerType, config } = req.body;
    const targetTenantId = tenantId || 'default';
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

router.get('/whatsapp/status', (req, res) => {
    res.json({
        status: getWaStatus(),
        qr: getLastQrCodeUrl()
    });
});

// تسجيل خروج واتساب الذكي لإعادة توليد الـ QR
router.post('/whatsapp/logout', async (req, res) => {
    addLog("🧹 جاري إغلاق وفصل اتصال واتساب وإعادة تهيئة البوابات...");
    console.log("🧹 جاري إغلاق وفصل اتصال واتساب...");

    setWaStatus("جاري التحميل...");
    setLastQrCodeUrl("");

    try {
        if (getWaClient()) {
            try {
                await getWaClient().destroy();
            } catch (e) {
                console.log("تم تدمير المحرك بنجاح أو كان مغلقاً بالفعل.");
            }
        }

        await new Promise(resolve => setTimeout(resolve, 1500));

        const authPath = path.join(__dirname, '..', '..', '.wwebjs_auth');
        const cachePath = path.join(__dirname, '..', '..', '.wwebjs_cache');

        if (fs.existsSync(authPath)) {
            fs.rmSync(authPath, { recursive: true, force: true });
        }
        if (fs.existsSync(cachePath)) {
            fs.rmSync(cachePath, { recursive: true, force: true });
        }

        addLog("🧼 تم تصفير وحذف ملفات جلسة الواتساب المعلقة بنجاح.");
        startWhatsApp();

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
        const { getLastRetrievalProfiling, getLastRetrievalMode } = require('../services/knowledge');
        const { getConfig } = require('../rag/config/ragConfig');

        // 1. Run the unified response generation pipeline exactly once
        let finalAnswer = 'لم يتم تهيئة مفتاح OpenRouter لتوليد الإجابة النهائية.';
        let aiResp = null;
        try {
            aiResp = await getAIResponse('playground_temp_user', question);
            if (aiResp) {
                finalAnswer = aiResp;
            } else if (process.env.OPENROUTER_API_KEY) {
                finalAnswer = 'فشل الحصول على رد من الذكاء الاصطناعي.';
            }
        } catch (aiErr) {
            finalAnswer = `خطأ أثناء الاتصال بالذكاء الاصطناعي: ${aiErr.message}`;
        }

        // 2. Extract single-pass retrieval metadata, profiling, and chunks
        const rProfiling = getLastRetrievalProfiling();
        const retrievalMode = getLastRetrievalMode();

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
        const promptSent = `[System Instructions]:\n${sysPrompt}\n\n[User Query]:\n${question}`;
        const tokensUsed = Math.ceil((promptSent.length + finalAnswer.length) / 4);

        res.json({
            success: true,
            retrievedChunks: topChunks.map((c, idx) => ({
                text: c.text,
                similarityScore: c.semanticScore || c.score || c.similarityScore || 0,
                keywordScore: c.keywordScore || 0,
                rerankScore: c.rerankScore || c.score || 0,
                documentName: c.source || c.payload?.documentName || c.documentName || 'معرفة عامة',
                chunkId: c.chunkId || c.payload?.chunkId || '',
                finalRankOrder: idx + 1
            })),
            similarityThreshold,
            selectedTopK: dynamicTopK,
            promptContext,
            finalAnswer,
            executionTime: rProfiling ? rProfiling.totalDuration : executionTime,
            mode: rProfiling ? (rProfiling.intent !== 'General' ? `Hybrid (${rProfiling.intent})` : 'Hybrid') : (retrievalMode === 'legacy-fallback' ? 'Fallback' : 'Hybrid'),
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

const multer = require('multer');
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
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
        const page = parseInt(req.query.page || '1', 10);
        const limit = parseInt(req.query.limit || '10', 10);

        const db = require('../database/connection');
        const docs = db.prepare("SELECT * FROM knowledge_documents WHERE status = 'indexed'").all();

        const kbPath = path.join(__dirname, '..', '..', 'knowledge.txt');
        if (fs.existsSync(kbPath)) {
            const stat = fs.statSync(kbPath);
            docs.push({
                document_key: 'manual_text',
                original_name: 'النص المعرفي اليدوي (knowledge.txt)',
                source_type: 'manual',
                storage_path: kbPath,
                content_hash: 'manual_hash',
                status: 'indexed',
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
        res.status(500).json({ success: false, error: err.message });
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
            const kbPath = path.join(__dirname, '..', '..', 'knowledge.txt');
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
            const d = db.prepare('SELECT * FROM knowledge_documents WHERE document_key = ?').get(documentId);
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
            const dRecord = require('../database/connection').prepare('SELECT * FROM knowledge_documents WHERE document_key = ?').get(documentId);
            rawText = await extractTextFromBuffer(dRecord.source_type, fileBuffer);
        }

        const cleanedText = cleanText(rawText);

        const virtualDoc = {
            documentId,
            source: originalName,
            sourceType,
            originalText: cleanedText,
            documentHash: contentHash
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

// GET /rag/documents
router.get('/rag/documents', async (req, res) => {
    try {
        const filters = {
            search: req.query.search,
            type: req.query.type,
            status: req.query.status,
            page: req.query.page,
            limit: req.query.limit
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
        const kbPath = path.join(__dirname, '..', '..', 'knowledge.txt');
        if (fs.existsSync(kbPath)) {
            const stat = fs.statSync(kbPath);
            const { getIndexingState } = require('../rag/indexing/knowledgeIndexingService');
            const indexState = getIndexingState('knowledge.txt');

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
                page: parseInt(filters.page || '1', 10),
                limit: parseInt(filters.limit || '10', 10)
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /rag/documents/:documentId
router.get('/rag/documents/:documentId', async (req, res) => {
    try {
        const db = require('../database/connection');
        const d = db.prepare('SELECT * FROM knowledge_documents WHERE document_key = ?').get(req.params.documentId);
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

    try {
        const overwriteAction = req.body.overwriteAction || req.query.overwriteAction;
        const doc = await kbDocService.uploadAndRegisterDocument(
            req.file.originalname,
            req.file.mimetype,
            req.file.buffer,
            { overwriteAction }
        );

        addRAGAuditLog('المشرف', 'رفع مستند المعرفة', doc.original_name, 'نجاح');

        res.json({
            success: true,
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
            }
        });
    } catch (err) {
        if (err.code === 'DUPLICATE_UPLOAD') {
            return res.status(400).json({
                success: false,
                code: 'DUPLICATE_UPLOAD',
                message: err.message,
                existing: err.existing
            });
        }
        if (err.code === 'DUPLICATE_DOCUMENT' || err.message.includes('موجود مسبقاً')) {
            return res.status(400).json({ success: false, error: err.message });
        }
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /rag/documents/:documentId/reindex
router.post('/rag/documents/:documentId/reindex', async (req, res) => {
    try {
        if (req.params.documentId === 'manual_text') {
            const { reindexKnowledgeBase } = require('../rag/indexing/knowledgeIndexingService');
            const result = await reindexKnowledgeBase(true);
            const stat = fs.statSync(path.join(__dirname, '..', '..', 'knowledge.txt'));
            return res.json({
                success: true,
                document: {
                    id: 9999,
                    documentId: 'manual_text',
                    originalFilename: 'النص المعرفي اليدوي (knowledge.txt)',
                    fileType: 'MANUAL',
                    fileSize: stat.size,
                    status: 'indexed',
                    chunkCount: result.totalVectors,
                    createdAt: stat.birthtime || stat.mtime,
                    indexedAt: new Date().toISOString()
                }
            });
        }

        const doc = await kbDocService.reindexDocument(req.params.documentId);
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
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /rag/documents/:documentId/retry
router.post('/rag/documents/:documentId/retry', async (req, res) => {
    try {
        const doc = await kbDocService.retryFailedDocument(req.params.documentId);
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
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /rag/documents/:documentId
router.delete('/rag/documents/:documentId', async (req, res) => {
    try {
        if (req.params.documentId === 'manual_text') {
            // Delete manual knowledge.txt content safely
            const kbPath = path.join(__dirname, '..', '..', 'knowledge.txt');
            if (fs.existsSync(kbPath)) {
                fs.writeFileSync(kbPath, '', 'utf8');
            }
            await deleteVectorsByDocument('knowledge.txt');

            const { getIndexingState } = require('../rag/indexing/knowledgeIndexingService');
            const state = getIndexingState('knowledge.txt');
            if (state) {
                const db = require('../database/connection');
                db.prepare("DELETE FROM rag_indexing_state WHERE document_id = 'knowledge.txt'").run();
            }

            try {
                const { publish } = require('../realtime/eventPublisher');
                publish('rag:document-deleted', { documentId: 'manual_text', status: 'deleted' });
            } catch (evErr) {}

            return res.json({ success: true, message: 'تم حذف النص المعرفي اليدوي بنجاح.' });
        }

        await kbDocService.deleteDocument(req.params.documentId);
        res.json({ success: true, message: 'تم حذف المستند والمتجهات المرافقة بنجاح.' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// AI Usage & Billing APIs (Obsolete /usage/* routes removed in rebuild)
const OpenRouterBalanceService = require('../services/OpenRouterBalanceService');

router.get('/providers/openrouter/balance', async (req, res) => {
    try {
        const balance = await OpenRouterBalanceService.getBalance(false);
        if (!balance || !balance.success) {
            const errBody = {
                success: false,
                error: balance ? balance.errorMessage : 'Failed to retrieve balance',
                balance: null
            };
            console.log('📤 [Balance API] Body المرسل إلى الـFrontend:', JSON.stringify(errBody));
            return res.json(errBody);
        }
        const successBody = { success: true, balance };
        console.log('📤 [Balance API] Body المرسل إلى الـFrontend:', JSON.stringify(successBody));
        res.json(successBody);
    } catch (err) {
        const errBody = { success: false, error: err.message, balance: null };
        console.log('📤 [Balance API] Exception Body المرسل إلى الـFrontend:', JSON.stringify(errBody));
        res.status(500).json(errBody);
    }
});

router.all('/providers/openrouter/balance/refresh', async (req, res) => {
    try {
        const balance = await OpenRouterBalanceService.getBalance(true);
        if (!balance || !balance.success) {
            const errBody = {
                success: false,
                error: balance ? balance.errorMessage : 'Failed to retrieve balance',
                balance: null
            };
            console.log('📤 [Balance API Refresh] Body المرسل إلى الـFrontend:', JSON.stringify(errBody));
            return res.json(errBody);
        }
        const successBody = { success: true, balance };
        console.log('📤 [Balance API Refresh] Body المرسل إلى الـFrontend:', JSON.stringify(successBody));
        res.json(successBody);
    } catch (err) {
        const errBody = { success: false, error: err.message, balance: null };
        console.log('📤 [Balance API Refresh] Exception Body المرسل إلى الـFrontend:', JSON.stringify(errBody));
        res.status(500).json(errBody);
    }
});

const aiTaskRepository = require('../database/repositories/aiTaskRepository');

// GET /ai-tasks -> fetch all AI task model configurations
router.get('/ai-tasks', (req, res) => {
    try {
        const configs = aiTaskRepository.getAllTaskConfigs();
        res.json({ success: true, tasks: configs });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /ai-tasks -> update specific AI task model configuration
router.post('/ai-tasks', (req, res) => {
    const { task, provider, model, api_key_ref, enabled } = req.body;
    if (!task || !provider || !model) {
        return res.status(400).json({ success: false, error: 'بيانات ناقصة لإعداد المهمة الذكية.' });
    }

    try {
        aiTaskRepository.saveTaskConfig({ task, provider, model, api_key_ref, enabled });
        addLog(`[إعدادات AI] تم تحديث إعداد المهمة الذكية [${task}] لـ المزود: [${provider}] والموديل: [${model}]`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
