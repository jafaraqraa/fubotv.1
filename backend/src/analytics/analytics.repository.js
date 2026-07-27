const db = require('../database/connection');

/**
 * Optimizes the ai_usage table indexes for maximum performance.
 * Wrapped in safe try/catch to support offline testing and early DB initialization stages.
 */
function optimizeIndexes() {
    try {
        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_ai_usage_tenant_time ON ai_usage(tenant_id, request_time);
            CREATE INDEX IF NOT EXISTS idx_ai_usage_provider_model ON ai_usage(provider, model);
        `);
        console.log('⚡ [AnalyticsRepository] Index optimizations successfully applied.');
        return true;
    } catch (err) {
        console.warn('⚠️ [AnalyticsRepository] Index optimization deferred:', err.message);
        return false;
    }
}

// Attempt lazy index creation on startup
optimizeIndexes();

/**
 * Saves a single AI usage event to the database.
 * Supports both prompt_tokens/completion_tokens (new) and input_tokens/output_tokens (legacy).
 */
function recordUsage(data) {
    const {
        provider,
        model,
        task,
        tenant_id = 'default',
        request_time,
        response_time = new Date().toISOString(),
        duration = 0,
        prompt_tokens = 0,
        completion_tokens = 0,
        input_tokens = 0,
        output_tokens = 0,
        total_tokens = 0,
        cost = 0.0,
        success = 1,
        error_message = null,
        generation_id = null,
        apiKey = null,
        api_key_hash = null
    } = data;

    const budgetService = require('../services/budgetService');
    const computedKeyHash = apiKey ? budgetService.hashApiKey(apiKey) : (api_key_hash || null);

    // Map input/prompt tokens correctly to allow zero-downtime transition
    const pTokens = prompt_tokens || input_tokens || 0;
    const cTokens = completion_tokens || output_tokens || 0;
    const tTokens = total_tokens || (pTokens + cTokens);

    const reqTimeStr = typeof request_time === 'object' ? request_time.toISOString() : request_time;
    const respTimeStr = typeof response_time === 'object' ? response_time.toISOString() : response_time;

    const query = `
        INSERT INTO ai_usage (
            provider, model, task, tenant_id, request_time, response_time,
            duration, input_tokens, output_tokens, total_tokens, cost, success, error_message, generation_id, api_key_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    try {
        console.log('[AnalyticsRepository] Saving AI usage record...');
        const info = db.prepare(query).run(
            provider,
            model,
            task,
            tenant_id,
            reqTimeStr,
            respTimeStr,
            duration,
            pTokens,
            cTokens,
            tTokens,
            cost,
            success ? 1 : 0,
            error_message,
            generation_id,
            computedKeyHash
        );
        console.log(`[AnalyticsRepository] Saved record ID: ${info.lastInsertRowid}`);

        // Update balance cache / tracking locally
        if (apiKey) {
            budgetService.decrementBalanceAfterRequest(apiKey, cost);
        }

        return {
            success: true,
            id: info.lastInsertRowid
        };
    } catch (err) {
        console.error('❌ [AnalyticsRepository] Failed to record usage:', err.message);
        return {
            success: false,
            error: err.message
        };
    }
}

/**
 * Gets aggregated overview metrics inside specific datetime ranges.
 */
function getOverviewMetrics(tenantId, todayStartIso, monthStartIso) {
    // Today's metrics (since todayStartIso)
    const todayRow = db.prepare(`
        SELECT COUNT(*) as count, SUM(total_tokens) as tokens, SUM(cost) as cost
        FROM ai_usage
        WHERE tenant_id = ? AND success = 1 AND request_time >= ?
    `).get(tenantId, todayStartIso);

    // This month's metrics (since monthStartIso)
    const monthRow = db.prepare(`
        SELECT COUNT(*) as count, SUM(total_tokens) as tokens, SUM(cost) as cost
        FROM ai_usage
        WHERE tenant_id = ? AND success = 1 AND request_time >= ?
    `).get(tenantId, monthStartIso);

    // Total metrics (all time)
    const totalRow = db.prepare(`
        SELECT COUNT(*) as count, SUM(total_tokens) as tokens, SUM(cost) as cost, AVG(duration) as avg_latency
        FROM ai_usage
        WHERE tenant_id = ? AND success = 1
    `).get(tenantId);

    return {
        today: {
            requests: todayRow ? todayRow.count : 0,
            tokens: todayRow ? (todayRow.tokens || 0) : 0,
            cost: todayRow ? (todayRow.cost || 0.0) : 0.0
        },
        monthly: {
            requests: monthRow ? monthRow.count : 0,
            tokens: monthRow ? (monthRow.tokens || 0) : 0,
            cost: monthRow ? (monthRow.cost || 0.0) : 0.0
        },
        total: {
            requests: totalRow ? totalRow.count : 0,
            tokens: totalRow ? (totalRow.tokens || 0) : 0,
            cost: totalRow ? (totalRow.cost || 0.0) : 0.0,
            avgLatency: totalRow ? Math.round(totalRow.avg_latency || 0) : 0
        }
    };
}

/**
 * Gets stats grouped by providers.
 */
function getProviderStats(tenantId, todayStartIso, monthStartIso) {
    const rows = db.prepare(`
        SELECT
            provider,
            COUNT(*) as requests,
            SUM(input_tokens) as prompt_tokens,
            SUM(output_tokens) as completion_tokens,
            SUM(total_tokens) as total_tokens,
            SUM(cost) as cost,
            AVG(duration) as avg_latency,
            SUM(CASE WHEN request_time >= ? THEN cost ELSE 0 END) as today_cost,
            SUM(CASE WHEN request_time >= ? THEN cost ELSE 0 END) as monthly_cost
        FROM ai_usage
        WHERE tenant_id = ? AND success = 1
        GROUP BY provider
    `).all(todayStartIso, monthStartIso, tenantId);

    return rows;
}

/**
 * Gets stats grouped by models.
 */
function getModelStats(tenantId) {
    const rows = db.prepare(`
        SELECT
            model,
            provider,
            COUNT(*) as requests,
            SUM(input_tokens) as prompt_tokens,
            SUM(output_tokens) as completion_tokens,
            SUM(total_tokens) as total_tokens,
            SUM(cost) as total_cost,
            AVG(cost) as avg_cost,
            AVG(duration) as avg_latency,
            SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as success_rate
        FROM ai_usage
        WHERE tenant_id = ?
        GROUP BY model, provider
        ORDER BY requests DESC
    `).all(tenantId);

    return rows;
}

/**
 * Gets daily usage history for charting.
 */
function getDailyHistory(tenantId) {
    const rows = db.prepare(`
        SELECT
            strftime('%Y-%m-%d', request_time) as date,
            COUNT(*) as requests,
            SUM(cost) as cost,
            SUM(total_tokens) as tokens,
            AVG(duration) as avg_latency
        FROM ai_usage
        WHERE tenant_id = ? AND success = 1
        GROUP BY date
        ORDER BY date ASC
    `).all(tenantId);

    return rows;
}

/**
 * Gets the most recent successful AI requests.
 */
function getRecentLiveLogs(tenantId, limit = 50) {
    const rows = db.prepare(`
        SELECT
            id,
            tenant_id,
            provider,
            model,
            task,
            input_tokens as prompt_tokens,
            output_tokens as completion_tokens,
            total_tokens,
            cost,
            request_time,
            created_at
        FROM ai_usage
        WHERE tenant_id = ? AND success = 1
        ORDER BY request_time DESC
        LIMIT ?
    `).all(tenantId, limit);

    return rows;
}

module.exports = {
    optimizeIndexes,
    recordUsage,
    getOverviewMetrics,
    getProviderStats,
    getModelStats,
    getDailyHistory,
    getRecentLiveLogs
};
