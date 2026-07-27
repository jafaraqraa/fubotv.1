// WhatsAppProvider.js - Abstract Base Interface for WhatsApp Providers

class WhatsAppProvider {
    constructor(tenantId, config) {
        if (new.target === WhatsAppProvider) {
            throw new Error("Cannot instantiate abstract class WhatsAppProvider directly.");
        }
        this.tenantId = tenantId;
        this.config = config || {};
    }

    /**
     * Initialize the provider connection/session.
     * @returns {Promise<void>}
     */
    async initialize() {
        throw new Error("Method 'initialize()' must be implemented");
    }

    /**
     * Stop/close/destroy the provider connection.
     * @returns {Promise<void>}
     */
    async destroy() {
        throw new Error("Method 'destroy()' must be implemented");
    }

    /**
     * Returns the connection status string.
     * @returns {string} e.g. "متصل", "انتظار المسح", "غير متصل"
     */
    getStatus() {
        throw new Error("Method 'getStatus()' must be implemented");
    }

    /**
     * Returns the base64 encoded QR Code string if available.
     * @returns {string}
     */
    getQrCode() {
        return "";
    }

    /**
     * Sends a message to a recipient.
     * @param {Object} payload - { recipientId, messageType, content, media }
     * @returns {Promise<Object>} e.g. { success: true, externalMessageId: "..." }
     */
    async sendMessage({ recipientId, messageType, content, media }) {
        throw new Error("Method 'sendMessage()' must be implemented");
    }
}

module.exports = WhatsAppProvider;
