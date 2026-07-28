# RAG Platform Production-Readiness Audit

Audit date: 2026-07-29  
Decision: **NO-GO**  
Scope: RAG upload, indexing, replacement, deletion, retrieval, generation, validation, reconciliation, caches, tenant routing, security, operations, and the currently running local stack.

## 1. Executive summary

The RAG implementation contains substantial safety work: versioned staging and activation, tenant-filtered retrieval, process-safe SQLite leases, bounded embedding/vector batches, request cancellation, version-aware retrieval caching, reconciliation logic, prompt-injection filtering, and evidence-aware answer validation. The configured automated test command completed successfully, and the current SQLite state has no duplicate active versions or unfinished active documents.

It is nevertheless not production-ready. Two directly observed critical blockers are enough to stop release:

1. `knowledge.txt` falls back to one shared filesystem path when `RAG_TENANT_KNOWLEDGE_DIR` is absent. That variable is absent in the audited environment. Tenant-scoped routes can therefore read, replace, reindex, or clear the same underlying source.
2. Qdrant listens on all interfaces and accepts unauthenticated requests. `QDRANT_API_KEY` is absent. Anyone with network reachability can bypass application authentication, tenant filters, locks, and audit controls.

Release is also blocked by an incomplete readiness probe, missing production configuration, no verified coherent backup/restore, no real crash-recovery drill, no rollback drill, no measured production load envelope, no deployment specification, and missing abuse controls on expensive RAG operations.

## 2. Final decision

**NO-GO**

This decision follows the required strict rules, not an averaged score:

- unresolved CRITICAL security and tenant-isolation defects;
- real backup restore has not been demonstrated;
- the mandatory crash/reconciliation drill has not been demonstrated;
- production performance thresholds have not been measured against the actual server and actual dependencies;
- deployment and operational ownership evidence is absent.

A production launch, production-data migration, or multi-tenant exposure must not proceed until every P0/P1 remediation below is completed and independently re-tested.

## 3. Release-blocking findings

### RAG-PR-001 — Shared manual knowledge source across tenants

- Severity: **CRITICAL**
- Evidence: `getManualKnowledgePath()` in `backend/src/routes/api.js` returns `backend/knowledge.txt` unless `RAG_TENANT_KNOWLEDGE_DIR` is configured. The audited environment does not define it. `/config/knowledge`, manual preview/download, reindex, and manual delete consume this path.
- Impact: a tenant can overwrite, index, download, or erase knowledge intended for another tenant. Cache and vector filters cannot repair source-level cross-tenant corruption.
- Required fix: tenant storage must be mandatory and derived from a canonical authenticated tenant ID. Production startup must fail if the tenant root is missing or unsafe. Existing global data needs an explicit one-time migration.

### RAG-PR-002 — Qdrant exposed without authentication

- Severity: **CRITICAL**
- Evidence: Qdrant listens on `0.0.0.0:6333` and `[::]:6333`; `QDRANT_API_KEY` is absent; unauthenticated `/readyz`, root version, collection metadata, and filtered count requests returned successfully.
- Impact: direct vector read/write/delete bypasses Express authentication, CSRF, tenant filters, distributed leases, reconciliation policy, and application audit events.
- Required fix: bind Qdrant to a private interface/network, require an API key or mTLS, block public ingress, rotate credentials, and verify denial from an untrusted network segment.

### RAG-PR-003 — Production mode and mandatory secrets are not enforced

- Severity: **HIGH**
- Evidence: `NODE_ENV` and `SESSION_SECRET` are absent. `backend/src/app.js` and `backend/src/routes/auth.js` use the known literal fallback `futh_secure_fallback_secret_2026_xxxx`.
- Impact: production-only safeguards are not activated and signed session material relies on a public fallback. Query-string session transport also risks session leakage through URLs and logs.
- Required fix: fail startup in production without a high-entropy secret; remove the fallback outside tests; remove `sessionId` query transport and retain a secure cookie/header mechanism only.

### RAG-PR-004 — Readiness reports healthy while required RAG dependencies may be unusable

- Severity: **HIGH**
- Evidence: `/ready` checks only `SELECT 1` in SQLite and returned `READY`. It does not verify Qdrant, the lock backend, storage writability, migration state, configured embedding service, or mandatory provider readiness.
- Impact: an orchestrator can send traffic to an instance that cannot safely index or retrieve.
- Required fix: keep `/health` as liveness and make `/ready` fail closed on mandatory dependencies, with bounded per-check timeouts and dependency-specific status.

### RAG-PR-005 — Backup, restore, crash recovery, rollback, and capacity are not proven

- Severity: **HIGH**
- Evidence: no coherent SQLite + source files + Qdrant snapshot runbook or successful restore record was found. No real SIGKILL during partial upload drill, deployment rollback drill, 24-hour soak, or actual-server 10–1000 concurrency result was supplied or safely reproducible against the user’s current data.
- Impact: recovery point, recovery time, stale staging cleanup, and real capacity are unknown.
- Required fix: execute the drills in an isolated production-like environment and preserve timestamps, commands, checksums, counts, and logs.

### RAG-PR-006 — Deployment topology is undefined

- Severity: **HIGH**
- Evidence: no Docker, Compose, Kubernetes, PM2, systemd, Nginx, or equivalent production deployment definition was found. The configured lock provider is SQLite.
- Impact: resource limits, non-root execution, TLS boundaries, persistent volumes, restart behavior, replica topology, and upgrade ordering are unspecified. SQLite leases do not coordinate separate database files on multiple hosts.
- Required fix: publish and test one supported topology. Until a genuinely shared lock backend exists, constrain RAG mutation workers to a single host/shared local SQLite database and reject unsupported multi-host deployments.

### RAG-PR-007 — Expensive RAG routes lack production abuse controls

- Severity: **HIGH**
- Evidence: login and reindex have focused limiting, but upload, playground/generation, diagnostics, and several mutation/provider test paths do not have tenant-aware distributed rate limits or quotas. Global JSON input permits 50 MB.
- Impact: an authenticated or compromised account can exhaust CPU, memory, embedding/provider quota, Qdrant, or SQLite.
- Required fix: tenant/user quotas, bounded queues, route-specific body limits, concurrent-job limits, and cost budgets with auditable rejection responses.

## 4. Readiness-gate scorecard

| Gate | Status | Evidence and reason |
|---|---|---|
| G1 Security | **FAIL** | Unauthenticated network-visible Qdrant; known session-secret fallback; query-string session transport. |
| G2 Tenant isolation | **FAIL** | Shared `knowledge.txt` fallback is active in the audited environment. |
| G3 Authentication/authorization | **PASS_WITH_RISK** | API routes require session + CSRF and RAG tenant middleware; no granular RBAC and session ID can be transported in a query. |
| G4 Data integrity | **PASS_WITH_RISK** | Version/active uniqueness exists and current invariants are clean; manual-source isolation and direct state updates remain risks. |
| G5 Indexing correctness | **PASS_WITH_RISK** | Staging, verification, activation, cleanup, cancellation, and tests exist; real crash drill is missing. |
| G6 Retrieval correctness | **PASS_WITH_RISK** | Tenant/version filters and version-aware cache keys exist; production relevance benchmarks are absent. |
| G7 Answer grounding | **PASS_WITH_RISK** | Claim/evidence validation and no-context rejection are tested; semantic calibration on a production corpus is absent. |
| G8 Prompt injection resistance | **PASS_WITH_RISK** | Injection filtering, boundary prompts, and regression tests exist; novel/adversarial corpus red-team is not demonstrated. |
| G9 Failure handling | **PASS_WITH_RISK** | Timeouts, retries, cancellation, false-success assertions exist; not all parser/provider failure modes were exercised live. |
| G10 Concurrency/locking | **PASS_WITH_RISK** | Real two-process SQLite lease contention tests pass; unsupported for independent multi-host SQLite files. |
| G11 Recovery/reconciliation | **FAIL** | Code and tests exist, but the mandatory real process-kill recovery drill was not executed. |
| G12 Performance/scalability | **NOT_VERIFIED** | Harness tests pass; no real production dependency load, saturation curve, or endurance result. |
| G13 Observability/metrics | **FAIL** | Process-local metrics are labeled, but readiness is misleading; no cluster metrics, trace IDs, alerts, or SLO evidence. |
| G14 Configuration/secrets | **FAIL** | `NODE_ENV`, `SESSION_SECRET`, tenant knowledge root, and Qdrant API key are missing. |
| G15 Deployment/infrastructure | **FAIL** | No tested deployment definition; Qdrant network exposure and replica model are unsafe/undefined. |
| G16 Backup/restore | **FAIL** | No successful, coherent restore proof or RPO/RTO. |
| G17 Operational readiness | **FAIL** | Missing runbooks, alert routing, ownership, rollback proof, and incident exercise. |
| G18 Test/release confidence | **PASS_WITH_RISK** | Configured automated tests pass, but critical live gates and adversarial production-like drills are absent. |

## 5. Architecture and trust boundaries

### Indexing path

Authenticated dashboard/API → session and CSRF → canonical RAG tenant middleware → upload/body validation → source storage/extraction → chunking → injection scan → embedding provider → staging Qdrant vectors → vector verification → SQLite active-version transaction → version-aware cache invalidation → old-version cleanup/reconciliation.

### Retrieval path

Authenticated request/message pipeline → tenant resolution → input validation → version-aware cache → query embedding → Qdrant search with tenant/lifecycle/version filters → injection filtering → optional reranking → bounded context → provider generation → claim/evidence validation → secret scan → response and runtime metrics.

### Primary trust boundaries

- Browser to Express/Socket.IO.
- Express session identity to tenant selection.
- Untrusted uploaded/retrieved document content to prompt construction.
- Node to SQLite, filesystem, Ollama/provider APIs, and Qdrant.
- Process-local caches/metrics to multi-process or multi-host deployment.
- Backup operator and deployment operator to persistent data.

The most serious boundary failure is that Qdrant is reachable outside the application’s trust boundary. The second is that tenant-scoped manual data becomes global at the filesystem boundary.

## 6. Security findings

- API and versioned API routers are protected by authentication and CSRF middleware.
- Prompt documents are treated as untrusted and filtered before use.
- Upload filenames reject traversal patterns and executable extensions; PDF and DOCX magic checks are present.
- Qdrant authentication/network isolation is absent (**CRITICAL**).
- A known session-secret fallback remains active (**HIGH**).
- Accepting signed session IDs in a URL query can leak credentials in history, access logs, screenshots, and referrers (**HIGH**).
- Parsed PDF/DOCX work lacks explicit worker isolation and archive-bomb/parser time and memory ceilings (**MEDIUM/HIGH**).
- `npm audit --omit=dev` reported eight high-severity dependency findings, primarily through `whatsapp-web.js` → `archiver`/glob/minimatch/brace-expansion. Exploit reachability in RAG was not proven, but the packages share the backend process and require triage before release.
- No committed credential-looking assignment was identified by the scoped secret-pattern scan, excluding databases, dependencies, and Git internals.

## 7. Tenant-isolation findings

Retrieval and indexed-document code generally require `tenantId`, place it in Qdrant payloads, filter Qdrant searches, and reject mismatched payload tenants. Database uniqueness keys are tenant-scoped, and tenant/cache regression tests pass.

The manual knowledge path breaks that model. With the current missing environment variable, every tenant maps to the same source file. `/stats` also reads the global source directly. This invalidates any claim of strict end-to-end tenant isolation. The acceptance criterion “tenant A data cannot be observed or mutated by tenant B” is not met.

## 8. Data-integrity findings

Observed SQLite invariants:

| Check | Result |
|---|---:|
| Duplicate active uploaded-document versions | 0 |
| Duplicate active manual-knowledge versions | 0 |
| Documents with null tenant | 0 |
| Unverified documents marked active | 0 |
| Incomplete active uploaded documents | 0 |
| Incomplete active knowledge versions | 0 |
| Active operation locks | 0 |
| Stale running operations | 0 |

SQLite uses WAL, foreign keys, and a 5000 ms busy timeout. Partial unique indexes protect one active version per tenant/logical document. Current default-tenant active chunk count is one in both SQLite and a tenant-filtered Qdrant count.

Risks:

- Qdrant contains three physical points while only one belongs to the verified active default-tenant view. The other points may be legitimate other lifecycle/tenant data or orphans; no destructive reconciliation was authorized, so their ownership was not assumed.
- Status validity is primarily enforced by application code rather than comprehensive database `CHECK` constraints.
- Manual delete calls deletion for `knowledge.txt`; versioned document identifiers and cleanup semantics require a focused regression proof across historical versions.
- Direct unauthenticated Qdrant access can invalidate all application-level invariants.

## 9. Indexing and retrieval findings

Positive evidence:

- versioned staging before activation;
- post-upload vector verification;
- SQLite activation transaction and partial uniqueness;
- old-version cleanup after activation;
- selective, tenant/collection/version-aware cache invalidation;
- retrieval key includes tenant, collection, index version, embedding model, reranker, weights, `topK`, threshold, mode, and normalized query;
- Qdrant retrieval enforces tenant and lifecycle/version conditions;
- bounded candidates, chunks, embedding batches, and upload batches;
- retry/cancellation and false-success tests pass.

Remaining risks:

- no real crash during a partially accepted Qdrant upload;
- no production relevance set measuring recall@K, precision, answer correctness, or reranker regression;
- manual source path is not tenant-safe;
- model/provider health may not influence readiness;
- synchronous filesystem operations and document parsing can block the Node event loop.

## 10. Failure and recovery findings

The codebase has leases, heartbeats, stale-operation detection, lifecycle cleanup, reconciliation, and fault-injection tests. A real two-process lock test gives useful same-host evidence.

This is not a substitute for the required recovery drill. The following has not been evidenced end to end with the real server and Qdrant: partial staging upload → SIGKILL → lease expiry → restart → stale-operation detection → reconciliation → preservation of old active version → staging cleanup → successful retry → exactly one active version.

No tested rollback procedure exists for application/schema incompatibility. Forward-only migration capability is not deployment rollback proof.

## 11. Performance findings

The supplied load framework and smoke tests pass and are valuable for repeatability. They establish that the harness functions, not that the production platform meets capacity requirements.

Not verified:

- actual server concurrency from 10 through 1000;
- p50/p95/p99 indexing and retrieval latency against real Ollama/Qdrant/provider dependencies;
- maximum safe queue depth and overload rejection behavior;
- CPU, RSS, event-loop lag, SQLite lock time, Qdrant saturation, and provider quota at the knee;
- long-duration soak, memory leak, and recovery after dependency flapping;
- a documented per-tenant capacity and cost envelope.

Until measured, no production throughput or latency claim is valid.

## 12. Observability findings

- RAG operations emit useful component logs and some duration/count metrics.
- Runtime/cache metrics are explicitly identified as process-local, which avoids falsely presenting them as cluster totals.
- Logs are mostly free-form and do not consistently carry a request/trace ID across API, lock, indexing, Qdrant, generation, and validation.
- `/ready` is materially incomplete.
- No Prometheus/OpenTelemetry export, durable operation dashboard, alert definitions, paging route, SLO, or alert owner was found.
- Prompt/context debug responses are available to authenticated dashboard users; without granular roles this should be treated as privileged sensitive-data access.
- Error persistence and client responses need a uniform redaction/error-code policy; raw internal `err.message` is still returned in several APIs.

## 13. Deployment findings

No production deployment manifest or runbook was found. Consequently, these properties are not verified:

- non-root execution and filesystem permissions;
- TLS termination and trusted-proxy allowlist;
- CPU/memory/PID/file-descriptor limits;
- persistent volumes for SQLite, sources, WhatsApp sessions, and Qdrant;
- Qdrant private networking and authentication;
- graceful termination budget and readiness removal;
- migration ordering and one-shot jobs;
- replica count and lock topology;
- log rotation and retention;
- application and data rollback.

SQLite is acceptable only for a deliberately constrained topology with local durable storage, one shared database file for all coordinating processes, tested backups, and controlled write concurrency. It is not a multi-host distributed lock backend.

## 14. Backup and restore findings

No evidence demonstrates a point-in-time-consistent backup across:

1. SQLite metadata and operation state;
2. tenant source files;
3. Qdrant collections/snapshots;
4. required configuration and model/version metadata.

No restored environment was started and reconciled, and no RPO/RTO was measured. Backup existence without a successful isolated restore does not pass G16.

## 15. Operational-readiness findings

Missing or unverified:

- named service owner and backup owner;
- 24×7 incident route and severity policy;
- runbooks for Qdrant outage, Ollama/provider outage, SQLite corruption/lock contention, orphan growth, stuck lease, restore, tenant leakage, and key rotation;
- actionable alerts with thresholds and suppression;
- capacity/quota budgets and exhaustion responses;
- maintenance window and migration procedure;
- rollback authority and go/no-go approvers;
- privacy retention/deletion policy for source text, vectors, prompts, and logs.

## 16. Test evidence

Commands and checks executed during this audit included:

```text
npm test
npm run test:rag:resilience
npm audit --omit=dev --json
ss -ltnp
curl HTTP probes to application /health and /ready
curl HTTP probes to Qdrant /readyz, root, collection metadata, and filtered counts
SQLite read-only schema, pragma, and invariant queries
source searches for routes, tenant resolution, cache keys, locks, timeouts,
rate limits, upload validation, deployment files, backups, secrets, and error handling
```

Results:

- configured `npm test`: exit 0;
- RAG resilience suite: **97 passed, 0 failed, 0 skipped**;
- load-framework tests: **9 passed, 0 failed**;
- current SQLite invariants listed in section 8: all zero violations;
- application `/health`: HTTP 200;
- application `/ready`: HTTP 200, but only SQLite-backed and therefore not sufficient;
- Qdrant: live, collection green, unauthenticated access successful;
- Qdrant collection: 3 physical points; filtered default-tenant active count: 1;
- SQLite expected active default-tenant chunks: 1;
- dependency audit: 8 high, 0 critical.

Limits of this evidence:

- many integration tests use doubles/fault simulators;
- no destructive test was run against the user’s current database or vectors;
- no real message/provider generation was required for this audit;
- no restore, SIGKILL recovery, rollback, high-concurrency, or endurance exercise was completed;
- passing automated tests do not override failed production gates.

## 17. Risk register

| ID | Severity | Likelihood | Impact | Owner | Status |
|---|---|---|---|---|---|
| RAG-PR-001 shared manual source | Critical | High | Cross-tenant disclosure/destruction | Backend + Security | Open |
| RAG-PR-002 open Qdrant | Critical | High where reachable | Full vector compromise | Platform + Security | Open |
| RAG-PR-003 weak/missing prod secrets | High | Medium | Session/config compromise | Platform + Security | Open |
| RAG-PR-004 false readiness | High | High during dependency failure | Bad traffic routing/outage | Platform/SRE | Open |
| RAG-PR-005 unproven restore/recovery | High | Medium | Extended outage/data loss | SRE + Data owner | Open |
| RAG-PR-006 undefined deployment topology | High | High | Unsafe replicas/resources/upgrades | Platform | Open |
| RAG-PR-007 missing abuse controls | High | Medium | Cost and availability exhaustion | Backend + SRE | Open |
| RAG-PR-008 parser/resource isolation | High | Medium | Event-loop or memory exhaustion | Backend/Security | Open |
| RAG-PR-009 dependency advisories | High | Unknown | Backend DoS | Backend/Security | Open/triage |
| RAG-PR-010 missing cluster observability | Medium | High | Slow detection/diagnosis | SRE | Open |
| RAG-PR-011 no relevance benchmark | Medium | High | Poor or regressed answers | ML/RAG owner | Open |
| RAG-PR-012 no granular RAG RBAC | Medium | Medium | Excess privileged access | Security/Product | Open |

Owners are required roles, not evidence that named people have accepted ownership.

## 18. Required remediation plan

### P0 — Critical security and tenant isolation

1. Make the tenant knowledge root mandatory; remove the shared production fallback.
2. Migrate existing `knowledge.txt` into an explicit tenant directory with checksum and rollback.
3. Add cross-tenant source, preview, download, replace, delete, index, retrieval, and concurrent-operation tests.
4. Put Qdrant on a private network, enable authentication, rotate the key, and deny unauthenticated requests.
5. Fail production startup without `NODE_ENV=production`, `SESSION_SECRET`, allowed origins, tenant storage root, and Qdrant authentication.

### P1 — Data integrity, recovery, and availability

1. Expand readiness to every mandatory dependency with strict timeouts.
2. Define one supported deployment/replica/lock topology.
3. Build coherent backup and isolated restore automation; publish measured RPO/RTO.
4. Run and record the real partial-upload/SIGKILL/reconciliation/retry drill.
5. Run and record application and schema rollback.
6. Add tenant-aware distributed quotas and bounded queues for uploads, indexing, playground, and diagnostics.
7. Isolate document parsers and enforce decompression, time, memory, page, and extracted-size limits.
8. Remove query-string session credentials and require high-entropy production secrets.

### P2 — Performance, observability, and maintainability

1. Execute the real load matrix and soak test, then define SLOs/capacity.
2. Add cluster-safe metrics, trace IDs, dashboards, and alerts with owners.
3. Create a fixed relevance/grounding/injection benchmark corpus.
4. Triage and safely upgrade vulnerable dependency chains.
5. Add database state constraints where feasible and centralize lifecycle transitions.
6. Establish retention, privacy deletion, cost, and provider-quota policies.

## 19. Re-test plan

1. Start from a clean production-like isolated environment using the exact deployment manifest.
2. Prove Qdrant rejects anonymous and untrusted-network access.
3. Create tenants A and B; perform simultaneous upload/manual-save/replace/delete/reindex/retrieve operations and compare filesystem, SQLite, Qdrant payloads, caches, and responses.
4. Re-run the full automated suite and all security regression suites.
5. Inject failure before/after every indexing state transition and assert no false success.
6. Execute the mandatory SIGKILL recovery drill and archive evidence.
7. Produce a coherent backup during active operation, restore into isolation, reconcile, and compare checksums/counts/queries.
8. Roll back one application release and verify schema/data compatibility.
9. Run real-server load at increasing concurrency until saturation, then a soak test; record p50/p95/p99, errors, resources, queues, and costs.
10. Fail Qdrant, Ollama/providers, filesystem writes, and SQLite separately; verify readiness, bounded failure, alerts, and recovery.
11. Red-team uploads, prompt injection, tenant IDs, authorization, rate limits, and session transport.
12. Require independent security, backend, SRE, data, and product sign-off.

## 20. Remaining limitations

- This audit is a point-in-time assessment of the checked-out code and currently running local services.
- It did not mutate or delete user data.
- Network exposure beyond the host was inferred from the all-interface bind; perimeter firewall state was not independently verified. The bind and lack of Qdrant authentication remain unsafe even if a firewall currently limits access.
- No production credentials, separate staging environment, traffic profile, formal SLO, retention policy, or named owner roster was provided.
- Real answer quality and multilingual semantic validation require a representative labeled corpus.
- Provider availability, quotas, and third-party SLAs can change and need continuous monitoring.

## 21. Final sign-off checklist

Release may be reconsidered only when every item is checked with attached evidence:

- [ ] Security approves authenticated/private Qdrant and secret/session handling.
- [ ] Backend owner proves strict tenant isolation for all source/vector/cache/database paths.
- [ ] Data owner approves invariants, reconciliation, migration, and deletion behavior.
- [ ] SRE proves accurate readiness, supported topology, graceful shutdown, alerts, and capacity.
- [ ] Backup owner completes and times an isolated coherent restore.
- [ ] Recovery owner completes the real SIGKILL reconciliation drill.
- [ ] Release owner completes and approves application/schema rollback.
- [ ] ML/RAG owner approves retrieval, grounding, contradiction, and injection benchmark results.
- [ ] Privacy owner approves retention, access, logging, and tenant deletion.
- [ ] Product owner accepts documented residual risks and provider/cost limits.
- [ ] All P0/P1 findings are closed; no Critical or High release blocker remains.
- [ ] Final decision is re-issued from fresh evidence. Current decision remains **NO-GO**.
