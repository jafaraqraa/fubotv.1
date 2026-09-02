# FUThing Deep Technical Audit

Audit date: 2026-08-29 (Asia/Jerusalem)  
Audited revision: `0261748cdf04a831dc363b9491649f4dc9a16981` plus the existing dirty working tree  
Method: current-source inspection, local execution, isolated clean install, deterministic tests, failure-contract tests, and read-only database inspection.

## Executive Decision

**NOT READY**

The core application, database constraints, authentication, RAG isolation, backup tooling, and most regression gates are materially stronger than a typical pre-release build. Release is nevertheless blocked by a verified tenant-boundary defect in legacy `/uploads` media and by an unbounded WhatsApp Cloud download path. A full Playwright run also remains flaky (53/54), although the failed case passed 5/5 in isolation.

Verified facts and unverified claims are separated below. No real external message was sent during this audit.

## Architecture Summary

- One Node 22/Express process serves REST, webhooks, static frontend, Socket.IO, schedulers, and messaging providers.
- SQLite is the transactional store; Qdrant is the vector store; uploaded/media files and WhatsApp Web sessions are filesystem-backed.
- 31 ordered SQL migrations are checksum-validated and rerunnable.
- The frontend is static HTML/CSS/JavaScript. Large hotspots are `backend/src/routes/api.js` (~112 KB), `frontend/public/dashboard.html` (~204 KB), `rag.js` (~104 KB), and `settings.js` (~84 KB).
- Deployment uses a non-root multi-stage Node image, `tini`, persistent volumes, private app port binding in Compose, an authenticated pinned Qdrant `v1.12.5`, dropped capabilities, and health checks.
- The runtime model is effectively single-replica. SQLite, local sessions/files, WhatsApp Web browser state, and process-local rate-limit/scheduler state do not support arbitrary horizontal scaling.

## Runtime / Startup

PASS: migrations and security configuration execute before the listener; Qdrant tenant ownership is checked before bind; external providers start only after bind; shutdown drains HTTP, Socket.IO, RAG operations, Telegram, WhatsApp, schedulers, and SQLite with bounded timeouts.

PASS: the Telegram polling lease tests passed 2/2 and prevent two local processes using the same bot token from both calling `getUpdates`.

Finding: `/ready` checks runtime state and SQLite only. It can continue returning READY after Qdrant becomes unavailable. This contradicts the operations text that readiness reflects dependencies.

Observed: two application processes were running concurrently on ports 3000 and 3001. This is safe for Telegram polling only because of the new lease; it is not evidence that the whole application is multi-replica safe.

## Critical Findings

### C-01 — authenticated cross-tenant access to legacy media

- Severity: CRITICAL
- File/Component: `backend/src/app.js` `/uploads`; `profileImageService`; WhatsApp Web/Cloud media writers
- Evidence: `/uploads` is guarded only by `requireAuth`, then serves a shared directory. It does not call `attachAccessContext`, check a media record, or validate tenant ownership. Multiple channel paths create URLs in that directory. The existing media test proves any authenticated administrator can fetch a known `/uploads/<name>` URL.
- Impact: an administrator in tenant A can read a legacy media/profile file belonging to tenant B if the URL is disclosed, guessed, logged, or copied.
- Root cause: old path-based media contract coexists with the newer tenant-scoped `media_attachments` download endpoint.
- Recommended fix: migrate every customer/media writer to tenant directories plus `media_attachments`; serve only opaque attachment IDs through a tenant-authorized endpoint; remove the shared static route after migrating old records.
- Release blocker: YES

## High Findings

### H-01 — WhatsApp Cloud media download is unbounded and bypasses the unified store

- File/Component: `backend/src/routes/webhooks.js` WhatsApp Cloud handler
- Evidence: `fileRes.arrayBuffer()` reads the full remote response without Content-Length/stream limit, signature validation, or the 10 MB `persistMediaBuffer` policy, then synchronously writes to shared `public/uploads`.
- Impact: signed provider traffic containing a large media object can exhaust memory/event-loop/disk; stored content bypasses tenant records and content validation.
- Root cause: the Cloud adapter predates the unified media pipeline.
- Recommended fix: reuse bounded streaming, allowlisted MIME/signature checks, tenant-private storage, rollback, and attachment records already used by Meta media.
- Release blocker: YES

### H-02 — global 50 MB body parsing precedes authentication and route-specific limits

- File/Component: `backend/src/app.js`
- Evidence: `express.json({limit: '50mb'})` and URL-encoded parsing apply globally before webhook/auth/API routers. The webhook limiter allows 600 requests/minute per key and stores the entire raw body for every JSON request.
- Impact: a remote client can force large repeated allocations and event-loop parsing before authentication. The theoretical accepted volume greatly exceeds safe process memory.
- Root cause: one global parser was used for both ordinary APIs and large payload use cases.
- Recommended fix: use a small global limit; attach raw, bounded parsers only to signed webhook routes and explicit upload endpoints; reject oversized bodies before allocation; add concurrency/backpressure tests.
- Release blocker: YES

### H-03 — Meta Messenger/Instagram tenant model is hard-coded to `default`

- File/Component: `backend/src/routes/webhooks.js`, Meta delivery/media helpers
- Evidence: inbound normalization, media records, delivery updates, and read-through updates use tenant `default`; `findByExternalMessageId` is not tenant-scoped.
- Impact: Messenger/Instagram cannot safely serve multiple tenants, and future multi-tenant configuration could update or associate the wrong record.
- Root cause: multi-tenancy was added to other channels without a tenant-owned Meta page/account routing table.
- Recommended fix: map signed page/account IDs to one active tenant, reject unknown ownership, and include tenant in every lookup/update uniqueness contract.
- Release blocker: YES if Meta is enabled for more than the default tenant; otherwise the feature must be explicitly constrained/documented as single-tenant.

## Medium Findings

- `/ready` does not live-probe Qdrant or report component degradation.
- Playwright has a focus restoration/re-render race: the full run failed 1/54, while the exact test passed 5/5 in isolation.
- Login limiting is persistent, but general API/webhook/RAG limits are in-memory and per-process; two replicas multiply limits and lose state on restart.
- The public auth router is mounted outside the main CSRF middleware. Logout has no CSRF protection; password change requires the current password but is also outside the shared CSRF guard.
- Synchronous file reads/writes exist in request and webhook paths, including RAG uploads/indexing and media delivery, creating event-loop latency under large operations.
- Qdrant is bound to all host interfaces in the observed local runtime (`6333/6334`). Compose itself does not publish it, but non-Compose operators must firewall it.
- The CI job checks only `audit-level=critical`; high-severity dependency findings would not fail the gate.
- Clean install reports deprecated Multer 1.x, unsupported `fluent-ffmpeg`, and deprecated transitive packages even though the current npm advisory database reports zero vulnerabilities.
- Runtime log style is mixed structured/unstructured and includes usernames, customer IDs, document IDs, tenant IDs, and provider error messages. No secret value was found in the targeted current-tree scan, but data-minimization policy is incomplete.

## Low / Technical Debt

- Large route/UI modules reduce ownership clarity and make tenant/security review expensive.
- Console logging is extensive in backend and browser code; production levels and sampling are inconsistent.
- The CSP still permits `unsafe-inline` for scripts/styles and depends on Google Fonts and Tailwind CDN declarations; Chart.js and DOMPurify are local.
- Duplicate legacy/versioned API paths increase surface area and test burden.
- Test scripts are long manually enumerated chains; the Telegram lease test is not part of the normal backend `test` script.

## Security Audit

PASS: production rejects weak/missing session, Qdrant, and metrics secrets; debug and URL session fallback are forbidden. Sessions are server-side SQLite records, regenerated on login, absolute-expiry checked, HttpOnly/Secure-configurable, and revoked on password/account changes. Passwords use bcrypt and login errors do not enumerate users.

PASS: CSRF is session-bound and timing-safe on the protected API routers. Origin policy is shared between HTTP and Socket.IO. Webhooks require HMAC signatures and fail closed when secrets are missing. Replay reservations are transactional and released after processing failure.

PASS: current-tree secret pattern scan found no tracked private keys/tokens; `backend/.env` is ignored and mode `0600`. Git-history secret scanning is **UNVERIFIED**.

FAIL: C-01, H-01, and H-02.

## Tenant Isolation Audit

PASS: authenticated API tenant selection is membership-backed; forged tenant IDs are rejected; RBAC is enforced; conversation/message database triggers reject scope mismatch; RAG storage, cache, locks, delete, rollback, retrieval filtering, and concurrent retrieval have explicit tenant tests (15/15 within the 98-test resilience gate).

FAIL: legacy `/uploads` files are not tenant-authorized. Meta remains hard-coded to `default`.

## Database & Migration Audit

PASS: clean DB applied migrations 001–031 twice; checksum drift and partial schemas fail; foreign keys are enabled; `integrity_check=ok`; no orphan/mismatched/duplicate/malformed/impossible-state rows were found. Tenant-aware indexes and state/JSON triggers exist. WAL backup/restore and rollback contracts passed.

Current data audit: 0 foreign-key violations; all reported integrity counters were 0.

Production-scale SQLite contention and multi-gigabyte query behavior are **UNVERIFIED**.

## Messaging Audit

PASS: message identities are unique by tenant/channel/external ID; compare-and-set delivery transitions and duplicate/race contracts pass. Telegram has a single-owner polling lease. WhatsApp webhook signature, ownership, replay, and retry-on-processing-failure tests pass.

FAIL: WhatsApp Cloud media H-01. Meta multi-tenant routing H-03.

Real Telegram/WhatsApp/Messenger/Instagram send/receive/delivery execution is **UNVERIFIED** because no external recipients or staging authorization were supplied.

## Media Audit

PASS: the unified outgoing path enforces 10 MB, MIME allowlist, extension agreement, magic signatures, random names, atomic create, tenant-scoped DB records, authenticated ID downloads, idempotency, and rollback.

FAIL: legacy writers and `/uploads` bypass that contract (C-01/H-01). Orphan cleanup for all historic shared files is **UNVERIFIED**.

## AI Audit

PASS: provider fetches have bounded timeout/retry behavior; permanent 4xx is not retried; cancellation and failure propagation are tested; invalid credentials/provider outages do not become fake success. Task routing, vision, STT, token/cost telemetry, grounding, contradictions, and fallback contracts pass under mocks.

Real provider credentials, billing reconciliation, and production latency are **UNVERIFIED**.

## RAG Audit

PASS: 98/98 resilience tests passed, covering isolation, atomic replacement/reindex, distributed locks, timeouts, cache, rollback, and failure states. Prompt-injection scanning/quarantine and supported/unsupported-answer quality contracts pass. A prior isolated real Qdrant snapshot/restore in this workspace restored 3 points with identical size/distance/retrieval evidence.

Current live Qdrant contained legacy ownership warnings in earlier startup evidence; ownership remediation of those points is **UNVERIFIED**. Real Ollama embedding compatibility and production corpus quality are **UNVERIFIED**.

## Realtime Audit

PASS: Socket.IO shares the authenticated session middleware, validates account activity/absolute expiry, joins only membership tenant rooms, removes account-check timers on disconnect, and shuts down cleanly. Tenant event contracts pass under tests.

Long-duration socket churn/leak profiling and network-partition ordering are **UNVERIFIED**.

## Frontend Engineering Audit

PASS: DOMPurify is pinned/local; XSS tests reject dangerous sinks and inline event attributes; major flows use text/DOM APIs; navigation restoration, dialogs, keyboard operation, mobile overflow, visual baselines, and axe critical/serious checks are covered.

CONDITIONAL: the time fixture was made relative after it failed across midnight. One focus restoration case remains flaky under the complete four-worker suite.

Firefox/WebKit support is not claimed and was **UNVERIFIED**. Chromium/mobile Chromium were exercised.

## Performance Findings

PASS: local `/live` concurrency/latency contract reports p95 below 2 seconds; pagination/query-plan and RAG load-control tests pass. RAG tests exercised 25 simultaneous retrievals and bounded embedding concurrency.

Risk: synchronous filesystem operations and giant in-process uploads can block the single event loop. Large production database, document indexing, and endurance profiling are **UNVERIFIED**.

## Dependency Audit

- `npm audit --omit=dev --json`: 0 critical/high/moderate/low; 280 production dependencies, 424 total dependency graph entries.
- Outdated direct packages include major upgrades for Express 5, Multer 2, better-sqlite3 13, and dotenv 17; upgrades were not forced during audit.
- Clean `npm ci`: PASS for root and frontend; both reported 0 advisories.

## Secrets & Configuration

PASS: `.env` ignored, mode 0600, production secrets fail closed, Qdrant authentication required in Compose, API keys use encrypted-at-rest application handling and masking in API/UI paths.

UNVERIFIED: secret rotation procedure, external secret manager integration, and full Git-history scan.

## CI/CD

PASS: install, Chromium installation, npm audit, unit/integration tests, build, full Playwright, and Docker build are defined. Browser installation was added explicitly.

FAIL: current full Playwright result is 53/54 because of a nondeterministic focus test. CI audits only critical advisories. Branch protection and artifact retention are **UNVERIFIED**.

## Test Quality

Tests contain real assertions and cover migrations, rollback, concurrency/idempotency, security failures, tenant boundaries, RAG failures, accessibility, and visuals. No `.only`/skipped tests were found. Mock-heavy provider tests do not prove external staging behavior. The detected fixed-date fixture was corrected; a separate focus race remains.

## Full Regression Results

| Gate | Result | Evidence |
|---|---:|---|
| `npm run build` | PASS | 154 JavaScript files, 4 deployable assets |
| `npm test` | PASS | backend + frontend chain completed, exit 0 |
| RAG resilience | PASS | 98/98 |
| Database integrity | PASS | integrity `ok`, 0 violations/counters |
| API inventory | PASS | 90 endpoints inventoried |
| Telegram polling lease | PASS | 2/2 |
| npm production audit | PASS | 0 advisories |
| clean install/build | PASS | root/frontend `npm ci`, build exit 0 |
| Playwright full | FAIL | 53/54; focus restoration race |
| Failed Playwright case isolated | PASS | 5/5 repeats |
| Real external channels | UNVERIFIED | deliberately not called |
| Production-scale load/endurance | UNVERIFIED | no production-equivalent environment |

## Technical Scores

| Area | Score | Evidence |
|---|---:|---|
| Architecture | 72 | clear layers in newer code; large monolith hotspots and single-replica coupling |
| Backend | 78 | broad contracts; global parser and legacy paths remain |
| Frontend Engineering | 82 | XSS/a11y/visual/mobile coverage; giant modules and one flake |
| Database | 91 | constraints, indexes, integrity, rollback, WAL backup |
| Migrations | 94 | clean/rerunnable/checksummed 31 migrations |
| Authentication | 88 | fixation/expiry/revocation/rate limit tested |
| Authorization | 86 | RBAC and tenant membership enforcement; legacy media bypass |
| Tenant Isolation | 62 | strong DB/RAG/API; critical filesystem exception |
| Security | 68 | good defaults/signatures; C-01 and H-02 block release |
| Messaging | 72 | idempotency and adapters tested; external execution unverified |
| Media | 48 | unified path strong; legacy/Cloud path unsafe |
| AI | 80 | robust mocked contracts; real providers unverified |
| RAG | 88 | 98 tests and real restore evidence; live readiness gap |
| Realtime | 84 | session/tenant rooms/shutdown tested |
| Error Handling | 82 | typed/bounded failures; mixed logging and legacy catches |
| Observability | 70 | health/metrics/request IDs; dependency readiness incomplete |
| Performance | 66 | local/load-control evidence; blocking I/O and production scale unknown |
| Testing | 84 | broad meaningful suite; external gaps and one flaky E2E |
| CI/CD | 77 | comprehensive gate; Playwright currently red, audit threshold weak |
| Maintainability | 61 | very large files, duplicated legacy/versioned surface |
| Deployment Readiness | 58 | hardened image/backup; three release blockers and single-replica limits |

## Top 10 Engineering Risks

| # | Severity | File/Component | Evidence / Impact | Root Cause | Recommended Fix | Blocker |
|---:|---|---|---|---|---|:---:|
| 1 | CRITICAL | `/uploads` | authenticated cross-tenant file read | shared legacy static store | tenant-record downloads only | YES |
| 2 | HIGH | WhatsApp Cloud media | unbounded buffer and unchecked file | adapter bypasses unified pipeline | bounded validated tenant storage | YES |
| 3 | HIGH | global parsers | unauthenticated 50 MB allocation | parser scope too broad | route-specific small limits | YES |
| 4 | HIGH | Meta routing | all data uses `default` tenant | no page-to-tenant ownership model | explicit account ownership mapping | Conditional |
| 5 | MEDIUM | `/ready` | Qdrant outage can still report READY | startup-only dependency validation | component readiness/degraded policy | NO |
| 6 | MEDIUM | Playwright/focus | full suite 53/54; isolated 5/5 | polling/re-render focus race | preserve/focus new row after render | NO |
| 7 | MEDIUM | rate limiting | process-local limits multiply/reset | in-memory buckets | shared bounded limiter | NO |
| 8 | MEDIUM | request I/O | synchronous file operations on event loop | synchronous storage design | worker/async streaming where measured | NO |
| 9 | MEDIUM | dependencies | Multer 1 and fluent-ffmpeg deprecation | deferred major upgrades | compatibility-tested upgrades | NO |
| 10 | LOW | module size | API/dashboard/RAG/settings giant files | accumulated feature ownership | incremental boundary extraction | NO |

## Recommended Fix Order

### P0

1. Replace shared `/uploads` authorization with tenant-scoped attachment access and migrate legacy records.
2. Move WhatsApp Cloud inbound media onto the bounded unified media pipeline.
3. Reduce/scoped body parsers and add oversized/concurrent request tests.

### P1

1. Add tenant-owned Meta account/page routing or explicitly disable multi-tenant Meta.
2. Make readiness policy honest about Qdrant and other required dependencies.
3. Stabilize the focus restoration test/product race and restore 54/54 full-suite PASS.

### P2

1. Centralize rate limits for any multi-process deployment.
2. Upgrade Multer and unsupported media dependencies with regression tests.
3. Move measured blocking file paths to bounded streaming/async workers.

### P3

1. Split giant API/frontend modules by ownership boundary.
2. Normalize structured logging and redact/minimize identifiers.
3. Add Firefox/WebKit only if product support is declared.

## Final Recommendation

Do not promote this working tree to production. The minimum release condition is closure of C-01, H-01, and H-02 with explicit two-tenant negative tests, followed by a clean 54/54 Playwright run and a production-equivalent staging exercise for every enabled external channel. Existing green backend/RAG/database evidence should be retained; it is strong but does not compensate for a verified tenant file boundary failure.
