# Frontend–Backend Separation Architecture

This document describes the architectural and operational separation of the FUThing customer support dashboard application into independent frontend and backend workspaces.

## Final Repository Layout

```
project-root/
├── backend/
│   ├── src/
│   │   ├── channels/         # Telegraf, WhatsApp, Meta adapters
│   │   ├── database/         # SQLite connections, migrations, repositories
│   │   ├── messaging/        # Unified message processor, routers, normalizers
│   │   ├── middleware/       # requireAuth, csrfProtection, validation
│   │   ├── realtime/         # Socket.IO handlers and eventPublisher
│   │   ├── routes/           # REST endpoints, webhooks, auth routing
│   │   ├── services/         # Admin account bootstrap, AI handlers
│   │   ├── utils/            # Redactor, helpers
│   │   └── app.js            # Express core server configuration
│   ├── test/                 # Test suites (auth, realtime, database, etc.)
│   ├── data/                 # Ignored SQLite databases (.gitkeep)
│   ├── package.json          # Backend-specific package settings
│   ├── package-lock.json     # Backend lock file
│   ├── .env.example          # Backend configurations example
│   └── server.js             # Backend server bootstrapper
│
├── frontend/
│   ├── public/               # UI HTML, Cairo RTL CSS, Client JS Modules
│   │   ├── css/              # Cairo & Cairo Arabic support stylings
│   │   ├── js/dashboard/     # Cohesive client modules
│   │   ├── dashboard.html    # Arabic dashboard layout
│   │   ├── login.html        # Secure Login Page layout
│   │   └── index.html        # Default landing page
│   ├── package.json          # Frontend-specific package settings
│   ├── package-lock.json     # Frontend lock file
│   ├── .env.example          # Frontend public configurations example
│   └── server.js             # Independent frontend static Express server
│
├── docs/                     # Architectural documents
├── dev.js                    # Dependency-free root-level orchestration script
├── package.json              # Monorepo/Root package settings
└── README.md                 # Project-level overview and boot commands
```

## Architectural Boundaries & Trust Model

The application operates under a strict **Zero-Trust Frontend Model**. The frontend serves purely as a static representation of the user interface, rendering layout files (`dashboard.html`, `login.html`), styles, and state-free orchestration scripts.

1. **No Direct Storage Access:** The frontend possesses no direct connection or queries to SQLite. All operations must pass through authenticated REST endpoints.
2. **Zero Secrets in Frontend Build/Serving:** No server secrets (`SESSION_SECRET`, `BOT_TOKEN`, `OPENROUTER_API_KEY`, etc.) are included in the frontend serving directories or environment files. The frontend is fully safe for public CDN deployment.
3. **The Backend as Single-Trusted-Authority:** The backend Express application owns the SQLite persistent layer, verifies authorization, conducts CSRF token validations, processes incoming channel payloads, verifies Meta webhook signatures, rates limits sessions, and manages real-time event dissemination.

---

## Authentication & Cross-Origin Session Lifecycle

The system operates across decoupled browser domains while preserving secure server-side SQLite session storage.

```
[Browser Client]                                  [Backend Engine]
       │                                                 │
       ├─────── 1. POST /api/v1/auth/login ─────────────>┤  (Validate credentials
       │          (With credentials payload)             │   and generate Session)
       │                                                 │
       |<─────── 2. JSON: success + Cookie ──────────────┤  (Responds with secure
       │          (Set-Cookie: connect.sid, HttpOnly)    │   HttpOnly Cookie)
       │                                                 │
       │                                                 │
       ├─────── 3. GET /api/v1/auth/csrf-token ─────────>┤  (Retrieve bound token)
       │          (With credentials Cookie)              │
       │                                                 │
       |<─────── 4. JSON: { csrfToken: '...' } ──────────┤
       │                                                 │
       │                                                 │
       ├─────── 5. POST /api/v1/chat/assign ────────────>┤  (Validates Cookie
       │          (With X-CSRF-Token and Cookie)         │   and timingSafeEqual CSRF)
       │                                                 │
       |<─────── 6. JSON: { success: true } ─────────────┤
```

*   **Cookie Security Configuration:**
    *   `httpOnly: true`: Denies client-side JavaScript access to `connect.sid`, preventing XSS session extraction.
    *   `secure: true` (Production only): Limits cookie transmission strictly to HTTPS channels.
    *   `sameSite: 'lax'`: Mitigates CSRF risks across same-site subdomains.
    *   `domain: process.env.COOKIE_DOMAIN`: Configurable domain property allows credentials to be securely shared across different subdomains (e.g., `dashboard.example.com` and `api.example.com`).

---

## Centralized Real-time Socket.IO Integration

*   **Socket.IO Server CORS:** Socket.IO cors rules are configured to explicitly accept only trusted `FRONTEND_ORIGIN` connections while allowing credential sharing.
*   **Handshake Authentication:** The Socket.IO connection handshakes are cryptographically authenticated on connection establishment by checking the `connect.sid` cookie signature using the backend's shared `SESSION_SECRET` session middleware. Unauthenticated connections are instantly terminated at the Engine.IO level with an `unauthorized` payload, prompting a UI redirect to `/login`.
*   **Fallback Reconciliation Loops:** If the web socket disconnects, the UI activates background fallback polling intervals every 3 seconds to fetch active statistics and transcripts. Upon reconnection, polling is stopped and low-frequency stale-state reconciliation is run.

---

## Webhook Architecture & Public Exposes

*   **Public Routing:** Meta webhooks (`GET /webhook` and `POST /webhook`) are mounted globally at the backend root level.
*   **Isolation from CSRF/CORS:** Since Meta webhooks do not originate from browser sessions, they are kept independent of CORS limits and bypass CSRF checks entirely.
*   **Signature Security:** All Meta webhook requests are validated cryptographically against `META_APP_SECRET` using `crypto.timingSafeEqual()` to ensure payload integrity and block request forgery.
