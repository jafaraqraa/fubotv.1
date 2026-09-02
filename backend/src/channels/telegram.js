const { Telegraf } = require('telegraf');
const { addLog, reportError, setTelegramNotifier } = require('../services/logger');
const { downloadRemoteFile } = require('../utils/helpers');
const { normalizeTelegramMessage } = require('../messaging/normalizers/telegramNormalizer');
const { processIncomingMessage } = require('../messaging/messageProcessor');
const { acquireTelegramPollingLease } = require('./telegramPollingLease');

let bot;
let pollingLease;
let startPromise;
let pollingPromise;
let botToken = process.env.BOT_TOKEN;
let isValidToken = botToken && /^[0-9]+:[a-zA-Z0-9_-]+$/.test(botToken);
const profileImageCache = new Map();

function isTransientTelegramError(error) {
    const message = String(error?.message || error || '');
    return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|socket hang up|network|fetch failed/i.test(message);
}

async function launchWithRetry(telegrafBot, attempts = 3) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            await new Promise((resolve, reject) => {
                let ready = false;
                const activePolling = telegrafBot.launch({}, () => {
                    ready = true;
                    resolve();
                });
                telegrafBot.__fubotPollingPromise = activePolling;
                activePolling.then(() => {
                    if (!ready) reject(new Error('Telegram polling stopped before startup completed'));
                }, reject);
            });
            return true;
        } catch (error) {
            lastError = error;
            if (!isTransientTelegramError(error) || attempt === attempts) throw error;
            const delayMs = attempt * 750;
            console.warn(JSON.stringify({
                level: 'warn', event: 'telegram_startup_retry', attempt,
                maxAttempts: attempts, delayMs, message: String(error?.message || error)
            }));
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
    throw lastError;
}

async function getTelegramProfileImageUrl(ctx) {
    const userId = String(ctx.from?.id || '');
    if (!userId) return null;
    const cached = profileImageCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.url;

    let url = null;
    try {
        const result = await ctx.telegram.getUserProfilePhotos(userId, 0, 1);
        const photos = result?.photos;
        const largest = Array.isArray(photos?.[0]) ? photos[0].at(-1) : null;
        if (largest?.file_id) {
            const link = await ctx.telegram.getFileLink(largest.file_id);
            url = typeof link === 'object' && link ? link.href : String(link || '');
        }
    } catch (_) {
        // A profile photo is optional and must never block message processing.
    }
    profileImageCache.set(userId, {
        url: url || null,
        expiresAt: Date.now() + (6 * 60 * 60 * 1000)
    });
    return url;
}

// Register the notifier inside logger so reportError can alert the admin
setTelegramNotifier(async (type, date, time, message) => {
    const adminId = process.env.ADMIN_TELEGRAM_ID;
    if (adminId && bot && isValidToken) {
        await bot.telegram.sendMessage(adminId, `⚠️ تنبيه عاجل من خادم البوت:\n\nحدث عطل فني في النظام:\n\n• النوع: ${type}\n• التاريخ: ${date} ${time}\n• التفاصيل البرمجية: ${message}\n\nيرجى مراجعة لوحة التحكم لحل المشكلة.`);
    }
});

async function stopBot(signal = 'STOP') {
    const activeBot = bot;
    bot = undefined;
    if (activeBot) {
        try { await activeBot.stop(signal); } finally {
            pollingLease?.release();
            pollingLease = undefined;
        }
    } else {
        pollingLease?.release();
        pollingLease = undefined;
    }
    if (pollingPromise) {
        await pollingPromise.catch(() => {});
        pollingPromise = undefined;
    }
}

async function startBot(token) {
    if (startPromise) return startPromise;
    startPromise = (async () => {
      try {
        if (bot) {
            await stopBot('RESTART');
        }
        pollingLease = acquireTelegramPollingLease(token);
        bot = new Telegraf(token);

        bot.start(async (ctx) => {
            const profileImageRemoteUrl = await getTelegramProfileImageUrl(ctx);
            const normalized = normalizeTelegramMessage(ctx, null, 'text', '', profileImageRemoteUrl);
            // Replace user command specifically for /start normalization mapping
            normalized.content = '/start';
            normalized.messageType = 'text';

            await processIncomingMessage(normalized);

            const welcomeText = `أهلاً بك يا ${ctx.from.first_name}! 👋\nتم ربط حسابك بالمنصة بنجاح.`;
            ctx.reply(welcomeText);

            // Persist the welcome reply
            const { saveMessage } = require('../database/repositories/messageRepository');
            saveMessage(ctx.from.id, 'admin', welcomeText, 'text');
        });

        // الاستماع لجميع أنواع الرسائل (صوت، فيديو، صور، نصوص) من تيليجرام
        bot.on('message', async (ctx) => {
            let userText = ctx.message.text || ctx.message.caption || '';
            let fileId = null;
            let fileExt = '';
            let mediaType = 'text';

            // الكشف عن نوع الوسائط وتحديد الامتداد المناسب
            if (ctx.message.photo) {
                fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
                fileExt = 'jpg';
                mediaType = 'image';
            } else if (ctx.message.voice) {
                fileId = ctx.message.voice.file_id;
                fileExt = 'ogg';
                mediaType = 'audio';
            } else if (ctx.message.video) {
                fileId = ctx.message.video.file_id;
                fileExt = 'mp4';
                mediaType = 'video';
            } else if (ctx.message.document) {
                fileId = ctx.message.document.file_id;
                fileExt = ctx.message.document.file_name ? ctx.message.document.file_name.split('.').pop() : 'bin';
                mediaType = 'document';
            }

            // إذا كانت الرسالة تحتوي على وسائط، نقوم بتحميلها محلياً في السيرفر لضمان الأمان والاستقرار
            if (fileId) {
                try {
                    addLog(`جاري معالجة وتحميل ملف وسائط من تيليجرام...`);
                    const fileLinkObj = await ctx.telegram.getFileLink(fileId);
                    const fileLink = typeof fileLinkObj === 'object' ? fileLinkObj.href : fileLinkObj;
                    const fileName = `${Date.now()}_telegram.${fileExt}`;
                    const localPath = await downloadRemoteFile(fileLink, fileName);

                    // تحويل نص الرسالة إلى رابط الملف المحلي لتقوم شاشة الـ Frontend بعرضه فوراً
                    userText = localPath;
                } catch (err) {
                    reportError("تحميل وسائط تيليجرام", err.message);
                }
            }

            // Route strictly through unified normalizer and central incoming message processor (Task 9)
            const profileImageRemoteUrl = await getTelegramProfileImageUrl(ctx);
            const normalized = normalizeTelegramMessage(
                ctx,
                fileId ? userText : null,
                mediaType,
                fileExt,
                profileImageRemoteUrl
            );
            await processIncomingMessage(normalized);
        });

        await launchWithRetry(bot);
        pollingPromise = bot.__fubotPollingPromise;
        delete bot.__fubotPollingPromise;
        pollingPromise.catch(async error => {
            if (bot) {
                isValidToken = false;
                pollingLease?.release();
                pollingLease = undefined;
                await reportError('تشغيل Telegram polling', error?.message || String(error));
            }
        });
        console.log("🤖 تم تشغيل البوت بنجاح.");
        addLog("تم تشغيل البوت بنجاح");
        isValidToken = true;

        const { listErrors, solveError } = require('../database/repositories/logRepository');
        const resolvedTelegramErrors = listErrors().filter(e => !e.solved && (
            e.type === "توكن تيليجرام مفقود"
            || (e.type === "إقلاع البوت الداخلي" && isTransientTelegramError(e.message))
        ));
        resolvedTelegramErrors.forEach(error => solveError(error.id));
        if (resolvedTelegramErrors.length) addLog("✅ تم استعادة اتصال تيليجرام تلقائياً.");
        return true;
      } catch (e) {
        try { await stopBot('START_FAILURE'); } catch (_) { /* preserve startup error */ }
        await reportError("إقلاع البوت الداخلي", e.message);
        isValidToken = false;
        return false;
      } finally {
        startPromise = undefined;
      }
    })();
    return startPromise;
}

// initialize bot on start if token is valid
async function initializeTelegramOnStartup() {
    if (isValidToken) {
        return startBot(botToken);
    } else {
        await reportError("توكن تيليجرام مفقود", "لا يوجد توكن تيليجرام صالح حالياً في لوحة التحكم أو ملف .env للسيرفر.");
        console.warn("⚠️ تنبيه: لا يوجد توكن صالح حالياً، يمكنك إضافته من الإعدادات في لوحة التحكم.");
        return false;
    }
}

module.exports = {
    getBot: () => bot,
    getIsValidToken: () => isValidToken,
    setIsValidToken: (val) => { isValidToken = val; },
    startBot,
    stopBot,
    initializeTelegramOnStartup,
    _test: { isTransientTelegramError, launchWithRetry }
};
