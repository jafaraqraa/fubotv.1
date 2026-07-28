#!/usr/bin/env node
'use strict';

const http = require('http');

const port = Number(process.env.RAG_FAULT_PROXY_PORT || 19090);
const mode = process.env.RAG_FAULT_MODE || '503';
const latencyMs = Math.max(0, Number(process.env.RAG_FAULT_LATENCY_MS || 0));
const sequence = String(process.env.RAG_FAULT_SEQUENCE || '')
    .split(',').map(value => value.trim()).filter(Boolean);
let calls = 0;

function selectedMode() {
    return sequence.length ? sequence[Math.min(calls++, sequence.length - 1)] : mode;
}

const server = http.createServer((req, res) => {
    const fault = selectedMode();
    const respond = () => {
        if (fault === 'reset') return req.socket.destroy();
        if (fault === 'partial') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.write('{"embedding":[');
            return req.socket.destroy();
        }
        if (fault === 'invalid-json') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end('{invalid');
        }
        if (fault === 'timeout') return;
        const status = Number(fault) || 503;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: { type: 'injected_failure', status },
            faultInjection: true
        }));
    };
    setTimeout(respond, latencyMs);
});

server.listen(port, '127.0.0.1', () => {
    console.log(`[RAG Fault Proxy] listening=127.0.0.1:${port} mode=${mode} latencyMs=${latencyMs}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)));
}
