const { addLog, reportError } = require('../services/logger');

// Fetch the customer display name and profile image metadata. The remote image
// is materialized server-side before persistence and is never exposed directly.
async function getMetaUserProfile(psid, platform) {
    const accessToken = platform === 'messenger' ? process.env.MESSENGER_ACCESS_TOKEN : process.env.INSTAGRAM_ACCESS_TOKEN;
    if (!accessToken) return null;
    try {
        const fields = platform === 'messenger'
            ? 'first_name,last_name,profile_pic'
            : 'name,username,profile_picture_url';
        const response = await fetch(
            `https://graph.facebook.com/v19.0/${encodeURIComponent(psid)}`
            + `?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(accessToken)}`
        );
        if (response.ok) {
            const data = await response.json();
            return {
                displayName: (
                    platform === 'messenger'
                        ? `${data.first_name || ''} ${data.last_name || ''}`.trim()
                        : data.name || data.username
                ) || null,
                profileImageRemoteUrl: data.profile_pic || data.profile_picture_url || null
            };
        }
    } catch (e) {
        console.error("Error fetching Meta user profile:", e.message);
    }
    return null;
}

// دالة إرسال الرسائل لفيسبوك وانستجرام عبر بروتوكولات Meta Graph API وحماية الثغرات
async function sendMetaMessage(recipientId, text, platform) {
    const accessToken = platform === 'messenger' ? process.env.MESSENGER_ACCESS_TOKEN : process.env.INSTAGRAM_ACCESS_TOKEN;
    if (!accessToken) {
        const error = `Meta access token is not configured for ${platform}`;
        addLog(`⚠️ خطأ: لم يتم ضبط توكن إرسال الـ API لـ ${platform} بعد.`);
        return { success: false, error, statusCode: null, metaErrorCode: null, rawResponse: null, provider: 'meta' };
    }

    const timeoutMs = Number(process.env.META_REQUEST_TIMEOUT_MS) || 15000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${accessToken}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                recipient: { id: recipientId },
                message: { text: text }
            })
        });

        const responseText = await response.text();
        let data = null;
        try {
            data = responseText ? JSON.parse(responseText) : {};
        } catch (_) {
            data = { message: responseText || 'Empty Meta response' };
        }

        if (response.ok) {
            const messageId = String(data.message_id || (data.messages && data.messages[0] && data.messages[0].id) || '');
            if (!messageId) {
                const errorMsg = 'Meta Graph API returned success without a message ID';
                reportError(`إرسال ميتّا (${platform})`, errorMsg);
                return {
                    success: false,
                    error: errorMsg,
                    statusCode: response.status,
                    metaErrorCode: null,
                    provider: 'meta',
                    rawResponse: data
                };
            }
            console.log(`✅ تم إرسال الرد للعميل على منصة [${platform}] بنجاح!`);
            return {
                success: true,
                messageId,
                provider: 'meta',
                statusCode: response.status,
                rawResponse: data
            };
        }

        const metaError = data && data.error ? data.error : {};
        const errorMsg = metaError.message || `Meta Graph API request failed with HTTP ${response.status}`;
        reportError(`إرسال ميتّا (${platform})`, errorMsg);
        return {
            success: false,
            error: errorMsg,
            statusCode: response.status,
            metaErrorCode: metaError.code === undefined ? null : metaError.code,
            provider: 'meta',
            rawResponse: data
        };
    } catch (error) {
        const errorMsg = error && error.name === 'AbortError'
            ? `Meta Graph API request timed out after ${timeoutMs}ms`
            : `Meta Graph API network error: ${error.message}`;
        reportError(`اتصال ميتّا خطأ شبكة (${platform})`, errorMsg);
        return {
            success: false,
            error: errorMsg,
            statusCode: null,
            metaErrorCode: null,
            provider: 'meta',
            rawResponse: null
        };
    } finally {
        clearTimeout(timeout);
    }
}

module.exports = {
    getMetaUserProfile,
    sendMetaMessage
};
