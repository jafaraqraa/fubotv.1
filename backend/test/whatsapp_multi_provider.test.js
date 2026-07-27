const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Configure isolated test database path before loading anything that uses the database
const testDbPath = 'data/test_whatsapp_multi_provider.db';
process.env.SQLITE_DB_PATH = testDbPath;

const { initializeDatabase } = require('../src/database/initialize');
initializeDatabase();

const db = require('../src/database/connection');
const WhatsAppProvider = require('../src/channels/whatsapp-providers/WhatsAppProvider');
const WhatsAppWebProvider = require('../src/channels/whatsapp-providers/WhatsAppWebProvider');
const WhatsAppBusinessCloudProvider = require('../src/channels/whatsapp-providers/WhatsAppBusinessCloudProvider');
const manager = require('../src/channels/whatsapp-providers/WhatsAppProviderManager');
const { sendOutgoingMessage } = require('../src/messaging/outgoingMessageService');

test.before(() => {
    db.prepare("DELETE FROM whatsapp_tenant_configs").run();
});

test.after(() => {
    // Clean up isolated test database files safely
    try {
        db.close();
        const fullPath = path.join(__dirname, '..', testDbPath);
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
        }
        const walPath = `${fullPath}-wal`;
        if (fs.existsSync(walPath)) {
            fs.unlinkSync(walPath);
        }
        const shmPath = `${fullPath}-shm`;
        if (fs.existsSync(shmPath)) {
            fs.unlinkSync(shmPath);
        }
        console.log("🧹 Cleaned up isolated test database for WhatsApp Multi-Provider successfully!");
    } catch (err) {
        console.error("Cleanup error:", err.message);
    }
});

test('WhatsAppProvider Interface Constraints', (t) => {
    // Abstract class cannot be instantiated directly
    assert.throws(() => {
        new WhatsAppProvider('test_tenant');
    }, /Cannot instantiate abstract class WhatsAppProvider directly/);
});

test('WhatsAppProviderManager - Dynamic Provider Switching', async (t) => {
    const tenantId = 'tenant_switching_test';

    // 1. Initialise with web provider
    const webConfig = { testParam: 'web_val' };
    const pWeb = await manager.switchProvider(tenantId, 'web', webConfig);
    assert.ok(pWeb instanceof WhatsAppWebProvider);
    assert.strictEqual(pWeb.tenantId, tenantId);
    assert.strictEqual(pWeb.config.testParam, 'web_val');

    // 2. Switch to cloud provider
    const cloudConfig = { accessToken: 'token123', phoneNumberId: 'phone999', verifyToken: 'v_tok' };
    const pCloud = await manager.switchProvider(tenantId, 'cloud', cloudConfig);
    assert.ok(pCloud instanceof WhatsAppBusinessCloudProvider);
    assert.strictEqual(pCloud.tenantId, tenantId);
    assert.strictEqual(pCloud.config.accessToken, 'token123');
    assert.strictEqual(pCloud.getStatus(), 'متصل');

    // 3. Cleanup provider map for testing
    await manager.destroyAll();
});

test('Outgoing Message Routing to WhatsApp Provider', async (t) => {
    const tenantId = 'default';
    const mockConfig = { accessToken: 'token_mock', phoneNumberId: 'phone_mock', verifyToken: 'verify_mock' };

    // Register a mock Cloud API provider
    await manager.switchProvider(tenantId, 'cloud', mockConfig);

    const provider = manager.getProvider(tenantId);
    assert.ok(provider instanceof WhatsAppBusinessCloudProvider);

    // Mock provider.sendMessage
    let sendMessageCalled = false;
    let receivedPayload = null;
    provider.sendMessage = async (payload) => {
        sendMessageCalled = true;
        receivedPayload = payload;
        return { success: true, externalMessageId: 'mock_external_id_777' };
    };

    // Trigger outgoing message pipeline
    const outgoingMsg = {
        channel: 'whatsapp',
        externalUserId: '966500000000@c.us',
        senderType: 'agent',
        messageType: 'text',
        content: 'مرحباً بك في نظام المتجر السحابي!',
        tenantId
    };

    // Ensure the message table has some mock conversation or skip constraints for testing
    db.exec(`
        INSERT OR IGNORE INTO customers (id, display_name) VALUES ('cust_wa_test', 'Ahmed');
        INSERT OR IGNORE INTO channel_accounts (id, customer_id, channel, external_user_id)
        VALUES ('acc_wa_test', 'cust_wa_test', 'whatsapp', '966500000000@c.us');
        INSERT OR IGNORE INTO conversations (id, customer_id, channel_account_id, channel)
        VALUES ('966500000000@c.us', 'cust_wa_test', 'acc_wa_test', 'whatsapp');
    `);

    const result = await sendOutgoingMessage(outgoingMsg);

    assert.strictEqual(sendMessageCalled, true);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.externalMessageId, 'mock_external_id_777');
    assert.strictEqual(receivedPayload.recipientId, '966500000000@c.us');
    assert.strictEqual(receivedPayload.content, 'مرحباً بك في نظام المتجر السحابي!');

    // Cleanup
    await manager.destroyAll();
});
