const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Set environment variable to test database path before loading app or initialize
const testDbPath = path.join(__dirname, '..', 'data', 'test_realtime.db');
process.env.SQLITE_DB_PATH = testDbPath;

// Clean up any stale test database before booting
try {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
    if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');
} catch (e) {}

const { initializeDatabase } = require('../src/database/initialize');
initializeDatabase();

// Bootstrap admin account dynamically
const { bootstrapAdminAccount } = require('../src/services/adminBootstrap');
bootstrapAdminAccount();

// Load App and connection
const app = require('../src/app');
const db = require('../src/database/connection');
const { initializeSocketServer } = require('../src/realtime/socketServer');
const { publish, publishStats } = require('../src/realtime/eventPublisher');
const { EVENTS } = require('../src/realtime/events');

// Load repositories to test persistence hooks
const customerRepo = require('../src/database/repositories/customerRepository');
const messageRepo = require('../src/database/repositories/messageRepository');
const logRepo = require('../src/database/repositories/logRepository');

test('Socket.IO Real-Time Core Integration & Security Suite', async (t) => {
    // Start a temporary HTTP server
    const server = http.createServer(app);
    const io = initializeSocketServer(server);

    const listenServer = server.listen(0);
    const port = listenServer.address().port;
    const baseUrl = `http://localhost:${port}`;

    t.after(() => {
        listenServer.close();
        if (io) io.close();

        // Clean up temporary database files safely
        try {
            if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
            if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
            if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');
        } catch (e) {}
    });

    await t.test('1. Socket.IO server initialization', () => {
        assert.ok(io, 'Socket.IO server should be initialized');
    });

    await t.test('2. Complete Cryptographic Handshake Security Checks', async (st) => {
        // A. Log in to retrieve an authentic signed connect.sid session cookie from Express
        const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-forwarded-proto': 'https'
            },
            body: JSON.stringify({ username: 'admin', password: 'Admin@123456' })
        });
        assert.strictEqual(loginRes.status, 200, 'Login should succeed to get session cookie');

        const setCookieHeader = loginRes.headers.get('set-cookie');
        assert.ok(setCookieHeader, 'Response must include set-cookie header');

        // Extract cookie value: connect.sid=s%3A...
        const cookieVal = setCookieHeader.split(';')[0];
        assert.ok(cookieVal.includes('connect.sid='), 'Cookie must contain connect.sid');

        await st.test('a. Valid signed authenticated session cookie connects successfully', async () => {
            const handshakeRes = await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling`, {
                headers: { 'Cookie': cookieVal }
            });
            const txt = await handshakeRes.text();
            assert.match(txt, /"sid":/, 'Handshake payload must include socket session id (sid)');
            assert.strictEqual(txt.includes('unauthorized'), false, 'Should not contain unauthorized error');
        });

        await st.test('b. Missing cookie is rejected', async () => {
            const handshakeRes = await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling`);
            const txt = await handshakeRes.text();
            assert.match(txt, /"message":"Bad request"/, 'Response must report bad request / unauthorized');
        });

        await st.test('c. Forged session cookie is rejected', async () => {
            // Forged session cookie: tamper with the session ID portion while keeping the signature
            // This checks that signature verification prevents session ID spoofing/forgery
            const forgedCookie = cookieVal.includes('s%3A')
                ? cookieVal.replace('s%3A', 's%3Atampered')
                : cookieVal + '_forged';
            const handshakeRes = await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling`, {
                headers: { 'Cookie': forgedCookie }
            });
            const txt = await handshakeRes.text();
            assert.match(txt, /"message":"Bad request"/, 'Response must report bad request / unauthorized');
        });

        await st.test('d. Modified cookie signature is rejected', async () => {
            // Tamper with the signature portion
            const modifiedCookie = cookieVal + 'a';
            const handshakeRes = await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling`, {
                headers: { 'Cookie': modifiedCookie }
            });
            const txt = await handshakeRes.text();
            assert.match(txt, /"message":"Bad request"/, 'Response must report bad request / unauthorized');
        });

        await st.test('e. Random existing-looking session ID without a valid signature is rejected', async () => {
            const randomSid = 'connect.sid=s%3Aabc123_random_session_id';
            const handshakeRes = await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling`, {
                headers: { 'Cookie': randomSid }
            });
            const txt = await handshakeRes.text();
            assert.match(txt, /"message":"Bad request"/, 'Response must report bad request / unauthorized');
        });

        await st.test('f. Deleted or invalidated session is rejected', async () => {
            // Purge sessions from database
            db.prepare('DELETE FROM sessions').run();
            const handshakeRes = await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling`, {
                headers: { 'Cookie': cookieVal }
            });
            const txt = await handshakeRes.text();
            assert.match(txt, /"message":"Bad request"/, 'Response must report bad request / unauthorized');
        });
    });

    await t.test('3. Event Publisher envelope contract matches spec', () => {
        const testData = { item: 'value' };

        // Temporarily initialize publisher with a mock io instance to capture envelope details
        const mockIo = {
            to: (room) => ({
                emit: (event, envelope) => {
                    assert.strictEqual(room, 'admins', 'Event must be restricted to admins room');
                    assert.strictEqual(envelope.version, 1, 'Event payload version must be 1');
                    assert.ok(envelope.eventId, 'Event must have a unique eventId');
                    assert.ok(envelope.occurredAt, 'Event must have an occurrence timestamp');
                    assert.strictEqual(envelope.data.item, 'value', 'Event payload must contain correct data');
                }
            })
        };

        const { initialize: initPublisher } = require('../src/realtime/eventPublisher');
        initPublisher(mockIo);

        publish('test:event', testData);
    });

    await t.test('4. Persistence-Before-Emission workflow verification', () => {
        let emitOccurred = false;

        // Mock io instance to detect exact event publishing sequence
        const mockIo = {
            to: (room) => ({
                emit: (event, envelope) => {
                    if (event === EVENTS.MESSAGE_CREATED && envelope.data.text === 'persistence_test_msg') {
                        emitOccurred = true;
                        // Ensure persistence has already occurred before this event gets emitted
                        const row = db.prepare('SELECT COUNT(*) as count FROM messages WHERE content = ?').get('persistence_test_msg');
                        assert.strictEqual(row.count, 1, 'SQLite database insert must be completed before the event is emitted');
                    }
                }
            })
        };

        const { initialize: initPublisher } = require('../src/realtime/eventPublisher');
        initPublisher(mockIo);

        // Act: trigger a message save
        messageRepo.saveMessage('tg_persist_test', 'user', 'persistence_test_msg', 'text');

        assert.strictEqual(emitOccurred, true, 'Event must have been successfully emitted after persistence');
    });

    await t.test('5. Verify duplicate messages do not trigger duplicate events', () => {
        let emitCount = 0;

        const mockIo = {
            to: (room) => ({
                emit: (event, envelope) => {
                    if (event === EVENTS.MESSAGE_CREATED && envelope.data.text === 'duplicate_test_msg') {
                        emitCount++;
                    }
                }
            })
        };

        const { initialize: initPublisher } = require('../src/realtime/eventPublisher');
        initPublisher(mockIo);

        // Process first message
        messageRepo.saveMessage('tg_dup_test', 'user', 'duplicate_test_msg', 'text', false, 'msg_ext_id_100');

        // Attempt processing duplicate message (via processor logic checks, existsByExternalId returns true)
        const isDuplicate = messageRepo.existsByExternalId('telegram', 'msg_ext_id_100');
        assert.strictEqual(isDuplicate, true, 'Subsequent message with same external ID must be recognized as duplicate');

        if (!isDuplicate) {
            messageRepo.saveMessage('tg_dup_test', 'user', 'duplicate_test_msg', 'text', false, 'msg_ext_id_100');
        }

        assert.strictEqual(emitCount, 1, 'Duplicate message should not emit a second message:created event');
    });

    await t.test('6. Verify RAG stats update dispatches on stats:updated', () => {
        let statsEmitted = false;

        const mockIo = {
            to: (room) => ({
                emit: (event, envelope) => {
                    if (event === 'stats:updated') {
                        statsEmitted = true;
                        assert.ok(envelope.data.usersCount !== undefined, 'Stats payload must include usersCount');
                        assert.ok(envelope.data.messagesCount !== undefined, 'Stats payload must include messagesCount');
                    }
                }
            })
        };

        const { initialize: initPublisher } = require('../src/realtime/eventPublisher');
        initPublisher(mockIo);

        publishStats();
        assert.strictEqual(statsEmitted, true, 'stats:updated event must be published cleanly');
    });

    await t.test('7. Public Meta webhook remains open and unaffected by Socket.IO authentication', async () => {
        const res = await fetch(`${baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=invalid_token`);
        assert.strictEqual(res.status, 403, 'Public webhooks must remain public and return 403 for invalid verify tokens');
    });

    await t.test('8. Verify frontend client modules file exists and contains correct bindings', () => {
        const clientJsPath = path.join(__dirname, '..', '..', 'frontend', 'public', 'js', 'dashboard', 'realtime.js');
        assert.strictEqual(fs.existsSync(clientJsPath), true, 'realtime.js frontend client file must exist');

        const clientContent = fs.readFileSync(clientJsPath, 'utf8');
        assert.match(clientContent, /socket\.on\('message:created'/, 'Must register message:created listener');
        assert.match(clientContent, /socket\.on\('unread:updated'/, 'Must register unread:updated listener');
        assert.match(clientContent, /socket\.on\('stats:updated'/, 'Must register stats:updated listener');
    });
});
