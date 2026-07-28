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
        this.initializePromise = null;
        this.initialized = false;
        this.lifecycleGeneration = 0;
        this.processLeasePath = null;
        this.hasProcessLease = false;
        this.exitLeaseHandler = null;
    }

    _getProcessIdentity(pid = process.pid) {
        try {
            const bootId = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
            const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
            const closingParen = stat.lastIndexOf(')');
            const fieldsAfterCommand = stat.slice(closingParen + 2).split(' ');
            const startTime = fieldsAfterCommand[19];
            return { bootId, startTime };
        } catch (_) {
            return null;
        }
    }

    _leaseOwnerIsAlive(owner) {
        if (!owner || !Number.isInteger(owner.pid)) return false;

        try {
            process.kill(owner.pid, 0);
        } catch (err) {
            if (err.code !== 'EPERM') return false;
        }

        const currentIdentity = this._getProcessIdentity(owner.pid);
        if (owner.processIdentity && currentIdentity) {
            return owner.processIdentity.bootId === currentIdentity.bootId
                && owner.processIdentity.startTime === currentIdentity.startTime;
        }

        // Conservative fallback for platforms without /proc process identity.
        return true;
    }

    _acquireProcessLease(authPath) {
        if (this.hasProcessLease) return;

        const leasePath = `${authPath}.init.lock`;
        const createLease = () => {
            fs.mkdirSync(leasePath);
            fs.writeFileSync(path.join(leasePath, 'owner.json'), JSON.stringify({
                pid: process.pid,
                tenantId: this.tenantId,
                createdAt: new Date().toISOString(),
                processIdentity: this._getProcessIdentity()
            }));
            this.processLeasePath = leasePath;
            this.hasProcessLease = true;
            this.exitLeaseHandler = () => {
                if (this.hasProcessLease && this.processLeasePath) {
                    fs.rmSync(this.processLeasePath, { recursive: true, force: true });
                    this.hasProcessLease = false;
                    this.processLeasePath = null;
                }
            };
            process.once('exit', this.exitLeaseHandler);
        };

        try {
            createLease();
        } catch (err) {
            if (err.code !== 'EEXIST') throw err;

            let owner = null;
            try {
                owner = JSON.parse(fs.readFileSync(path.join(leasePath, 'owner.json'), 'utf8'));
            } catch (_) {
                // An incomplete lease is treated as stale below.
            }

            if (this._leaseOwnerIsAlive(owner)) {
                throw new Error(`WhatsApp tenant ${this.tenantId} is already owned by process ${owner.pid}`);
            }

            fs.rmSync(leasePath, { recursive: true, force: true });
            createLease();
        }
    }

    _releaseProcessLease() {
        if (!this.hasProcessLease || !this.processLeasePath) return;
        fs.rmSync(this.processLeasePath, { recursive: true, force: true });
        this.hasProcessLease = false;
        this.processLeasePath = null;
        if (this.exitLeaseHandler) {
            process.removeListener('exit', this.exitLeaseHandler);
            this.exitLeaseHandler = null;
        }
    }

    async _destroyClient(client, timeoutMs = 10000) {
        if (!client) return;

        let timeoutId;
        try {
            await Promise.race([
                Promise.resolve().then(() => client.destroy()),
                new Promise((_, reject) => {
                    timeoutId = setTimeout(() => {
                        reject(new Error(`Timed out destroying WhatsApp client for tenant: ${this.tenantId}`));
                    }, timeoutMs);
                })
            ]);
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
            client.removeAllListeners();
        }
    }

    initialize() {
        if (this.initialized && this.waClient) {
            return Promise.resolve(this);
        }
        if (this.initializePromise) {
            return this.initializePromise;
        }

        const generation = ++this.lifecycleGeneration;
        this.initializePromise = this._initialize(generation).finally(() => {
            this.initializePromise = null;
        });
        return this.initializePromise;
    }

    async _initialize(generation) {
        const startTime = Date.now();
        let client = null;
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
            this._acquireProcessLease(authPath);

            client = new Client({
                authStrategy: new LocalAuth({
                    dataPath: authPath
                }),
                puppeteer: puppeteerOptions
            });
            this.waClient = client;

            client.on('qr', (qr) => {
                if (this.waClient !== client || generation !== this.lifecycleGeneration) return;
                this.waStatus = "انتظار المسح";
                qrcode.toDataURL(qr, (err, url) => {
                    if (!err) {
                        this.lastQrCodeUrl = url;
                        addLog(`[WhatsApp] tenantId: ${this.tenantId} | provider: web | operation: qr_generation | executionTime: ${Date.now() - startTime} ms | details: Generated new QR code string successfully`);
                        publish(EVENTS.WHATSAPP_STATUS_UPDATED, { status: this.waStatus, qr: url, tenantId: this.tenantId });
                    }
                });
            });

            client.on('ready', () => {
                if (this.waClient !== client || generation !== this.lifecycleGeneration) return;
                this.waStatus = "متصل";
                this.lastQrCodeUrl = "";
                addLog(`[WhatsApp] tenantId: ${this.tenantId} | provider: web | operation: initialize | executionTime: ${Date.now() - startTime} ms | details: Session initialized and ready`);
                publish(EVENTS.WHATSAPP_STATUS_UPDATED, { status: this.waStatus, qr: "", tenantId: this.tenantId });
            });

            client.on('disconnected', (reason) => {
                if (this.waClient !== client || generation !== this.lifecycleGeneration) return;
                this.waStatus = "غير متصل";
                this.lastQrCodeUrl = "";
                this.initialized = false;
                this.waClient = null;
                addLog(`[WhatsApp] tenantId: ${this.tenantId} | provider: web | operation: disconnect | executionTime: ${Date.now() - startTime} ms | details: WhatsApp disconnected: ${reason}`);
                publish(EVENTS.WHATSAPP_STATUS_UPDATED, { status: this.waStatus, qr: "", tenantId: this.tenantId });

                // Automatic reconnection, coalesced through initialize().
                if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
                this.reconnectTimeout = setTimeout(async () => {
                    if (generation !== this.lifecycleGeneration) return;
                    try {
                        await this._destroyClient(client);
                    } catch (_) {
                        // The disconnected browser may already be gone.
                    }
                    if (generation === this.lifecycleGeneration) {
                        this.initialize().catch(err => {
                            reportError(`إعادة تهيئة واتساب ويب لـ ${this.tenantId}`, err.message);
                        });
                    }
                }, 10000);
            });

            client.on('message', async (msg) => {
                if (this.waClient !== client || generation !== this.lifecycleGeneration) return;
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

            await client.initialize();
            if (generation !== this.lifecycleGeneration || this.waClient !== client) {
                await client.destroy().catch(() => {});
                throw new Error(`WhatsApp initialization superseded for tenant: ${this.tenantId}`);
            }
            this.initialized = true;
            return this;

        } catch (error) {
            this.initialized = false;
            if (client) {
                try {
                    await this._destroyClient(client);
                } catch (_) {
                    // Initialization may fail before Puppeteer creates a browser.
                }
            }
            if (generation === this.lifecycleGeneration) {
                this.waClient = null;
            }
            this._releaseProcessLease();
            reportError(`تشغيل محرك واتساب ويب لـ ${this.tenantId}`, error.message);
            throw error;
        }
    }

    async destroy() {
        this.lifecycleGeneration += 1;
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        this.initialized = false;
        this.waStatus = "غير متصل";
        this.lastQrCodeUrl = "";
        const client = this.waClient;
        this.waClient = null;
        if (client) {
            try {
                await this._destroyClient(client);
            } catch (e) {
                console.log(`[Tenant: ${this.tenantId}] تم إغلاق العميل بنجاح أو كان مغلقاً بالفعل.`);
            }
        }
        this._releaseProcessLease();
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
