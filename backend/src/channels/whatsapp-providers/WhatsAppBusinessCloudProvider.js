// WhatsAppBusinessCloudProvider.js - Meta WhatsApp Business Cloud API Implementation

const WhatsAppProvider = require('./WhatsAppProvider');
const fs = require('fs');
const path = require('path');
const { Blob } = require('buffer');
const { addLog, reportError } = require('../../services/logger');

class WhatsAppBusinessCloudProvider extends WhatsAppProvider {
    constructor(tenantId, config) {
        super(tenantId, config);
        this.status = "غير متصل";
        this.initializePromise = null;
        this.initialized = false;
    }

    initialize() {
        if (this.initialized) return Promise.resolve(this);
        if (this.initializePromise) return this.initializePromise;

        this.initializePromise = (async () => {
            const startTime = Date.now();
            const { accessToken, phoneNumberId, verifyToken } = this.config;
            if (accessToken && phoneNumberId && verifyToken) {
                this.status = "متصل";
                addLog(`[WhatsApp] tenantId: ${this.tenantId} | provider: cloud | operation: initialize | executionTime: ${Date.now() - startTime} ms | details: Cloud API initialized successfully`);
            } else {
                this.status = "غير متصل";
                console.warn(`⚠️ [Tenant: ${this.tenantId}] إعدادات WhatsApp Cloud API غير مكتملة.`);
            }
            this.initialized = true;
            return this;
        })().finally(() => {
            this.initializePromise = null;
        });
        return this.initializePromise;
    }

    async destroy() {
        this.initialized = false;
        this.status = "غير متصل";
        if (this.initializePromise) {
            await this.initializePromise.catch(() => {});
        }
    }

    getStatus() {
        const { accessToken, phoneNumberId, verifyToken } = this.config;
        if (accessToken && phoneNumberId && verifyToken) {
            return "متصل";
        }
        return "غير متصل";
    }

    getQrCode() {
        return ""; // Cloud API does not require QR Scanning
    }

    async sendMessage({ recipientId, messageType, content, media }) {
        const txStartTime = Date.now();
        const { accessToken, phoneNumberId } = this.config;
        if (!accessToken || !phoneNumberId) {
            throw new Error(`WhatsApp Cloud API is not configured for tenant: ${this.tenantId}`);
        }

        const cleanRecipientId = recipientId.split('@')[0]; // Strip suffix e.g., "12345@c.us" -> "12345"

        let payload = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: cleanRecipientId
        };

        let finalPath = media ? media.localPath : null;

        if (finalPath) {
            const absolutePath = finalPath.startsWith('/') && !finalPath.startsWith('/uploads')
                ? finalPath
                : path.join(__dirname, '..', '..', '..', 'public', finalPath);

            if (!fs.existsSync(absolutePath)) {
                throw new Error(`Media file not found at: ${absolutePath}`);
            }

            const mimeType = media.mimeType || 'application/octet-stream';
            const fileName = media.fileName || path.basename(absolutePath);
            const fileBuffer = fs.readFileSync(absolutePath);

            const fileBlob = new Blob([fileBuffer], { type: mimeType });
            const formData = new FormData();
            formData.append('file', fileBlob, fileName);
            formData.append('type', mimeType);
            formData.append('messaging_product', 'whatsapp');

            const uploadStartTime = Date.now();
            const uploadResponse = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/media`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                },
                body: formData
            });

            if (!uploadResponse.ok) {
                const uploadErr = await uploadResponse.text();
                throw new Error(`Meta Media Upload Failed: ${uploadErr}`);
            }

            const uploadResult = await uploadResponse.json();
            const mediaId = uploadResult.id;

            if (!mediaId) {
                throw new Error(`Meta Media Upload succeeded but returned no ID.`);
            }

            addLog(`[WhatsApp] tenantId: ${this.tenantId} | provider: cloud | operation: media_upload | executionTime: ${Date.now() - uploadStartTime} ms | details: Media uploaded successfully (size: ${fileBuffer.length} bytes)`);

            let msgType = 'document';
            if (mimeType.startsWith('image/')) msgType = 'image';
            else if (mimeType.startsWith('audio/')) msgType = 'audio';
            else if (mimeType.startsWith('video/')) msgType = 'video';

            payload.type = msgType;
            payload[msgType] = {
                id: mediaId
            };
            if (msgType !== 'audio' && content) {
                payload[msgType].caption = content;
            }
        } else {
            payload.type = "text";
            payload.text = {
                body: content
            };
        }

        const response = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            const errorMsg = data.error && data.error.message ? data.error.message : JSON.stringify(data);
            throw new Error(`Meta API Error: ${errorMsg}`);
        }

        const externalMessageId = data.messages && data.messages[0] ? String(data.messages[0].id || '') : `wa_cloud_${Date.now()}`;

        addLog(`[WhatsApp] tenantId: ${this.tenantId} | provider: cloud | operation: send_message | executionTime: ${Date.now() - txStartTime} ms | details: Sent ${messageType} message to ${cleanRecipientId}`);

        return {
            success: true,
            externalMessageId
        };
    }
}

module.exports = WhatsAppBusinessCloudProvider;
