const db = require('../connection');
const crypto = require('crypto');
const { publish } = require('../../realtime/eventPublisher');
const { EVENTS } = require('../../realtime/events');

function registerCustomerUser(userId, name, platform) {
    const existing = db.prepare(`
        SELECT ca.id as channel_account_id, ca.customer_id, c.id as conversation_id
        FROM channel_accounts ca
        LEFT JOIN conversations c ON c.channel_account_id = ca.id
        WHERE ca.channel = ? AND ca.external_user_id = ?
    `).get(platform, String(userId));

    const lastSeen = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

    if (!existing) {
        const customerId = crypto.randomUUID();
        const accountId = crypto.randomUUID();
        const conversationId = crypto.randomUUID();

        const insertCustomer = db.prepare(`
            INSERT INTO customers (id, display_name) VALUES (?, ?)
        `);
        const insertAccount = db.prepare(`
            INSERT INTO channel_accounts (id, customer_id, channel, external_user_id, username) VALUES (?, ?, ?, ?, ?)
        `);
        const insertConversation = db.prepare(`
            INSERT INTO conversations (id, customer_id, channel_account_id, channel, is_ai_enabled, assignee, unread_count, last_message_at)
            VALUES (?, ?, ?, ?, 1, 'ai', 0, ?)
        `);

        db.transaction(() => {
            insertCustomer.run(customerId, name);
            insertAccount.run(accountId, customerId, platform, String(userId), name);
            insertConversation.run(conversationId, customerId, accountId, platform, lastSeen);
        })();

        console.log(`👤 Registered new customer and channel account: ${name} (${platform})`);
    } else {
        // Update customer display name and conversation activity
        db.transaction(() => {
            db.prepare('UPDATE customers SET display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
              .run(name, existing.customer_id);
            db.prepare('UPDATE channel_accounts SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
              .run(name, existing.channel_account_id);
            db.prepare('UPDATE conversations SET last_message_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
              .run(lastSeen, existing.conversation_id);
        })();
    }

    // Publish customer updates and stats immediately (Task 10)
    const userProfile = findCustomerUser(userId, platform);
    if (userProfile) {
        publish(existing ? EVENTS.CUSTOMER_UPDATED : EVENTS.CUSTOMER_CREATED, userProfile);
        publish(EVENTS.CONVERSATION_UPDATED, {
            userId: String(userId),
            lastSeen
        });
    }

    // Centrally publish statistics updates
    const { publishStats } = require('../../realtime/eventPublisher');
    publishStats();
}

function findCustomerUser(userId, platform) {
    const row = db.prepare(`
        SELECT ca.external_user_id as id, ca.username as name, ca.channel as platform,
               c.is_ai_enabled, c.unread_count, c.assignee, c.last_message_at as lastSeen
        FROM channel_accounts ca
        JOIN conversations c ON c.channel_account_id = ca.id
        WHERE ca.channel = ? AND ca.external_user_id = ?
    `).get(platform, String(userId));

    if (!row) return null;

    return {
        id: row.id,
        name: row.name,
        platform: row.platform,
        isAIEnabled: row.is_ai_enabled === 1,
        unreadCount: row.unread_count,
        assignee: row.assignee,
        lastSeen: row.lastSeen
    };
}

function findCustomerUserByIdOnly(userId) {
    const row = db.prepare(`
        SELECT ca.external_user_id as id, ca.username as name, ca.channel as platform,
               c.is_ai_enabled, c.unread_count, c.assignee, c.last_message_at as lastSeen
        FROM channel_accounts ca
        JOIN conversations c ON c.channel_account_id = ca.id
        WHERE ca.external_user_id = ?
    `).get(String(userId));

    if (!row) return null;

    return {
        id: row.id,
        name: row.name,
        platform: row.platform,
        isAIEnabled: row.is_ai_enabled === 1,
        unreadCount: row.unread_count,
        assignee: row.assignee,
        lastSeen: row.lastSeen
    };
}

function listCustomerUsers() {
    const rows = db.prepare(`
        SELECT ca.external_user_id as id, ca.username as name, ca.channel as platform,
               c.is_ai_enabled, c.unread_count, c.assignee, c.last_message_at as lastSeen
        FROM channel_accounts ca
        JOIN conversations c ON c.channel_account_id = ca.id
        ORDER BY c.updated_at DESC
    `).all();

    return rows.map(row => ({
        id: row.id,
        name: row.name,
        platform: row.platform,
        isAIEnabled: row.is_ai_enabled === 1,
        unreadCount: row.unread_count,
        assignee: row.assignee,
        lastSeen: row.lastSeen
    }));
}

function updateAIEnabled(userId, isEnabled) {
    const val = isEnabled ? 1 : 0;
    db.prepare(`
        UPDATE conversations
        SET is_ai_enabled = ?, assignee = CASE WHEN ? = 1 THEN 'ai' ELSE assignee END, updated_at = CURRENT_TIMESTAMP
        WHERE channel_account_id IN (SELECT id FROM channel_accounts WHERE external_user_id = ?)
    `).run(val, val, String(userId));

    // Publish ai status update event (Task 10)
    publish(EVENTS.AI_UPDATED, { userId: String(userId), isAIEnabled: isEnabled });
}

function updateAssignee(userId, assignee) {
    const isAI = assignee === 'ai' ? 1 : 0;
    db.prepare(`
        UPDATE conversations
        SET assignee = ?, is_ai_enabled = ?, updated_at = CURRENT_TIMESTAMP
        WHERE channel_account_id IN (SELECT id FROM channel_accounts WHERE external_user_id = ?)
    `).run(assignee, isAI, String(userId));

    // Publish assignment update event (Task 10)
    publish(EVENTS.ASSIGNMENT_UPDATED, { userId: String(userId), assignee });
}

function incrementUnreadCount(userId) {
    db.prepare(`
        UPDATE conversations
        SET unread_count = unread_count + 1, updated_at = CURRENT_TIMESTAMP
        WHERE channel_account_id IN (SELECT id FROM channel_accounts WHERE external_user_id = ?)
    `).run(String(userId));

    // Fetch the updated count and publish (Task 10)
    const row = db.prepare(`
        SELECT unread_count FROM conversations
        WHERE channel_account_id IN (SELECT id FROM channel_accounts WHERE external_user_id = ?)
    `).get(String(userId));
    if (row) {
        publish(EVENTS.UNREAD_UPDATED, { userId: String(userId), unreadCount: row.unread_count });
    }
}

function clearUnreadCount(userId) {
    db.prepare(`
        UPDATE conversations
        SET unread_count = 0, updated_at = CURRENT_TIMESTAMP
        WHERE channel_account_id IN (SELECT id FROM channel_accounts WHERE external_user_id = ?)
    `).run(String(userId));

    // Publish read clearance event (Task 10)
    publish(EVENTS.UNREAD_UPDATED, { userId: String(userId), unreadCount: 0 });
}

module.exports = {
    registerCustomerUser,
    findCustomerUser,
    findCustomerUserByIdOnly,
    listCustomerUsers,
    updateAIEnabled,
    updateAssignee,
    incrementUnreadCount,
    clearUnreadCount
};
