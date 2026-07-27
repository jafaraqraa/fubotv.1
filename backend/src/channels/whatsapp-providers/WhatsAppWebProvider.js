// WhatsAppWebProvider.js - whatsapp-web.js Provider Implementation

const WhatsAppProvider = require('./WhatsAppProvider');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { addLog, reportError } = require('../../services/logger');
const { getChromePath, getExtensionFromMime } = require('../../utils/helpers');
const { normalizeWhatsAppMessage } = require('../../messaging/normalizers/whatsappNormalizer');
const { processIncomingMessage } = require('../../messaging/messageProcessor');
const { publish } = require('../../realtime/eventPublisher');
const { EVENTS } = require('../../realtime/events');

const uploadsDir = path.join(__dirname, '..', '..', '..', 'public', 'uploads');

class WhatsAppWebProvider extends WhatsAppProvider {
    constructor(tenantId, config) {
        super(tenantId, config);
        this.waClient = null;
        this.waStatus = "جاري التحميل...";
        this.lastQrCodeUrl = "";
        this.reconnectTimeout = null;
    }

    async initialize() {
        const startTime = Date.now();
        try {
            const chromePath = getChromePath();
            const puppeteerOptions = {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu'
                ]
            };

            if (chromePath) {
                puppeteerOptions.executablePath = chromePath;
            }

            // Isolate session path per tenant
            const authPath = path.join(__dirname, '..', '..', '..', `.wwebjs_auth_tenant_${this.tenantId}`);

            this.waClient = new Client({
                authStrategy: new LocalAuth({
                    dataPath: authPath
                }),
                puppeteer: puppeteerOptions
            });

            this.waClient.on('qr', (qr) => {
                this.waStatus = "انتظار المسح";
                qrcode.toDataURL(qr, (err, url) => {
                    if (!err) {
                        this.lastQrCodeUrl = url;
                        addLog(`[WhatsApp] tenantId: ${this.tenantId} | provider: web | operation: qr_generation | executionTime: ${Date.now() - startTime} ms | details: Generated new QR code string successfully`);
                        publish(EVENTS.WHATSAPP_STATUS_UPDATED, { status: this.waStatus, qr: url, tenantId: this.tenantId });
                    }
                });
            });

            this.waClient.on('ready', () => {
                this.waStatus = "متصل";
                this.lastQrCodeUrl = "";
                addLog(`[WhatsApp] tenantId: ${this.tenantId} | provider: web | operation: initialize | executionTime: ${Date.now() - startTime} ms | details: Session initialized and ready`);
                publish(EVENTS.WHATSAPP_STATUS_UPDATED, { status: this.waStatus, qr: "", tenantId: this.tenantId });
            });

            this.waClient.on('disconnected', (reason) => {
                this.waStatus = "غير متصل";
                this.lastQrCodeUrl = "";
                addLog(`[WhatsApp] tenantId: ${this.tenantId} | provider: web | operation: disconnect | executionTime: ${Date.now() - startTime} ms | details: WhatsApp disconnected: ${reason}`);
                publish(EVENTS.WHATSAPP_STATUS_UPDATED, { status: this.waStatus, qr: "", tenantId: this.tenantId });

                // Automatic reconnection
                if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
                this.reconnectTimeout = setTimeout(() => this.initialize(), 10000);
            });

            this.waClient.on('message', async (msg) => {
                if (msg.from.includes('@g.us')) return;

                const rxStartTime = Date.now();
                const userId = msg.from;
                let userText = msg.body;
                let mediaType = 'text';
                let fileExt = '';

                const contact = await msg.getContact();

                if (msg.hasMedia) {
                    try {
                        const media = await msg.downloadMedia();
                        if (media) {
                            fileExt = getExtensionFromMime(media.mimetype);
                            const fileName = `${Date.now()}_whatsapp_${this.tenantId}.${fileExt}`;
                            const destPath = path.join(uploadsDir, fileName);

                            fs.writeFileSync(destPath, Buffer.from(media.data, 'base64'));
                            userText = `/uploads/${fileName}`;

                            if (media.mimetype.startsWith('image/')) mediaType = 'image';
                            else if (media.mimetype.startsWith('audio/')) mediaType = 'audio';
                            else if (media.mimetype.startsWith('video/')) mediaType = 'video';
                            else mediaType = 'document';
                        }
                    } catch (err) {
                        reportError(`تحميل وسائط واتساب لـ ${this.tenantId}`, err.message);
                    }
                }

                const normalized = normalizeWhatsAppMessage(msg, contact, msg.hasMedia ? userText : null, mediaType, fileExt);
                normalized.metadata = normalized.metadata || {};
                normalized.metadata.tenantId = this.tenantId;

                addLog(`[WhatsApp] tenantId: ${this.tenantId} | provider: web | operation: receive_message | executionTime: ${Date.now() - rxStartTime} ms | details: Received ${mediaType} message from ${userId}`);

                await processIncomingMessage(normalized);
            });

            await this.waClient.initialize().catch(err => {
                reportError(`تهيئة واتساب ويب لـ ${this.tenantId}`, err.message);
            });

        } catch (error) {
            reportError(`تشغيل محرك واتساب ويب لـ ${this.tenantId}`, error.message);
        }
    }

    async destroy() {
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        this.waStatus = "غير متصل";
        this.lastQrCodeUrl = "";
        if (this.waClient) {
            try {
                await this.waClient.destroy();
            } catch (e) {
                console.log(`[Tenant: ${this.tenantId}] تم إغلاق العميل بنجاح أو كان مغلقاً بالفعل.`);
            }
            this.waClient = null;
        }
    }

    getStatus() {
        return this.waStatus;
    }

    getQrCode() {
        return this.lastQrCodeUrl;
    }

    async sendMessage({ recipientId, messageType, content, media }) {
        const txStartTime = Date.now();
        if (!this.waClient || this.waStatus !== "متصل") {
            throw new Error(`WhatsApp Web client for tenant ${this.tenantId} is not connected`);
        }

        let sentMsg;
        let finalPath = media ? media.localPath : null;

        if (finalPath) {
            const absolutePath = finalPath.startsWith('/') && !finalPath.startsWith('/uploads')
                ? finalPath
                : path.join(__dirname, '..', '..', '..', 'public', finalPath);

            if (fs.existsSync(absolutePath)) {
                const mediaFile = MessageMedia.fromFilePath(absolutePath);
                sentMsg = await this.waClient.sendMessage(recipientId, mediaFile, { caption: content || '' });
            } else {
                throw new Error(`Media file not found at: ${absolutePath}`);
            }
        } else {
            sentMsg = await this.waClient.sendMessage(recipientId, content);
        }

        const externalMessageId = sentMsg && sentMsg.id ? String(sentMsg.id.id || '') : `wa_web_${Date.now()}`;

        addLog(`[WhatsApp] tenantId: ${this.tenantId} | provider: web | operation: send_message | executionTime: ${Date.now() - txStartTime} ms | details: Sent ${messageType} message to ${recipientId}`);

        return {
            success: true,
            externalMessageId
        };
    }
}

module.exports = WhatsAppWebProvider;
