const { monitorEventLoopDelay } = require('node:perf_hooks');

const startedAt = Date.now();
const eventLoop = monitorEventLoopDelay({ resolution: 20 });
eventLoop.enable();

const counters = new Map();
const durations = new Map();

function safeLabel(value) {
    return String(value || 'unknown').replace(/[^a-zA-Z0-9_:./-]/g, '_').slice(0, 160);
}

function normalizeRoute(pathname) {
    return safeLabel(String(pathname || '/')
        .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
        .replace(/\/\d+(?=\/|$)/g, '/:id')
        .replace(/\/doc_[a-zA-Z0-9_-]+/g, '/:documentId'));
}

function increment(name, labels = {}, amount = 1) {
    const key = JSON.stringify([name, labels]);
    counters.set(key, (counters.get(key) || 0) + amount);
}

function observe(name, value, labels = {}) {
    const key = JSON.stringify([name, labels]);
    const current = durations.get(key) || { count: 0, sum: 0, max: 0 };
    current.count += 1;
    current.sum += Number(value) || 0;
    current.max = Math.max(current.max, Number(value) || 0);
    durations.set(key, current);
}

function labelText(labels) {
    const pairs = Object.entries(labels);
    if (!pairs.length) return '';
    return `{${pairs.map(([key, value]) => `${safeLabel(key)}="${safeLabel(value)}"`).join(',')}}`;
}

function prometheus() {
    const lines = [
        '# TYPE futhing_process_uptime_seconds gauge',
        `futhing_process_uptime_seconds ${(Date.now() - startedAt) / 1000}`,
        '# TYPE futhing_process_resident_memory_bytes gauge',
        `futhing_process_resident_memory_bytes ${process.memoryUsage().rss}`,
        '# TYPE futhing_process_heap_used_bytes gauge',
        `futhing_process_heap_used_bytes ${process.memoryUsage().heapUsed}`,
        '# TYPE futhing_event_loop_delay_mean_seconds gauge',
        `futhing_event_loop_delay_mean_seconds ${Number(eventLoop.mean || 0) / 1e9}`,
        '# TYPE futhing_event_loop_delay_max_seconds gauge',
        `futhing_event_loop_delay_max_seconds ${Number(eventLoop.max || 0) / 1e9}`
    ];
    for (const [key, value] of counters) {
        const [name, labels] = JSON.parse(key);
        lines.push(`futhing_${safeLabel(name)}${labelText(labels)} ${value}`);
    }
    for (const [key, value] of durations) {
        const [name, labels] = JSON.parse(key);
        const metric = `futhing_${safeLabel(name)}`;
        lines.push(`${metric}_count${labelText(labels)} ${value.count}`);
        lines.push(`${metric}_sum${labelText(labels)} ${value.sum}`);
        lines.push(`${metric}_max${labelText(labels)} ${value.max}`);
    }
    try {
        const rag = require('../rag/runtime/ragMetrics').snapshot().metrics;
        for (const [name, value] of Object.entries(rag)) {
            const metric = `futhing_rag_${safeLabel(name)}`;
            if (typeof value === 'number') {
                lines.push(`${metric} ${value}`);
            } else if (value && typeof value === 'object') {
                if (Number.isFinite(value.count)) lines.push(`${metric}_count ${value.count}`);
                if (Number.isFinite(value.averageMs)) lines.push(`${metric}_average_milliseconds ${value.averageMs}`);
                if (Number.isFinite(value.p95Ms)) lines.push(`${metric}_p95_milliseconds ${value.p95Ms}`);
                if (Number.isFinite(value.maxMs)) lines.push(`${metric}_max_milliseconds ${value.maxMs}`);
            }
        }
    } catch (_) {
        // Metrics collection must not make the monitored application unavailable.
    }
    return `${lines.join('\n')}\n`;
}

function resetForTests() {
    counters.clear();
    durations.clear();
    eventLoop.reset();
}

module.exports = {
    increment,
    observe,
    normalizeRoute,
    prometheus,
    resetForTests
};
