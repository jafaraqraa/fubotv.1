const eventPublisher = require('../realtime/eventPublisher');

/**
 * Broadcasts a real-time event signal 'ai_usage_updated' to all connected WebSocket administrator clients.
 * This alerts active browser sessions to dynamically fetch new analytics and update their widgets.
 */
function broadcastUsageUpdate(data) {
    try {
        console.log('📡 [AnalyticsWebSocket] Broadcasting real-time ai_usage_updated signal...');
        const envelope = eventPublisher.publish('ai_usage_updated', {
            provider: data.provider,
            model: data.model,
            task: data.task,
            totalTokens: data.totalTokens || data.total_tokens || 0,
            timestamp: new Date().toISOString()
        });
        return envelope;
    } catch (err) {
        console.warn('⚠️ [AnalyticsWebSocket] Failed to publish real-time update:', err.message);
        return null;
    }
}

module.exports = {
    broadcastUsageUpdate
};
