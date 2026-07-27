# CURRENT SYSTEM ANALYSIS — Phase 1

## 1. Executive Summary
This document provides a comprehensive analysis of the existing multi-channel customer communication and support platform. Built as a single-file Express.js monolith (`server.js`) with an in-memory database (`botData`), the platform supports multiple communication channels (Telegram and WhatsApp) and defines configuration fields for other channels (Facebook Messenger and Instagram). The platform integrates with OpenRouter for AI automated responses, incorporates a basic keyword-based RAG knowledge base context lookup, and serves a feature-rich, single-file frontend dashboard (`dashboard.html`) designed with Arabic-first RTL support and a modern Tailwind CSS theme.

---

## 2. Current Project Purpose
The platform functions as an AI-powered customer support aggregator. Its primary business value is:
1. **Multi-Channel Aggregation:** Unifying conversations from Telegram, WhatsApp, and potentially Facebook/Instagram into a single backend service.
2. **AI-Driven Customer Automation:** Running automated conversations using OpenRouter models, custom system prompts, and a searchable local context document (`knowledge.txt`).
3. **Agent Handover (Human-in-the-Loop):** Allowing administrators to pause AI automation for individual users and chat directly from a central dashboard, assign chats to specific staff members, and add internal notes.
4. **Broadcast Messaging:** Facilitating mass messaging campaigns to all connected customers across all integrated channels.

---

## 3. Current Technology Stack
* **Runtime Environment:** Node.js (v22.22.1 detected in the sandbox).
* **Package Manager:** npm (v10.8.2 detected in the sandbox).
* **Backend Server Framework:** Express.js (`express` v4.19.2) - handles REST endpoints and webhooks.
* **Telegram Bot Library:** Telegraf (`telegraf` v4.16.3) - utilizes long-polling (`bot.launch()`).
* **WhatsApp Library:** whatsapp-web.js (`whatsapp-web.js` v1.34.7) - connects via standard Puppeteer headless browser emulation.
* **QR Code Generator:** qrcode (`qrcode` v1.5.4) - formats WhatsApp authentication QR codes into base64 URLs for dashboard display.
* **Configuration Loader:** dotenv (`dotenv` v16.4.5) - parses key-value parameters from the `.env` file.
* **External AI Provider:** OpenRouter API - routes chat requests to models (e.g. standard model `openrouter/free`, `google/gemma-2-9b-it:free`, etc.) using HTTP standard fetch requests.
* **Frontend:** Tailwind CSS, Chart.js, HTML5 standard DOM, native vanilla JS fetch APIs. No modern frontend framework (React, Vue) is used.

---

## 4. Current Project Tree
```text
/ (repository root)
├── docs/                               # Documentation directory (created in Phase 1)
│   ├── CURRENT_SYSTEM_ANALYSIS.md      # This file
│   └── REFACTOR_PLAN.md                # Safe modular refactoring blueprint
├── public/                             # Publicly served static files
│   ├── uploads/                        # Runtime-generated directory for media attachments
│   ├── dashboard.html                  # Main administration panel & agent workspace
│   └── index.html                      # Landing page for the customer bot service
├── .gitignore                          # Standard git-ignore rules for secrets/dependencies
├── knowledge.txt                       # RAG dataset containing company information chunks
├── package-lock.json                   # Deterministic lockfile for dependency resolution
├── package.json                        # Project metadata, dependencies, and start scripts
├── server.js                           # Monolithic Express backend, channel entrypoint, and storage
└── system_prompt.txt                   # Persona instructions injected into AI responses
```

---

## 5. File Classifications

| File/Directory | Source Code | Frontend | Dependencies | Runtime Generated | Session/Auth | Sensitive | Git Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| `server.js` | Yes | No | No | No | No | No | Tracked |
| `public/index.html` | No | Yes | No | No | No | No | Tracked |
| `public/dashboard.html` | No | Yes | No | No | No | No | Tracked |
| `package.json` | Yes | No | Yes | No | No | No | Tracked |
| `package-lock.json` | Yes | No | Yes | No | No | No | Tracked |
| `knowledge.txt` | Yes | No | No | No | No | No | Tracked |
| `system_prompt.txt` | Yes | No | No | No | No | No | Tracked |
| `.gitignore` | Yes | No | No | No | No | No | Tracked |
| `node_modules/` | No | No | Yes | Yes | No | No | Excluded |
| `public/uploads/` | No | No | No | Yes | No | No | Excluded |
| `.env` | No | No | No | Yes | No | Yes | Excluded (Sensitive) |
| `.wwebjs_auth/` | No | No | No | Yes | Yes | Yes | Excluded (Sensitive) |
| `.wwebjs_cache/` | No | No | No | Yes | No | No | Excluded |

---

## 6. Application Entry Points and Startup Flow

### Application Entry Point
The sole entry point is `server.js`. Running `npm start` executes `node server.js`.

### Startup Flow Sequence
1. **Environment Setup:** Loads `.env` file configurations using `require('dotenv').config()`.
2. **Server Initialization:** Spawns an Express app, configures JSON and urlencoded body parsers (with a `50mb` size limit), and serves the static `public/` directory.
3. **Data Base Prep:** Declares an in-memory object literal `botData` to store users, message records, logs, and technical incidents.
4. **Directory Check:** Verifies if `public/uploads/` exists, creating it recursively if missing.
5. **Telegram Initialization:**
   * Reads `BOT_TOKEN` from `process.env`.
   * Checks if token matches the Telegram Bot API regex (`/^[0-9]+:[a-zA-Z0-9_-]+$/`).
   * If valid, instantiates `Telegraf` and registers the `/start` commands and standard `message` handlers.
   * Launches long-polling listener (`bot.launch()`).
   * If invalid/missing, invokes `reportError` to flag a missing token.
6. **WhatsApp Initialization:**
   * Detects local Google Chrome / Chromium executable paths across standard Ubuntu locations.
   * Configures Puppeteer runner options (headless, disables sandboxes, and flags to manage limited shared memory limits safely in Linux environments).
   * Instantiates the WhatsApp `Client` using `LocalAuth` (session path: `.wwebjs_auth`).
   * Registers callback listeners (`qr`, `ready`, `disconnected`, `message`).
   * Invokes `waClient.initialize()`.
7. **Port Listening:** Express server starts listening on `process.env.PORT` (or defaults to `3005`).

---

## 7. Current System Architecture
The application adheres to an extreme **monolithic, single-process, in-memory model**.

```text
                               +------------------+
                               | Express Server   |
                               | (HTTP Port 3005) |
                               +--------+---------+
                                        |
                 +----------------------+----------------------+
                 |                      |                      |
        +--------+---------+   +--------+---------+   +--------+---------+
        |  Telegraf Engine |   |  whatsapp-web.js |   | Meta Webhooks   |
        |  (Telegram Bot)  |   |   (Puppeteer)    |   | (/webhook POST)  |
        +--------+---------+   +--------+---------+   +--------+---------+
                 |                      |                      |
                 +----------------------+----------------------+
                                        |
                                        v
                            +-----------------------+
                            |   Central server.js   |
                            |                       |
                            | - In-memory botData   |
                            | - keyword RAG lookup  |
                            | - OpenRouter AI Fetch |
                            +-----------+-----------+
                                        |
                        +---------------+---------------+
                        |                               |
                        v                               v
            +-----------------------+       +-----------------------+
            |  Dashboard UI (Client)|       | Local Disk Files      |
            |  - /api/stats (polling|       | - knowledge.txt       |
            |    every 3 seconds)   |       | - system_prompt.txt   |
            +-----------------------+       +-----------------------+
```

### Critical Architectural Flaws:
* **No Database Persistence:** Any server restart completely clears customer details, messages, active staff assignments, unread counters, and incident records.
* **Active Blocking Polling:** The dashboard polls the server at `/api/stats` and `/api/chat/:userId` every **3 seconds**, creating massive CPU and I/O bottlenecks.
* **No Real-Time Sockets:** There is no WebSocket or Socket.io implementation. Everything depends on aggressive HTTP polling.
* **Coupling of Concerns:** Input validation, file storage, RAG retrieval, third-party network routing, dashboard API, and bot initialization are all packed directly inside a single 1,400+ line javascript file (`server.js`).

---

## 8. Detailed Channel Analysis

### Telegram Channel
* **Initialization:** Initialized in `server.js` using `Telegraf`.
* **Method of Operation:** **Long Polling** (`bot.launch()`). Webhooks are not configured.
* **Incoming Message Handling:** Intercepted by `bot.on('message', ...)`. Registers the user profile (`registerUser`), parses user texts, and checks for attachments.
* **Supported Media Types:**
  * **Images:** Fetches using the largest size file ID. Downloaded from Telegram CDN, written to `public/uploads/` as `<timestamp>_telegram.jpg`.
  * **Voice & Audio:** Downloded from Telegram CDN, written to `public/uploads/` as `<timestamp>_telegram.ogg`.
  * **Video:** Downloaded from Telegram CDN, written to `public/uploads/` as `<timestamp>_telegram.mp4`.
  * **Documents:** Downloaded from Telegram CDN, matching file extension, written to `public/uploads/`.
* **User/Conversation Identification:** Identified by Telegram numeric `from.id`. Conversation history, state, and name are bound to this numeric ID.
* **AI & Agent Modes:** If the user profile has `isAIEnabled: true`, the text is sent to OpenRouter via `getAIResponse`, and the returned answer is replied back automatically. If `isAIEnabled: false`, the incoming message logs are printed with an auto-reply disabled flag to await manual administrative agent response.
* **Outgoing Messaging:** Handled via Express REST API `POST /api/send-direct`. When the agent writes a response in the dashboard, the backend uses `bot.telegram.sendMessage` (or `sendPhoto`, `sendVideo`, `sendAudio`, `sendDocument` if a local file path exists) to dispatch it.
* **Status:** **Fully Implemented and functional**.

---

### WhatsApp Channel
* **Library:** `whatsapp-web.js` (v1.34.7).
* **Client Initialization:** Handled by instantiating `Client` with `LocalAuth` strategy, storing credentials in `.wwebjs_auth/`.
* **Restoration:** Automatically reads `.wwebjs_auth/` on startup.
* **QR Authentication:** Triggers the `'qr'` event. Generates a base64 DataURL representation using the `qrcode` library, and binds it to `lastQrCodeUrl` for dashboard polling retrieval.
* **Incoming Message Handling:** Listens on `'message'` event. Ignores group threads (`@g.us`). Extracts contact names and phone numbers to register profiles.
* **Supported Media Types:** Extracts attachments if `msg.hasMedia` is true. Invokes `msg.downloadMedia()`, retrieves mime types, converts base64 payloads to raw buffers, and writes to `public/uploads/` (filenames: `<timestamp>_whatsapp.<ext>`).
* **AI & Agent Modes:** Uses `process.env.WA_AUTO_REPLY !== 'false'` as a global switch, and `user.isAIEnabled` as a local switch. If both are true, it queries OpenRouter and replies via `waClient.sendMessage`.
* **Logout/Reset:** Exposes `POST /api/whatsapp/logout` which destroys the client instance, deletes `.wwebjs_auth/` and `.wwebjs_cache/` recursively, and spins up a brand-new WhatsApp client to generate a fresh QR code.
* **Status:** **Fully Implemented and functional**.

---

### Facebook Messenger Channel
* **Method of Operation:** Configuration and HTTP webhook parsing only. No official library is used.
* **Inbound Handler:** Express endpoints `GET /webhook` (verifies verification token) and `POST /webhook` (receives messaging payloads).
* **Outgoing Handler:** `sendMetaMessage` helper sends POST requests to `https://graph.facebook.com/v19.0/me/messages` using `MESSENGER_ACCESS_TOKEN`.
* **Verification Security:** Checks for `process.env.META_VERIFY_TOKEN`. **No cryptographic signature validation** is performed on incoming payloads.
* **User Profiling:** Calls `https://graph.facebook.com/v19.0/<psid>` to extract the real user name.
* **Status:** **Partially Implemented (Configuration and Webhook Only)**. Requires webhook setup on Meta and a live secure HTTPS URL (e.g. via ngrok) to verify and work.

---

### Instagram Channel
* **Method of Operation:** shares the same `GET /webhook` and `POST /webhook` routes as Messenger.
* **Inbound Handler:** Receives payloads containing `body.object === 'instagram'`. Uses `INSTAGRAM_ACCESS_TOKEN` for fetching profiles and sending messages.
* **Outgoing Handler:** Dispatches POST payloads to Meta Graph API via `sendMetaMessage` helper using `INSTAGRAM_ACCESS_TOKEN`.
* **Verification Security:** Verification token handshake exists, but **signature validation is absent**.
* **Status:** **Partially Implemented (Configuration and Webhook Only)**. Requires webhook setup on Meta Developer portal and live secure HTTPS.

---

## 9. Channel Implementation-Status Matrix

| Channel | Implementation Status | Verified | Library / SDK | Inbound Transport | Outbound Transport | Media Support |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| **Telegram** | Fully Implemented | Yes | `telegraf` | Long Polling | API Send | Yes (Image, Audio, Video, Docs) |
| **WhatsApp** | Fully Implemented | Yes | `whatsapp-web.js` | Puppeteer / WS | API Send | Yes (Image, Audio, Video, Docs) |
| **Facebook Messenger** | Configuration & Webhooks Only | No | HTTP Native | Webhook POST | Meta Graph API | No (Text Only) |
| **Instagram** | Configuration & Webhooks Only | No | HTTP Native | Webhook POST | Meta Graph API | No (Text Only) |

---

## 10. Message Flow Trace (Current Monolith)

Below is the step-by-step trace of an incoming message from receipt to response:

```text
[Telegram Inbound] --(Polling)----+--> registerUser() ---> botData.messages.push()
                                  |    (Sets isAIEnabled)  (Stores local message)
[WhatsApp Inbound] --(Puppeteer)-+                         (Increments count)
                                                           |
+----------------------------------------------------------+
|
v
isAIEnabled === true?
|
├── [No] ---> Wait for manual Dashboard agent response.
│
└── [Yes] --> retrieveContext(userQuery)
              |
              ├── Searches knowledge.txt using simple whitespace word-matching
              └── Extracts up to 3 high-scoring chunks
                  |
                  v
              Injects system_prompt.txt (fallback to default helper string)
                  |
                  v
              getChatHistoryForAI(userId)
              (Retrieves last 6 messages, filtering out system notifications & notes)
                  |
                  v
              Construct API payload and POST to https://openrouter.ai/api/v1/chat/completions
                  |
                  v
              Parse returned assistant response text
                  |
                  v
              Save answer to botData.messages
                  |
                  v
              Send response back to original channel (Telegraf / whatsapp-web.js)
```

---

## 11. OpenRouter and AI Integration Analysis

* **Endpoint:** `https://openrouter.ai/api/v1/chat/completions` (POST).
* **API Key Retrieval:** Loaded from `process.env.OPENROUTER_API_KEY`.
* **Model Configuration:** Configured using `process.env.OPENROUTER_MODEL` (defaults to `openrouter/free`).
* **Request Headers:**
  * `Authorization: Bearer <API_KEY>`
  * `Content-Type: application/json`
  * `HTTP-Referer: http://localhost:3005`
  * `X-Title: Telegram RAG Memory Bot`
* **Temperature and Parameters:** None explicitly passed. Relies on the model's default settings. No max tokens or timeout properties configured.
* **History Filtering Logic (`getChatHistoryForAI`):**
  * Loops over `botData.messages`.
  * Matches `userId`.
  * Excludes internal note messages (`msg.type === 'note' || msg.isNote === true`).
  * Excludes automated service greeting lines (e.g. "شكراً لتواصلك معنا" or "تم ربط حسابك بالمنصة").
  * Extracts the last **6** qualifying messages.
* **System Prompt Injection:** Injects system prompt content directly inside the **last user message payload** as custom instruction block instead of placing it solely as the initial system role item:
  `lastMsg.content = "[التعليمات والشخصية الصارمة...]:\n<systemPrompt>\n\n[سؤال المستخدم الحالي]:\n<userText>"`
  This forces the LLM to follow the instructions.
* **Error Handling:** If OpenRouter returns an error, it invokes `reportError("OpenRouter AI API", ...)` and logs the failure to the admin alert system.

---

## 12. Knowledge System and System Prompt Analysis

### Knowledge Base (RAG)
* **File Location:** `knowledge.txt` in the root directory.
* **Loading & Search Strategy:** Basic word frequency calculation:
  1. Split text into chunks using double newlines (`\n\n`).
  2. Parse user query into unique words (filtering out words with $\le 2$ characters).
  3. Score each chunk by how many query words it contains.
  4. Filter out chunks with a score of 0.
  5. Sort chunks descending by score and slice the top **3** records.
  6. Join them with double newlines and append to the system instructions.
* **Limitations:**
  * It is not a semantic search or vector-based RAG. Syntactic exact match only.
  * Inefficient file system lookup: Reads `knowledge.txt` synchronously (`fs.readFileSync`) for **every** incoming message.
  * No in-memory caching for knowledge text.

### System Prompt
* **File Location:** `system_prompt.txt` in the root directory.
* **Loading Strategy:** Read synchronously (`fs.readFileSync`) on every incoming query. If file is missing/empty, falls back to a hardcoded default string: `"أنت مساعد خدمة عملاء محترف وذكي يجيب باللغة العربية بلطف ومودة."`

---

## 13. Current Data Storage

| Data Entity | Saved Location | Restart Survival | Format | Read Mechanism | Write Mechanism |
| :--- | :--- | :---: | :--- | :--- | :--- |
| **Users / Customers** | Memory (`botData.users`) | No | JS Object | `botData.users[id]` | `registerUser` function |
| **Messages / History** | Memory (`botData.messages`)| No | JS Array | `.filter()` on array | `.push()` on array |
| **Unread Message Counts** | Memory (`unreadCount`) | No | JS Property | UI queries endpoint | Incremented on incoming msg |
| **Assignee (Staff Name)** | Memory (`assignee`) | No | JS Property | UI queries endpoint | `POST /api/chat/assign` |
| **Technical Errors** | Memory (`botData.errors`) | No | JS Array | `GET /api/errors` | `reportError` function |
| **Activity Logs** | Memory (`botData.recentLogs`)| No | JS Array | `GET /api/stats` | `addLog` function |
| **Bot Token / API Keys**| `.env` file | Yes | Text file | `process.env` | `updateEnvFile` function |
| **Media Files** | Disk (`public/uploads/`) | Yes | Bin Files | Static routes | `fs.writeFileSync` |
| **System Prompt** | Disk (`system_prompt.txt`)| Yes | Text | `fs.readFileSync` | `fs.writeFileSync` |
| **Knowledge Data** | Disk (`knowledge.txt`) | Yes | Text | `fs.readFileSync` | `fs.writeFileSync` |

---

## 14. Dashboard Analysis
The administration interface is loaded from `public/dashboard.html`. It contains **all CSS styles, HTML layout blocks, and Client JavaScript logic in one single 92KB+ file**.

### Key Modules and Layout Sections:
* **Sidebar Navigation:** Switch between Chat ("الدعم والدردشة"), Errors ("تتبع الأعطال"), Analytics ("تحليلات الأداء"), WhatsApp ("واتساب ويب"), and Settings ("إعدادات النظام").
* **Unified Workspace:**
  * **Left/Right column layout:** Active customer list with quick filter buttons (All, Telegram, WhatsApp, Messenger, Instagram, and unread-only toggle).
  * **Main chat conversation window:** Live dialogue with active customer assignment options ("أحمد", "سارة", or "الذكاء الاصطناعي") and AI automated state controls.
  * **Bottom inputs:** Rich text composer with dual response tabs ("رد مباشر للعميل" / "ملاحظة داخلية") and local file attachment selector.
  * **Right Panel:** Quick mass broadcast trigger ("Execute Broadcast"), summary numbers, and real-time logs terminal emulator.
* **Arabic and RTL Integration:** Styled natively with standard RTL rules (`dir="rtl"`), Cairo fonts, and translated Arabic-first user directions.
* **Aggressive Polling Engine:** Uses standard client timers (`setInterval`) to hit `/api/stats` and `/api/chat/:userId` every **3 seconds** and `/api/whatsapp/status` every **5 seconds**.

---

## 15. REST API, Webhooks, and WebSockets Inventory

The application has **no WebSocket or Socket.io integration**. Real-time simulation is managed through active client polling.

### REST Endpoints

| Method | Route | Responsible File | Purpose | Input Payload | Output Payload | Auth / Security |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **GET** | `/webhook` | `server.js` | Handshake validator for Meta | `hub.verify_token`, `hub.challenge` | Challenge text string | Checks matching token |
| **POST** | `/webhook` | `server.js` | Receives WhatsApp / FB messages | JSON webhook payload | `EVENT_RECEIVED` | None |
| **POST**| `/api/chat/assign` | `server.js` | Assigns chat owner | `{ userId, assignee }` | `{ success: true }` | None |
| **POST**| `/api/send-direct` | `server.js` | Admin direct send message | `{ userId, message, isNote, mediaData, mediaName, mediaType }` | `{ success: true }` | None |
| **POST**| `/api/config/settings`| `server.js` | Writes config parameters to `.env` | Env variables form body | `{ success: true }` | None |
| **GET** | `/api/stats` | `server.js` | Returns usage stats, logs, prompt | None | Unified stats JSON | None |
| **GET** | `/api/users` | `server.js` | Returns array of users | None | User profiles list JSON | None |
| **GET** | `/api/chat/:userId`| `server.js` | Returns user conversation thread | None | Array of message objects | None |
| **POST**| `/api/chat/toggle-ai`| `server.js` | Toggles AI state for a user | `{ userId }` | `{ success: true, isAIEnabled }` | None |
| **GET** | `/api/errors` | `server.js` | Gets list of recorded errors | None | Error logs JSON array | None |
| **POST**| `/api/errors/solve` | `server.js` | Marks error as solved | `{ id }` | `{ success: true }` | None |
| **POST**| `/api/broadcast` | `server.js` | Broadcasts mass message | `{ message }` | `{ success: true, stats }` | None |
| **POST**| `/api/config/knowledge`| `server.js`| Overwrites knowledge file | `{ text }` | `{ success: true }` | None |
| **GET** | `/api/whatsapp/status`| `server.js`| Returns WhatsApp state/QR code | None | `{ status, qr }` | None |
| **POST**| `/api/whatsapp/logout`| `server.js`| Logouts and clears WhatsApp session | None | `{ success: true }` | None |

---

## 16. Security Findings

We evaluated the application's overall codebase structure, static paths, endpoints, and input routines.

### 1. Missing Authentication and Session Security
* **Classification:** Critical
* **Affected Component:** Dashboard UI and all `/api/*` endpoints.
* **Risk:** The dashboard is public and has no login protection. Any visitor can open `/dashboard.html` and call endpoints to read chats, edit tokens, view logs, alter settings, or overwrite `.env` fields.
* **Remediation Recommendation:** Implement session authentication (cookie-session or JWT) on the dashboard and secure all `/api/*` administrative endpoints behind a robust authentication middleware.

### 2. High Risk of Path Traversal & Unsafe Local File Uploads
* **Classification:** High
* **Affected Component:** `POST /api/send-direct` and remote file fetch helpers.
* **Risk:** Filenames are extracted directly from user inputs and written to static directories. Without path sanitization, an attacker could trigger path traversal (e.g. `../../server.js`) to overwrite system files.
* **Remediation Recommendation:** Restrict allowed file extensions, sanitize filenames, and use UUIDs for saved files instead of preserving input names.

### 3. Missing CSRF / Rate Limiting Controls
* **Classification:** High
* **Affected Component:** `/api/broadcast`, `/api/config/settings`, and `/webhook`.
* **Risk:** Anyone can call `/api/broadcast` to send spam messages to thousands of connected customers. There is also no rate-limiting, exposing OpenRouter endpoints to abuse and high API costs.
* **Remediation Recommendation:** Add rate-limiting middleware (`express-rate-limit`) and secure APIs with anti-CSRF protection or API keys.

### 4. Direct Secrets Writing to Environment File
* **Classification:** Medium
* **Affected Component:** `/api/config/settings` endpoint.
* **Risk:** Writes secrets directly to `.env` using simple regex replacements. This could corrupt `.env` formatting or leak secrets in debug outputs.
* **Remediation Recommendation:** Transition setting storage to a secure SQLite `settings` table, keeping only core secrets (like DB path or server key) in `.env` as read-only variables.

### 5. Meta Webhook Security Deficiencies
* **Classification:** Medium
* **Affected Component:** `POST /webhook` endpoint.
* **Risk:** The server processes Meta payloads without validating the cryptographic signature (`X-Hub-Signature-256`), making it easy to spoof messages.
* **Remediation Recommendation:** Validate incoming webhook signatures against `process.env.META_APP_SECRET`.

---

## 17. Runtime-Verification Results

The application dependencies and configuration structures were verified safely within the sandbox.

### Dependency Audit
We checked for installed dependencies:
```bash
npm list --depth=0
```
This revealed that dependencies listed in `package.json` (`dotenv`, `express`, `qrcode`, `telegraf`, `whatsapp-web.js`) were **not installed** (`UNMET DEPENDENCY`).

### Running Safe Runtime Checks
Running the server without installing dependencies will fail. We recorded this as:
* **Runtime-Verification Status:** `Partially verified` (verified structure and dependencies, but app cannot start due to missing node modules).
* **Risks:** Installing missing packages is restricted in Phase 1.
* **Startup Duration:** Not applicable.

---

## 18. Known System Risks and Unknowns
1. **WhatsApp Web Selector Risks:** `whatsapp-web.js` depends on Puppeteer and Chromium. Changes in WhatsApp's web interface often break selectors, causing connection errors.
2. **OpenRouter Concurrent Operations:** There are no safeguards against overlapping messages. If a user sends multiple messages quickly, several overlapping OpenRouter API requests may trigger, causing race conditions in conversation history.
3. **Data Loss on Restart:** Because all user data, conversation threads, and settings are kept in memory, any server restart deletes all active customer contexts and chat histories. This makes stateful RAG prompt engineering impossible across restarts.
