const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase6-auth-'));
process.env.SQLITE_DB_PATH = path.join(tempDir, 'phase6.db');
process.env.SESSION_SECRET = 'phase6_session_secret_more_than_thirty_two_chars';

const db = require('../src/database/connection');
require('../src/database/initialize').initializeDatabase();
const access = require('../src/security/accessControl');
const customerRepo = require('../src/database/repositories/customerRepository');
const adminRepo = require('../src/database/repositories/adminRepository');

function responseRecorder() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
}

test('Phase 6 authorization and tenant-isolation contracts', async t => {
    let adminA;
    await t.test('fixture creates explicit, tenant-scoped memberships', () => {
        db.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-a', 'A'), ('tenant-b', 'B')").run();
        db.prepare(`
            INSERT INTO administrators (username, password_hash, display_name)
            VALUES ('agent-a', 'unused', 'Agent A')
        `).run();
        adminA = db.prepare("SELECT id FROM administrators WHERE username = 'agent-a'").get().id;
        db.prepare(`
            INSERT INTO administrator_tenants (administrator_id, tenant_id, role)
            VALUES (?, 'tenant-a', 'agent')
        `).run(adminA);
        assert.deepEqual(access.getMemberships(adminA).map(x => x.tenantId), ['tenant-a']);
    });

    await t.test('forged tenant identifiers are rejected before route execution', () => {
        const req = {
            session: { userId: adminA },
            headers: { 'x-tenant-id': 'tenant-b' },
            params: {}, body: {}, query: {}
        };
        const res = responseRecorder();
        let called = false;
        access.attachAccessContext(req, res, () => { called = true; });
        assert.equal(called, false);
        assert.equal(res.statusCode, 403);
        assert.equal(res.body.error, 'Tenant access denied');
    });

    await t.test('RBAC permits agent messaging but denies integration administration', () => {
        const req = {
            session: { userId: adminA }, headers: { 'x-tenant-id': 'tenant-a' },
            params: {}, body: {}, query: {}
        };
        const res = responseRecorder();
        access.attachAccessContext(req, res, () => {});
        let allowed = false;
        access.requirePermission('messages:send')(req, res, () => { allowed = true; });
        assert.equal(allowed, true);
        access.requirePermission('integrations:manage')(req, res, () => {});
        assert.equal(res.statusCode, 403);
    });

    await t.test('identical provider user IDs keep tenant-owned names and profiles isolated', () => {
        customerRepo.registerCustomerUser('same-user', 'Tenant A Name', 'whatsapp', 'tenant-a');
        customerRepo.registerCustomerUser('same-user', 'Tenant B Name', 'whatsapp', 'tenant-b');
        assert.equal(
            customerRepo.findCustomerUser('same-user', 'whatsapp', 'tenant-a').name,
            'Tenant A Name'
        );
        assert.equal(
            customerRepo.findCustomerUser('same-user', 'whatsapp', 'tenant-b').name,
            'Tenant B Name'
        );
        assert.equal(customerRepo.listCustomerUsers('tenant-a').length, 1);
        assert.equal(customerRepo.listCustomerUsers('tenant-b').length, 1);
        assert.equal(customerRepo.findCustomerUserByIdOnly('same-user'), null);
    });

    await t.test('realtime publisher emits tenant data only to its tenant room', () => {
        const emissions = [];
        const io = {
            to(room) {
                return { emit: (event, payload) => emissions.push({ room, event, payload }) };
            }
        };
        const publisher = require('../src/realtime/eventPublisher');
        publisher.initialize(io);
        publisher.publish('message:created', { tenantId: 'tenant-a', text: 'private' });
        assert.deepEqual(emissions.map(item => item.room), ['tenant:tenant-a']);
        publisher.shutdown();
    });

    await t.test('credentials are authenticated-encrypted and session revocation is account scoped', () => {
        const cryptoService = require('../src/security/credentialCrypto');
        const encrypted = cryptoService.encryptSecret('provider-secret-value');
        assert.match(encrypted, /^enc:v1:/);
        assert.equal(encrypted.includes('provider-secret-value'), false);
        assert.equal(cryptoService.decryptSecret(encrypted), 'provider-secret-value');

        db.prepare(`
            INSERT INTO sessions (sid, sess, expired) VALUES
            ('agent-session', ?, '2099-01-01T00:00:00.000Z'),
            ('other-session', '{"userId":99999}', '2099-01-01T00:00:00.000Z')
        `).run(JSON.stringify({ userId: adminA }));
        assert.equal(adminRepo.revokeSessionsForAdministrator(adminA), 1);
        assert.equal(db.prepare("SELECT COUNT(*) count FROM sessions WHERE sid='other-session'").get().count, 1);
    });
});

test.after(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
});
