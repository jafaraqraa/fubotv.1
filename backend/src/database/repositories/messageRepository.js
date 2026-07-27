const db = require('../connection');
const crypto = require('crypto');
const { publish, publishStats } = require('../../realtime/eventPublisher');
const { EVENTS } = require('../../realtime/events');

function getConversationIdByUserId(userId) {
    const row = db.prepare(`
        SELECT c.id
        FROM conversations c
        JOIN channel_accounts ca ON ca.id = c.channel_account_id
        WHERE ca.external_user_id = ?
    `).get(String(userId));
    return row ? row.id : null;
}

function saveMessage(userId, sender, text, type = 'text', isNote = false, externalMsgId = null) {
    let conversationId = getConversationIdByUserId(userId);

    if (!conversationId) {
        // If conversation is missing, fallback register first
        const { registerCustomerUser } = require('./customerRepository');
        registerCustomerUser(userId, `User_${userId}`, 'telegram');
        conversationId = getConversationIdByUserId(userId);
    }

    const id = crypto.randomUUID();
    const time = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

    const role = (sender === 'user') ? 'user' : 'assistant';
    const direction = (sender === 'user') ? 'inbound' : 'outbound';
    const isInternalNote = isNote ? 1 : 0;
    const isAi = (sender === 'ai') ? 1 : 0;

    // Determine channel from conversation
    const convRow = db.prepare('SELECT channel FROM conversations WHERE id = ?').get(conversationId);
    const channel = convRow ? convRow.channel : 'telegram';

    db.transaction(() => {
        db.prepare(`
            INSERT INTO messages (
                id, conversation_id, channel, external_message_id, direction,
                sender_type, role, message_type, content, is_internal_note,
                is_ai_generated, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(
            id, conversationId, channel, externalMsgId ? String(externalMsgId) : null,
            direction, sender, role, type, text, isInternalNote, isAi
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
}

function listMessages(userId) {
    const conversationId = getConversationIdByUserId(userId);
    if (!conversationId) return [];

    const rows = db.prepare(`
        SELECT sender_type as sender, content as text, message_type as type,
               is_internal_note as isNote, strftime('%H:%M', created_at) as rawTime
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
            time: formattedTime
        };
    });
}

function existsByExternalId(channel, externalMsgId) {
    if (!externalMsgId) return false;
    const row = db.prepare('SELECT 1 FROM messages WHERE channel = ? AND external_message_id = ?').get(channel, String(externalMsgId));
    return !!row;
}

function getChatHistoryForAI(userId) {
    const conversationId = getConversationIdByUserId(userId);
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
    listMessages,
    existsByExternalId,
    getChatHistoryForAI,
    getMessagesCount
};
