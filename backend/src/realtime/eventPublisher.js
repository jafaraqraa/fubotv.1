// Real-time Event Publisher Interface (Tasks 9 & 11)
const crypto = require('crypto');

let ioInstance = null;

function initialize(io) {
    ioInstance = io;
    console.log('📡 Real-time event publisher initialized successfully!');
}

function tenantFrom(rawData, options) {
    return options?.tenantId || rawData?.tenantId || rawData?.tenant_id || null;
}

function publish(eventName, rawData = {}, options = {}) {
    if (!ioInstance) {
        // Safe no-op when Socket.IO server is not instantiated (e.g. during standalone database testing)
        return null;
    }

    // Generate custom safe unique event identifiers and include occurrence timestamp (Task 9)
    const eventId = crypto.randomUUID ? crypto.randomUUID() : `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Build standard versioned event envelope contract (Task 8)
    const envelope = {
        version: 1,
        eventId,
        occurredAt: new Date().toISOString(),
        data: rawData
    };

    const tenantId = tenantFrom(rawData, options);
    if (tenantId) {
        ioInstance.to(`tenant:${tenantId}`).emit(eventName, envelope);
    } else {
        // Operational events without tenant ownership are visible only to
        // explicitly authorized super administrators.
        ioInstance.to('system:admins').emit(eventName, envelope);
    }
    return envelope;
}

function shutdown() {
    ioInstance = null;
}

function publishStats(tenantId) {
    if (!ioInstance) return null;
    if (!tenantId) return null;
    try {
        const db = require('../database/connection');
        const usersCountRow = db.prepare(
            'SELECT COUNT(*) as count FROM conversations WHERE tenant_id = ?'
        ).get(tenantId);
        const messagesCountRow = db.prepare(
            'SELECT COUNT(*) as count FROM messages WHERE tenant_id = ?'
        ).get(tenantId);
        const activeErrorsCountRow = db.prepare('SELECT COUNT(*) as count FROM application_errors WHERE solved = 0').get();

        const stats = {
            usersCount: usersCountRow ? usersCountRow.count : 0,
            messagesCount: messagesCountRow ? messagesCountRow.count : 0,
            activeErrorsCount: activeErrorsCountRow ? activeErrorsCountRow.count : 0
            ,tenantId
        };

        return publish('stats:updated', stats, { tenantId });
    } catch (err) {
        console.error('⚠️ Failed to publish stats update:', err.message);
    }
    return null;
}

module.exports = {
    initialize,
    publish,
    publishStats,
    shutdown
};
