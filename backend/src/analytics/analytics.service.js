const repository = require('./analytics.repository');

/**
 * Helper to get ISO strings for the start of today and start of this month.
 * Calculates timezone-robust local day/month starting boundaries.
 */
function getDateBoundaries() {
    const now = new Date();

    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    return {
        todayStartIso: todayStart.toISOString(),
        monthStartIso: monthStart.toISOString()
    };
}

/**
 * Gets overview stats formatted precisely with required friendly keys.
 */
function getOverview(tenantId = 'default') {
    const { todayStartIso, monthStartIso } = getDateBoundaries();
    const metrics = repository.getOverviewMetrics(tenantId, todayStartIso, monthStartIso);

    return {
        "Today's Requests": metrics.today.requests,
        "Today's Tokens": metrics.today.tokens,
        "Today's Cost": parseFloat((metrics.today.cost || 0.0).toFixed(6)),

        "Monthly Requests": metrics.monthly.requests,
        "Monthly Tokens": metrics.monthly.tokens,
        "Monthly Cost": parseFloat((metrics.monthly.cost || 0.0).toFixed(6)),

        "Total Requests": metrics.total.requests,
        "Total Tokens": metrics.total.tokens,
        "Total Cost": parseFloat((metrics.total.cost || 0.0).toFixed(6)),

        // Include latency and camelCase keys for frontend/compatibility
        "Average Latency": metrics.total.avgLatency,
        avgLatency: metrics.total.avgLatency,
        totalTokens: metrics.total.tokens,
        totalCost: parseFloat((metrics.total.cost || 0.0).toFixed(6))
    };
}

/**
 * Gets stats grouped by provider.
 */
function getProviders(tenantId = 'default') {
    const { todayStartIso, monthStartIso } = getDateBoundaries();
    const rows = repository.getProviderStats(tenantId, todayStartIso, monthStartIso);

    const providers = {};
    rows.forEach(r => {
        providers[r.provider.toLowerCase()] = {
            requests: r.requests,
            tokens: r.total_tokens,
            inputTokens: r.prompt_tokens,
            outputTokens: r.completion_tokens,
            prompt_tokens: r.prompt_tokens,
            completion_tokens: r.completion_tokens,
            cost: parseFloat((r.cost || 0.0).toFixed(6)),
            avgLatency: Math.round(r.avg_latency || 0),
            todayCost: parseFloat((r.today_cost || 0.0).toFixed(6)),
            monthlyCost: parseFloat((r.monthly_cost || 0.0).toFixed(6))
        };
    });

    // Ensure all standard system providers are present to prevent front-end null errors
    const standardProviders = ['openrouter', 'openai', 'gemini', 'ollama'];
    standardProviders.forEach(p => {
        if (!providers[p]) {
            providers[p] = {
                requests: 0,
                tokens: 0,
                inputTokens: 0,
                outputTokens: 0,
                prompt_tokens: 0,
                completion_tokens: 0,
                cost: 0.0,
                avgLatency: 0,
                todayCost: 0.0,
                monthlyCost: 0.0
            };
        }
    });

    return providers;
}

/**
 * Gets stats grouped by model.
 */
function getModels(tenantId = 'default') {
    const rows = repository.getModelStats(tenantId);
    return rows.map(r => ({
        model: r.model,
        provider: r.provider,
        requests: r.requests,
        prompt_tokens: r.prompt_tokens,
        completion_tokens: r.completion_tokens,
        inputTokens: r.prompt_tokens, // backward-compatibility alias
        outputTokens: r.completion_tokens, // backward-compatibility alias
        totalTokens: r.total_tokens,
        totalCost: parseFloat((r.total_cost || 0.0).toFixed(6)),
        avgCost: parseFloat((r.avg_cost || 0.0).toFixed(6)),
        avgLatency: Math.round(r.avg_latency || 0),
        successRate: parseFloat((r.success_rate !== undefined && r.success_rate !== null ? r.success_rate : 100.0).toFixed(2))
    }));
}

/**
 * Gets daily usage history.
 */
function getHistory(tenantId = 'default') {
    const rows = repository.getDailyHistory(tenantId);
    return rows.map(r => ({
        date: r.date,
        requests: r.requests,
        cost: parseFloat((r.cost || 0.0).toFixed(6)),
        tokens: r.tokens,
        avg_latency: Math.round(r.avg_latency || 0)
    }));
}

/**
 * Gets live analytics requests.
 */
function getLive(tenantId = 'default') {
    const rows = repository.getRecentLiveLogs(tenantId, 50);
    return rows.map(r => ({
        id: r.id,
        tenant_id: r.tenant_id,
        provider: r.provider,
        model: r.model,
        task: r.task,
        prompt_tokens: r.prompt_tokens,
        completion_tokens: r.completion_tokens,
        total_tokens: r.total_tokens,
        cost: parseFloat((r.cost || 0.0).toFixed(6)),
        request_time: r.request_time,
        created_at: r.created_at
    }));
}

module.exports = {
    getOverview,
    getProviders,
    getModels,
    getHistory,
    getLive
};
