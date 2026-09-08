#!/usr/bin/env node
const path = require('node:path');
const { spawn, execSync } = require('node:child_process');

let child;
let stopping = false;

function resolvePort(port = process.env.PORT) {
    const value = Number(port ?? 3000);
    return Number.isInteger(value) && value > 0 && value <= 65535 ? value : 3000;
}

function freePortIfBusy(port = resolvePort()) {
    try {
        const out = execSync(`ss -lptn sport = :${port}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        const matches = [...out.matchAll(/pid=(\d+)/g)];
        const pids = new Set();
        for (const m of matches) {
            const pid = parseInt(m[1], 10);
            if (pid && pid !== process.pid) {
                pids.add(pid);
            }
        }
        for (const pid of pids) {
            console.log(`[Supervisor] Found stale process ${pid} on port ${port}, terminating...`);
            try { process.kill(pid, 'SIGTERM'); } catch (_) {}
        }
        if (pids.size > 0) {
            const startTime = Date.now();
            while (Date.now() - startTime < 3000) {
                try {
                    const check = execSync(`ss -lptn sport = :${port}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
                    if (!check.includes(`:${port}`)) break;
                } catch (_) { break; }
                const buf = new Int32Array(new SharedArrayBuffer(4));
                Atomics.wait(buf, 0, 0, 100);
            }
            for (const pid of pids) {
                try { process.kill(pid, 'SIGKILL'); } catch (_) {}
            }
        }
    } catch (_) {}
}

function start() {
    const port = resolvePort();
    freePortIfBusy(port);
    child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
        stdio: 'inherit',
        env: { ...process.env, FUBOT_SUPERVISED: 'true', PORT: String(port) }
    });
    child.once('exit', (code, signal) => {
        if (!stopping && code === 75) {
            console.log('[Supervisor] Restarting FuBot to apply the verified restore...');
            setTimeout(start, 750);
            return;
        }
        process.exitCode = code ?? (signal ? 1 : 0);
    });
}

if (require.main === module) {
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.on(signal, () => {
            stopping = true;
            if (child && !child.killed) {
                child.kill(signal);
                setTimeout(() => {
                    if (child && !child.killed) {
                        try { child.kill('SIGKILL'); } catch (_) {}
                    }
                }, 4000).unref();
            }
        });
    }

    start();
}

module.exports = { resolvePort, freePortIfBusy, start };

