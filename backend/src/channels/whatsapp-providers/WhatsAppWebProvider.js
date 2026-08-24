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

function extractExternalMessageId(sentMessage) {
    const id = sentMessage?.id || sentMessage?._data?.id;
    if (typeof id === 'string') return id.trim();
    return String(id?.id || id?._serialized || '').trim();
}

class WhatsAppWebProvider extends WhatsAppProvider {
    constructor(tenantId, config) {
        super(tenantId, config);
        this.waClient = null;
        this.waStatus = "جاري التحميل...";
        this.lastQrCodeUrl = "";
        this.reconnectTimeout = null;
        this.reconnectPromise = null;
        this.initializePromise = null;
        this.initialized = false;
        this.lifecycleGeneration = 0;
        this.processLeasePath = null;
        this.hasProcessLease = false;
        this.exitLeaseHandler = null;
        this.profileImageCache = new Map();
        this.reconnectDelayMs = 10000;
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

    _scheduleReconnect(client, generation) {
        if (this.reconnectPromise || this.reconnectTimeout) return;

        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            this.reconnectPromise = (async () => {
                if (generation !== this.lifecycleGeneration || this.waClient !== client) return;

                // Invalidate every callback from the retired page before destroying
                // it. whatsapp-web.js must never bind a new QR handler to that page.
                this.lifecycleGeneration += 1;
                this.waClient = null;
                this.initialized = false;
                try {
                    await this._destroyClient(client);
                } catch (_) {
                    // A disconnected Chromium page may already be closed.
                }

                const pendingInitialization = this.initializePromise;
                if (pendingInitialization) await pendingInitialization.catch(() => {});
                this._releaseProcessLease();
                await this.initialize();
            })().catch(error => {
                reportError(`إعادة تهيئة واتساب ويب لـ ${this.tenantId}`, error.message);
            }).finally(() => {
                this.reconnectPromise = null;
            });
        }, this.reconnectDelayMs);
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
                addLog(`[WhatsApp] tenantId: ${this.tenantId} | provider: web | operation: disconnect | executionTime: ${Date.now() - startTime} ms | details: WhatsApp disconnected: ${reason}`);
                publish(EVENTS.WHATSAPP_STATUS_UPDATED, { status: this.waStatus, qr: "", tenantId: this.tenantId });

                this._scheduleReconnect(client, generation);
            });

            client.on('message', async (msg) => {
                if (this.waClient !== client || generation !== this.lifecycleGeneration) return;
                if (msg.from.includes('@g.us')) return;
                if (!String(msg.body || '').trim() && !msg.hasMedia) {
                    // WhatsApp Web emits protocol/reaction notifications through the
                    // message channel. They are not customer messages.
                    return;
                }

                const rxStartTime = Date.now();
                const userId = msg.from;
                let userText = msg.body;
                let mediaType = 'text';
                let fileExt = '';

                const contact = await msg.getContact();
                let resolvedPhoneNumber = null;
                if (/@lid$/i.test(userId) && typeof client.getContactLidAndPhone === 'function') {
                    try {
                        const mappings = await Promise.race([
                            client.getContactLidAndPhone([userId]),
                            new Promise((_, reject) => setTimeout(
                                () => reject(new Error('WhatsApp LID phone resolution timed out')),
                                5000
                            ))
                        ]);
                        const phoneWid = Array.isArray(mappings) ? mappings[0]?.pn : null;
                        if (/@(?:c\.us|s\.whatsapp\.net)$/i.test(String(phoneWid || ''))) {
                            resolvedPhoneNumber = String(phoneWid).split('@')[0];
                        }
                    } catch (error) {
                        console.warn(`[WhatsApp] Could not resolve LID to phone tenant=${this.tenantId}: ${error.message}`);
                    }
                }
                let profileImageRemoteUrl = null;
                const cachedProfileImage = this.profileImageCache.get(userId);
                if (cachedProfileImage && cachedProfileImage.expiresAt > Date.now()) {
                    profileImageRemoteUrl = cachedProfileImage.url;
                } else {
                    try {
                        profileImageRemoteUrl = await contact.getProfilePicUrl();
                    } catch (_) {
                        // Privacy settings commonly make profile photos unavailable.
                    }
                    this.profileImageCache.set(userId, {
                        url: profileImageRemoteUrl || null,
                        expiresAt: Date.now() + (6 * 60 * 60 * 1000)
                    });
                }

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
                        const detail = err?.message || String(err || 'unknown media download error');
                        reportError(`تحميل وسائط واتساب لـ ${this.tenantId}`, detail);
                    }
                }

                if (!String(userText || '').trim() && mediaType === 'text') return;

                const normalized = normalizeWhatsAppMessage(
                    msg,
                    contact,
                    msg.hasMedia ? userText : null,
                    mediaType,
                    fileExt,
                    profileImageRemoteUrl,
                    resolvedPhoneNumber
                );
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
            if (generation === this.lifecycleGeneration) {
                reportError(`تشغيل محرك واتساب ويب لـ ${this.tenantId}`, error.message);
            }
            throw error;
        }
    }

    async destroy() {
        this.lifecycleGeneration += 1;
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        if (this.reconnectPromise) {
            await this.reconnectPromise.catch(() => {});
            this.reconnectPromise = null;
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

        const externalMessageId = extractExternalMessageId(sentMsg);
        const acceptedUnverified = !externalMessageId;
        if (acceptedUnverified) {
            console.warn(`[WhatsApp] Provider resolved send without a message ID tenant=${this.tenantId}; preserving the accepted reply with unverified delivery metadata.`);
        }

        addLog(`[WhatsApp] tenantId: ${this.tenantId} | provider: web | operation: send_message | executionTime: ${Date.now() - txStartTime} ms | details: Sent ${messageType} message to ${recipientId}`);

        return {
            success: true,
            externalMessageId: externalMessageId || null,
            acceptedUnverified
        };
    }
}

module.exports = WhatsAppWebProvider;
module.exports._test = { extractExternalMessageId };
