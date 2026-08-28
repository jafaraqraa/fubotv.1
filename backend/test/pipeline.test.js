const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Force test database configuration before requiring models
const testDbPath = path.resolve(__dirname, '..', 'data', 'test_pipeline.db');
process.env.SQLITE_DB_PATH = testDbPath;

if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');

const db = require('../src/database/connection');
const { initializeDatabase } = require('../src/database/initialize');
const { normalizeTelegramMessage } = require('../src/messaging/normalizers/telegramNormalizer');
const { normalizeWhatsAppMessage } = require('../src/messaging/normalizers/whatsappNormalizer');
const { normalizeMetaMessage } = require('../src/messaging/normalizers/metaNormalizer');
const { validateNormalizedMessage } = require('../src/messaging/validateMessage');
const { processIncomingMessage } = require('../src/messaging/messageProcessor');
const messageProcessorTest = require('../src/messaging/messageProcessor')._test;
const { sendOutgoingMessage } = require('../src/messaging/outgoingMessageService');
const customerRepo = require('../src/database/repositories/customerRepository');
const messageRepo = require('../src/database/repositories/messageRepository');

test('Unified Message Pipeline & Normalizers Suite', async (t) => {

    await t.test('0. Management request and unknown-answer escalation detection', () => {
        assert.strictEqual(messageProcessorTest.requestsManagement('بدي أحكي مع الإدارة'), true);
        assert.strictEqual(messageProcessorTest.requestsManagement('كم سعر المنتج؟'), false);
        assert.strictEqual(messageProcessorTest.aiSignalsUnknown('لا أستطيع تحديد هوية الشخص في الصورة.'), true);
        assert.strictEqual(messageProcessorTest.aiSignalsUnknown('سعر المنتج هو 20 شيكل.'), false);
    });

    await t.test('1. Setup database schemas', () => {
        initializeDatabase();
        assert.ok(true);
    });

    await t.test('2. Normalizer: Telegram text message normalization', () => {
        const mockCtx = {
            from: { id: 1122, first_name: 'Ahmed', last_name: 'Bakri', username: 'ahmed_tg' },
            message: { message_id: 55, text: 'مرحبا بكم', date: 1783880000 }
        };
        const normalized = normalizeTelegramMessage(mockCtx);
        assert.strictEqual(normalized.channel, 'telegram');
        assert.strictEqual(normalized.externalMessageId, '55');
        assert.strictEqual(normalized.externalUserId, '1122');
        assert.strictEqual(normalized.customer.displayName, 'Ahmed Bakri');
        assert.strictEqual(normalized.customer.username, 'ahmed_tg');
        assert.strictEqual(normalized.messageType, 'text');
        assert.strictEqual(normalized.content, 'مرحبا بكم');
        assert.strictEqual(normalized.metadata.tenantId, 'default');
        assert.ok(normalized.timestamp);
    });

    await t.test('3. Normalizer: WhatsApp image normalization', () => {
        const mockMsg = {
            from: '970599123456@c.us',
            body: 'صورة الشحن',
            hasMedia: true,
            id: { id: 'wa-msg-88' },
            timestamp: 1783880100
        };
        const mockContact = {
            number: '970599123456',
            pushname: 'أبو أحمد'
        };
        const normalized = normalizeWhatsAppMessage(mockMsg, mockContact, '/uploads/wa_img.jpg', 'image', 'jpg');
        assert.strictEqual(normalized.channel, 'whatsapp');
        assert.strictEqual(normalized.externalUserId, '970599123456@c.us');
        assert.strictEqual(normalized.customer.displayName, 'أبو أحمد');
        assert.strictEqual(normalized.messageType, 'image');
        assert.strictEqual(normalized.content, '/uploads/wa_img.jpg');
        assert.deepStrictEqual(normalized.media, {
            localPath: '/uploads/wa_img.jpg',
            publicUrl: '/uploads/wa_img.jpg',
            fileName: 'wa_img.jpg',
            mimeType: 'image/jpeg',
            caption: 'صورة الشحن'
        });
        assert.strictEqual(normalized.customer.phoneNumber, '970599123456');
    });

    await t.test('3b. WhatsApp LID is never exported as a phone number without provider resolution', () => {
        const lidMsg = {
            from: '58970521772124@lid', body: 'مرحبا', hasMedia: false,
            id: { id: 'wa-lid-1' }, timestamp: 1783880100
        };
        const contact = { number: '58970521772124', pushname: 'LID User' };
        const unresolved = normalizeWhatsAppMessage(lidMsg, contact);
        assert.strictEqual(unresolved.customer.phoneNumber, null);

        const resolved = normalizeWhatsAppMessage(
            lidMsg, contact, null, 'text', '', null, '972599123456@c.us'
        );
        assert.strictEqual(resolved.customer.phoneNumber, '972599123456');
    });

    await t.test('4. Validator rejects invalid or missing fields', () => {
        const invalid = { channel: 'unsupported_platform', externalUserId: '123' };
        assert.throws(() => {
            validateNormalizedMessage(invalid);
        }, /Invalid or unsupported channel/);
    });

    await t.test('5. Central Inbound Processor updates customer state and prevents duplicates', async () => {
        const mockCtx = {
            from: { id: 'tg_user_99', first_name: 'Samer' },
            message: { message_id: 'tg_mid_99', text: 'سؤال persistence', date: 1783880200 }
        };
        const normalized = normalizeTelegramMessage(mockCtx);

        // Stub getBot() locally to bypass actual API HTTP requests with unique IDs
        const telegramAdapter = require('../src/channels/telegram');
        let mockMessageId = 10000;
        telegramAdapter.getBot = () => ({
            telegram: {
                sendMessage: async () => ({ message_id: mockMessageId++ }),
                sendPhoto: async () => ({ message_id: mockMessageId++ }),
                sendVideo: async () => ({ message_id: mockMessageId++ }),
                sendAudio: async () => ({ message_id: mockMessageId++ }),
                sendDocument: async () => ({ message_id: mockMessageId++ })
            }
        });
        telegramAdapter.setIsValidToken(true);

        const result1 = await processIncomingMessage(normalized);
        assert.strictEqual(
            result1.status,
            'escalated_to_management',
            'An empty AI response must preserve the message and escalate it to management'
        );
        assert.strictEqual(result1.escalationReason, 'ai_provider_failure');
        assert.strictEqual(result1.assignee, 'ai', 'Management notification must not change assignment');
        assert.strictEqual(result1.aiEnabled, true, 'Management notification must keep AI enabled');
        assert.ok(result1.messageId, 'The durable incoming message ID must be retained');
        assert.strictEqual(result1.duplicate, false);

        // Disable AI automation to test human agent queue mapping
        customerRepo.updateAIEnabled('tg_user_99', false);
        const resultDisabled = await processIncomingMessage(normalized);
        assert.strictEqual(resultDisabled.status, 'duplicate', "Repeated message ID is duplicate regardless of AI state");

        // Use a new message ID to verify human-agent routing
        const mockCtxAgent = {
            from: { id: 'tg_user_99', first_name: 'Samer' },
            message: { message_id: 'tg_mid_100', text: 'سؤال بشري', date: 1783880300 }
        };
        const normalizedAgent = normalizeTelegramMessage(mockCtxAgent);
        const resultAgent = await processIncomingMessage(normalizedAgent);
        assert.strictEqual(resultAgent.status, 'waiting_for_agent', "AI-disabled user goes to human queue");

        // Check customer list has our user
        const users = customerRepo.listCustomerUsers('default');
        const found = users.find(u => u.id === 'tg_user_99');
        assert.ok(found, "User Samer should be saved");
        assert.strictEqual(found.name, 'Samer');
    });

    await t.test('6. Conversation channel identity isolation', async () => {
        // Create user with same external_user_id 'user_collision' on different channels (Telegram & WhatsApp)
        customerRepo.registerCustomerUser('user_collision', 'Tg Collide', 'telegram');
        customerRepo.registerCustomerUser('user_collision', 'Wa Collide', 'whatsapp', 'default');

        const tgUser = customerRepo.findCustomerUser('user_collision', 'telegram');
        const waUser = customerRepo.findCustomerUser('user_collision', 'whatsapp', 'default');

        assert.ok(tgUser && waUser);
        assert.strictEqual(tgUser.name, 'Tg Collide');
        assert.strictEqual(waUser.name, 'Wa Collide'); // confirms that no silent collisions or identity merging occurred!
    });

    await t.test('7. Central Outgoing Pipeline persists direct text and internal notes', async () => {
        // Direct human note save (Task 14)
        const noteResult = await sendOutgoingMessage({
            channel: 'telegram',
            externalUserId: 'tg_user_99',
            direction: 'outgoing',
            senderType: 'agent',
            messageType: 'note',
            content: 'سعر خاص لهذا العميل',
            isNote: true
        });
        assert.strictEqual(noteResult.success, true);
        assert.strictEqual(noteResult.status, 'note_saved');

        // Outgoing direct text message
        const textResult = await sendOutgoingMessage({
            channel: 'telegram',
            externalUserId: 'tg_user_99',
            direction: 'outgoing',
            senderType: 'agent',
            messageType: 'text',
            content: 'يا هلا بالورد',
            media: null
        });
        assert.strictEqual(textResult.success, true);

        // Verify messages history contains both note and replies
        const list = messageRepo.listMessages('tg_user_99');
        assert.ok(list.length >= 3);
        assert.strictEqual(list.some(m => m.isNote === true && m.text === 'سعر خاص لهذا العميل'), true);
        assert.strictEqual(list.some(m => m.text === 'يا هلا بالورد'), true);
    });

    await t.test('8. Restart and Reopen database regression verification', () => {
        db.close();

        const Database = require('better-sqlite3');
        const dbNew = new Database(testDbPath);

        const rowCust = dbNew.prepare("SELECT username FROM channel_accounts WHERE external_user_id = 'user_collision' AND channel = 'whatsapp'").get();
        assert.strictEqual(rowCust.username, 'Wa Collide');

        dbNew.close();
    });

    t.after(() => {
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
        if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
        if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');
        console.log("🧹 Pipeline verification database cleared cleanly!");
    });
});
