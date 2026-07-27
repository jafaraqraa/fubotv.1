// WhatsAppProviderManager.js - Centralized WhatsApp multi-tenant/multi-provider Router and Lifecycle Manager

const db = require('../../database/connection');
const WhatsAppWebProvider = require('./WhatsAppWebProvider');
const WhatsAppBusinessCloudProvider = require('./WhatsAppBusinessCloudProvider');
const { addLog, reportError } = require('../../services/logger');

class WhatsAppProviderManager {
    constructor() {
        this.providers = new Map();
    }

    /**
     * Initializes all active/enabled providers on startup.
     */
    async initializeAll() {
        try {
            console.log("🚀 Initializing WhatsApp multi-tenant providers...");

            // Ensure default tenant exists
            const defaultExists = db.prepare("SELECT 1 FROM whatsapp_tenant_configs WHERE tenant_id = 'default'").get();
            if (!defaultExists) {
                db.prepare(`
                    INSERT INTO whatsapp_tenant_configs (tenant_id, provider_type, config_json, enabled)
                    VALUES ('default', 'web', '{}', 1)
                `).run();
            }

            const activeConfigs = db.prepare("SELECT * FROM whatsapp_tenant_configs WHERE enabled = 1").all();
            for (const row of activeConfigs) {
                try {
                    await this.getOrLoadProvider(row.tenant_id, row);
                } catch (err) {
                    reportError(`تهيئة مزود واتساب للمستأجر ${row.tenant_id}`, err.message);
                }
            }
            console.log("🎉 All active WhatsApp providers initialized.");
        } catch (err) {
            reportError("تجهيز مدير بوابات واتساب", err.message);
        }
    }

    /**
     * Retrieves an active provider instance or loads/instantiates it if cached version does not exist.
     * @param {string} tenantId
     * @param {Object} [dbRow] Optional pre-fetched row for efficiency
     */
    async getOrLoadProvider(tenantId, dbRow = null) {
        if (this.providers.has(tenantId)) {
            return this.providers.get(tenantId);
        }

        let row = dbRow;
        if (!row) {
            row = db.prepare("SELECT * FROM whatsapp_tenant_configs WHERE tenant_id = ?").get(tenantId);
        }

        // If no configuration exists, fallback to a default 'web' configuration for backwards compatibility
        if (!row) {
            if (tenantId === 'default') {
                db.prepare(`
                    INSERT INTO whatsapp_tenant_configs (tenant_id, provider_type, config_json, enabled)
                    VALUES ('default', 'web', '{}', 1)
                `).run();
                row = { tenant_id: 'default', provider_type: 'web', config_json: '{}', enabled: 1 };
            } else {
                throw new Error(`WhatsApp config not found for tenant: ${tenantId}`);
            }
        }

        const config = JSON.parse(row.config_json || '{}');
        let providerInstance;

        if (row.provider_type === 'cloud') {
            providerInstance = new WhatsAppBusinessCloudProvider(tenantId, config);
        } else {
            providerInstance = new WhatsAppWebProvider(tenantId, config);
        }

        this.providers.set(tenantId, providerInstance);
        await providerInstance.initialize();

        return providerInstance;
    }

    /**
     * Get provider safely. Returns null if not initialized/cached.
     * @param {string} tenantId
     */
    getProvider(tenantId) {
        return this.providers.get(tenantId);
    }

    /**
     * Dynamically switches or restarts the provider for a given tenant.
     * @param {string} tenantId
     * @param {string} providerType - 'web' or 'cloud'
     * @param {Object} config - credentials/settings object
     */
    async switchProvider(tenantId, providerType, config) {
        addLog(`🔄 [Tenant: ${tenantId}] جاري تغيير وتحديث مزود بوابة واتساب إلى: [${providerType}]...`);

        // 1. Destroy existing provider instance
        if (this.providers.has(tenantId)) {
            try {
                const oldProvider = this.providers.get(tenantId);
                await oldProvider.destroy();
            } catch (err) {
                console.error(`Failed to destroy old provider for ${tenantId}:`, err.message);
            }
            this.providers.delete(tenantId);
        }

        // 2. Persist new configuration to database
        const configJson = JSON.stringify(config || {});
        db.prepare(`
            INSERT INTO whatsapp_tenant_configs (tenant_id, provider_type, config_json, enabled, updated_at)
            VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(tenant_id) DO UPDATE SET
                provider_type = excluded.provider_type,
                config_json = excluded.config_json,
                updated_at = CURRENT_TIMESTAMP
        `).run(tenantId, providerType, configJson);

        // 3. Instantiate and initialize the new provider
        const newProvider = await this.getOrLoadProvider(tenantId);
        return newProvider;
    }

    /**
     * Destroy all active providers (e.g. for graceful shutdown).
     */
    async destroyAll() {
        console.log("🔌 Stopping all active WhatsApp providers...");
        for (const [tenantId, provider] of this.providers.entries()) {
            try {
                await provider.destroy();
            } catch (err) {
                console.error(`Error destroying provider for tenant ${tenantId}:`, err.message);
            }
        }
        this.providers.clear();
    }
}

// Export singleton instance
const managerInstance = new WhatsAppProviderManager();
module.exports = managerInstance;
