# Security Baseline Inventory — FUThing Support Portal

This document specifies the baseline security inventory as of Phase 8, mapping out all interfaces, configurations, state handlers, and potential risk surfaces prior to the Phase 9 Production Security Hardening pass.

---

## 1. Route Map & Authentication Boundaries

The Express application exposes the following routes and access gates:

### 1.1 Public Unauthenticated Routes
*   `GET /` -> Serves public landing page.
*   `GET /index.html` -> Serves public landing page statically.
*   `GET /login` -> Serves Arabic-first admin signin page (`login.html`).
*   `POST /api/auth/login` -> Authenticates admin login, subject to in-memory rate limits.
*   `GET /api/auth/me` -> Fetches session authenticated user identity context.
*   `POST /api/auth/logout` -> Destroys server-side session.

### 1.2 Public Webhook Routes
*   `GET /webhook` -> Verifies Facebook/Instagram Meta webhook subscriptions.
*   `POST /webhook` -> Receives Meta Messenger and Instagram incoming event dispatches.

### 1.3 Authenticated Administrative Routes (`/api/*`)
Protected by the `requireAuth` session check middleware on `/api`:
*   `GET /dashboard.html` -> Serves full workspace control panel layout.
*   `GET /api/stats` -> Returns system database status and config fields.
*   `GET /api/users` -> Lists registered channel conversations.
*   `GET /api/chat/:userId` -> Pulls chat message transcripts thread.
*   `POST /api/chat/toggle-ai` -> Enables/Disables RAG response automation.
*   `POST /api/chat/assign` -> Configures manually assigned worker names.
*   `POST /api/send-direct` -> Transmits chat responses, attachments, or staff notes.
*   `GET /api/errors` -> Fetches recorded application incident logs.
*   `POST /api/errors/solve` -> Flags incident logs as resolved.
*   `POST /api/config/settings` -> Mutates system channel parameters.
*   `POST /api/config/knowledge` -> Syncs product knowledge content.
*   `GET /api/whatsapp/status` -> Pulls WhatsApp connection and QR details.
*   `POST /api/whatsapp/logout` -> Dismantles and reboots WhatsApp Web gateways.
*   `POST /api/broadcast` -> Dispatches announcements across active accounts.
*   `POST /api/auth/change-password` -> Processes password strength mutations.

---

## 2. File and Data Transmission Channels

### 2.1 File-Upload Paths
*   **Target Directory:** `public/uploads/` (maps to `/uploads/` URL path).
*   **Current Input:** Staged via client file select, read as Base64 in `public/js/dashboard/composer.js`, and sent to `/api/send-direct` under fields `mediaData` and `mediaName`.
*   **WhatsApp Media Input:** Downloaded from WhatsApp Web's CDN and written locally under `public/uploads/` using mime-extension helpers in `src/channels/whatsapp.js`.

### 2.2 Remote Media-Download Path
*   **Helpers:** Media files originating from Telegram and WhatsApp channels are downloaded remotely using fetch/stream helpers and saved directly under `public/uploads/`.
*   **Telegram Helper:** Downloads files using standard HTTP requests to `https://api.telegram.org/file/bot<token>/<file_path>`.

### 2.3 Configuration-Writing Path
*   **Local `.env` writes:** `POST /api/config/settings` rewrites `.env` variables via `updateEnvFile()` helper.
*   **Knowledge-base writes:** `POST /api/config/knowledge` rewrites `knowledge.txt` in the root folder.
*   **System Prompt writes:** `POST /api/config/settings` writes the `system_prompt.txt` file in the root.

---

## 3. Handshakes & Session Properties

### 3.1 Cookies and session settings
*   **Middleware:** `express-session` backed by a custom SQLite session store.
*   **Name:** `connect.sid`
*   **Cookie Flags:** `httpOnly: true`, `sameSite: 'lax'`, `secure: false` (in development HTTP) / `true` (in production HTTPS).
*   **Duration:** 8 hours (`maxAge: 28800000`).

### 3.2 Socket.IO Handshake Authentication
*   **Layer:** Engine.IO level.
*   **Auth check:** Intercepted by direct mounting of `app.sessionMiddleware` on the Engine.IO layer. Validates the signature of the signed `connect.sid` cookie using `SESSION_SECRET` against the active SQLite session table.

---

## 4. Rate-Limiting & Protection Baselines
*   **Authentication Limiter:** Process-memory-based limiter allowing up to 5 failed attempts per 15 minutes per IP. Resets on process restarts.
*   **Other Routes:** No rate limits are currently configured on API routes, direct sending endpoints, broadcasts, or webhook endpoints.
*   **Meta Webhook Validation:** No signature verification is currently configured on incoming `POST /webhook` events.

---

## 5. Environment Variables Inventory
The system depends on the following sensitive keys loaded from `.env`:
*   `SESSION_SECRET` -> Session cryptographic signing key.
*   `BOT_TOKEN` -> Telegram bot API key.
*   `ADMIN_TELEGRAM_ID` -> Telegram ID for notifications.
*   `OPENROUTER_API_KEY` -> AI response generator API key.
*   `MESSENGER_ACCESS_TOKEN` -> Facebook Messenger API token.
*   `INSTAGRAM_ACCESS_TOKEN` -> Instagram DM API token.
*   `META_VERIFY_TOKEN` -> Shared token for verification handshakes.
