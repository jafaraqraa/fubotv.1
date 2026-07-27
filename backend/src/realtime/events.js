// Central Real-Time Event Names Contract (Task 8)
const EVENTS = {
    READY: 'realtime:ready',
    CUSTOMER_CREATED: 'customer:created',
    CUSTOMER_UPDATED: 'customer:updated',
    CONVERSATION_CREATED: 'conversation:created',
    CONVERSATION_UPDATED: 'conversation:updated',
    MESSAGE_CREATED: 'message:created',
    UNREAD_UPDATED: 'unread:updated',
    AI_UPDATED: 'conversation:ai-updated',
    ASSIGNMENT_UPDATED: 'conversation:assignment-updated',
    STATS_UPDATED: 'stats:updated',
    ACTIVITY_LOG_CREATED: 'activity-log:created',
    APPLICATION_ERROR_CREATED: 'application-error:created',
    APPLICATION_ERROR_UPDATED: 'application-error:updated',
    WHATSAPP_STATUS_UPDATED: 'whatsapp:status-updated',
    SYSTEM_RESYNC_REQUIRED: 'system:resync-required',
    SYSTEM_SESSION_EXPIRED: 'system:session-expired'
};

module.exports = {
    EVENTS
};
