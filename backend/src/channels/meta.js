const { addLog, reportError } = require('../services/logger');
const fs = require('fs');
const path = require('path');
const { reliableFetch } = require('../utils/reliableFetch');

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';
const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'file']);
const META_TEXT_LIMIT = 2000;

function splitMetaText(value, limit = META_TEXT_LIMIT) {
    const text = String(value || '');
    if (Array.from(text).length <= limit) return [text];
    const parts = [];
    let remaining = text;
    while (Array.from(remaining).length > limit) {
        const chars = Array.from(remaining);
        const window = chars.slice(0, limit).join('');
        const candidates = [window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf(' ')]
            .filter(index => index >= Math.floor(limit * 0.55));
        const cut = candidates.length ? Math.max(...candidates) : window.length;
        parts.push(window.slice(0, cut).trimEnd());
        remaining = window.slice(cut).trimStart() + chars.slice(limit).join('');
    }
    if (remaining) parts.push(remaining);
    return parts.filter(Boolean);
}

function graphHostFor(platform) {
    // Tokens issued by the current "Instagram API with Instagram Login" flow
    // are valid on graph.instagram.com, not graph.facebook.com. Messenger keeps
    // using the Facebook Graph host.
    return platform === 'instagram'
        ? 'https://graph.instagram.com'
        : 'https://graph.facebook.com';
}

function accountIdFor(platform) {
    return platform === 'messenger'
        ? (process.env.MESSENGER_PAGE_ID || 'me')
        : (process.env.INSTAGRAM_ACCOUNT_ID || 'me');
}

async function parseMetaResponse(response) {
    const responseText = await response.text();
    try {
        return responseText ? JSON.parse(responseText) : {};
    } catch (_) {
        return { message: responseText || 'Empty Meta response' };
    }
}

function failureResult(response, data, fallback) {
    const metaError = data?.error || {};
    return {
        success: false,
        error: metaError.message || fallback,
        statusCode: response?.status ?? null,
        metaErrorCode: metaError.code ?? null,
        metaErrorSubcode: metaError.error_subcode ?? null,
        isTransient: Boolean(metaError.is_transient)
            || response?.status === 429 || response?.status >= 500,
        provider: 'meta',
        rawResponse: data || null
    };
}

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
            `${graphHostFor(platform)}/${META_GRAPH_VERSION}/${encodeURIComponent(psid)}`
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
async function uploadMetaAttachment(media, platform, accessToken) {
    if (!media?.localPath || !fs.existsSync(media.localPath)) {
        return failureResult(null, null, 'Local media attachment is missing or was deleted');
    }
    const attachmentType = media.messageType === 'document' ? 'file' : media.messageType;
    if (!MEDIA_TYPES.has(attachmentType)) {
        return failureResult(null, null, `Unsupported Meta attachment type: ${attachmentType}`);
    }
    if (platform === 'instagram' && !['image', 'video'].includes(attachmentType)) {
        return failureResult(null, null, `Instagram Messaging does not support ${attachmentType} attachments`);
    }

    const buffer = await fs.promises.readFile(media.localPath);
    const form = new FormData();
    form.append('message', JSON.stringify({
        attachment: { type: attachmentType, payload: { is_reusable: true } }
    }));
    form.append(
        'filedata',
        new Blob([buffer], { type: media.mimeType || 'application/octet-stream' }),
        media.originalName || media.fileName || path.basename(media.localPath)
    );

    let response;
    try {
        response = await reliableFetch(
            `${graphHostFor(platform)}/${META_GRAPH_VERSION}/${encodeURIComponent(accountIdFor(platform))}`
            + `/message_attachments?access_token=${encodeURIComponent(accessToken)}`,
            { method: 'POST', body: form },
            {
                timeoutMs: Number(process.env.META_REQUEST_TIMEOUT_MS) || 15000,
                maxAttempts: Number(process.env.META_MAX_ATTEMPTS) || 3
            }
        );
    } catch (error) {
        return failureResult(null, null, error.code === 'PROVIDER_TIMEOUT'
            ? 'Meta attachment upload timed out'
            : `Meta attachment upload network error: ${error.message}`);
    }
    const data = await parseMetaResponse(response);
    if (!response.ok || !data.attachment_id) {
        return failureResult(response, data,
            response.ok ? 'Meta attachment upload returned no attachment ID'
                : `Meta attachment upload failed with HTTP ${response.status}`);
    }
    return {
        success: true,
        attachmentId: String(data.attachment_id),
        statusCode: response.status,
        provider: 'meta',
        rawResponse: data
    };
}

async function sendMetaMessage(recipientId, text, platform, media = null) {
    const accessToken = platform === 'messenger' ? process.env.MESSENGER_ACCESS_TOKEN : process.env.INSTAGRAM_ACCESS_TOKEN;
    if (!accessToken) {
        const error = `Meta access token is not configured for ${platform}`;
        addLog(`⚠️ خطأ: لم يتم ضبط توكن إرسال الـ API لـ ${platform} بعد.`);
        return { success: false, error, statusCode: null, metaErrorCode: null, rawResponse: null, provider: 'meta' };
    }

    try {
        let uploaded = null;
        let message;
        if (platform === 'instagram' && media?.shareUrl) {
            message = { attachment: { type: 'image', payload: { url: media.shareUrl } } };
        } else if (media) {
            uploaded = media.providerAttachmentId
                ? { success: true, attachmentId: media.providerAttachmentId }
                : await uploadMetaAttachment(media, platform, accessToken);
            if (!uploaded.success) return uploaded;
            message = {
                attachment: {
                    type: media.messageType === 'document' ? 'file' : media.messageType,
                    payload: { attachment_id: uploaded.attachmentId }
                }
            };
        } else {
            message = { text };
        }
        const messages = media || (platform === 'instagram' && media?.shareUrl)
            ? [message]
            : splitMetaText(text).map(part => ({ text: part }));
        const messageIds = [];
        let lastResponse = null;
        let lastData = null;
        for (const outboundMessage of messages) {
            const response = await reliableFetch(
                `${graphHostFor(platform)}/${META_GRAPH_VERSION}/${encodeURIComponent(accountIdFor(platform))}`
                + `/messages?access_token=${encodeURIComponent(accessToken)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ recipient: { id: recipientId }, message: outboundMessage })
            }, {
                timeoutMs: Number(process.env.META_REQUEST_TIMEOUT_MS) || 15000,
                maxAttempts: Number(process.env.META_MAX_ATTEMPTS) || 3
            });
            const data = await parseMetaResponse(response);
            lastResponse = response;
            lastData = data;

            if (!response.ok) {
                const metaError = data && data.error ? data.error : {};
                const errorMsg = metaError.message || `Meta Graph API request failed with HTTP ${response.status}`;
                reportError(`إرسال ميتّا (${platform})`, errorMsg);
                return {
                    success: false, error: errorMsg, statusCode: response.status,
                    metaErrorCode: metaError.code === undefined ? null : metaError.code,
                    metaErrorSubcode: metaError.error_subcode === undefined ? null : metaError.error_subcode,
                    isTransient: Boolean(metaError.is_transient) || response.status === 429 || response.status >= 500,
                    attachmentId: uploaded?.attachmentId || null, provider: 'meta', rawResponse: data,
                    messageIds, reported: true
                };
            }
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
                    rawResponse: data,
                    reported: true
                };
            }
            messageIds.push(messageId);
        }
        console.log(`✅ تم إرسال الرد للعميل على منصة [${platform}] بنجاح (${messageIds.length} جزء).`);
        return {
            success: true,
            messageId: messageIds[messageIds.length - 1],
            messageIds,
            statusCode: lastResponse.status,
            attachmentId: uploaded?.attachmentId || null,
            provider: 'meta',
            rawResponse: lastData
        };
    } catch (error) {
        const errorMsg = error?.code === 'PROVIDER_TIMEOUT' || error?.name === 'AbortError'
            ? 'Meta Graph API request timed out'
            : `Meta Graph API network error: ${error.message}`;
        reportError(`اتصال ميتّا خطأ شبكة (${platform})`, errorMsg);
        return {
            success: false,
            error: errorMsg,
            statusCode: null,
            metaErrorCode: null,
            provider: 'meta',
            rawResponse: null,
            reported: true
        };
    }
}

module.exports = {
    getMetaUserProfile,
    uploadMetaAttachment,
    sendMetaMessage,
    splitMetaText
};
