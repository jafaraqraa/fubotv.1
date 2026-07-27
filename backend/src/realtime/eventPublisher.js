// Real-time Event Publisher Interface (Tasks 9 & 11)
const crypto = require('crypto');

let ioInstance = null;

function initialize(io) {
    ioInstance = io;
    console.log('📡 Real-time event publisher initialized successfully!');
}

function publish(eventName, rawData = {}) {
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

    // Emit event strictly to the authenticated 'admins' security room only (Task 21)
    ioInstance.to('admins').emit(eventName, envelope);
    return envelope;
}

function publishStats() {
    if (!ioInstance) return null;
    try {
        const db = require('../database/connection');
        const usersCountRow = db.prepare('SELECT COUNT(*) as count FROM channel_accounts').get();
        const messagesCountRow = db.prepare('SELECT COUNT(*) as count FROM messages').get();
        const activeErrorsCountRow = db.prepare('SELECT COUNT(*) as count FROM application_errors WHERE solved = 0').get();

        const stats = {
            usersCount: usersCountRow ? usersCountRow.count : 0,
            messagesCount: messagesCountRow ? messagesCountRow.count : 0,
            activeErrorsCount: activeErrorsCountRow ? activeErrorsCountRow.count : 0
        };

        return publish('stats:updated', stats);
    } catch (err) {
        console.error('⚠️ Failed to publish stats update:', err.message);
    }
    return null;
}

module.exports = {
    initialize,
    publish,
    publishStats
};
