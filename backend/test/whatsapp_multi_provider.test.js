const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
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

test('WhatsApp Web accepts every supported message ID representation', () => {
    const { extractExternalMessageId } = WhatsAppWebProvider._test;
    assert.strictEqual(extractExternalMessageId({ id: { id: 'plain-id' } }), 'plain-id');
    assert.strictEqual(
        extractExternalMessageId({ id: { _serialized: 'true_remote_serialized-id' } }),
        'true_remote_serialized-id'
    );
    assert.strictEqual(extractExternalMessageId({ id: 'string-id' }), 'string-id');
    assert.strictEqual(
        extractExternalMessageId({ _data: { id: { _serialized: 'fallback-id' } } }),
        'fallback-id'
    );
    assert.strictEqual(extractExternalMessageId({}), '');
});

test('WhatsApp Web preserves a provider-accepted reply even when no external ID is returned', async () => {
    const provider = new WhatsAppWebProvider('unverified_send_tenant', {});
    provider.waStatus = 'متصل';
    provider.waClient = { sendMessage: async () => undefined };

    const result = await provider.sendMessage({
        recipientId: '972599123456@c.us',
        messageType: 'text',
        content: 'رد الذكاء الاصطناعي'
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.externalMessageId, null);
    assert.strictEqual(result.acceptedUnverified, true);
});

test('WhatsApp web process lease permits only one owner per tenant', () => {
    const leaseBase = path.join(__dirname, '..', 'data', 'test_whatsapp_process_lease');
    const first = new WhatsAppWebProvider('lease_tenant', {});
    const second = new WhatsAppWebProvider('lease_tenant', {});

    try {
        first._acquireProcessLease(leaseBase);
        assert.throws(
            () => second._acquireProcessLease(leaseBase),
            /already owned by process/
        );
    } finally {
        first._releaseProcessLease();
        second._releaseProcessLease();
    }
});

test('WhatsApp web process lease recovers from a stale or reused PID', () => {
    const leaseBase = path.join(__dirname, '..', 'data', 'test_whatsapp_stale_lease');
    const leasePath = `${leaseBase}.init.lock`;
    const provider = new WhatsAppWebProvider('stale_lease_tenant', {});

    fs.mkdirSync(leasePath, { recursive: true });
    fs.writeFileSync(path.join(leasePath, 'owner.json'), JSON.stringify({
        pid: process.pid,
        tenantId: 'stale_lease_tenant',
        processIdentity: {
            bootId: 'stale-boot-id',
            startTime: '0'
        }
    }));

    try {
        provider._acquireProcessLease(leaseBase);
        const owner = JSON.parse(fs.readFileSync(path.join(leasePath, 'owner.json'), 'utf8'));
        assert.strictEqual(owner.pid, process.pid);
        assert.notStrictEqual(owner.processIdentity?.bootId, 'stale-boot-id');
    } finally {
        provider._releaseProcessLease();
        fs.rmSync(leasePath, { recursive: true, force: true });
    }
});

test('WhatsApp reconnect fully retires one client before initializing exactly one replacement', async () => {
    const provider = new WhatsAppWebProvider('reconnect_tenant', {});
    const client = new EventEmitter();
    const sequence = [];
    provider.waClient = client;
    provider.lifecycleGeneration = 4;
    provider.reconnectDelayMs = 0;
    provider._destroyClient = async target => {
        assert.strictEqual(target, client);
        sequence.push('destroy-start');
        await new Promise(resolve => setTimeout(resolve, 5));
        sequence.push('destroy-end');
    };
    provider._releaseProcessLease = () => sequence.push('lease-release');
    provider.initialize = async () => sequence.push('initialize');

    provider._scheduleReconnect(client, 4);
    provider._scheduleReconnect(client, 4);
    await new Promise(resolve => setTimeout(resolve, 25));

    assert.deepStrictEqual(sequence, [
        'destroy-start', 'destroy-end', 'lease-release', 'initialize'
    ]);
    assert.strictEqual(provider.lifecycleGeneration, 5);
    assert.strictEqual(provider.waClient, null);
});

test('WhatsApp initialization is concurrency-safe per manager and tenant', async () => {
    await manager.destroyAll();
    db.prepare("DELETE FROM whatsapp_tenant_configs").run();
    db.prepare(`
        INSERT INTO whatsapp_tenant_configs (tenant_id, provider_type, config_json, enabled)
        VALUES
            ('default', 'cloud', '{"accessToken":"a","phoneNumberId":"p","verifyToken":"v"}', 1),
            ('concurrent_tenant', 'cloud', '{"accessToken":"a2","phoneNumberId":"p2","verifyToken":"v2"}', 1)
    `).run();

    const originalInitialize = WhatsAppBusinessCloudProvider.prototype.initialize;
    const callsByTenant = new Map();
    WhatsAppBusinessCloudProvider.prototype.initialize = function () {
        callsByTenant.set(this.tenantId, (callsByTenant.get(this.tenantId) || 0) + 1);
        return new Promise(resolve => setTimeout(resolve, 20))
            .then(() => originalInitialize.call(this));
    };

    try {
        const first = manager.initializeAll();
        const second = manager.initializeAll();
        const third = manager.initializeAll();

        assert.strictEqual(first, second, 'parallel initializeAll calls must share one Promise');
        assert.strictEqual(second, third, 'all callers must receive the active initialization Promise');

        await Promise.all([first, second, third]);

        assert.strictEqual(callsByTenant.get('default'), 1);
        assert.strictEqual(callsByTenant.get('concurrent_tenant'), 1);
        assert.strictEqual(manager.providers.size, 2);

        const alreadyInitialized = await manager.initializeAll();
        assert.strictEqual(alreadyInitialized, manager.providers);
        assert.strictEqual(callsByTenant.get('default'), 1);

        await manager.destroyAll();
    } finally {
        WhatsAppBusinessCloudProvider.prototype.initialize = originalInitialize;
    }
});

test('Repeated Web and Cloud switching destroys the old provider before starting the new one', async () => {
    await manager.destroyAll();
    const events = [];
    const originalWebInitialize = WhatsAppWebProvider.prototype.initialize;
    const originalWebDestroy = WhatsAppWebProvider.prototype.destroy;
    const originalCloudInitialize = WhatsAppBusinessCloudProvider.prototype.initialize;
    const originalCloudDestroy = WhatsAppBusinessCloudProvider.prototype.destroy;

    WhatsAppWebProvider.prototype.initialize = async function () {
        events.push(`start:web:${this.tenantId}`);
        this.initialized = true;
        this.waStatus = 'متصل';
        return this;
    };
    WhatsAppWebProvider.prototype.destroy = async function () {
        events.push(`destroy:web:${this.tenantId}`);
        this.initialized = false;
    };
    WhatsAppBusinessCloudProvider.prototype.initialize = async function () {
        events.push(`start:cloud:${this.tenantId}`);
        this.initialized = true;
        this.status = 'متصل';
        return this;
    };
    WhatsAppBusinessCloudProvider.prototype.destroy = async function () {
        events.push(`destroy:cloud:${this.tenantId}`);
        this.initialized = false;
    };

    try {
        for (let index = 0; index < 5; index += 1) {
            await manager.switchProvider('switch_stress', 'web', {});
            await manager.switchProvider('switch_stress', 'cloud', {
                accessToken: 'a',
                phoneNumberId: 'p',
                verifyToken: 'v'
            });
        }

        for (let index = 1; index < events.length; index += 1) {
            if (events[index].startsWith('start:')) {
                assert.ok(
                    events[index - 1].startsWith('destroy:'),
                    `provider started before previous provider was destroyed: ${events[index - 1]} -> ${events[index]}`
                );
            }
        }
        assert.strictEqual(manager.providers.size, 1);
        assert.ok(manager.getProvider('switch_stress') instanceof WhatsAppBusinessCloudProvider);
    } finally {
        await manager.destroyAll();
        WhatsAppWebProvider.prototype.initialize = originalWebInitialize;
        WhatsAppWebProvider.prototype.destroy = originalWebDestroy;
        WhatsAppBusinessCloudProvider.prototype.initialize = originalCloudInitialize;
        WhatsAppBusinessCloudProvider.prototype.destroy = originalCloudDestroy;
    }
});

test('Destroy removes all listeners from the retired WhatsApp client', async () => {
    const provider = new WhatsAppWebProvider('listener_cleanup', {});
    const fakeClient = new EventEmitter();
    fakeClient.destroy = async () => {};
    fakeClient.on('message', () => {});
    fakeClient.on('ready', () => {});
    fakeClient.on('disconnected', () => {});
    provider.waClient = fakeClient;
    provider.initialized = true;

    await provider.destroy();

    assert.strictEqual(fakeClient.eventNames().length, 0);
    assert.strictEqual(provider.waClient, null);
});

test('WhatsAppProviderManager - Dynamic Provider Switching', async (t) => {
    const tenantId = 'tenant_switching_test';
    const originalWebInitialize = WhatsAppWebProvider.prototype.initialize;
    WhatsAppWebProvider.prototype.initialize = async function () {
        this.initialized = true;
        this.waStatus = 'متصل';
        return this;
    };

    try {
        // 1. Initialise with web provider without launching Chromium in the unit test
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
    } finally {
        WhatsAppWebProvider.prototype.initialize = originalWebInitialize;
    }
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

    provider.sendMessage = async () => ({
        success: true,
        externalMessageId: null,
        acceptedUnverified: true
    });
    const unverifiedResult = await sendOutgoingMessage({
        ...outgoingMsg,
        content: 'رد محفوظ بدون معرف خارجي'
    });
    assert.strictEqual(unverifiedResult.success, true);
    assert.strictEqual(unverifiedResult.status, 'sent_unverified');
    const savedUnverified = db.prepare(`
        SELECT content, external_message_id, delivery_status, metadata
        FROM messages WHERE content = ? ORDER BY created_at DESC LIMIT 1
    `).get('رد محفوظ بدون معرف خارجي');
    assert.ok(savedUnverified);
    assert.strictEqual(savedUnverified.external_message_id, null);
    assert.strictEqual(savedUnverified.delivery_status, 'sent');
    assert.strictEqual(JSON.parse(savedUnverified.metadata).externalMessageIdVerified, false);

    // Cleanup
    await manager.destroyAll();
});
