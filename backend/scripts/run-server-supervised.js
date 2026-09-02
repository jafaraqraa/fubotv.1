#!/usr/bin/env node
const path = require('node:path');
const { spawn } = require('node:child_process');

let child;
let stopping = false;

function start() {
    child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
        stdio: 'inherit',
        env: { ...process.env, FUBOT_SUPERVISED: 'true' }
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

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        stopping = true;
        if (child && !child.killed) child.kill(signal);
    });
}

start();
