// WhatsAppProviderManager.js - Centralized WhatsApp multi-tenant/multi-provider Router and Lifecycle Manager

const db = require('../../database/connection');
const WhatsAppWebProvider = require('./WhatsAppWebProvider');
const WhatsAppBusinessCloudProvider = require('./WhatsAppBusinessCloudProvider');
const { addLog, reportError } = require('../../services/logger');

class WhatsAppProviderManager {
    constructor() {
        this.providers = new Map();
        this.providerInitPromises = new Map();
        this.providerSwitchPromises = new Map();
        this.initializeAllPromise = null;
        this.initialized = false;
    }

    /**
     * Initializes all active/enabled providers on startup.
     */
    initializeAll() {
        if (this.initialized) {
            console.log('[WhatsApp Init] Already initialized.');
            return Promise.resolve(this.providers);
        }

        if (this.initializeAllPromise) {
            console.log('[WhatsApp Init] Already running.');
            return this.initializeAllPromise;
        }

        console.log('[WhatsApp Init] Starting...');
        this.initializeAllPromise = (async () => {
            try {
                // Ensure default tenant exists
                const defaultExists = db.prepare("SELECT 1 FROM whatsapp_tenant_configs WHERE tenant_id = 'default'").get();
                if (!defaultExists) {
                    db.prepare(`
                        INSERT INTO whatsapp_tenant_configs (tenant_id, provider_type, config_json, enabled)
                        VALUES ('default', 'web', '{}', 1)
                    `).run();
                }

                const activeConfigs = db.prepare("SELECT * FROM whatsapp_tenant_configs WHERE enabled = 1").all();
                const failures = [];
                for (const row of activeConfigs) {
                    try {
                        await this.getOrLoadProvider(row.tenant_id, row);
                    } catch (err) {
                        failures.push({ tenantId: row.tenant_id, error: err });
                        reportError(`تهيئة مزود واتساب للمستأجر ${row.tenant_id}`, err.message);
                    }
                }
                if (failures.length > 0) {
                    throw new Error(`WhatsApp initialization failed for tenant(s): ${failures.map(item => item.tenantId).join(', ')}`);
                }
                this.initialized = true;
                console.log('[WhatsApp Init] Completed.');
                return this.providers;
            } catch (err) {
                reportError("تجهيز مدير بوابات واتساب", err.message);
                throw err;
            } finally {
                this.initializeAllPromise = null;
            }
        })();

        return this.initializeAllPromise;
    }

    /**
     * Retrieves an active provider instance or loads/instantiates it if cached version does not exist.
     * @param {string} tenantId
     * @param {Object} [dbRow] Optional pre-fetched row for efficiency
     */
    getOrLoadProvider(tenantId, dbRow = null) {
        if (this.providers.has(tenantId)) {
            return Promise.resolve(this.providers.get(tenantId));
        }

        if (this.providerInitPromises.has(tenantId)) {
            return this.providerInitPromises.get(tenantId);
        }

        const initPromise = (async () => {
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
            const providerInstance = row.provider_type === 'cloud'
                ? new WhatsAppBusinessCloudProvider(tenantId, config)
                : new WhatsAppWebProvider(tenantId, config);

            try {
                await providerInstance.initialize();
                this.providers.set(tenantId, providerInstance);
                return providerInstance;
            } catch (err) {
                await providerInstance.destroy().catch(() => {});
                throw err;
            }
        })();

        this.providerInitPromises.set(tenantId, initPromise);
        initPromise.finally(() => {
            if (this.providerInitPromises.get(tenantId) === initPromise) {
                this.providerInitPromises.delete(tenantId);
            }
        }).catch(() => {});

        return initPromise;
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
    switchProvider(tenantId, providerType, config) {
        if (this.providerSwitchPromises.has(tenantId)) {
            return this.providerSwitchPromises.get(tenantId);
        }

        const switchPromise = (async () => {
            addLog(`🔄 [Tenant: ${tenantId}] جاري تغيير وتحديث مزود بوابة واتساب إلى: [${providerType}]...`);

            const pendingInit = this.providerInitPromises.get(tenantId);
            if (pendingInit) {
                await pendingInit.catch(() => {});
            }

            const requestedConfig = config || {};
            const storedRow = db.prepare(
                'SELECT provider_type, config_json FROM whatsapp_tenant_configs WHERE tenant_id = ?'
            ).get(tenantId);
            const storedConfig = storedRow ? JSON.parse(storedRow.config_json || '{}') : null;
            const currentProvider = this.providers.get(tenantId);
            if (currentProvider && storedRow?.provider_type === providerType
                && JSON.stringify(storedConfig) === JSON.stringify(requestedConfig)) {
                addLog(`✅ [Tenant: ${tenantId}] إعدادات واتساب لم تتغير؛ تم الإبقاء على الاتصال الحالي.`);
                return currentProvider;
            }

            const oldProvider = this.providers.get(tenantId);
            this.providers.delete(tenantId);
            if (oldProvider) {
                await oldProvider.destroy();
            }

            const configJson = JSON.stringify(requestedConfig);
            db.prepare(`
                INSERT INTO whatsapp_tenant_configs (tenant_id, provider_type, config_json, enabled, updated_at)
                VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
                ON CONFLICT(tenant_id) DO UPDATE SET
                    provider_type = excluded.provider_type,
                    config_json = excluded.config_json,
                    updated_at = CURRENT_TIMESTAMP
            `).run(tenantId, providerType, configJson);

            return this.getOrLoadProvider(tenantId);
        })();

        this.providerSwitchPromises.set(tenantId, switchPromise);
        switchPromise.finally(() => {
            if (this.providerSwitchPromises.get(tenantId) === switchPromise) {
                this.providerSwitchPromises.delete(tenantId);
            }
        }).catch(() => {});

        return switchPromise;
    }

    /**
     * Destroy all active providers (e.g. for graceful shutdown).
     */
    async destroyAll() {
        console.log("🔌 Stopping all active WhatsApp providers...");
        if (this.initializeAllPromise) {
            await this.initializeAllPromise.catch(() => {});
        }
        await Promise.allSettled([...this.providerSwitchPromises.values()]);
        await Promise.allSettled([...this.providerInitPromises.values()]);
        for (const [tenantId, provider] of this.providers.entries()) {
            try {
                await provider.destroy();
            } catch (err) {
                console.error(`Error destroying provider for tenant ${tenantId}:`, err.message);
            }
        }
        this.providers.clear();
        this.providerInitPromises.clear();
        this.providerSwitchPromises.clear();
        this.initialized = false;
    }
}

// Preserve one lifecycle manager even if this module is re-evaluated by a hot reloader.
const managerKey = Symbol.for('futhing.whatsappProviderManager');
const managerInstance = globalThis[managerKey] || new WhatsAppProviderManager();
globalThis[managerKey] = managerInstance;
module.exports = managerInstance;
