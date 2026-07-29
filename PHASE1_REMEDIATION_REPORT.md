# Phase 1 — Critical Stabilization & Security Remediation

**Date:** 2026-07-29  
**Scope:** C-01 through C-05 and uploaded-media protection only

## Executive Summary

The critical application-code findings were remediated without redesigning the
system or changing existing API contracts:

- Known administrator credentials and automatic default accounts were removed.
- Administrator creation now requires an explicit, strong, one-time bootstrap.
- Every `SESSION_SECRET` fallback was removed and weak/missing values stop startup.
- Production startup now requires authenticated Qdrant configuration.
- Stored-XSS sinks were removed or routed through a pinned DOMPurify boundary.
- HTML event attributes were removed and replaced with allowlisted listeners.
- Meta and WhatsApp webhooks now always fail closed and reject persisted replays.
- Uploaded customer media now requires an authenticated administrator session.

No existing migration was edited. Migration 022 was added for durable webhook
replay protection.

## Modified Files

### Production backend

- `backend/server.js`
- `backend/src/app.js`
- `backend/src/config/securityConfig.js`
- `backend/src/database/migrations/022_webhook_replay_guard.sql`
- `backend/src/database/repositories/adminRepository.js`
- `backend/src/routes/auth.js`
- `backend/src/routes/webhooks.js`
- `backend/src/services/adminBootstrap.js`

### Production frontend

- `frontend/public/dashboard.html`
- `frontend/public/js/dashboard/apiKeys.js`
- `frontend/public/js/dashboard/eventBindings.js`
- `frontend/public/js/dashboard/rag.js`
- `frontend/public/js/dashboard/settings.js`
- `frontend/public/js/dashboard/utils.js`

### Dependencies and documentation

- `package.json`, `package-lock.json`
- `backend/package.json`, `backend/package-lock.json`
- `backend/docs/PHASE1_SECURITY_CONFIGURATION.md`

DOMPurify is pinned at `3.4.12`. The installed version has no currently
reported DOMPurify advisory in `npm audit`.

### Tests

- `backend/test/security_configuration.test.js`
- `backend/test/meta_webhook_signature.test.js`
- `backend/test/media_access.test.js`
- `backend/test/auth.test.js`
- `backend/test/whatsapp_webhook_signature.test.js`
- `backend/test/realtime.test.js`
- `backend/test/origin_policy.test.js`
- `backend/test/dashboard.test.js`
- `backend/test/phase10_separation.test.js`
- `backend/test/ai_task_routing.test.js`
- `backend/test/analytics_rebuild.test.js`
- `backend/test/rag.test.js`
- `backend/test/settings.test.js`
- `frontend/test/xss.test.js`

## Remediation Explanation

### C-01 — Administrator bootstrap

`bootstrapAdminAccount()` no longer contains a username or password. If an
administrator exists it remains idempotent. If none exists:

- production refuses to continue unless both bootstrap variables are present;
- development creates no account when configuration is absent;
- usernames are strictly validated;
- passwords require 12–128 characters, upper/lower case, a number, a symbol,
  and cannot contain the username;
- bcrypt cost was increased to 12;
- the plaintext bootstrap password is removed from `process.env` immediately
  after successful creation.

### C-02 — Session signing

`requireSessionSecret()` is the single source for session and rate-limit HMAC
signing. Secrets shorter than 32 characters or missing secrets are rejected in
all environments. There is no literal fallback in production source.

Changing this secret cryptographically invalidates all existing signed
sessions. The deployment procedure explicitly requires administrators to sign
in again after rotation.

### C-03 — Qdrant

Startup security validation runs after persistent settings load and before the
application/providers start. Production requires a Qdrant API key of at least
32 characters. All Qdrant requests use the central vector store and attach the
configured `api-key`.

Network binding remains an infrastructure responsibility because this
repository contains no Qdrant deployment definition. The required private
binding/firewall configuration is documented.

### C-04 — Stored XSS

- Toast messages now use `textContent` and DOM construction.
- API provider errors and RAG/document values are escaped by context.
- Dynamic document actions use data identifiers plus `addEventListener`;
  untrusted values never enter executable JavaScript.
- Dashboard HTML no longer contains `onclick`, `onchange`, `onload`, or
  `onerror` attributes.
- A fixed allowlist converts trusted declarative actions into listeners without
  `eval` or `Function`.
- The one remaining HTML parser boundary is centralized in
  `setSanitizedHTML()`, uses locally served pinned DOMPurify, and forbids active
  tags, event attributes, `srcdoc`, and declarative action attributes.

### C-05 — Webhooks

Meta and WhatsApp share a raw-body HMAC-SHA256 verifier:

- missing signature → 401;
- malformed/invalid/tampered signature → 401;
- missing signing secret → 503, with no business processing;
- valid signature → processing;
- duplicate valid signature during the five-minute replay window → 409.

Replay keys are SHA-256 hashes, persisted in SQLite, bounded to 10,000 active
entries, and expired transactionally. This works across process restarts and
multiple processes sharing the database. The default Meta verification token
and development signature bypass were removed.

### Uploaded media

`/uploads` is no longer anonymous static content. It is behind `requireAuth`,
denies dotfiles/indexes, uses private/no-store caching, and sends a sandboxed
content security policy.

## Test Results

Commands:

```bash
cd backend
npm test

node test/whatsapp_webhook_signature.test.js
node test/meta_webhook_signature.test.js
node test/media_access.test.js

cd ../frontend
npm test
node --check public/js/dashboard/eventBindings.js
node --check public/js/dashboard/rag.js
node --check public/js/dashboard/settings.js
node --check public/js/dashboard/apiKeys.js
```

Results:

- Full combined backend + frontend regression command: **exit 0**.
- Security configuration tests: **5 assertions passed**.
- WhatsApp signature suite: **8 tests passed**.
- Meta signature/replay suite: **passed**.
- Media authorization integration: **passed**.
- Expanded frontend XSS suite: **4/4 passed**.
- Existing authentication, database, Socket.IO, origin, messaging, AI,
  analytics, provider, and RAG suites: **passed**.
- JavaScript syntax checks for modified frontend modules: **passed**.
- `git diff --check`: **passed**.
- Static scan found no known hard-coded default administrator password, session
  fallback, or default Meta verify token in production source.
- Static scan found no HTML event attributes and no direct HTML assignment
  outside the reviewed DOMPurify boundary.

The dependency audit still reports the pre-existing eight High advisories in
the `whatsapp-web.js` transitive tree. They are outside this phase's defined
critical scope and require a compatibility-tested dependency remediation.

## Verification Matrix

| Finding | Code status | Verification | Regression result |
|---|---|---|---|
| C-01 default administrator | Fixed | Fresh production DB rejects missing bootstrap; explicit strong bootstrap tested | No detected regression |
| C-02 session fallback | Fixed | Missing/short secret rejected; login and Socket.IO tests pass | No detected regression |
| C-03 Qdrant application configuration | Fixed | Production missing key rejected; all vector calls reviewed | No detected regression |
| C-04 Stored XSS | Fixed for known sinks | Full frontend sink scan and malicious payload suite pass | No detected regression |
| C-05 webhook fail-closed | Fixed | Valid/invalid/missing/tampered/missing-secret/replay tests pass | No detected regression |
| Public uploaded media | Fixed | Anonymous 302; authenticated 200; private headers verified | No detected regression |

## Deployment Actions Required

The code is ready for a controlled rollout, but the currently running old
process does not automatically receive these changes. Before restarting:

1. Configure a new `SESSION_SECRET` of at least 32 characters.
2. Configure Qdrant with an API key and the same `QDRANT_API_KEY` in the app.
3. Bind/firewall Qdrant to a private network; the previously observed
   `0.0.0.0:6333` listener must not remain public.
4. Configure Meta/WhatsApp signing secrets and a random verify token.
5. If and only if the administrators table is empty, configure the one-time
   bootstrap variables and remove them after the first successful start.
6. Expect all prior administrator sessions to be invalid after secret rotation.

The application will intentionally refuse an insecure restart rather than
silently restoring the old behavior.
