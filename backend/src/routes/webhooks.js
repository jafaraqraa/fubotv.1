const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { addLog, reportError } = require('../services/logger');
const { getMetaUserProfile } = require('../channels/meta');
const { normalizeMetaMessage } = require('../messaging/normalizers/metaNormalizer');
const { processIncomingMessage } = require('../messaging/messageProcessor');
const { getExtensionFromMime } = require('../utils/helpers');

const REPLAY_WINDOW_MS = 5 * 60 * 1000;
const MAX_REPLAY_ENTRIES = 10000;

function rejectReplay(scope, signatureHeader, res) {
    const now = Date.now();
    const replayKey = crypto
        .createHash('sha256')
        .update(`${scope}\0${signatureHeader}`)
        .digest('hex');
    const db = require('../database/connection');
    const inserted = db.transaction(() => {
        db.prepare('DELETE FROM webhook_replay_guard WHERE expires_at <= ?').run(now);
        const count = db.prepare('SELECT COUNT(*) AS count FROM webhook_replay_guard').get().count;
        if (count >= MAX_REPLAY_ENTRIES) {
            db.prepare(`
                DELETE FROM webhook_replay_guard
                WHERE replay_key IN (
                    SELECT replay_key FROM webhook_replay_guard
                    ORDER BY expires_at ASC LIMIT ?
                )
            `).run(Math.max(1, count - MAX_REPLAY_ENTRIES + 1));
        }
        return db.prepare(`
            INSERT INTO webhook_replay_guard (replay_key, expires_at)
            VALUES (?, ?)
            ON CONFLICT(replay_key) DO NOTHING
        `).run(replayKey, now + REPLAY_WINDOW_MS).changes === 1;
    })();
    if (!inserted) {
        console.warn(`[Webhook] Replay rejected. Scope: ${scope}`);
        res.status(409).json({ success: false, error: 'Duplicate webhook delivery' });
        return true;
    }
    return false;
}

function verifySignedWebhook({ secretEnvNames, scope }) {
    return function signedWebhookVerification(req, res, next) {
        const signatureHeader = req.headers['x-hub-signature-256'];
        if (!signatureHeader) {
            console.warn('[Webhook] Missing signature header.');
            return res.status(401).json({ success: false, error: 'Signature missing' });
        }

        const appSecret = secretEnvNames
            .map(name => process.env[name])
            .find(value => typeof value === 'string' && value.length > 0);
        const signatureMatch = signatureHeader.match(/^sha256=([A-Fa-f0-9]{64})$/);
        const rawBody = req.rawBody;

        if (!appSecret) {
            console.error(`[Webhook] Required signing secret is missing: ${secretEnvNames.join(' or ')}.`);
            return res.status(503).json({ success: false, error: 'Webhook verification unavailable' });
        }
        if (!signatureMatch || !Buffer.isBuffer(rawBody)) {
            console.warn('[Webhook] Invalid signature.');
            return res.status(401).json({ success: false, error: 'Invalid signature' });
        }

        const receivedSignature = Buffer.from(signatureMatch[1], 'hex');
        const expectedSignature = crypto
            .createHmac('sha256', appSecret)
            .update(rawBody)
            .digest();
        if (
            receivedSignature.length !== expectedSignature.length ||
            !crypto.timingSafeEqual(receivedSignature, expectedSignature)
        ) {
            console.warn('[Webhook] Invalid signature.');
            return res.status(401).json({ success: false, error: 'Invalid signature' });
        }
        if (rejectReplay(`${scope}:${req.params.tenantId || 'global'}`, signatureHeader, res)) {
            return;
        }
        console.log('[Webhook] Signature verified.');
        return next();
    };
}

// Cryptographic verification middleware for Meta Webhook POST requests (Task 3)
const verifyMetaSignature = verifySignedWebhook({
    secretEnvNames: ['META_APP_SECRET'],
    scope: 'meta'
});

// Verify WhatsApp Cloud webhook authenticity using Meta's official
// X-Hub-Signature-256 HMAC over the exact raw HTTP request body.
const verifyWhatsAppSignature = verifySignedWebhook({
    secretEnvNames: ['WHATSAPP_APP_SECRET', 'META_APP_SECRET'],
    scope: 'whatsapp'
});

// 1. مسار التحقق من Webhook لفيسبوك وانستجرام (GET)
router.get('/webhook', (req, res) => {
    const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (VERIFY_TOKEN && mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('✅ تم التحقق من Webhook الخاص بشركة Meta بنجاح!');
        addLog("تم التحقق من رابط الـ Webhook الخاص بـ Meta بنجاح!");
        return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
});

// 2. مسار استقبال ومعالجة رسائل فيسبوك وانستجرام بالـ AI (POST) - with signature check (Task 3)
router.post('/webhook', verifyMetaSignature, async (req, res) => {
    const body = req.body;

    res.status(200).send('EVENT_RECEIVED');

    try {
        if (body.object === 'page' || body.object === 'instagram') {
            const platform = body.object === 'page' ? 'messenger' : 'instagram';

            for (const entry of body.entry) {
                if (!entry.messaging) continue;
                const webhookEvent = entry.messaging[0];
                const senderPsid = webhookEvent.sender.id;

                if (webhookEvent.message && webhookEvent.message.text) {
                    let profile = null;
                    try {
                        profile = await getMetaUserProfile(senderPsid, platform);
                    } catch (e) {
                        console.log("فشل جلب ملف حساب ميتّا الشخصي.");
                    }

                    // Route strictly through unified normalizer and central incoming message processor (Task 11)
                    const normalized = normalizeMetaMessage(webhookEvent, platform, profile);
                    await processIncomingMessage(normalized);
                }
            }
        }
    } catch (error) {
        reportError("استقبال Webhook لـ Meta", error.message);
    }
});

// 3. Webhook verification endpoint for WhatsApp Cloud API (GET)
router.get('/whatsapp/:tenantId', async (req, res) => {
    const { tenantId } = req.params;
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    try {
        const db = require('../database/connection');
        const row = db.prepare('SELECT config_json FROM whatsapp_tenant_configs WHERE tenant_id = ?').get(tenantId);
        if (row) {
            const config = JSON.parse(row.config_json);
            if (mode === 'subscribe' && token === config.verifyToken) {
                console.log(`✅ [Webhook] WhatsApp Cloud verified successfully for tenant: ${tenantId}`);
                addLog(`تم التحقق بنجاح من Webhook الخاص بـ WhatsApp Cloud للمستأجر: ${tenantId}`);
                return res.status(200).send(challenge);
            }
        }
    } catch (err) {
        reportError(`تحقق Webhook لـ WhatsApp Cloud (${tenantId})`, err.message);
    }
    return res.sendStatus(403);
});

// 4. Webhook message receiver endpoint for WhatsApp Cloud API (POST)
router.post('/whatsapp/:tenantId', verifyWhatsAppSignature, async (req, res) => {
    const { tenantId } = req.params;
    const body = req.body;

    // Acknowledge receipt immediately to Meta
    res.status(200).send('EVENT_RECEIVED');

    try {
        if (body.object === 'whatsapp_business_account') {
            for (const entry of body.entry) {
                if (!entry.changes) continue;
                for (const change of entry.changes) {
                    if (change.field !== 'messages') continue;
                    const value = change.value;
                    if (!value.messages) continue;

                    for (const msg of value.messages) {
                        const contact = value.contacts && value.contacts[0] ? value.contacts[0] : {};
                        const from = msg.from; // Phone number
                        const name = (contact.profile && contact.profile.name) ? contact.profile.name : `+${from}`;

                        let messageText = '';
                        let mediaType = 'text';
                        let fileExt = '';
                        let mediaMetadata = null;

                        if (msg.type === 'text') {
                            messageText = msg.text.body;
                        } else if (['image', 'audio', 'video', 'document'].includes(msg.type)) {
                            mediaType = msg.type;
                            const mediaObj = msg[msg.type];
                            const mediaId = mediaObj.id;

                            messageText = `[Media Attachment: ${mediaType}]`;
                            fileExt = getExtensionFromMime(mediaObj.mime_type || '');

                            // Download media in background from Meta Cloud API
                            try {
                                const db = require('../database/connection');
                                const row = db.prepare('SELECT config_json FROM whatsapp_tenant_configs WHERE tenant_id = ?').get(tenantId);
                                if (row) {
                                    const config = JSON.parse(row.config_json);
                                    if (config.accessToken) {
                                        const mediaRes = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
                                            headers: { 'Authorization': `Bearer ${config.accessToken}` }
                                        });
                                        if (mediaRes.ok) {
                                            const mediaData = await mediaRes.json();
                                            if (mediaData.url) {
                                                const fileRes = await fetch(mediaData.url, {
                                                    headers: { 'Authorization': `Bearer ${config.accessToken}` }
                                                });
                                                if (fileRes.ok) {
                                                    const buffer = await fileRes.arrayBuffer();
                                                    const fileName = `${Date.now()}_whatsapp_cloud_${mediaId}.${fileExt}`;
                                                    const destPath = path.join(__dirname, '..', '..', 'public', 'uploads', fileName);
                                                    fs.writeFileSync(destPath, Buffer.from(buffer));

                                                    messageText = `/uploads/${fileName}`;
                                                    mediaMetadata = {
                                                        localPath: `/uploads/${fileName}`,
                                                        publicUrl: `/uploads/${fileName}`,
                                                        fileName: fileName,
                                                        mimeType: mediaObj.mime_type,
                                                        caption: mediaObj.caption || ''
                                                    };
                                                }
                                            }
                                        }
                                    }
                                }
                            } catch (err) {
                                console.error('Failed to download WhatsApp Cloud media:', err.message);
                            }
                        }

                        // Normalize into standard system format
                        const normalized = {
                            channel: 'whatsapp',
                            externalMessageId: String(msg.id || ''),
                            externalUserId: `${from}@c.us`,
                            customer: {
                                displayName: name,
                                username: null,
                                phoneNumber: from,
                                profileData: {}
                            },
                            direction: 'incoming',
                            senderType: 'customer',
                            messageType: mediaType,
                            content: messageText,
                            media: mediaMetadata,
                            timestamp: new Date(parseInt(msg.timestamp) * 1000 || Date.now()).toISOString(),
                            metadata: {
                                hasMedia: !!mediaMetadata,
                                tenantId
                            }
                        };

                        await processIncomingMessage(normalized);
                    }
                }
            }
        }
    } catch (err) {
        reportError(`استقبال Webhook لـ WhatsApp Cloud (${tenantId})`, err.message);
    }
});

module.exports = router;
