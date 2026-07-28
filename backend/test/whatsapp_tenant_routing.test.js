const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const testDbPath = path.resolve(__dirname, '..', 'data', 'test_whatsapp_tenant_routing.db');
process.env.SQLITE_DB_PATH = testDbPath;
for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
}

const db = require('../src/database/connection');
const { initializeDatabase } = require('../src/database/initialize');
initializeDatabase();

const manager = require('../src/channels/whatsapp-providers/WhatsAppProviderManager');
const ai = require('../src/services/ai');
ai.getAIResponse = async (_userId, content) => `AI:${content}`;
delete require.cache[require.resolve('../src/messaging/messageProcessor')];
const { processIncomingMessage } = require('../src/messaging/messageProcessor');
const { sendOutgoingMessage } = require('../src/messaging/outgoingMessageService');

const sends = [];
const providers = new Map();
for (const tenantId of ['tenant-a', 'tenant-b', 'default']) {
    providers.set(tenantId, {
        getStatus: () => 'متصل',
        sendMessage: async payload => {
            sends.push({ tenantId, payload });
            return { success: true, externalMessageId: `${tenantId}-${sends.length}` };
        }
    });
}
const originalGetOrLoadProvider = manager.getOrLoadProvider.bind(manager);
manager.getOrLoadProvider = async tenantId => {
    assert.ok(providers.has(tenantId), `Unexpected tenant route: ${tenantId}`);
    return providers.get(tenantId);
};

function incoming(tenantId, sequence) {
    return {
        channel: 'whatsapp',
        externalMessageId: `${tenantId}-incoming-${sequence}`,
        externalUserId: '972500000000@c.us',
        customer: { displayName: `Customer ${tenantId}`, username: null, phoneNumber: null, profileData: {} },
        direction: 'incoming',
        senderType: 'customer',
        messageType: 'text',
        content: `hello-${tenantId}`,
        media: null,
        timestamp: new Date().toISOString(),
        metadata: { tenantId }
    };
}

test('automatic replies preserve tenant isolation', async () => {
    sends.length = 0;
    const [resultA, resultB] = await Promise.all([
        processIncomingMessage(incoming('tenant-a', 1)),
        processIncomingMessage(incoming('tenant-b', 2))
    ]);
    assert.equal(resultA.responseSent, true);
    assert.equal(resultB.responseSent, true);
    assert.deepEqual(sends.map(send => send.tenantId).sort(), ['tenant-a', 'tenant-b']);
    assert.equal(sends.filter(send => send.tenantId === 'tenant-a').length, 1);
    assert.equal(sends.filter(send => send.tenantId === 'tenant-b').length, 1);
});

test('missing tenantId rejects WhatsApp sending without default routing', async () => {
    sends.length = 0;
    const result = await sendOutgoingMessage({
        channel: 'whatsapp',
        externalUserId: '972599999999@c.us',
        senderType: 'ai',
        messageType: 'text',
        content: 'must not send'
    });
    assert.equal(result.success, false);
    assert.match(result.error, /Missing tenantId/);
    assert.equal(sends.length, 0);
});

test('explicit default tenant remains supported', async () => {
    sends.length = 0;
    const result = await sendOutgoingMessage({
        channel: 'whatsapp',
        externalUserId: '972588888888@c.us',
        senderType: 'agent',
        messageType: 'text',
        content: 'explicit default',
        tenantId: 'default'
    });
    assert.equal(result.success, true);
    assert.equal(sends[0].tenantId, 'default');
});

test('tenantId is persisted on conversations and incoming/outgoing messages', () => {
    const rows = db.prepare(`
        SELECT m.tenant_id AS message_tenant, c.tenant_id AS conversation_tenant
        FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE m.channel = 'whatsapp'
    `).all();
    assert.ok(rows.some(row => row.message_tenant === 'tenant-a' && row.conversation_tenant === 'tenant-a'));
    assert.ok(rows.some(row => row.message_tenant === 'tenant-b' && row.conversation_tenant === 'tenant-b'));
    assert.ok(rows.every(row => row.message_tenant === row.conversation_tenant));
});

test.after(() => {
    manager.getOrLoadProvider = originalGetOrLoadProvider;
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
        if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
});
