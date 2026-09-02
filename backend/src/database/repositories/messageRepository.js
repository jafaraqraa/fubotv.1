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
    const media = routing.media || null;

    // Determine channel from conversation
    const convRow = db.prepare('SELECT channel FROM conversations WHERE id = ?').get(conversationId);
    const channel = convRow ? convRow.channel : 'telegram';

    db.transaction(() => {
        db.prepare(`
            INSERT INTO messages (
                id, conversation_id, tenant_id, channel, external_message_id, direction,
                sender_type, role, message_type, content, is_internal_note,
                is_ai_generated, delivery_status, metadata, media_url, media_path,
                media_name, mime_type, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(
            id, conversationId, tenantId || 'default', channel, externalMsgId ? String(externalMsgId) : null,
            direction, sender, role, type, text, isInternalNote, isAi, deliveryStatus, metadata,
            media?.publicUrl || null, media?.localPath || null,
            media?.originalName || media?.fileName || null, media?.mimeType || null
        );

        // Update conversation last seen activity
        db.prepare('UPDATE conversations SET last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(conversationId);
    })();

    console.log(`✉️ Saved message in SQLite for user: ${userId} (${type})`);

    // Authoritative Emission Boundary: publish real-time message event strictly after successful SQLite persistence (Tasks 10 & 25)
    publish(EVENTS.MESSAGE_CREATED, {
        userId: String(userId),
        sender: sender === 'ai' ? 'admin' : sender,
        text,
        type,
        isNote: !!isNote,
        time,
        tenantId
    }, { tenantId });

    // Also trigger global stats update broadcast
    publishStats(tenantId);
    return id;
}

function updateMessageDelivery(messageId, deliveryStatus, details = {}) {
    const allowedTransitions = {
        pending: new Set(['pending', 'sending', 'failed']),
        sending: new Set(['sending', 'sent', 'failed']),
        sent: new Set(['sent', 'delivered', 'read', 'failed']),
        delivered: new Set(['delivered', 'read']),
        read: new Set(['read']),
        failed: new Set(['failed', 'sending'])
    };
    if (!allowedTransitions[deliveryStatus]) {
        const error = new Error(`Unsupported message delivery status: ${deliveryStatus}`);
        error.code = 'INVALID_MESSAGE_STATUS';
        throw error;
    }
    const metadata = Object.keys(details).length > 0 ? JSON.stringify(details) : null;
    return db.transaction(() => {
        const current = db.prepare(`
            SELECT m.delivery_status, m.tenant_id, m.channel,
                   ca.external_user_id AS user_id
            FROM messages m
            JOIN conversations c ON c.id = m.conversation_id
            JOIN channel_accounts ca ON ca.id = c.channel_account_id
            WHERE m.id = ?
        `).get(messageId);
        if (!current) {
            const error = new Error('Message not found.');
            error.code = 'MESSAGE_NOT_FOUND';
            throw error;
        }
        if (!allowedTransitions[current.delivery_status]?.has(deliveryStatus)) {
            const error = new Error(
                `Invalid message delivery transition: ${current.delivery_status} -> ${deliveryStatus}`
            );
            error.code = 'INVALID_MESSAGE_STATUS_TRANSITION';
            throw error;
        }
        const result = db.prepare(`
            UPDATE messages
            SET delivery_status = ?,
                external_message_id = COALESCE(?, external_message_id),
                metadata = ?
            WHERE id = ? AND delivery_status = ?
        `).run(
            deliveryStatus,
            details.externalMessageId || null,
            metadata,
            messageId,
            current.delivery_status
        );
        if (result.changes !== 1) {
            const error = new Error('Concurrent message status update rejected.');
            error.code = 'MESSAGE_STATUS_CONFLICT';
            throw error;
        }
        publish(EVENTS.MESSAGE_DELIVERY_UPDATED, {
            messageId,
            userId: String(current.user_id),
            channel: current.channel,
            deliveryStatus,
            tenantId: current.tenant_id
        }, { tenantId: current.tenant_id });
        return true;
    })();
}

function listMessages(userId, tenantId = 'default', channel = null) {
    const conversationId = getConversationIdByUserId(userId, tenantId, channel);
    if (!conversationId) return [];

    const rows = db.prepare(`
        SELECT id, sender_type as sender, content as text, message_type as type,
               is_internal_note as isNote, delivery_status as deliveryStatus,
               metadata, media_url as mediaUrl, media_name as mediaName,
               mime_type as mimeType, created_at as createdAt,
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
            id: row.id,
            userId: String(userId),
            sender: row.sender === 'ai' ? 'admin' : row.sender, // Keep admin/user compatibility for dashboard UI
            text: row.text,
            type: row.type,
            isNote: row.isNote === 1,
            deliveryStatus: row.deliveryStatus,
            mediaUrl: row.mediaUrl,
            mediaName: row.mediaName,
            mimeType: row.mimeType,
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

function findInternalNote(messageId, tenantId) {
    return db.prepare(`
        SELECT m.id, m.content, m.conversation_id, ca.external_user_id
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id AND c.tenant_id = m.tenant_id
        JOIN channel_accounts ca ON ca.id = c.channel_account_id
        WHERE m.id = ? AND m.tenant_id = ? AND m.is_internal_note = 1
    `).get(String(messageId), tenantId);
}

function updateInternalNote(messageId, tenantId, content) {
    const note = findInternalNote(messageId, tenantId);
    if (!note) return null;
    const result = db.prepare(`
        UPDATE messages SET content = ?
        WHERE id = ? AND tenant_id = ? AND is_internal_note = 1
    `).run(content, String(messageId), tenantId);
    if (result.changes !== 1) return null;
    return { ...note, content };
}

function deleteInternalNote(messageId, tenantId) {
    const note = findInternalNote(messageId, tenantId);
    if (!note) return null;
    const result = db.prepare(`
        DELETE FROM messages
        WHERE id = ? AND tenant_id = ? AND is_internal_note = 1
    `).run(String(messageId), tenantId);
    return result.changes === 1 ? note : null;
}

function markMessageForManagement(messageId, tenantId, reason) {
    const row = db.prepare(
        'SELECT metadata FROM messages WHERE id = ? AND tenant_id = ?'
    ).get(messageId, tenantId);
    if (!row) return false;
    let metadata = {};
    try {
        metadata = row.metadata ? JSON.parse(row.metadata) : {};
    } catch (_) {
        metadata = {};
    }
    metadata.managementEscalation = true;
    metadata.managementEscalationReason = String(reason || 'unspecified');
    return db.prepare(
        'UPDATE messages SET metadata = ? WHERE id = ? AND tenant_id = ?'
    ).run(JSON.stringify(metadata), messageId, tenantId).changes === 1;
}

function resolveManagementRequest(userId, tenantId = 'default', channel = null) {
    const conversationId = getConversationIdByUserId(userId, tenantId, channel);
    if (!conversationId) return false;
    const rows = db.prepare(`
        SELECT id, metadata FROM messages
        WHERE conversation_id = ? AND metadata LIKE '%"managementEscalation":true%'
    `).all(conversationId);
    const update = db.prepare('UPDATE messages SET metadata = ? WHERE id = ?');
    db.transaction(() => rows.forEach(row => {
        let metadata = {};
        try { metadata = JSON.parse(row.metadata || '{}'); } catch (_) { metadata = {}; }
        metadata.managementEscalation = false;
        metadata.managementResolvedAt = new Date().toISOString();
        update.run(JSON.stringify(metadata), row.id);
    }))();
    return rows.length > 0;
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

function getMessagesCount(tenantId) {
    if (!tenantId) throw new Error('tenantId is required');
    const row = db.prepare('SELECT COUNT(*) as count FROM messages WHERE tenant_id = ?').get(tenantId);
    return row ? row.count : 0;
}

function getMessageForRetry(messageId, tenantId) {
    return db.prepare(`
        SELECT m.*, ca.external_user_id
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        JOIN channel_accounts ca ON ca.id = c.channel_account_id
        WHERE m.id = ? AND m.tenant_id = ?
    `).get(messageId, tenantId);
}

function updateDeliveryByExternalId(externalMessageId, channel, tenantId, status, details = {}) {
    const row = db.prepare(`
        SELECT id FROM messages
        WHERE external_message_id = ? AND channel = ? AND tenant_id = ?
    `).get(String(externalMessageId), channel, tenantId);
    if (!row) return false;
    updateMessageDelivery(row.id, status, details);
    return true;
}

function markOutboundReadThrough(externalUserId, channel, tenantId, watermark) {
    const cutoff = Number(watermark);
    if (!Number.isFinite(cutoff)) return [];
    const rows = db.prepare(`
        SELECT m.id, m.external_message_id
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        JOIN channel_accounts ca ON ca.id = c.channel_account_id
        WHERE ca.external_user_id = ? AND m.channel = ? AND m.tenant_id = ?
          AND m.direction = 'outbound'
          AND m.delivery_status IN ('sent', 'delivered')
          AND CAST(strftime('%s', m.created_at) AS INTEGER) * 1000 <= ?
    `).all(String(externalUserId), channel, tenantId, cutoff);
    const update = db.prepare(`
        UPDATE messages SET delivery_status = 'read'
        WHERE id = ? AND delivery_status IN ('sent', 'delivered')
    `);
    db.transaction(() => rows.forEach(row => update.run(row.id)))();
    rows.forEach(row => publish(EVENTS.MESSAGE_DELIVERY_UPDATED, {
        messageId: row.id,
        userId: String(externalUserId),
        channel,
        deliveryStatus: 'read',
        tenantId
    }, { tenantId }));
    return rows.map(row => row.external_message_id).filter(Boolean);
}

module.exports = {
    saveMessage,
    markMessageForManagement,
    resolveManagementRequest,
    updateMessageDelivery,
    listMessages,
    updateInternalNote,
    deleteInternalNote,
    existsByExternalId,
    getChatHistoryForAI,
    getMessagesCount,
    getMessageForRetry,
    updateDeliveryByExternalId,
    markOutboundReadThrough
};
