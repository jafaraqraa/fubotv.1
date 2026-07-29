const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const path = require('path');

const dbPath = path.resolve(__dirname, '..', 'data', 'test_media_access.db');
const uploadsDir = path.resolve(__dirname, '..', 'public', 'uploads');
const mediaName = `access-test-${process.pid}.txt`;
const mediaPath = path.join(uploadsDir, mediaName);

process.env.SQLITE_DB_PATH = dbPath;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'media_access_test_session_secret_32_chars';
process.env.ADMIN_BOOTSTRAP_USERNAME = 'media-admin';
process.env.ADMIN_BOOTSTRAP_PASSWORD = 'Media!Bootstrap6Password';

for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(dbPath + suffix)) fs.unlinkSync(dbPath + suffix);
}
fs.mkdirSync(uploadsDir, { recursive: true });
fs.writeFileSync(mediaPath, 'private-media-fixture');

const db = require('../src/database/connection');
require('../src/database/initialize').initializeDatabase();
require('../src/services/adminBootstrap').bootstrapAdminAccount();
const app = require('../src/app');

test('uploaded media requires an authenticated administrator session', async (t) => {
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        db.close();
        if (fs.existsSync(mediaPath)) fs.unlinkSync(mediaPath);
        for (const suffix of ['', '-wal', '-shm']) {
            if (fs.existsSync(dbPath + suffix)) fs.unlinkSync(dbPath + suffix);
        }
    });

    const anonymous = await fetch(`${base}/uploads/${mediaName}`, { redirect: 'manual' });
    assert.strictEqual(anonymous.status, 302);
    assert.strictEqual(anonymous.headers.get('location'), '/login');

    const login = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-forwarded-proto': 'https'
        },
        body: JSON.stringify({
            username: 'media-admin',
            password: 'Media!Bootstrap6Password'
        })
    });
    assert.strictEqual(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];

    const authorized = await fetch(`${base}/uploads/${mediaName}`, {
        headers: { Cookie: cookie }
    });
    assert.strictEqual(authorized.status, 200);
    assert.strictEqual(await authorized.text(), 'private-media-fixture');
    assert.match(authorized.headers.get('cache-control'), /private/);
    assert.strictEqual(authorized.headers.get('content-security-policy'), "default-src 'none'; sandbox");
});
