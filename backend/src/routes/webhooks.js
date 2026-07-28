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

// Cryptographic verification middleware for Meta Webhook POST requests (Task 3)
function verifyMetaSignature(req, res, next) {
    // GET /webhook is for Meta token verification handshake, skip signature check
    if (req.method === 'GET') {
        return next();
    }

    const signatureHeader = req.headers['x-hub-signature-256'];
    const appSecret = process.env.META_APP_SECRET;
    const isProd = process.env.NODE_ENV === 'production';

    // 1. Missing secret handling (Production must fail closed)
    if (!appSecret) {
        if (isProd) {
            console.error('❌ Production Fail-Closed: META_APP_SECRET environment variable is missing.');
            return res.status(500).json({ success: false, error: 'Internal server configuration error' });
        } else {
            console.warn('⚠️ Development warning: META_APP_SECRET is not configured. Webhook signature check bypassed.');
            return next();
        }
    }

    // 2. Reject if signature header is missing
    if (!signatureHeader) {
        return res.status(401).json({ success: false, error: 'Signature missing' });
    }

    // 3. Signature format validation: sha256=<hex-digest>
    const match = signatureHeader.match(/^sha256=([A-Fa-f0-9]+)$/);
    if (!match) {
        return res.status(400).json({ success: false, error: 'Invalid signature format' });
    }

    const receivedHashHex = match[1];
    const receivedBuffer = Buffer.from(receivedHashHex, 'hex');

    // Verify SHA256 digest size (32 bytes)
    if (receivedBuffer.length !== 32) {
        return res.status(400).json({ success: false, error: 'Invalid signature length' });
    }

    // 4. Calculate HMAC-SHA256 signature of the raw body buffer
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
    const hmac = crypto.createHmac('sha256', appSecret);
    hmac.update(rawBody);
    const expectedBuffer = hmac.digest();

    // 5. Compare signatures using constant-time comparison (timingSafeEqual)
    try {
        if (!crypto.timingSafeEqual(receivedBuffer, expectedBuffer)) {
            return res.status(401).json({ success: false, error: 'Signature verification failed' });
        }
    } catch (e) {
        return res.status(401).json({ success: false, error: 'Signature verification failed' });
    }

    next();
}

// Verify WhatsApp Cloud webhook authenticity using Meta's official
// X-Hub-Signature-256 HMAC over the exact raw HTTP request body.
function verifyWhatsAppSignature(req, res, next) {
    const verificationDisabled =
        String(process.env.WHATSAPP_VERIFY_SIGNATURE || '').toLowerCase() === 'false';

    if (verificationDisabled) {
        console.warn('[Webhook] Signature verification disabled.');
        return next();
    }

    const signatureHeader = req.headers['x-hub-signature-256'];
    if (!signatureHeader) {
        console.warn('[Webhook] Missing signature header.');
        return res.status(401).json({ success: false, error: 'Signature missing' });
    }

    const signatureMatch = signatureHeader.match(/^sha256=([A-Fa-f0-9]{64})$/);
    const appSecret = process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET;
    const rawBody = req.rawBody;

    if (!signatureMatch || !appSecret || !Buffer.isBuffer(rawBody)) {
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

    console.log('[Webhook] Signature verified.');
    return next();
}

// 1. مسار التحقق من Webhook لفيسبوك وانستجرام (GET)
router.get('/webhook', (req, res) => {
    const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || "my_secure_token";
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
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
                    let username = `عميل ${platform === 'messenger' ? 'ماسنجر' : 'انستجرام'}`;
                    try {
                        const profileName = await getMetaUserProfile(senderPsid, platform);
                        if (profileName) username = profileName;
                    } catch (e) {
                        console.log("فشل جلب اسم حساب ميتّا الشخصي.");
                    }

                    // Route strictly through unified normalizer and central incoming message processor (Task 11)
                    const normalized = normalizeMetaMessage(webhookEvent, platform, username);
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
