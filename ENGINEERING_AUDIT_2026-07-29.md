# Full Production Engineering Audit — FUThing

**Date:** 2026-07-29  
**Scope:** current repository and running local deployment  
**Decision:** **NO GO**

## 1. Executive Summary

The project contains substantial working functionality: unified messaging, multi-provider WhatsApp support, persistent sessions, SQLite migrations, provider-aware AI routing, a versioned RAG pipeline, tenant-filtered vector operations, reconciliation tooling, Socket.IO authentication, and a broad backend regression suite.

It is not production-ready. The decision is based on defects proven in the current implementation and runtime, not on design expectations:

1. A fresh installation creates a publicly known administrator account (`admin / Admin@123456`).
2. The current runtime has no `SESSION_SECRET` and uses a hard-coded known fallback.
3. Qdrant listens on all interfaces (`0.0.0.0:6333`) without an API key.
4. Stored-XSS sinks remain in the dashboard despite the existing XSS tests passing.
5. The Meta webhook becomes unsigned when `NODE_ENV` and `META_APP_SECRET` are absent; both are absent in the inspected runtime.
6. The customer/channel data model is not tenant-isolated: channel accounts are globally unique by `(channel, external_user_id)`.
7. Several RAG operations in the UI report success without executing a backend operation.
8. Secrets are stored in plaintext in SQLite.
9. Webhooks acknowledge before durable persistence, so a crash can permanently lose an inbound message.
10. There is no complete production deployment, backup/restore, monitoring, or disaster-recovery implementation.

The system is suitable for continued controlled development and single-instance staging only after access is restricted. It must not be exposed as a production SaaS in its current state.

## 2. Audit Method and Evidence

The audit followed actual entry points from `backend/server.js` and the static frontend loaded by `backend/src/app.js`. It inspected reachable CommonJS dependencies, route mounts, repositories, migrations, messaging/RAG flows, frontend sinks, runtime processes, listening ports, and the live SQLite database.

Commands included:

```bash
rg --files
rg -n "router\.(get|post|put|patch|delete)|app\.use|innerHTML|onclick|fetch\(" ...
npm test                           # backend
npm test                           # frontend
npm audit --json                   # root/backend/frontend
ps -eo pid,ppid,stat,etimes,cmd
ss -ltnp
PRAGMA integrity_check
PRAGMA foreign_key_check
PRAGMA journal_mode
```

Observed results:

- 240 project files outside dependency/vendor directories.
- 113 backend JavaScript source files; 108 reachable from the server entry point.
- One circular dependency component in the messaging/WhatsApp graph.
- 86 route declarations/mounts.
- Backend regression suite passed in the current workspace.
- Frontend tests passed: 3/3.
- Dependency audit: 8 High vulnerabilities in the root/backend dependency tree.
- Frontend dependency audit could not run because `frontend/package-lock.json` does not exist.
- SQLite: `integrity_check=ok`, no foreign-key violations, WAL enabled, 21 migrations recorded.
- Runtime: one project Node process and one WhatsApp Chrome tree for tenant `default`.
- Qdrant: listening on all IPv4/IPv6 interfaces at port 6333 without `QDRANT_API_KEY`.
- `NODE_ENV`, `SESSION_SECRET`, Meta secrets, and configured origin variables were absent from the inspected shell environment.

Passing tests were treated as supporting evidence only, never as proof of production readiness.

## 3. Current Architecture

```text
Browser dashboard (static HTML + global JS modules)
        │ REST / Socket.IO
        ▼
Express application
  ├─ session + CSRF + origin policy
  ├─ auth routes
  ├─ legacy /api and versioned /api/v1 (same router)
  ├─ public Meta/WhatsApp webhooks
  ├─ messaging processor
  │    ├─ AI provider routing
  │    ├─ RAG retrieval/validation
  │    └─ channel-specific outgoing service
  ├─ WhatsApp Web / WhatsApp Cloud / Telegram / Meta
  ├─ Socket.IO event publisher
  └─ background key sync and RAG reconciliation scheduler
        │
        ├─ SQLite (business data, sessions, settings, RAG state/leases)
        ├─ Qdrant (vectors)
        ├─ Ollama (local embeddings/models)
        └─ external AI/provider APIs
```

Layering is partial. Repositories are generally separated, but `backend/src/routes/api.js` is approximately 85 KB and mixes HTTP concerns, validation, SQL, provider switching, filesystem operations, and orchestration. The frontend is a 192 KB dashboard document plus large global scripts (`rag.js` approximately 91 KB); it has no module bundling or code splitting.

## 4. Strengths

- SQLite migrations are ordered and applied transactionally (`backend/src/database/initialize.js:24-42`).
- The live database passed integrity and foreign-key checks.
- WAL and a busy timeout are configured.
- Express and Socket.IO use the same origin-policy object.
- Authenticated APIs use session authentication and CSRF protection.
- WhatsApp Cloud has raw-body HMAC verification and timing-safe comparison.
- WhatsApp initialization contains in-process promise sharing and process leases.
- Outgoing WhatsApp routing now carries an explicit tenant and rejects missing WhatsApp tenant IDs.
- RAG document/index activation uses staging, verification, atomic metadata activation, rollback, version-aware cache keys, tenant filters, and distributed leases.
- RAG has bounded runtime controls, reconciliation audit trails, prompt-injection filtering, and evidence-aware answer validation.
- Message external IDs are tenant-scoped after migration 014.
- Backend tests cover many high-risk regression paths, including webhook signatures, tenant routing, Meta delivery failures, RAG atomicity, cache isolation, locks, and answer validation.

## 5. Critical Findings

### C-01 — Known default administrator credentials

**Evidence:** `backend/src/services/adminBootstrap.js:6-16` creates username `admin` with password `Admin@123456` whenever no administrator exists.

**Impact:** immediate administrative takeover of every fresh or reset deployment.

**Required fix:** require an explicit one-time bootstrap secret/password, fail startup if absent in production, force rotation, and remove the known credential from code and tests.

### C-02 — Known hard-coded session signing fallback

**Evidence:** `backend/src/app.js:49-60`, `backend/src/routes/auth.js:85`, and `backend/src/database/repositories/adminRepository.js:42` use `futh_secure_fallback_secret_2026_xxxx`. The inspected runtime has no `SESSION_SECRET`.

**Impact:** attackers who know the source can forge or manipulate session-related signatures.

**Required fix:** validate environment at startup and fail closed outside explicit test mode. Rotate all sessions after deployment.

### C-03 — Unauthenticated network-exposed Qdrant

**Evidence:** runtime `ss` shows `0.0.0.0:6333` and `[::]:6333`; `QDRANT_API_KEY` is absent. `backend/src/rag/vector/qdrantVectorStore.js` adds authentication only when the optional key exists.

**Impact:** vector reading, deletion, replacement, tenant-data disclosure, and denial of service by any network-reachable party.

**Required fix:** bind Qdrant privately, require an API key/TLS or service mesh authentication, restrict firewall rules, and rotate/rebuild vectors if it has ever been exposed.

### C-04 — Stored XSS remains in administrative dashboard

**Evidence:**

- `frontend/public/js/dashboard/settings.js:12-32` places arbitrary `message` into `toast.innerHTML`.
- `frontend/public/js/dashboard/apiKeys.js:112-168` inserts `key.errorMessage` into HTML and assigns it through `innerHTML`.
- `frontend/public/js/dashboard/settings.js:1039-1053` places database/API values inside inline JavaScript attributes.
- Similar HTML-template rendering remains in `frontend/public/js/dashboard/rag.js`.

Provider errors, filenames, database fields, and API responses are untrusted. HTML escaping, where present, does not make a value safe inside a JavaScript attribute.

**Impact:** malicious data can execute in the administrator origin and steal the session token stored in browser storage or perform privileged requests.

**Required fix:** render untrusted data with `textContent`/DOM nodes and bind events with `addEventListener`; add a restrictive CSP after removing inline handlers.

### C-05 — Meta webhook authentication fails open in current runtime mode

**Evidence:** `backend/src/routes/webhooks.js:20-31` bypasses signature validation when `META_APP_SECRET` is absent unless `NODE_ENV === 'production'`. Both variables are absent in the inspected runtime. The verify token also falls back to `my_secure_token` at line 117.

**Impact:** forged Messenger/Instagram events can invoke AI processing and outbound behavior.

**Required fix:** signature verification must default to enabled and fail closed; disabling must require an explicit development-only flag. Remove the default verify token.

## 6. High Findings

### H-01 — Customer identity is globally shared across tenants

`backend/src/database/migrations/001_initial_schema.sql:16-28` defines `channel_accounts` without `tenant_id` and globally enforces `UNIQUE(channel, external_user_id)`. `customerRepository.registerCustomerUser()` finds the channel account globally, then creates tenant-specific conversations around the same customer/account (`backend/src/database/repositories/customerRepository.js:4-67`).

This lets two tenants share identity/profile mutations and prevents the same WhatsApp account from being independently represented per tenant. `listCustomerUsers()` is also unscoped (`customerRepository.js:131-148`).

**SaaS impact:** hard isolation is not achievable with the current customer/account schema.

### H-02 — No role-based authorization

`requireAuth` establishes only an authenticated administrator. Configuration, API keys, RAG cleanup, WhatsApp switching, errors, and messaging operations are available to every administrator. The administrators table has no enforced permission or tenant-membership model.

### H-03 — Secrets are plaintext at rest

`api_keys.api_key`, global `settings.value`, and `whatsapp_tenant_configs.config_json` store provider keys, access tokens, and webhook secrets as plaintext. Database/file backup compromise exposes all integrations.

### H-04 — Webhook acknowledgement is not durable

`backend/src/routes/webhooks.js:134-162` and `:194-206` return HTTP 200 before message processing. There is no durable inbox/queue transaction before acknowledgement. A crash or processing failure loses the event permanently, and retries cannot reconstruct it.

### H-05 — Meta batch events are dropped

`backend/src/routes/webhooks.js:140-143` handles only `entry.messaging[0]`. All later events in a Meta batch are ignored.

### H-06 — False-success RAG administration actions

`frontend/public/js/dashboard/rag.js:788-793` binds optimization, validation, backup, and synchronization buttons to `triggerOperation()`. At `rag.js:1509`, that function only shows a success toast and writes a local timeline entry. No API is called.

**Impact:** operators believe backup/integrity/optimization completed when nothing happened.

### H-07 — Manual media reply does not upload the file

`frontend/public/js/dashboard/composer.js:149-153` fabricates `https://futh-storage.com/media/<filename>` and sends it as the message. The selected file is never uploaded.

### H-08 — Unsafe process survival after fatal exceptions

`backend/server.js:55-61` logs `uncaughtException` and `unhandledRejection` but keeps the process alive. Node state may be inconsistent after an uncaught exception.

### H-09 — Shutdown does not first stop accepting traffic

`backend/server.js:65-108` drains RAG and closes providers/database but never calls `httpServer.close()` or closes Socket.IO before database shutdown. New work can arrive during teardown.

### H-10 — Eight High dependency vulnerabilities

`npm audit` reports eight High issues through `whatsapp-web.js`/`archiver`/`glob`/`minimatch`/`brace-expansion`. The reported fix implies a compatibility-affecting version change and therefore needs regression testing, not blind installation.

### H-11 — Session ID accepted through URLs

`backend/src/app.js:64-69` and `backend/src/realtime/socketServer.js:31-39` accept `sessionId` in the query string. URLs leak into history, diagnostics, proxies, screenshots, and referrers. The code then synthesizes the session cookie.

### H-12 — Public uploaded customer media

`backend/src/app.js:96-97` exposes the entire uploads directory without authentication, tenant checks, signed URLs, or retention enforcement.

### H-13 — Production environment validation is incomplete

The running process was started without `NODE_ENV`, origin variables, session secret, or webhook secrets. Some components silently choose development/fallback behavior, so a deployment can appear healthy while security is disabled.

## 7. Medium Findings

1. **M-01: Monolithic API layer.** `backend/src/routes/api.js` mixes routing, persistence, provider lifecycle, files, and RAG orchestration, increasing regression and transaction-boundary risk.
2. **M-02: Duplicate API surfaces.** `backend/src/app.js:133-140` mounts the same routers under `/api` and `/api/v1`; authorization fixes must be maintained and tested twice.
3. **M-03: Incomplete readiness.** `/ready` checks only `SELECT 1` (`app.js:110-121`), not Qdrant, required secrets, writable storage, leases, or configured providers.
4. **M-04: Global 50 MB parsers.** `app.js:78-85` buffers large request bodies for every JSON/form route and captures a second raw-body reference. Route-specific limits are required.
5. **M-05: Media downloads are unbounded.** Webhook code buffers remote media with no explicit response-size limit, MIME verification, streaming limit, or end-to-end timeout.
6. **M-06: Cookie policy is environment-insensitive.** `SameSite=None; Secure` is hard-coded (`app.js:55-60`), causing HTTP-local behavior problems and hiding deployment assumptions.
7. **M-07: Missing modern headers.** There is no enforced CSP/HSTS/Permissions-Policy/COOP/CORP. Inline events and CDN scripts currently prevent a strong CSP.
8. **M-08: No session revocation after password change.** Existing sessions remain usable after credential rotation.
9. **M-09: Synchronous CPU work.** `bcrypt.hashSync` and several synchronous filesystem/database operations execute on the Node event loop.
10. **M-10: No API-wide request cancellation.** Many frontend fetches and external-provider paths have no caller timeout/AbortSignal.
11. **M-11: Missing status constraints.** SQLite does not enforce CHECK constraints for message direction/status, delivery state, booleans, non-negative counts/costs, or RAG state machines.
12. **M-12: Nullable RAG ownership remnants.** `retrieval_analytics.tenant_id` and `rag_injection_quarantine.tenant_id` permit unowned rows. Migration tooling exists, but schema-level prevention is incomplete.
13. **M-13: Global AI configuration.** `ai_task_configs`, API keys, settings, and provider balance cache are not tenant-scoped.
14. **M-14: Provider cache is not key/tenant scoped.** Balance cache is provider-scoped, which fixes cross-provider reuse but does not isolate multiple keys or tenants.
15. **M-15: Operational tables are global.** Activity logs and application errors have no tenant/actor ownership and limited indexing.
16. **M-16: No down migrations.** Forward migrations are transactional, but there is no automated rollback strategy.
17. **M-17: False database startup wording.** AI-task initialization errors are caught (`initialize.js:51-57`), yet line 59 says the database is fully initialized.
18. **M-18: RAG source/index can diverge.** Manual knowledge text is persisted before a separate reindex call. A reindex failure keeps the old active vectors while the source contains new text.
19. **M-19: RAG deletion filter mismatch risk.** `deleteVectorsByDocument()` filters only payload `documentId` (`qdrantVectorStore.js:489-519`), while versioned points also use logical/version identifiers. Some cleanup paths pass document keys and others version IDs. Cleanup correctness depends on the precise payload variant and lacks a single canonical delete contract.
20. **M-20: Reconciliation cleanup is not automatic by default.** Safe dry-run behavior is good, but orphans persist until an operator enables and executes cleanup.
21. **M-21: Legacy global retrieval telemetry remains.** Request-scoped telemetry is used in the repaired path, but global “last retrieval” getters remain exported and are unsafe if reused concurrently.
22. **M-22: Synthetic pipeline sub-timings.** Some RAG timing fields are derived by percentages rather than measured stage boundaries, making bottleneck reports misleading.
23. **M-23: No real retrieval-quality benchmark.** Tests validate contracts and selected fixtures, not recall/precision/grounded-answer quality against a versioned production corpus.
24. **M-24: Frontend has no build artifact discipline.** `npm run build` only prints “Build complete”; Tailwind is loaded from its CDN runtime and scripts have no bundling/minification/code splitting.
25. **M-25: CDN supply-chain exposure.** Browser libraries are loaded remotely without Subresource Integrity, while CSP is absent.
26. **M-26: Frontend session copy in local storage.** XSS can extract the session credential; HttpOnly cookie protection is bypassed by the iframe compatibility design.
27. **M-27: Static dashboard is served before page-level auth.** APIs remain protected, but the application shell and implementation are available at `/dashboard`.
28. **M-28: No pagination on several list endpoints.** Users, errors, documents, and operational views can grow into large synchronous responses or queries.

## 8. Low Findings

- `backend/src/rag/indexing/contentHasher.js`, `backend/src/rag/services/rerankingService.js`, `backend/src/realtime/socketAuth.js`, `backend/src/services/userService.js`, and `backend/src/state/botData.js` are unreachable from the server entry graph.
- `OpenRouterService` is imported by `backend/src/services/ai.js` but provider generation uses `aiProviders`; the class is legacy/duplicated.
- A circular dependency spans `WhatsAppWebProvider`, `WhatsAppProviderManager`, Telegram, `outgoingMessageService`, and `messageProcessor`.
- Root and backend duplicate dependency manifests; the frontend also has a second static server even though the backend serves the same assets.
- Frontend has no lockfile, so installs are not reproducible.
- A zombie Node process was visible in the host process list; it was not the active project server but indicates process supervision hygiene should be reviewed.
- The application still triggers Node's deprecated `punycode` warning through dependencies.
- Health responses expose uptime and readiness errors expose raw error messages.
- Naming/logging still labels the AI latency stage “OpenRouter API” in provider-agnostic paths, producing misleading Gemini diagnostics.

## 9. Database Assessment

### Verified good

- All 21 migrations are recorded.
- Integrity check is `ok`.
- Foreign-key check returned no rows.
- Foreign keys are enabled and WAL is active.
- Core message and RAG indexes exist, including tenant-scoped message external IDs and active-version partial indexes.
- RAG metadata activation uses database transactions.

### Defects

- Tenant ownership is absent from the customer/channel-account root model.
- Secrets are plaintext.
- Business state constraints are mostly application-only.
- Several SaaS resources are global rather than tenant-scoped.
- No tested backup/restore procedure exists.
- SQLite plus local files and process-local services limit horizontal scaling to a single writer host unless storage/coordination architecture is changed.

The live database is internally consistent; that does not make its schema SaaS-safe.

## 10. RAG Assessment

### Actual flow

```text
Upload/manual source
→ extraction
→ prompt-injection scan
→ chunking
→ embedding with timeout/concurrency controls
→ temporary/versioned Qdrant upload
→ vector verification
→ transactional metadata activation
→ selective cache version invalidation
→ old-version cleanup/reconciliation

Question
→ tenant/config-aware cache key
→ planner/decomposition
→ vector + keyword retrieval
→ fusion/reranking
→ context optimization/prompt building
→ provider generation
→ claim/evidence validation
→ fallback policy
```

### Remaining production risks

- Public unauthenticated Qdrant is the dominant risk.
- Source/index divergence is visible after failed manual reindex.
- Cleanup contracts are not fully canonical.
- Automatic reconciliation is disabled by default.
- Readiness does not verify the RAG dependency graph.
- No production corpus quality gate or real capacity result exists.
- The answer validator is deterministic-first and materially better than number-only validation, but semantic paraphrases, nuanced contradiction, multilingual claims, and adversarial documents can still require an LLM verifier or stronger NLI model.
- Prompt-injection detection is heuristic and must be treated as defense-in-depth, not a security boundary.

## 11. API Assessment

- Versioning exists, but the full legacy API remains active indefinitely.
- Authentication and CSRF are consistently mounted for the main API routers.
- Validation is endpoint-specific rather than schema/DTO-driven and is inconsistent across the 85 KB router.
- Error bodies and status codes are not governed by a stable error-code contract.
- Pagination, filtering, and idempotency are incomplete.
- Webhook idempotency/durable inbox behavior is missing.
- Destructive RAG operations are rate-limited and leased, which is a strong foundation.
- No OpenAPI/contract artifact proves backward compatibility.

## 12. Frontend Assessment

The frontend is a global-object/static-script application rather than a component architecture. All dashboard modules are loaded on initial page load. It has working channel-specific chat styling and broad administrative controls, but:

- stored-XSS sinks remain;
- inline handlers are widespread;
- no CSP-compatible rendering model exists;
- no code splitting or lazy loading exists;
- fake RAG operational success and fake media URLs are functional defects;
- request timeout/cancellation and stale-view coordination are incomplete;
- accessibility is not systematically tested;
- external CDN dependencies are not pinned with SRI;
- frontend tests inspect a selected set of files and miss current vulnerabilities.

## 13. Test Assessment

### What is genuinely covered

- SQLite repository behavior and migrations.
- Authentication and origin policy.
- Socket authentication/events.
- WhatsApp signature verification and tenant routing.
- Meta outgoing delivery result states.
- RAG cache/versioning/atomic replacement/locks/reconciliation/fallback/validator.
- AI task/provider routing and selected model pipelines.
- Selected frontend XSS-safe renderers and channel themes.

### Missing or insufficient

- Browser E2E for login, dashboard, uploads, manual media, provider switching, and WebSocket reconnection.
- Tests for `settings.showToast`, API-key error rendering, RAG inline handlers, and the full frontend sink inventory.
- Authorization/RBAC tests because RBAC does not exist.
- Durable webhook crash/replay tests.
- Real Meta/WhatsApp/Ollama/OpenRouter integration gates in CI.
- Restore-from-backup and disaster-recovery tests.
- Coverage measurement and minimum thresholds.
- Production dataset relevance benchmarks.
- Multi-process/multi-host tenant isolation under load.
- Long-duration memory/leak tests with real Chrome and Qdrant.
- Dependency/security scanning in CI.

The GitHub workflow runs a RAG smoke suite. Its scheduled “stress gate” only syntax-checks scripts/configuration and explicitly says the real external stress environment is unavailable; it is not a stress-test result.

## 14. Performance Assessment

Main bottlenecks and scaling limits:

- single Node event loop with synchronous bcrypt/filesystem/SQLite operations;
- global 50 MB request buffering and in-memory Multer uploads;
- remote media fully buffered in memory;
- large unpaginated administrative responses;
- all frontend dashboard code loaded eagerly;
- SQLite single-writer behavior;
- one local Chrome tree per WhatsApp Web tenant, creating significant memory/CPU growth;
- no connection/load shedding policy around external providers;
- duplicate API/cache refresh requests are possible from the global frontend lifecycle;
- no evidence-backed maximum tenant/message/document capacity.

RAG batching, cancellation, bounded concurrency, and provider timeouts are positive controls, but capacity remains unproven.

## 15. DevOps Assessment

- A limited GitHub Actions RAG workflow exists.
- No complete Docker/Compose/Kubernetes/systemd/PM2 production definition was found.
- No immutable build exists; the build script is a placeholder.
- No startup-wide environment schema enforces production secrets.
- No central metrics exporter, distributed tracing, alert thresholds, or log rotation is implemented.
- No automated encrypted backup, restore verification, retention, or disaster-recovery runbook exists.
- Readiness is incomplete.
- Graceful shutdown ordering is unsafe for new incoming traffic.
- Qdrant network exposure is unsafe.
- There is no proven rolling/zero-downtime deployment strategy.

## 16. SaaS Readiness

| Area | Assessment |
|---|---|
| Message tenant routing | Improved, explicit for WhatsApp outgoing |
| Customer/account isolation | **Not safe** — global channel account identity |
| Knowledge/vector isolation | Stronger tenant filters/versioning, but exposed Qdrant |
| Cache isolation | Tenant/provider/config aware for RAG; provider balance not tenant/key aware |
| Configuration isolation | Mostly global |
| Permissions | No RBAC or tenant membership |
| Billing/plans | Usage records exist; subscriptions/plans/entitlements do not |
| Storage isolation | Local shared paths and public uploads |
| API isolation | Admin-wide, not tenant/role scoped |
| Scaling | Single-host design; no production orchestration |
| Database | Consistent, but schema is not multi-tenant complete |

**SaaS readiness estimate: 35/100.** The project has tenant-aware foundations in messaging and RAG, but the identity/config/security/control-plane layers are not yet SaaS-isolated.

## 17. Prioritized Remediation Plan

### Phase 0 — Immediate containment (before any public deployment)

1. Remove known admin credentials and require explicit secure bootstrap.
2. Require and rotate `SESSION_SECRET`; invalidate existing sessions.
3. Bind/authenticate Qdrant and firewall it.
4. Fail closed for all webhook signatures and remove default tokens.
5. Restrict the deployment to trusted networks until Stored XSS is removed.
6. Protect uploaded media and rotate exposed provider secrets.

### Phase 1 — Critical correctness and isolation

1. Add tenant ownership to customers/channel accounts and migrate uniqueness to `(tenant_id, channel, external_user_id)`.
2. Add RBAC and tenant membership at the API/repository boundaries.
3. Replace all untrusted HTML/template/inline-event rendering with safe DOM construction.
4. Introduce a durable webhook inbox with idempotency and process every event in a batch.
5. Remove fake operational success and implement or disable those buttons.
6. Implement real media upload/send.
7. Encrypt provider credentials at rest with an external master key.

### Phase 2 — Reliability and database enforcement

1. Stop HTTP/Socket acceptance first during graceful shutdown.
2. Exit cleanly after fatal process errors under a supervisor.
3. Add environment schema validation and full dependency readiness.
4. Add CHECK/UNIQUE/FK constraints and tenant scope to operational/config tables.
5. Canonicalize RAG deletion and make source/index state explicit.
6. Add route-specific body limits, streaming media limits, timeouts, and cancellation.
7. Add pagination and stable API error codes.

### Phase 3 — Delivery, observability, and proof

1. Create an immutable production build and lock all dependency trees.
2. Remediate dependency advisories with WhatsApp regression testing.
3. Add CI security scanning, coverage, browser E2E, and real disposable integration environments.
4. Implement metrics/tracing/alerts and remove synthetic timings.
5. Implement encrypted backups, automated restore drills, and disaster-recovery objectives.
6. Run real load/endurance/failure tests and record capacity/SLO results.
7. Add a versioned RAG evaluation corpus with grounding, recall, latency, and injection-resistance gates.

## 18. Final Decision

# NO GO

The project must not be approved for production or public SaaS deployment in the audited state. The blocker is not architectural style; it is the combination of immediately exploitable defaults, exposed vector storage, fail-open webhook behavior, stored XSS, incomplete tenant isolation, plaintext secrets, false-success operations, and absent recovery/deployment proof.

A **CONDITIONAL GO** can be reconsidered after all Critical findings and H-01 through H-06, H-08, H-09, H-11, and H-12 are fixed and independently verified in a production-like environment. A full **GO** additionally requires tested backup/restore, observability, dependency remediation, real integration/load results, and complete tenant/RBAC isolation.

