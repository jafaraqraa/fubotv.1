const db = require('../connection');
const crypto = require('crypto');
const { publish, publishStats } = require('../../realtime/eventPublisher');
const { EVENTS } = require('../../realtime/events');

function getConversationIdByUserId(userId, tenantId = 'default', channel = null) {
    const row = db.prepare(`
        SELECT c.id
        FROM conversations c
        JOIN channel_accounts ca ON ca.id = c.channel_account_id
        WHERE ca.external_user_id = ? AND c.tenant_id = ?
          AND (? IS NULL OR ca.channel = ?)
    `).get(String(userId), tenantId, channel, channel);
    return row ? row.id : null;
}

function saveMessage(userId, sender, text, type = 'text', isNote = false, externalMsgId = null, routing = {}) {
    const channelHint = routing.channel || null;
    const tenantId = routing.tenantId || (channelHint === 'whatsapp' ? null : 'default');
    if (channelHint === 'whatsapp' && !tenantId) {
        throw new Error('Missing tenantId for WhatsApp message persistence');
    }
    let conversationId = getConversationIdByUserId(userId, tenantId || 'default', channelHint);

    if (!conversationId) {
        // If conversation is missing, fallback register first
        const { registerCustomerUser } = require('./customerRepository');
        const fallbackChannel = channelHint || 'telegram';
        registerCustomerUser(userId, `User_${userId}`, fallbackChannel, tenantId);
        conversationId = getConversationIdByUserId(userId, tenantId || 'default', fallbackChannel);
    }

    const id = crypto.randomUUID();
    const time = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

    const role = (sender === 'user') ? 'user' : 'assistant';
    const direction = (sender === 'user') ? 'inbound' : 'outbound';
    const isInternalNote = isNote ? 1 : 0;
    const isAi = (sender === 'ai') ? 1 : 0;
    const deliveryStatus = routing.deliveryStatus || (sender === 'user' || isNote ? 'delivered' : 'sent');
    const metadata = routing.metadata ? JSON.stringify(routing.metadata) : null;

    // Determine channel from conversation
    const convRow = db.prepare('SELECT channel FROM conversations WHERE id = ?').get(conversationId);
    const channel = convRow ? convRow.channel : 'telegram';

    db.transaction(() => {
        db.prepare(`
            INSERT INTO messages (
                id, conversation_id, tenant_id, channel, external_message_id, direction,
                sender_type, role, message_type, content, is_internal_note,
                is_ai_generated, delivery_status, metadata, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(
            id, conversationId, tenantId || 'default', channel, externalMsgId ? String(externalMsgId) : null,
            direction, sender, role, type, text, isInternalNote, isAi, deliveryStatus, metadata
        );

        // Update conversation last seen activity
        db.prepare('UPDATE conversations SET last_message_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(time, conversationId);
    })();

    console.log(`✉️ Saved message in SQLite for user: ${userId} (${type})`);

    // Authoritative Emission Boundary: publish real-time message event strictly after successful SQLite persistence (Tasks 10 & 25)
    publish(EVENTS.MESSAGE_CREATED, {
        userId: String(userId),
        sender: sender === 'ai' ? 'admin' : sender,
        text,
        type,
        isNote: !!isNote,
        time
    });

    // Also trigger global stats update broadcast
    publishStats();
    return id;
}

function updateMessageDelivery(messageId, deliveryStatus, details = {}) {
    const metadata = Object.keys(details).length > 0 ? JSON.stringify(details) : null;
    db.prepare(`
        UPDATE messages
        SET delivery_status = ?,
            external_message_id = COALESCE(?, external_message_id),
            metadata = ?
        WHERE id = ?
    `).run(deliveryStatus, details.externalMessageId || null, metadata, messageId);
}

function listMessages(userId, tenantId = 'default', channel = null) {
    const conversationId = getConversationIdByUserId(userId, tenantId, channel);
    if (!conversationId) return [];

    const rows = db.prepare(`
        SELECT sender_type as sender, content as text, message_type as type,
               is_internal_note as isNote, delivery_status as deliveryStatus,
               metadata, created_at as createdAt,
               strftime('%H:%M', created_at) as rawTime
        FROM messages
        WHERE conversation_id = ?
        ORDER BY created_at ASC
    `).all(conversationId);

    // Map time to current Arabic locale format if needed, or fallback to record creation
    return rows.map(row => {
        const dateObj = new Date();
        const [hours, minutes] = row.rawTime ? row.rawTime.split(':') : [12, 0];
        dateObj.setHours(parseInt(hours), parseInt(minutes));
        const formattedTime = dateObj.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

        return {
            userId: String(userId),
            sender: row.sender === 'ai' ? 'admin' : row.sender, // Keep admin/user compatibility for dashboard UI
            text: row.text,
            type: row.type,
            isNote: row.isNote === 1,
            deliveryStatus: row.deliveryStatus,
            metadata: (() => {
                try {
                    return row.metadata ? JSON.parse(row.metadata) : {};
                } catch (_) {
                    return {};
                }
            })(),
            createdAt: row.createdAt,
            time: formattedTime
        };
    });
}

function existsByExternalId(channel, externalMsgId, tenantId = null) {
    if (!externalMsgId) return false;
    const scopedTenantId = tenantId || (channel === 'whatsapp' ? null : 'default');
    if (channel === 'whatsapp' && !scopedTenantId) return false;
    const row = db.prepare('SELECT 1 FROM messages WHERE tenant_id = ? AND channel = ? AND external_message_id = ?')
        .get(scopedTenantId, channel, String(externalMsgId));
    return !!row;
}

function getChatHistoryForAI(userId, tenantId = 'default', channel = null) {
    const conversationId = getConversationIdByUserId(userId, tenantId, channel);
    if (!conversationId) return [];

    const rows = db.prepare(`
        SELECT sender_type, role, content as text
        FROM messages
        WHERE conversation_id = ? AND is_internal_note = 0
        ORDER BY created_at ASC
    `).all(conversationId);

    const filtered = rows.filter(msg => {
        // Exclude system responses
        const text = msg.text;
        if (text.includes("شكراً لتواصلك معنا") || text.includes("تم استلام رسالتك") || text.includes("تم ربط حسابك بالمنصة")) {
            return false;
        }
        return true;
    });

    const recent = filtered.slice(-6);

    return recent.map(msg => ({
        role: msg.role,
        content: msg.text
    }));
}

function getMessagesCount() {
    const row = db.prepare('SELECT COUNT(*) as count FROM messages').get();
    return row ? row.count : 0;
}

module.exports = {
    saveMessage,
    updateMessageDelivery,
    listMessages,
    existsByExternalId,
    getChatHistoryForAI,
    getMessagesCount
};
