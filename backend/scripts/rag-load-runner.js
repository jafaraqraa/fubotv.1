#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { performance, monitorEventLoopDelay } = require('perf_hooks');

const DEFAULTS = {
    baseUrl: 'http://127.0.0.1:3001',
    scenario: 'retrieval',
    concurrency: 10,
    requests: 100,
    timeoutMs: 30000,
    tenantId: 'default',
    maxErrorRate: 0.001,
    maxP95Ms: 3000,
    maxP99Ms: 6000,
    minAvailability: 0.999,
    questions: ['ما هي المعلومات المتوفرة في قاعدة المعرفة؟']
};

function parseArgs(argv) {
    const values = {};
    for (let i = 0; i < argv.length; i++) {
        if (!argv[i].startsWith('--')) continue;
        const [key, inline] = argv[i].slice(2).split('=');
        values[key] = inline === undefined ? argv[++i] : inline;
    }
    return values;
}

function assertSafeTarget(baseUrl, destructive) {
    const url = new URL(baseUrl);
    const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if (!local && process.env.RAG_LOAD_ALLOW_REMOTE !== 'true') {
        throw new Error('Remote load targets require RAG_LOAD_ALLOW_REMOTE=true.');
    }
    if (destructive && process.env.RAG_LOAD_ALLOW_MUTATIONS !== 'true') {
        throw new Error('Mutation scenarios require RAG_LOAD_ALLOW_MUTATIONS=true.');
    }
}

function percentile(values, fraction) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function safeJson(text) {
    try { return JSON.parse(text); } catch (_) { return null; }
}

async function timedFetch(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = performance.now();
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        const text = await response.text();
        return {
            status: response.status,
            ok: response.ok,
            body: safeJson(text),
            durationMs: performance.now() - startedAt,
            timeout: false
        };
    } catch (error) {
        return {
            status: 0,
            ok: false,
            error: error.name === 'AbortError' ? 'timeout' : error.message,
            durationMs: performance.now() - startedAt,
            timeout: error.name === 'AbortError'
        };
    } finally {
        clearTimeout(timer);
    }
}

async function authenticate(config) {
    const username = process.env.RAG_LOAD_USERNAME;
    const password = process.env.RAG_LOAD_PASSWORD;
    if (!username || !password) {
        throw new Error('RAG_LOAD_USERNAME and RAG_LOAD_PASSWORD are required.');
    }
    const login = await timedFetch(`${config.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: config.baseUrl },
        body: JSON.stringify({ username, password })
    }, config.timeoutMs);
    if (!login.ok || !login.body?.sessionId) {
        throw new Error(`Load-test authentication failed (HTTP ${login.status}).`);
    }
    const headers = {
        'X-Session-ID': login.body.sessionId,
        'X-Tenant-ID': config.tenantId,
        Origin: config.baseUrl
    };
    const csrf = await timedFetch(`${config.baseUrl}/api/auth/csrf-token`, { headers }, config.timeoutMs);
    if (!csrf.ok || !csrf.body?.csrfToken) throw new Error('Could not obtain CSRF token.');
    return { ...headers, 'X-CSRF-Token': csrf.body.csrfToken };
}

function requestFor(config, headers, index) {
    if (config.scenario === 'indexing') {
        const form = new FormData();
        const unique = `${Date.now()}-${process.pid}-${index}`;
        form.append('file', new Blob([
            `${config.uploadText || 'RAG isolated load fixture'}\nfixture=${unique}`
        ], { type: 'text/plain' }), `rag-load-${unique}.txt`);
        return {
            url: `${config.baseUrl}/api/rag/documents/upload`,
            options: {
                method: 'POST',
                headers: { ...headers, 'Idempotency-Key': `rag-load-${unique}` },
                body: form
            }
        };
    }
    const question = config.questions[index % config.questions.length];
    if (config.scenario === 'metrics') {
        return {
            url: `${config.baseUrl}/api/admin/rag/metrics-summary`,
            options: { headers }
        };
    }
    if (config.scenario === 'mixed' && index % 5 === 0) {
        return {
            url: `${config.baseUrl}/api/rag/status`,
            options: { headers }
        };
    }
    return {
        url: `${config.baseUrl}/api/rag/playground`,
        options: {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ question })
        }
    };
}

function validateResult(config, result) {
    if (!result.ok) return false;
    if (config.scenario === 'indexing') {
        return result.body?.success === true && result.body?.status === 'active'
            && Number.isInteger(result.body?.chunkCount) && result.body.chunkCount > 0;
    }
    if (config.scenario === 'metrics') return result.body?.success === true
        && result.body?.metrics?.tenantId === config.tenantId;
    if (config.scenario === 'mixed' && result.body?.status) return result.body.success === true;
    return result.body?.success === true && typeof result.body?.finalAnswer === 'string';
}

async function run(config) {
    const destructive = ['indexing', 'mixed-mutations'].includes(config.scenario);
    assertSafeTarget(config.baseUrl, destructive);
    const headers = await authenticate(config);
    const eventLoop = monitorEventLoopDelay({ resolution: 20 });
    eventLoop.enable();
    const beforeMemory = process.memoryUsage();
    const beforeCpu = process.cpuUsage();
    const startedAt = performance.now();
    const latencySamples = [];
    const maxSamples = Number(config.maxLatencySamples) || 100000;
    const errorCounts = {};
    let completed = 0;
    let successful = 0;
    let timeouts = 0;
    let tenantLeakDetected = false;
    let cursor = 0;
    const deadline = config.durationSeconds
        ? startedAt + (Number(config.durationSeconds) * 1000) : Infinity;

    async function worker() {
        while (true) {
            const index = cursor++;
            if (index >= config.requests || performance.now() >= deadline) return;
            const request = requestFor(config, headers, index);
            const response = await timedFetch(request.url, request.options, config.timeoutMs);
            const correct = validateResult(config, response);
            completed++;
            if (correct) successful++;
            if (response.timeout) timeouts++;
            tenantLeakDetected ||= response.body?.metrics?.tenantId !== undefined
                && response.body.metrics.tenantId !== config.tenantId;
            if (!correct) {
                const category = response.error || `HTTP_${response.status}`;
                errorCounts[category] = (errorCounts[category] || 0) + 1;
            }
            // Bounded deterministic sampling keeps endurance memory stable.
            if (latencySamples.length < maxSamples) latencySamples.push(response.durationMs);
            else {
                const slot = index % maxSamples;
                latencySamples[slot] = response.durationMs;
            }
        }
    }

    await Promise.all(Array.from(
        { length: Math.min(config.concurrency, config.requests) },
        () => worker()
    ));
    const durationMs = performance.now() - startedAt;
    const cpu = process.cpuUsage(beforeCpu);
    const afterMemory = process.memoryUsage();
    eventLoop.disable();
    const availability = completed ? successful / completed : 0;
    const latencyMin = latencySamples.reduce((min, value) => Math.min(min, value), Infinity);
    const latencyMax = latencySamples.reduce((max, value) => Math.max(max, value), -Infinity);
    const report = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        host: os.hostname(),
        scenario: config.scenario,
        target: new URL(config.baseUrl).origin,
        tenantId: config.tenantId,
        configuration: {
            concurrency: config.concurrency,
            requests: config.requests,
            timeoutMs: config.timeoutMs
        },
        results: {
            durationMs,
            requests: completed,
            successful,
            failed: completed - successful,
            timeouts,
            availability,
            throughputRps: completed / (durationMs / 1000),
            latencyMs: {
                sampleCount: latencySamples.length,
                sampled: completed > latencySamples.length,
                min: latencySamples.length ? latencyMin : null,
                p50: percentile(latencySamples, 0.50),
                p95: percentile(latencySamples, 0.95),
                p99: percentile(latencySamples, 0.99),
                max: latencySamples.length ? latencyMax : null
            }
        },
        resources: {
            rssBeforeBytes: beforeMemory.rss,
            rssAfterBytes: afterMemory.rss,
            heapDeltaBytes: afterMemory.heapUsed - beforeMemory.heapUsed,
            cpuUserMs: cpu.user / 1000,
            cpuSystemMs: cpu.system / 1000,
            eventLoopLagMs: {
                mean: Number.isFinite(eventLoop.mean) ? eventLoop.mean / 1e6 : null,
                p95: eventLoop.percentile(95) / 1e6,
                max: eventLoop.max / 1e6
            }
        },
        errors: Object.entries(errorCounts).map(([category, count]) => ({ category, count }))
    };
    const checks = {
        availability: availability >= config.minAvailability,
        errorRate: (1 - availability) <= config.maxErrorRate,
        p95: report.results.latencyMs.p95 <= config.maxP95Ms,
        p99: report.results.latencyMs.p99 <= config.maxP99Ms,
        tenantLeak: !tenantLeakDetected
    };
    report.acceptance = { checks, passed: Object.values(checks).every(Boolean) };
    return report;
}

function markdown(report) {
    const latency = report.results.latencyMs;
    return `# RAG load report

- Scenario: ${report.scenario}
- Requests: ${report.results.requests}
- Concurrency: ${report.configuration.concurrency}
- Throughput: ${report.results.throughputRps.toFixed(2)} req/s
- Availability: ${(report.results.availability * 100).toFixed(3)}%
- Latency p50/p95/p99: ${latency.p50.toFixed(1)} / ${latency.p95.toFixed(1)} / ${latency.p99.toFixed(1)} ms
- Timeouts: ${report.results.timeouts}
- Heap delta: ${report.resources.heapDeltaBytes} bytes
- Event-loop p95: ${report.resources.eventLoopLagMs.p95.toFixed(2)} ms
- Acceptance: ${report.acceptance.passed ? 'PASS' : 'FAIL'}
`;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const configFile = args.config
        ? JSON.parse(fs.readFileSync(path.resolve(args.config), 'utf8')) : {};
    const config = {
        ...DEFAULTS,
        ...configFile,
        ...Object.fromEntries(Object.entries({
            baseUrl: args.baseUrl,
            scenario: args.scenario,
            tenantId: args.tenantId,
            concurrency: args.concurrency && Number(args.concurrency),
            requests: args.requests && Number(args.requests)
        }).filter(([, value]) => value !== undefined))
    };
    const report = await run(config);
    const reportDir = path.resolve(args.reportDir || 'reports/rag');
    fs.mkdirSync(reportDir, { recursive: true });
    const basename = `${config.scenario}-${Date.now()}`;
    fs.writeFileSync(path.join(reportDir, `${basename}.json`), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(reportDir, `${basename}.md`), markdown(report));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.acceptance.passed ? 0 : 1;
}

if (require.main === module) {
    main().catch(error => {
        console.error(`[RAG Load] ${error.message}`);
        process.exitCode = 2;
    });
}

module.exports = { assertSafeTarget, percentile, validateResult, run };
