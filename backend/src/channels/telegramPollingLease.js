const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function getProcessIdentity(pid = process.pid) {
    try {
        const bootId = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
        const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
        const closingParen = stat.lastIndexOf(')');
        const fieldsAfterCommand = stat.slice(closingParen + 2).split(' ');
        return { bootId, startTime: fieldsAfterCommand[19] };
    } catch (_) {
        return null;
    }
}

function ownerIsAlive(owner) {
    if (!owner || !Number.isInteger(owner.pid)) return false;
    try {
        process.kill(owner.pid, 0);
    } catch (error) {
        if (error.code !== 'EPERM') return false;
    }

    const currentIdentity = getProcessIdentity(owner.pid);
    if (owner.processIdentity && currentIdentity) {
        return owner.processIdentity.bootId === currentIdentity.bootId
            && owner.processIdentity.startTime === currentIdentity.startTime;
    }
    return true;
}

function leasePathForToken(token, root = path.join(__dirname, '..', '..', 'data')) {
    const fingerprint = crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 16);
    return path.join(root, `.telegram-${fingerprint}.polling.lock`);
}

function acquireTelegramPollingLease(token, options = {}) {
    const leasePath = options.leasePath || leasePathForToken(token, options.root);
    const ownerPath = path.join(leasePath, 'owner.json');
    const create = () => {
        fs.mkdirSync(leasePath);
        fs.writeFileSync(ownerPath, JSON.stringify({
            pid: process.pid,
            createdAt: new Date().toISOString(),
            processIdentity: getProcessIdentity()
        }), { mode: 0o600 });
    };

    fs.mkdirSync(path.dirname(leasePath), { recursive: true });
    try {
        create();
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let owner = null;
        try { owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8')); } catch (_) { /* stale */ }
        if (ownerIsAlive(owner)) {
            const conflict = new Error(`Telegram polling is already owned by process ${owner.pid}`);
            conflict.code = 'TELEGRAM_POLLING_ALREADY_OWNED';
            throw conflict;
        }
        fs.rmSync(leasePath, { recursive: true, force: true });
        create();
    }

    let released = false;
    return {
        path: leasePath,
        release() {
            if (released) return;
            released = true;
            fs.rmSync(leasePath, { recursive: true, force: true });
        }
    };
}

module.exports = { acquireTelegramPollingLease, leasePathForToken };
