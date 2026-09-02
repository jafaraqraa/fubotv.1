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
const { updateDeliveryByExternalId } = require('../../database/repositories/messageRepository');

const uploadsDir = path.join(__dirname, '..', '..', '..', 'public', 'uploads');

function extractExternalMessageId(sentMessage) {
    const id = sentMessage?.id || sentMessage?._data?.id;
    if (typeof id === 'string') return id.trim();
    return String(id?.id || id?._serialized || '').trim();
}

async function downloadMediaWithRetry(message, attempts = 3) {
    // Current WhatsApp Web exposes the serialized key as `$1`, while
    // whatsapp-web.js 1.34.7 still reads `_serialized` in downloadMedia().
    // Reconstruct the compatible key before entering the library method.
    if (message?.id && !message.id._serialized) {
        const serialized = message.id.$1
            || `${String(message.id.fromMe)}_${message.id.remote}_${message.id.id}`;
        try {
            message.id._serialized = serialized;
        } catch (_) {
            Object.defineProperty(message.id, '_serialized', {
                value: serialized, configurable: true, enumerable: false
            });
        }
    }
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            const media = await message.downloadMedia();
            if (media?.data && media?.mimetype) return media;
            lastError = new Error('WhatsApp returned empty media data');
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error || 'WhatsApp media download failed'));
        }
        if (attempt < attempts) {
            await new Promise(resolve => setTimeout(resolve, attempt * 500));
        }
    }
    throw lastError || new Error('WhatsApp media download failed');
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

            client.on('message_ack', async (message, ack) => {
                if (this.waClient !== client || generation !== this.lifecycleGeneration) return;
                const externalMessageId = extractExternalMessageId(message);
                if (!externalMessageId) return;

                // whatsapp-web.js: 1=server, 2=device, 3=read, 4=played.
                const deliveryStatus = ack >= 3 ? 'read' : ack === 2 ? 'delivered' : ack === -1 ? 'failed' : null;
                if (!deliveryStatus) return;
                try {
                    // The acknowledgement can race the database write immediately
                    // after sendMessage resolves. Retry briefly instead of dropping it.
                    for (const delayMs of [0, 150, 600]) {
                        if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
                        const updated = updateDeliveryByExternalId(
                            externalMessageId,
                            'whatsapp',
                            this.tenantId,
                            deliveryStatus,
                            { provider: 'whatsapp-web', acknowledgement: ack }
                        );
                        if (updated) break;
                    }
                } catch (error) {
                    reportError(`تحديث حالة قراءة واتساب لـ ${this.tenantId}`, error.message);
                }
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
                let localMediaPath = null;
                const providerMessageType = String(msg.type || '').toLowerCase();
                if (providerMessageType === 'ptt') mediaType = 'voice';
                else if (providerMessageType === 'audio') mediaType = 'audio';

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
                        const media = await downloadMediaWithRetry(msg);
                        if (media) {
                            const normalizedMime = String(media.mimetype || '').split(';')[0].trim().toLowerCase();
                            fileExt = getExtensionFromMime(normalizedMime);
                            const fileName = `${Date.now()}_whatsapp_${this.tenantId}.${fileExt}`;
                            const destPath = path.join(uploadsDir, fileName);

                            fs.writeFileSync(destPath, Buffer.from(media.data, 'base64'));
                            userText = `/uploads/${fileName}`;
                            localMediaPath = userText;

                            if (normalizedMime.startsWith('image/')) mediaType = 'image';
                            else if (normalizedMime.startsWith('audio/')) {
                                mediaType = providerMessageType === 'ptt' ? 'voice' : 'audio';
                            }
                            else if (normalizedMime.startsWith('video/')) mediaType = 'video';
                            else mediaType = 'document';
                        }
                    } catch (err) {
                        const detail = err?.message || String(err || 'unknown media download error');
                        reportError(`تحميل وسائط واتساب لـ ${this.tenantId}`, detail);
                        mediaType = providerMessageType === 'ptt' ? 'voice' : 'document';
                        userText = 'تعذّر تحميل التسجيل الصوتي من واتساب. يرجى طلب إعادة إرساله.';
                    }
                }

                if (!String(userText || '').trim() && mediaType === 'text') return;

                const normalized = normalizeWhatsAppMessage(
                    msg,
                    contact,
                    localMediaPath,
                    mediaType,
                    fileExt,
                    profileImageRemoteUrl,
                    resolvedPhoneNumber,
                    userText
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
        let resolveCreatedMessageId;
        const createdMessageId = new Promise(resolve => { resolveCreatedMessageId = resolve; });
        const onMessageCreated = message => {
            const fromMe = message?.fromMe ?? message?.id?.fromMe ?? message?._data?.id?.fromMe;
            if (fromMe === false) return;
            const target = String(message?.to || message?.id?.remote || message?._data?.to || '');
            if (target && target !== String(recipientId)) return;
            const id = extractExternalMessageId(message);
            if (id) resolveCreatedMessageId(id);
        };
        const canCaptureCreatedMessage = typeof this.waClient.on === 'function'
            && typeof this.waClient.removeListener === 'function';
        if (canCaptureCreatedMessage) this.waClient.on('message_create', onMessageCreated);
        let finalPath = media ? media.localPath : null;

        try {
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
        } catch (error) {
            if (canCaptureCreatedMessage) this.waClient.removeListener('message_create', onMessageCreated);
            throw error;
        }

        let externalMessageId = extractExternalMessageId(sentMsg);
        if (!externalMessageId && canCaptureCreatedMessage) {
            externalMessageId = await Promise.race([
                createdMessageId,
                new Promise(resolve => setTimeout(() => resolve(''), 1500))
            ]);
        }
        if (canCaptureCreatedMessage) this.waClient.removeListener('message_create', onMessageCreated);
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
module.exports._test = { extractExternalMessageId, downloadMediaWithRetry };
