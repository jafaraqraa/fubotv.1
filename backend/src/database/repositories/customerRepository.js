const db = require('../connection');
const crypto = require('crypto');
const { publish } = require('../../realtime/eventPublisher');
const { EVENTS } = require('../../realtime/events');

function sanitizeProfileData(profileData) {
    const avatarUrl = profileData && typeof profileData.avatarUrl === 'string'
        ? profileData.avatarUrl.trim()
        : '';
    if (!/^\/uploads\/profile_[a-f0-9]{24}\.(?:jpg|png|webp|gif)$/.test(avatarUrl)) {
        return null;
    }
    return { avatarUrl };
}

function parseProfileData(value) {
    try {
        return sanitizeProfileData(value ? JSON.parse(value) : null) || {};
    } catch (_) {
        return {};
    }
}

function mapCustomerRow(row) {
    if (!row) return null;
    const profileData = parseProfileData(row.profile_data);
    return {
        id: row.id,
        name: row.name,
        platform: row.platform,
        tenantId: row.tenant_id,
        avatarUrl: profileData.avatarUrl || null,
        isAIEnabled: row.is_ai_enabled === 1,
        unreadCount: row.unread_count,
        assignee: row.assignee,
        lastSeen: row.lastSeen
    };
}

function registerCustomerUser(userId, name, platform, tenantId = null, profileData = null) {
    const scopedTenantId = tenantId || (platform === 'whatsapp' ? null : 'default');
    if (platform === 'whatsapp' && !scopedTenantId) {
        throw new Error('Missing tenantId for WhatsApp customer');
    }
    const existing = db.prepare(`
        SELECT ca.id as channel_account_id, ca.customer_id, c.id as conversation_id
        FROM channel_accounts ca
        LEFT JOIN conversations c ON c.channel_account_id = ca.id AND c.tenant_id = ?
        WHERE ca.channel = ? AND ca.external_user_id = ?
    `).get(scopedTenantId, platform, String(userId));

    const lastSeen = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    const safeProfileData = sanitizeProfileData(profileData);
    const serializedProfileData = safeProfileData ? JSON.stringify(safeProfileData) : null;

    if (!existing) {
        const customerId = crypto.randomUUID();
        const accountId = crypto.randomUUID();
        const conversationId = crypto.randomUUID();

        const insertCustomer = db.prepare(`
            INSERT INTO customers (id, display_name) VALUES (?, ?)
        `);
        const insertAccount = db.prepare(`
            INSERT INTO channel_accounts (id, customer_id, channel, external_user_id, username, profile_data)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        const insertConversation = db.prepare(`
            INSERT INTO conversations (id, customer_id, channel_account_id, channel, tenant_id, is_ai_enabled, assignee, unread_count, last_message_at)
            VALUES (?, ?, ?, ?, ?, 1, 'ai', 0, ?)
        `);

        db.transaction(() => {
            insertCustomer.run(customerId, name);
            insertAccount.run(accountId, customerId, platform, String(userId), name, serializedProfileData);
            insertConversation.run(conversationId, customerId, accountId, platform, scopedTenantId, lastSeen);
        })();

        console.log(`👤 Registered new customer and channel account: ${name} (${platform})`);
    } else if (!existing.conversation_id) {
        const conversationId = crypto.randomUUID();
        db.transaction(() => {
            db.prepare('UPDATE customers SET display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
              .run(name, existing.customer_id);
            db.prepare(`
                UPDATE channel_accounts
                SET username = ?, profile_data = COALESCE(?, profile_data), updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(name, serializedProfileData, existing.channel_account_id);
            db.prepare(`
                INSERT INTO conversations (id, customer_id, channel_account_id, channel, tenant_id, is_ai_enabled, assignee, unread_count, last_message_at)
                VALUES (?, ?, ?, ?, ?, 1, 'ai', 0, ?)
            `).run(conversationId, existing.customer_id, existing.channel_account_id, platform, scopedTenantId, lastSeen);
        })();
    } else {
        // Update customer display name and conversation activity
        db.transaction(() => {
            db.prepare('UPDATE customers SET display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
              .run(name, existing.customer_id);
            db.prepare(`
                UPDATE channel_accounts
                SET username = ?, profile_data = COALESCE(?, profile_data), updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(name, serializedProfileData, existing.channel_account_id);
            db.prepare('UPDATE conversations SET last_message_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
              .run(lastSeen, existing.conversation_id);
        })();
    }

    // Publish customer updates and stats immediately (Task 10)
    const userProfile = findCustomerUser(userId, platform, scopedTenantId);
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

function findCustomerUser(userId, platform, tenantId = null) {
    const scopedTenantId = tenantId || (platform === 'whatsapp' ? null : 'default');
    if (platform === 'whatsapp' && !scopedTenantId) return null;
    const row = db.prepare(`
        SELECT ca.external_user_id as id, ca.username as name, ca.channel as platform, ca.profile_data,
               c.is_ai_enabled, c.unread_count, c.assignee, c.last_message_at as lastSeen, c.tenant_id
        FROM channel_accounts ca
        JOIN conversations c ON c.channel_account_id = ca.id
        WHERE ca.channel = ? AND ca.external_user_id = ? AND c.tenant_id = ?
    `).get(platform, String(userId), scopedTenantId);

    return mapCustomerRow(row);
}

function findCustomerUserByIdOnly(userId, tenantId = null) {
    const row = db.prepare(`
        SELECT ca.external_user_id as id, ca.username as name, ca.channel as platform, ca.profile_data,
               c.is_ai_enabled, c.unread_count, c.assignee, c.last_message_at as lastSeen, c.tenant_id
        FROM channel_accounts ca
        JOIN conversations c ON c.channel_account_id = ca.id
        WHERE ca.external_user_id = ? AND (? IS NULL OR c.tenant_id = ?)
        ORDER BY CASE WHEN c.tenant_id = 'default' THEN 0 ELSE 1 END
    `).get(String(userId), tenantId, tenantId);

    return mapCustomerRow(row);
}

function listCustomerUsers() {
    const rows = db.prepare(`
        SELECT ca.external_user_id as id, ca.username as name, ca.channel as platform, ca.profile_data,
               c.is_ai_enabled, c.unread_count, c.assignee, c.last_message_at as lastSeen, c.tenant_id
        FROM channel_accounts ca
        JOIN conversations c ON c.channel_account_id = ca.id
        ORDER BY c.updated_at DESC
    `).all();

    return rows.map(mapCustomerRow);
}

function updateAIEnabled(userId, isEnabled, tenantId = 'default') {
    const val = isEnabled ? 1 : 0;
    db.prepare(`
        UPDATE conversations
        SET is_ai_enabled = ?, assignee = CASE WHEN ? = 1 THEN 'ai' ELSE assignee END, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ? AND channel_account_id IN (SELECT id FROM channel_accounts WHERE external_user_id = ?)
    `).run(val, val, tenantId, String(userId));

    // Publish ai status update event (Task 10)
    publish(EVENTS.AI_UPDATED, { userId: String(userId), isAIEnabled: isEnabled });
}

function updateAssignee(userId, assignee, tenantId = 'default') {
    const isAI = assignee === 'ai' ? 1 : 0;
    db.prepare(`
        UPDATE conversations
        SET assignee = ?, is_ai_enabled = ?, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ? AND channel_account_id IN (SELECT id FROM channel_accounts WHERE external_user_id = ?)
    `).run(assignee, isAI, tenantId, String(userId));

    // Publish assignment update event (Task 10)
    publish(EVENTS.ASSIGNMENT_UPDATED, { userId: String(userId), assignee });
}

function incrementUnreadCount(userId, tenantId = 'default') {
    db.prepare(`
        UPDATE conversations
        SET unread_count = unread_count + 1, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ? AND channel_account_id IN (SELECT id FROM channel_accounts WHERE external_user_id = ?)
    `).run(tenantId, String(userId));

    // Fetch the updated count and publish (Task 10)
    const row = db.prepare(`
        SELECT unread_count FROM conversations
        WHERE tenant_id = ? AND channel_account_id IN (SELECT id FROM channel_accounts WHERE external_user_id = ?)
    `).get(tenantId, String(userId));
    if (row) {
        publish(EVENTS.UNREAD_UPDATED, { userId: String(userId), unreadCount: row.unread_count });
    }
}

function clearUnreadCount(userId, tenantId = 'default') {
    db.prepare(`
        UPDATE conversations
        SET unread_count = 0, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ? AND channel_account_id IN (SELECT id FROM channel_accounts WHERE external_user_id = ?)
    `).run(tenantId, String(userId));

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
