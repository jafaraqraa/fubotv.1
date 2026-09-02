const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { acquireTelegramPollingLease } = require('../src/channels/telegramPollingLease');

test('Telegram polling lease permits only one local owner per bot token', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'futh-telegram-lease-'));
    const leasePath = path.join(root, 'polling.lock');
    const first = acquireTelegramPollingLease('123:test-token', { leasePath });
    try {
        assert.throws(
            () => acquireTelegramPollingLease('123:test-token', { leasePath }),
            error => error.code === 'TELEGRAM_POLLING_ALREADY_OWNED'
        );
    } finally {
        first.release();
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Telegram polling lease reclaims a stale or reused PID lease', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'futh-telegram-stale-'));
    const leasePath = path.join(root, 'polling.lock');
    fs.mkdirSync(leasePath);
    fs.writeFileSync(path.join(leasePath, 'owner.json'), JSON.stringify({
        pid: process.pid,
        processIdentity: { bootId: 'stale-boot', startTime: '0' }
    }));
    const lease = acquireTelegramPollingLease('123:test-token', { leasePath });
    try {
        const owner = JSON.parse(fs.readFileSync(path.join(leasePath, 'owner.json'), 'utf8'));
        assert.equal(owner.pid, process.pid);
        assert.notEqual(owner.processIdentity?.bootId, 'stale-boot');
    } finally {
        lease.release();
        fs.rmSync(root, { recursive: true, force: true });
    }
});
