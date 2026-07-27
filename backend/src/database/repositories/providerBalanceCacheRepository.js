const db = require('../connection');

/**
 * Gets cached balance for a provider.
 */
function getBalanceCache(provider) {
    try {
        const row = db.prepare(`
            SELECT * FROM provider_balance_cache WHERE LOWER(provider) = ?
        `).get(provider.toLowerCase());
        return row || null;
    } catch (err) {
        console.error(`❌ Failed to get balance cache for ${provider}:`, err.message);
        return null;
    }
}

/**
 * Saves or updates balance cache.
 */
function saveBalanceCache(data) {
    const {
        provider,
        current_balance = 0.0,
        remaining_balance = 0.0,
        usage_data = '{}',
        error_message = null
    } = data;

    const query = `
        INSERT INTO provider_balance_cache (provider, current_balance, remaining_balance, usage_data, error_message, last_updated)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(provider) DO UPDATE SET
            current_balance = excluded.current_balance,
            remaining_balance = excluded.remaining_balance,
            usage_data = excluded.usage_data,
            error_message = excluded.error_message,
            last_updated = CURRENT_TIMESTAMP
    `;

    try {
        db.prepare(query).run(
            provider.toLowerCase(),
            current_balance,
            remaining_balance,
            usage_data,
            error_message
        );
        return true;
    } catch (err) {
        console.error(`❌ Failed to save balance cache for ${provider}:`, err.message);
        return false;
    }
}

/**
 * Deletes/invalidates balance cache.
 */
function deleteBalanceCache(provider) {
    try {
        db.prepare(`
            DELETE FROM provider_balance_cache WHERE LOWER(provider) = ?
        `).run(provider.toLowerCase());
        return true;
    } catch (err) {
        console.error(`❌ Failed to delete balance cache for ${provider}:`, err.message);
        return false;
    }
}

module.exports = {
    getBalanceCache,
    saveBalanceCache,
    deleteBalanceCache
};
