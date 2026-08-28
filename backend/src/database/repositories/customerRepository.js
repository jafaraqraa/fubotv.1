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
        username: row.username || null,
        phoneNumber: row.phone_number || null,
        platform: row.platform,
        tenantId: row.tenant_id,
        avatarUrl: profileData.avatarUrl || null,
        isAIEnabled: row.is_ai_enabled === 1,
        unreadCount: row.unread_count,
        assignee: row.assignee,
        managementRequested: row.management_requested === 1,
        lastSeen: row.lastSeen
    };
}

function registerCustomerUser(userId, name, platform, tenantId = null, profileData = null, contactData = null) {
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

    const safeProfileData = sanitizeProfileData(profileData);
    const serializedProfileData = safeProfileData ? JSON.stringify(safeProfileData) : null;
    const username = contactData && typeof contactData.username === 'string'
        ? contactData.username.trim().slice(0, 255) || null
        : null;
    const phoneNumber = contactData && typeof contactData.phoneNumber === 'string'
        ? contactData.phoneNumber.replace(/[^0-9+]/g, '').slice(0, 32) || null
        : null;

    if (!existing) {
        const customerId = crypto.randomUUID();
        const accountId = crypto.randomUUID();
        const conversationId = crypto.randomUUID();

        const insertCustomer = db.prepare(`
            INSERT INTO customers (id, display_name) VALUES (?, ?)
        `);
        const insertAccount = db.prepare(`
            INSERT INTO channel_accounts (id, customer_id, channel, external_user_id, username, phone_number, profile_data)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const insertConversation = db.prepare(`
            INSERT INTO conversations (id, customer_id, channel_account_id, channel, tenant_id, is_ai_enabled, assignee, unread_count, last_message_at)
            VALUES (?, ?, ?, ?, ?, 1, 'ai', 0, ?)
        `);

        db.transaction(() => {
            insertCustomer.run(customerId, name);
            insertAccount.run(accountId, customerId, platform, String(userId), username || name, phoneNumber, serializedProfileData);
            insertConversation.run(conversationId, customerId, accountId, platform, scopedTenantId, new Date().toISOString());
        })();

        console.log(`👤 Registered new customer and channel account: ${name} (${platform})`);
    } else if (!existing.conversation_id) {
        const conversationId = crypto.randomUUID();
        db.transaction(() => {
            db.prepare(`
                INSERT INTO conversations (id, customer_id, channel_account_id, channel, tenant_id, is_ai_enabled, assignee, unread_count, last_message_at)
                VALUES (?, ?, ?, ?, ?, 1, 'ai', 0, ?)
            `).run(conversationId, existing.customer_id, existing.channel_account_id, platform, scopedTenantId, new Date().toISOString());
        })();
    } else {
        // Update customer display name and conversation activity
        db.transaction(() => {
            db.prepare('UPDATE conversations SET last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
              .run(existing.conversation_id);
        })();
    }

    const account = db.prepare(`
        SELECT ca.id
        FROM channel_accounts ca
        JOIN conversations c ON c.channel_account_id = ca.id
        WHERE ca.channel = ? AND ca.external_user_id = ? AND c.tenant_id = ?
    `).get(platform, String(userId), scopedTenantId);
    if (account) {
        db.prepare(`
            INSERT INTO tenant_channel_profiles
                (tenant_id, channel_account_id, display_name, profile_data, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(tenant_id, channel_account_id) DO UPDATE SET
                display_name = excluded.display_name,
                profile_data = COALESCE(excluded.profile_data, tenant_channel_profiles.profile_data),
                updated_at = CURRENT_TIMESTAMP
        `).run(scopedTenantId, account.id, name, serializedProfileData);

        const tenantCount = db.prepare(`
            SELECT COUNT(DISTINCT tenant_id) AS count
            FROM conversations WHERE channel_account_id = ?
        `).get(account.id).count;
        if (tenantCount === 1) {
            db.prepare(`
                UPDATE channel_accounts
                SET username = COALESCE(?, username), phone_number = COALESCE(?, phone_number),
                    profile_data = COALESCE(?, profile_data),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(username, phoneNumber, serializedProfileData, account.id);
            db.prepare(`
                UPDATE customers SET display_name = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = (SELECT customer_id FROM channel_accounts WHERE id = ?)
            `).run(name, account.id);
        }
    }

    // Publish customer updates and stats immediately (Task 10)
    const userProfile = findCustomerUser(userId, platform, scopedTenantId);
    if (userProfile) {
        publish(existing ? EVENTS.CUSTOMER_UPDATED : EVENTS.CUSTOMER_CREATED, userProfile, {
            tenantId: scopedTenantId
        });
        publish(EVENTS.CONVERSATION_UPDATED, {
            userId: String(userId),
            lastSeen: userProfile.lastSeen,
            tenantId: scopedTenantId
        }, { tenantId: scopedTenantId });
    }

    // Centrally publish statistics updates
    const { publishStats } = require('../../realtime/eventPublisher');
    publishStats(scopedTenantId);
}

function findCustomerUser(userId, platform, tenantId = null) {
    const scopedTenantId = tenantId || (platform === 'whatsapp' ? null : 'default');
    if (platform === 'whatsapp' && !scopedTenantId) return null;
    const row = db.prepare(`
        SELECT ca.external_user_id as id, COALESCE(tcp.display_name, ca.username) as name,
               ca.username, ca.phone_number,
               ca.channel as platform, COALESCE(tcp.profile_data, ca.profile_data) as profile_data,
               c.is_ai_enabled, c.unread_count, c.assignee, c.last_message_at as lastSeen, c.tenant_id,
               EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.metadata LIKE '%"managementEscalation":true%') as management_requested
        FROM channel_accounts ca
        JOIN conversations c ON c.channel_account_id = ca.id
        LEFT JOIN tenant_channel_profiles tcp
          ON tcp.channel_account_id = ca.id AND tcp.tenant_id = c.tenant_id
        WHERE ca.channel = ? AND ca.external_user_id = ? AND c.tenant_id = ?
    `).get(platform, String(userId), scopedTenantId);

    return mapCustomerRow(row);
}

function findCustomerUserByIdOnly(userId, tenantId) {
    if (!tenantId) return null;
    const row = db.prepare(`
        SELECT ca.external_user_id as id, COALESCE(tcp.display_name, ca.username) as name,
               ca.username, ca.phone_number,
               ca.channel as platform, COALESCE(tcp.profile_data, ca.profile_data) as profile_data,
               c.is_ai_enabled, c.unread_count, c.assignee, c.last_message_at as lastSeen, c.tenant_id,
               EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.metadata LIKE '%"managementEscalation":true%') as management_requested
        FROM channel_accounts ca
        JOIN conversations c ON c.channel_account_id = ca.id
        LEFT JOIN tenant_channel_profiles tcp
          ON tcp.channel_account_id = ca.id AND tcp.tenant_id = c.tenant_id
        WHERE ca.external_user_id = ? AND c.tenant_id = ?
    `).get(String(userId), tenantId);

    return mapCustomerRow(row);
}

function listCustomerUsers(tenantId) {
    if (!tenantId) throw new Error('tenantId is required');
    const rows = db.prepare(`
        SELECT ca.external_user_id as id, COALESCE(tcp.display_name, ca.username) as name,
               ca.username, ca.phone_number,
               ca.channel as platform, COALESCE(tcp.profile_data, ca.profile_data) as profile_data,
               c.is_ai_enabled, c.unread_count, c.assignee, c.last_message_at as lastSeen, c.tenant_id,
               EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.metadata LIKE '%"managementEscalation":true%') as management_requested
        FROM channel_accounts ca
        JOIN conversations c ON c.channel_account_id = ca.id
        LEFT JOIN tenant_channel_profiles tcp
          ON tcp.channel_account_id = ca.id AND tcp.tenant_id = c.tenant_id
        WHERE c.tenant_id = ?
        ORDER BY c.updated_at DESC
    `).all(tenantId);

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
    publish(EVENTS.AI_UPDATED, { userId: String(userId), isAIEnabled: isEnabled, tenantId });
}

function updateAssignee(userId, assignee, tenantId = 'default') {
    const isAI = assignee === 'ai' ? 1 : 0;
    db.prepare(`
        UPDATE conversations
        SET assignee = ?, is_ai_enabled = ?, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ? AND channel_account_id IN (SELECT id FROM channel_accounts WHERE external_user_id = ?)
    `).run(assignee, isAI, tenantId, String(userId));

    // Publish assignment update event (Task 10)
    publish(EVENTS.ASSIGNMENT_UPDATED, { userId: String(userId), assignee, tenantId });
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
        publish(EVENTS.UNREAD_UPDATED, {
            userId: String(userId), unreadCount: row.unread_count, tenantId
        });
    }
}

function clearUnreadCount(userId, tenantId = 'default') {
    db.prepare(`
        UPDATE conversations
        SET unread_count = 0, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ? AND channel_account_id IN (SELECT id FROM channel_accounts WHERE external_user_id = ?)
    `).run(tenantId, String(userId));

    // Publish read clearance event (Task 10)
    publish(EVENTS.UNREAD_UPDATED, { userId: String(userId), unreadCount: 0, tenantId });
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
