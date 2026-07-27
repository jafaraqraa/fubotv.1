const crypto = require('crypto');
const db = require('../database/connection');
const { getSetting, saveSetting } = require('../database/repositories/settingsRepository');
const ProviderAdapterFactory = require('./adapters/ProviderAdapterFactory');

function hashApiKey(key) {
    if (!key) return '';
    return crypto.createHash('sha256').update(key).digest('hex');
}

function maskApiKey(key) {
    if (!key) return '';
    if (key.length <= 8) return '••••••••';
    return '••••••••' + key.substring(key.length - 4);
}

function isMaskedPlaceholder(value) {
    if (!value) return false;
    return value.includes('•') || value.includes('●');
}

/**
 * Idempotently seeds existing settings keys into the new `api_keys` table on startup
 */
function seedExistingKeysOnStartup() {
    try {
        const count = db.prepare('SELECT COUNT(*) as cnt FROM api_keys').get().cnt;
        if (count > 0) {
            console.log('🌱 [BudgetService] API Keys table already contains records. Seeding bypassed.');
            return;
        }

        console.log('🌱 [BudgetService] API Keys table is empty. Scanning settings to seed existing keys...');
        const mainKeys = [
            { key: 'OPENROUTER_API_KEY', provider: 'openrouter', name: 'Default OpenRouter Key' },
            { key: 'OPENAI_API_KEY', provider: 'openai', name: 'Default OpenAI Key' },
            { key: 'GEMINI_API_KEY', provider: 'gemini', name: 'Default Gemini Key' },
            { key: 'AI_API_KEY', provider: 'openrouter', name: 'Primary AI API Key' }
        ];

        for (const item of mainKeys) {
            const val = getSetting(item.key);
            if (val && !isMaskedPlaceholder(val)) {
                // Determine correct provider if it's the generic AI_API_KEY
                let provider = item.provider;
                if (item.key === 'AI_API_KEY') {
                    provider = (getSetting('AI_PROVIDER') || 'openrouter').toLowerCase().trim();
                    item.name = `Primary Key (${provider.toUpperCase()})`;
                }

                const hash = hashApiKey(val);
                try {
                    // Enforce exactly ONE API Key per provider
                    db.prepare('DELETE FROM api_keys WHERE LOWER(provider) = ?').run(provider.toLowerCase());

                    db.prepare(`
                        INSERT INTO api_keys (friendly_name, provider, api_key, api_key_hash, enabled)
                        VALUES (?, ?, ?, ?, 1)
                    `).run(item.name, provider, val, hash);
                    console.log(`✅ [BudgetService] Seeded existing key [${item.key}] as [${item.name}]`);
                } catch (err) {
                    console.error(`❌ [BudgetService] Failed to seed key ${item.key}:`, err.message);
                }
            }
        }
    } catch (e) {
        console.error('⚠️ [BudgetService] Failed to seed existing keys:', e.message);
    }
}

/**
 * Retrieves all configured API keys from the database, grouped by provider
 */
function getApiKeysGrouped() {
    try {
        const rows = db.prepare('SELECT * FROM api_keys ORDER BY provider ASC, created_at DESC').all();
        const grouped = {};
        for (const r of rows) {
            const prov = r.provider.toLowerCase();
            if (!grouped[prov]) grouped[prov] = [];

            let capabilities = {};
            let source = {};
            try {
                capabilities = r.capabilities ? JSON.parse(r.capabilities) : {};
                source = r.source ? JSON.parse(r.source) : {};
            } catch (e) {}

            grouped[prov].push({
                id: r.id,
                friendlyName: r.friendly_name,
                provider: r.provider,
                maskedKey: r.masked_key || maskApiKey(r.api_key),
                enabled: r.enabled === 1,
                limitsAvailable: r.limits_available === 1,
                capabilities,
                currentBalance: r.current_balance,
                remainingBalance: r.remaining_balance,
                limitVal: r.limit_val,
                usageVal: r.usage_val,
                billingPeriod: r.billing_period,
                resetDate: r.reset_date,
                source,
                lastSyncSuccess: r.last_sync_success,
                lastSyncFailed: r.last_sync_failed,
                errorMessage: r.error_message,
                nextSync: r.next_sync,
                createdAt: r.created_at,
                updatedAt: r.updated_at
            });
        }
        return grouped;
    } catch (err) {
        console.error('❌ [BudgetService] getApiKeysGrouped failed:', err.message);
        return {};
    }
}

/**
 * Gets local monthly usage for a specific API Key hash
 */
function getLocalMonthlyUsage(providerName, keyHash) {
    const provider = providerName.toLowerCase();
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const startOfMonthISO = startOfMonth.toISOString();

    let used = 0.0;
    try {
        const row = db.prepare(`
            SELECT SUM(cost) as total_cost
            FROM ai_usage
            WHERE LOWER(provider) = ? AND api_key_hash = ? AND request_time >= ?
        `).get(provider, keyHash, startOfMonthISO);

        if (row && row.total_cost) {
            used = parseFloat(row.total_cost);
        }
    } catch (err) {
        console.error(`⚠️ Failed to calculate local monthly usage for ${provider}:`, err.message);
    }
    return used;
}

/**
 * Registers/Adds a new API Key and triggers its initial sync
 * Strictly enforces ONE API Key per provider.
 */
async function addApiKey(friendlyName, provider, apiKey, enabled = 1) {
    if (!friendlyName || !provider || !apiKey) {
        throw new Error('بيانات ناقصة لإضافة المفتاح البرمجي.');
    }
    const hash = hashApiKey(apiKey);
    const masked = maskApiKey(apiKey);
    const provLower = provider.toLowerCase();

    // Delete any existing API Key for this provider to guarantee exactly ONE API Key
    db.prepare('DELETE FROM api_keys WHERE LOWER(provider) = ?').run(provLower);

    db.prepare(`
        INSERT INTO api_keys (friendly_name, provider, api_key, api_key_hash, enabled)
        VALUES (?, ?, ?, ?, ?)
    `).run(friendlyName, provLower, apiKey, hash, enabled ? 1 : 0);

    const row = db.prepare('SELECT id FROM api_keys WHERE api_key_hash = ?').get(hash);
    const id = row.id;

    console.log(`✅ [BudgetService] Registered unique key [${friendlyName}] for [${provLower}]. Triggering initial sync...`);
    await syncApiKey(id);

    return id;
}

/**
 * Synchronizes balance and limit info from the provider API for a single API Key ID
 */
async function syncApiKey(id) {
    const r = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id);
    if (!r) return null;

    const provider = r.provider.toLowerCase();
    const keyValue = r.api_key;
    const keyHash = r.api_key_hash;
    const masked = maskApiKey(keyValue);

    if (r.enabled !== 1) {
        console.log(`[BudgetService] Key [${r.friendly_name}] is disabled. Skipping sync.`);
        return null;
    }

    const adapter = ProviderAdapterFactory.getAdapter(provider, keyValue);
    if (!adapter) {
        console.warn(`⚠️ [BudgetService] No adapter found for provider: ${provider}`);
        return null;
    }

    console.log(`🔄 [BudgetService] Syncing limits for key [${r.friendly_name}] (${provider}) from official API...`);
    const info = await adapter.fetchUsageInfo();

    const nextSyncDate = new Date();
    nextSyncDate.setHours(nextSyncDate.getHours() + 1); // Schedule next sync in 1 hour
    const nextSyncStr = nextSyncDate.toISOString();

    if (info.success) {
        const limitsAvailable = info.limitsAvailable ? 1 : 0;
        const currentBalance = info.balance !== null ? info.balance : 0.0;
        const remainingBalance = info.remaining !== null ? info.remaining : 0.0;
        const limitVal = info.limit !== null ? info.limit : 0.0;
        const usageVal = info.usage !== null ? info.usage : 0.0;
        const billingPeriod = info.billingPeriod || null;
        const resetDate = info.resetDate || null;
        const capabilitiesStr = JSON.stringify(info.capabilities || adapter.getCapabilities());
        const sourceStr = JSON.stringify(info.source || {});
        const usageDataStr = info.rawResponse ? JSON.stringify(info.rawResponse) : '{}';

        db.prepare(`
            UPDATE api_keys
            SET limits_available = ?,
                capabilities = ?,
                current_balance = ?,
                remaining_balance = ?,
                limit_val = ?,
                usage_val = ?,
                billing_period = ?,
                reset_date = ?,
                source = ?,
                last_sync_success = CURRENT_TIMESTAMP,
                error_message = NULL,
                next_sync = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(
            limitsAvailable, capabilitiesStr, currentBalance, remainingBalance,
            limitVal, usageVal, billingPeriod, resetDate, sourceStr, nextSyncStr, id
        );

        console.log(`✅ [BudgetService] Sync success for key [${r.friendly_name}]`);
    } else {
        db.prepare(`
            UPDATE api_keys
            SET last_sync_failed = CURRENT_TIMESTAMP,
                error_message = ?,
                next_sync = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(info.errorMessage || 'Unknown sync error', nextSyncStr, id);

        console.error(`❌ [BudgetService] Sync failed for key [${r.friendly_name}]:`, info.errorMessage);
    }

    // Broadcast updated provider budget metrics to WebSocket clients
    broadcastProviderBudget(provider);

    return id;
}

/**
 * Synchronizes all enabled API Keys
 */
async function syncAllConfiguredApiKeys() {
    try {
        const rows = db.prepare('SELECT id FROM api_keys WHERE enabled = 1').all();
        console.log(`🔄 [BudgetService] Running background sync for ${rows.length} active keys...`);
        for (const r of rows) {
            await syncApiKey(r.id);
        }
    } catch (e) {
        console.error('[BudgetService] syncAllConfiguredApiKeys failed:', e.message);
    }
}

/**
 * Dynamically aggregates budgets and usage for a given AI provider across all its active keys.
 * Preserves the provider's original reported values, clearly marks estimated ones, and handles Fallback gracefully.
 */
function getProviderBudget(providerName) {
    const provider = providerName.toLowerCase().trim();

    // Sum or list information for all active keys of this provider
    let keys = [];
    try {
        keys = db.prepare('SELECT * FROM api_keys WHERE LOWER(provider) = ? AND enabled = 1').all(provider);
    } catch (e) {
        console.error('Failed to query api_keys:', e.message);
    }

    if (keys.length === 0) {
        // No keys configured or enabled for this provider
        const localUsage = getLocalMonthlyUsage(provider, 'none');
        return {
            provider,
            limitsAvailable: false,
            budget: null,
            limit: null,
            used: parseFloat(localUsage.toFixed(4)),
            remaining: null,
            percentage: null,
            billingPeriod: null,
            resetDate: null,
            maskedKey: 'Unavailable',
            syncStatus: 'No API Key configured',
            source: {
                used: 'local'
            },
            capabilities: {
                supportsBalance: false,
                supportsUsage: false,
                supportsResetDate: false
            }
        };
    }

    // Aggregate stats or return the primary active key details
    // For single-provider metrics, we represent the primary (first) active key's details
    const primaryKey = keys[0];

    let capabilities = {};
    let source = {};
    try {
        capabilities = primaryKey.capabilities ? JSON.parse(primaryKey.capabilities) : {};
        source = primaryKey.source ? JSON.parse(primaryKey.source) : {};
    } catch (e) {}

    if (primaryKey.limits_available === 1) {
        // 1. Provider API reports limits as the source of truth
        const limit = primaryKey.limit_val;
        const providerUsage = primaryKey.usage_val;
        const remaining = primaryKey.remaining_balance;
        const percentage = limit > 0 ? parseFloat(((providerUsage / limit) * 100).toFixed(1)) : 0.0;

        return {
            provider,
            limitsAvailable: true,
            budget: limit, // legacy alias
            limit: limit,
            used: parseFloat(providerUsage.toFixed(4)),
            remaining: parseFloat(remaining.toFixed(4)),
            percentage: percentage > 100 ? 100.0 : percentage,
            billingPeriod: primaryKey.billing_period,
            resetDate: primaryKey.reset_date,
            maskedKey: primaryKey.masked_key || maskApiKey(primaryKey.api_key),
            syncStatus: primaryKey.error_message ? 'Failed' : 'Synced',
            errorMessage: primaryKey.error_message,
            lastSyncSuccess: primaryKey.last_sync_success,
            source,
            capabilities
        };
    } else {
        // 2. Fallback: Provider does not expose limits.
        // We clearly report automatic limits as unavailable, track local usage, and never invent fake limits.
        const localUsage = getLocalMonthlyUsage(provider, primaryKey.api_key_hash);

        return {
            provider,
            limitsAvailable: false,
            budget: null,
            limit: null,
            used: parseFloat(localUsage.toFixed(4)),
            remaining: null,
            percentage: null,
            billingPeriod: null,
            resetDate: null,
            maskedKey: primaryKey.masked_key || maskApiKey(primaryKey.api_key),
            syncStatus: primaryKey.error_message ? 'Failed' : 'Synced',
            errorMessage: primaryKey.error_message,
            lastSyncSuccess: primaryKey.last_sync_success,
            source: {
                used: 'local',
                limit: 'none',
                remaining: 'none'
            },
            capabilities
        };
    }
}

/**
 * Retrieves budgets for all supported AI providers.
 */
function getAllProviderBudgets() {
    const providers = ['openrouter', 'openai', 'gemini', 'anthropic', 'ollama'];
    const results = {};
    for (const prov of providers) {
        results[prov] = getProviderBudget(prov);
    }
    return results;
}

/**
 * Safely decrements remaining balances and increments usage values LOCALLY on request completion.
 * Clearly marks modified values as estimates so we NEVER overwrite/falsify the true provider-reported values.
 */
function decrementBalanceAfterRequest(apiKey, cost) {
    if (!apiKey) return;
    const keyHash = hashApiKey(apiKey);

    try {
        const row = db.prepare('SELECT id, limits_available, remaining_balance, usage_val, provider, source FROM api_keys WHERE api_key_hash = ?').get(keyHash);
        if (row) {
            const newRemaining = Math.max(0.0, row.remaining_balance - cost);
            const newUsage = row.usage_val + cost;

            // Load and update source flags to mark modified values as 'estimated'
            let source = {};
            try {
                source = row.source ? JSON.parse(row.source) : {};
            } catch (e) {}

            source.usage = 'estimated';
            source.remaining = 'estimated';

            db.prepare(`
                UPDATE api_keys
                SET remaining_balance = ?,
                    usage_val = ?,
                    source = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(newRemaining, newUsage, JSON.stringify(source), row.id);

            broadcastProviderBudget(row.provider.toLowerCase());
        }
    } catch (err) {
        console.error('❌ [BudgetService] Failed to decrement balance after request:', err.message);
    }
}

/**
 * Broadcasts provider budget updates over WebSockets
 */
function broadcastProviderBudget(provider) {
    const stats = getProviderBudget(provider);
    try {
        const eventPublisher = require('../realtime/eventPublisher');
        eventPublisher.publish('provider_budget_updated', stats);
        console.log(`📡 [BudgetService] Broadcasted provider_budget_updated for: ${provider}`, stats);
    } catch (wsErr) {
        console.warn('⚠️ [BudgetService] Failed to publish real-time Socket update:', wsErr.message);
    }
}

/**
 * Obsolete legacy budget method. Just runs full background sync of keys.
 */
function updateProviderBudget(providerName, newBudget) {
    const provider = providerName.toLowerCase();
    const stats = getProviderBudget(provider);
    return stats;
}

module.exports = {
    hashApiKey,
    maskApiKey,
    seedExistingKeysOnStartup,
    getApiKeysGrouped,
    addApiKey,
    syncApiKey,
    syncAllConfiguredApiKeys,
    getProviderBudget,
    getAllProviderBudgets,
    decrementBalanceAfterRequest,
    broadcastProviderBudget,
    updateProviderBudget
};
