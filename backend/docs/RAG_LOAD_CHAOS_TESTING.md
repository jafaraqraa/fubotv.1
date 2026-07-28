# RAG load, resilience, and chaos testing

## Safety model

The HTTP runner accepts localhost only. Remote targets require
`RAG_LOAD_ALLOW_REMOTE=true`. Upload, replacement, cleanup, crash, and other
mutating scenarios additionally require `RAG_LOAD_ALLOW_MUTATIONS=true`.
Run mutations only against disposable SQLite, Qdrant, Ollama, and document
storage volumes.

Never point chaos tests at production.

## Test layers

| Layer | Automation | Default cadence | Pass criteria |
|---|---|---|---|
| Functional load | `rag-load-runner.js` smoke/mixed | pull request | configured availability and p95/p99; zero tenant leaks |
| Failure injection | runtime, atomic indexing, replacement, lock tests plus fault proxy | pull request | zero false success, activation, or rollback corruption |
| Stress/chaos | stress profile and disposable dependency restarts | nightly/manual | zero tenant/lock violations and successful recovery |
| Endurance | 24-hour bounded-sample profile | scheduled/manual | no monotonic heap, handle, lock, cache, or orphan growth |

## Commands

Start the real server with isolated dependencies, then provide credentials
without committing them:

```bash
export RAG_LOAD_USERNAME=admin
export RAG_LOAD_PASSWORD='...'
npm run test:rag:load-smoke
npm run test:rag:load-matrix
npm run test:rag:load-stress
npm run test:rag:endurance
```

Reports are written to `backend/reports/rag/*.json` and `*.md`. They include
request totals, throughput, p50/p95/p99, errors, timeouts, RSS/heap, CPU and
event-loop delay. Endurance latency storage is bounded to 100,000 samples.

## Failure injection

The local proxy can return HTTP 429/500/502/503/504, delay responses, never
respond, reset sockets, return invalid JSON, or close a partial response:

```bash
RAG_FAULT_MODE=503 npm run rag:fault-proxy
RAG_FAULT_MODE=timeout RAG_FAULT_PROXY_PORT=19090 npm run rag:fault-proxy
RAG_FAULT_SEQUENCE=503,503,200 npm run rag:fault-proxy
RAG_FAULT_MODE=reset npm run rag:fault-proxy
```

Point the isolated provider URL at `http://127.0.0.1:19090`. Existing automated
tests verify timeout classification, bounded retries, connection refusal,
429 handling, partial Qdrant upload, count mismatch, request cancellation,
SQLite commit/rollback failure, lease expiry, fencing tokens, stale recovery,
multi-process contention, prompt injection, and tenant isolation.

## Chaos matrix

Use a disposable deployment and record `/api/admin/rag/metrics-summary` before,
during, and after each action:

1. Restart/stop Qdrant during upload, verification, search, count, and scroll.
2. Send SIGTERM during chunking, embedding, upload, activation, and cleanup.
3. Send SIGKILL at the same checkpoints, restart, then run reconciliation.
4. Hold a SQLite `BEGIN EXCLUSIVE` transaction to simulate lock contention.
5. Mount a size-limited temporary filesystem for documents/logs to simulate
   `ENOSPC`; do not fill a host disk.
6. Apply latency/loss/reset through a test proxy or `tc netem` inside the
   dependency container only.
7. Constrain the Node container heap and CPU, then upload maximum-size fixtures.

Acceptance requires: false success 0, duplicate activation 0, tenant leak 0,
lock violation 0, active-version corruption 0, post-success count mismatch 0,
and no sustained orphan/stale-lock growth after reconciliation.

## Retrieval levels

Execute retrieval profiles at concurrency 10, 50, 100, 250, 500, and 1000.
Start at 10 and stop escalation when thresholds fail. This prevents an already
unhealthy environment from being overloaded.

## Indexing fixtures

Use unique, deterministic TXT/PDF/DOCX fixtures in groups of 10, 20, and 50.
After every wave verify SQLite has exactly one active version per logical
document, Qdrant exact filtered counts equal persisted chunk counts, and a
reconciliation dry-run reports no new orphan or mismatch growth.

The automated TXT indexing smoke is mutation-gated:

```bash
RAG_LOAD_ALLOW_MUTATIONS=true npm run test:rag:indexing-load
```

PDF and DOCX waves must use sanitized fixture corpora in the disposable
environment; binary fixtures are intentionally not committed to this repository.

## Endurance review

Compare hourly snapshots for RSS, heap after GC, active handles, descriptors,
event-loop p95, lock rows, abandoned operations, cache size, Qdrant points,
logical chunks, orphans, and mismatch counters. A single increase is not a
leak; fail only on sustained growth after workload and cleanup reach steady
state.
