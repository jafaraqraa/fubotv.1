const db = require('../database/connection');
const { getSetting, saveSetting } = require('../database/repositories/settingsRepository');

/**
 * Calculates budget, used cost, remaining amount, and usage percentage for a given AI provider.
 */
function getProviderBudget(providerName) {
    const provider = providerName.toLowerCase();

    // 1. Fetch budget limit from settings, defaulting to 100.0
    const settingKey = `BUDGET_${provider.toUpperCase()}`;
    const budgetStr = getSetting(settingKey);
    const budget = budgetStr !== null && budgetStr !== undefined ? parseFloat(budgetStr) : 100.0;

    // 2. Fetch used amount for the current calendar month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const startOfMonthISO = startOfMonth.toISOString();

    let used = 0.0;
    try {
        const row = db.prepare(`
            SELECT SUM(cost) as total_cost
            FROM ai_usage
            WHERE LOWER(provider) = ? AND request_time >= ?
        `).get(provider, startOfMonthISO);

        if (row && row.total_cost) {
            used = parseFloat(row.total_cost);
        }
    } catch (err) {
        console.error(`⚠️ Failed to calculate monthly usage for ${provider}:`, err.message);
    }

    // 3. Compute remaining and percentage
    const remaining = Math.max(0.0, budget - used);
    const percentage = budget > 0 ? parseFloat(((used / budget) * 100).toFixed(1)) : 0.0;

    return {
        provider,
        budget,
        used: parseFloat(used.toFixed(4)),
        remaining: parseFloat(remaining.toFixed(4)),
        percentage: percentage > 100 ? 100.0 : percentage // Cap percentage visually at 100 if they overspend
    };
}

/**
 * Retrieves budgets for all supported AI providers.
 */
function getAllProviderBudgets() {
    const providers = ['openrouter', 'openai', 'gemini', 'ollama'];
    const results = {};
    for (const prov of providers) {
        results[prov] = getProviderBudget(prov);
    }
    return results;
}

/**
 * Updates an AI provider's monthly budget limit, persists it to settings database,
 * and broadcasts the updated budget statistics to all authenticated WebSocket clients.
 */
function updateProviderBudget(providerName, newBudget) {
    const provider = providerName.toLowerCase();
    const budgetVal = parseFloat(newBudget);

    if (isNaN(budgetVal) || budgetVal < 0) {
        throw new Error('قيمة الميزانية غير صالحة.');
    }

    const settingKey = `BUDGET_${provider.toUpperCase()}`;
    saveSetting(settingKey, String(budgetVal));
    process.env[settingKey] = String(budgetVal);

    // Recalculate and broadcast update
    const stats = getProviderBudget(provider);

    try {
        const eventPublisher = require('../realtime/eventPublisher');
        eventPublisher.publish('provider_budget_updated', stats);
        console.log(`📡 [BudgetService] Broadcasted provider_budget_updated for: ${provider}`, stats);
    } catch (wsErr) {
        console.warn('⚠️ [BudgetService] Failed to publish real-time Socket update:', wsErr.message);
    }

    return stats;
}

module.exports = {
    getProviderBudget,
    getAllProviderBudgets,
    updateProviderBudget
};
