# Phase 7 Production Readiness Report

Date: 2026-07-30

## Decision

**CONDITIONAL GO — 84/100**

The application now has a reproducible production image, a validated Compose
topology, fail-closed production configuration, health/readiness endpoints,
request correlation, protected Prometheus metrics, rate limits, verified
SQLite/upload backup and restore tooling, CI gates, and an operations runbook.

Production traffic must not be enabled until the remaining dependency and
environment-specific checks below are closed.

## Deployment architecture

HTTPS reverse proxy → non-root Node container → SQLite/upload/session persistent
volumes → authenticated private Qdrant service. The Node container uses `tini`,
has a liveness probe, drops Linux capabilities, binds the host port to loopback,
and waits for Qdrant health in Compose.

## Implemented controls

- `/live`: process liveness, fails while shutting down.
- `/ready`: runtime startup gate plus a real SQLite query.
- `/health`: safe runtime state and uptime.
- `/internal/metrics`: bearer-token protected Prometheus text.
- Structured HTTP completion records with request/correlation IDs, route,
  status, duration, user and tenant.
- Process, HTTP, AI-provider, and existing RAG runtime metrics.
- Fixed-window limits for administrator APIs, AI, uploads, and webhooks.
- Production startup rejects missing session, Qdrant, or metrics secrets and
  rejects inspector/debug mode.
- Security headers include CSP, HSTS in production, content-type protection,
  frame restriction, referrer policy and permissions policy.
- Atomic backup publication: partial backups are deleted on failure and the
  destination appears only after SQLite, uploads, optional Qdrant snapshot and
  checksums complete.
- Backup verifier checks every checksum, SQLite integrity and foreign keys.
- CI runs clean install, critical dependency audit, the complete test suite,
  build verification and Docker build.

## Commands and evidence

```text
node --test backend/test/phase7_production_operations.test.js
Result: 6/6 passed.

npm test
Result: exit 0; complete backend and frontend suites passed.

npm run build
Result: 148 JavaScript files and 3 deployable assets validated.

QDRANT_API_KEY=<test-secret> docker compose -f docker-compose.production.yml config --quiet
Result: exit 0.

docker build -t futhing:phase7-verify .
Result: image eb4c6352649b built and tagged successfully.

npm audit --omit=dev --audit-level=critical
Result: no critical finding; 8 high transitive findings remain.
```

The Phase 7 local load regression issued 100 concurrent `/live` requests:
zero failures, with the test-enforced p95 below 2 seconds. This validates the
HTTP process path only; it is not a production-capacity claim.

The restore regression created a WAL-safe SQLite backup plus a real upload,
verified checksums, reopened the restored database read-only, and passed both
`integrity_check` and `foreign_key_check`. Qdrant backup is fail-closed by
default and was skipped explicitly in the local test.

## Remaining risks and release gates

1. **High — dependency advisories.** `whatsapp-web.js` brings eight high
   transitive advisories through `archiver`, `glob`, `minimatch`, and
   `brace-expansion`. The audit-proposed forced fix downgrades
   `whatsapp-web.js` to 1.17.1 and is therefore unsafe without compatibility
   testing. Track an upstream patched release or test a controlled override.
   Multer 1.x and `fluent-ffmpeg` also emit deprecation warnings.
2. **High — real Qdrant restore not executed here.** Execute a full snapshot,
   restore it into an empty production-equivalent Qdrant instance, and run RAG
   reconciliation before release.
3. **High — external workload capacity not established.** Run authenticated
   webhook bursts, AI concurrency, upload load, and RAG search load against a
   staging environment with production-equivalent Qdrant/Ollama/provider
   limits. Define capacity from those results.
4. **Medium — rate limiting is process-local.** It is safe for one replica but
   is not a distributed quota. Use an edge limiter or shared store before
   horizontal replicas.
5. **Medium — mixed legacy logging.** New HTTP/error paths are structured, but
   older feature logs are still human-readable. Central ingestion must parse
   both until legacy call sites are migrated.
6. **Medium — CSP compatibility.** The current UI still requires
   `unsafe-inline` and CDN Tailwind. Self-host assets and remove inline code
   before claiming a strict CSP.
7. **Medium — `/ready` is startup-aware rather than a live deep dependency
   probe.** Qdrant ownership is checked before the server becomes ready, but a
   later Qdrant outage is surfaced through RAG dependency metrics/errors rather
   than making all dashboard traffic unready.
8. **Operational gate.** Configure external TLS, log/metrics collection,
   alert routing, encrypted off-host backups, retention, restore ownership, and
   immutable image promotion in the target platform.

## Monitoring and alerting

The operational thresholds, recovery order, backup/restore commands, rollback
rules, and disaster scenarios are documented in
`docs/PRODUCTION_OPERATIONS.md`. Recommended primary alerts cover service down,
not-ready, HTTP 5xx ratio, p95 latency, event-loop delay, memory, crash loops,
RAG dependency timeouts, webhook/index failures, disk space, and missing
verified backups.

## Production release checklist

- Supply all secrets from a secret manager; never bake `.env` into the image.
- Terminate HTTPS at the proxy and expose neither port 3001 nor Qdrant publicly.
- Run the complete CI workflow on the exact commit/image digest.
- Create and verify a full backup including Qdrant.
- Pass production-equivalent load and provider failure tests.
- Confirm alert delivery and execute a restore/rollback drill.
- Resolve or formally accept the tracked high dependency advisories.

