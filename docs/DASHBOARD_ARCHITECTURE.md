# Dashboard Architecture — FUThing Frontend Workspace

This document defines the architectural specification, module design, state management, and communication guidelines for the modularized administration dashboard.

---

## 1. Purpose
The purpose of Phase 7 is to safely deconstruct the 1498-line monolithic administration dashboard (`public/dashboard.html`) into modular, discrete, single-responsibility files without altering user-visible layouts, styling, Arabic translation assets, or backend REST endpoints.

---

## 2. Design Principles
Our refactoring conforms strictly to the following principles:
* **Edit Source, Not Design:** We preserve 100% of the Tailwind styling, Arabic alignment, typography, margins, responsive blocks, and Cairo text.
* **Separation of Concerns:** Each module focuses strictly on one core business feature (e.g., chat rendering, system settings, analytics charts).
* **Robust Global Namespace:** To maintain maximum browser compatibility without introducing complex transpilation overheads or bundler scripts (like Vite/Webpack), the system relies on a clean, single global namespace object: `window.Dashboard`.
* **Zero side effects:** Bootstrapping or state initialization is restricted entirely to the entry orchestration module (`main.js`).

---

## 3. Module Strategy & Browser Pattern
The frontend architecture organizes components into a single global namespace:
```javascript
window.Dashboard = window.Dashboard || {};
```
To ensure that dependencies resolve correctly in plain browser targets, files are loaded sequentially within the dashboard entry point document:
1. State parameters (`state.js`) are initialized first.
2. Utilities and core API clients (`utils.js`, `api.js`) are loaded.
3. Feature-specific controller modules are appended.
4. The orchestration bootstraper (`main.js`) initializes the interface and mounts long-running polling handlers safely.

---

## 4. Final File Structure
The modularized frontend structure under the root repository:
```text
public/
├── dashboard.html             # Entry dashboard HTML markup document (No inline script/style)
├── login.html                 # Arabic-first administrator login panel
├── css/
│   └── dashboard.css          # Core visual custom rules (tech-grid background, scrollbars, etc.)
└── js/
    └── dashboard/
        ├── state.js           # Shared client state variables and canned-responses cache
        ├── utils.js           # Escapers and media file identifier helper functions
        ├── api.js             # Central fetch client with global session expiration interceptor
        ├── auth.js            # Admin signout dispatch and UI controllers
        ├── navigation.js      # Sidebar section switcher and visibility toggles
        ├── users.js           # Active connections sidebar rendering and platform filter managers
        ├── chat.js            # Conversation history bubbles rendering and media attachment handlers
        ├── composer.js        # Text composer, quick replies overlay, and base64 transmission pipelines
        ├── conversationControls.js # Admin direct assignee selectors and automated AI toggle widgets
        ├── analytics.js       # Real-time database telemetry counters and Chart.js renderer
        ├── errors.js          # System log table lists and incident resolution dispatchers
        ├── whatsapp.js        # Headless Puppeteer status updates and QR code renderers
        ├── settings.js        # Admin settings inputs collector and sync dispatchers
        ├── broadcast.js       # Direct text broadcast submitter
        └── main.js            # Initial bootstrapping event listeners and polling schedulers
```

---

## 5. Module Responsibilities & Specifications

### 5.1 Dashboard Entry Document (`dashboard.html`)
The static HTML file contains ONLY semantic DOM elements, Tailwind CSS structures, Cairo/Inter/Poppins external font links, Chart.js dependencies, and standard `<script>` script tags. It contains zero inline `<style>` and zero inline `<script>` blocks.

### 5.2 State Management (`state.js`)
Consolidates all reactive states under `window.Dashboard.state`. No other modules are permitted to maintain independent isolated state. Key state parameters include:
* `selectedUserId`: Active customer ID in focus.
* `usersCache`: Fetched list of customer profiles.
* `platformChartInstance` / `messageChartInstance`: Chart.js instances.
* `cannedResponses`: Statically defined quick-response texts.

### 5.3 Central API Client (`api.js`)
Wraps the browser's native `fetch` API under `window.Dashboard.api.request`.
* Intercepts `401 Unauthorized` responses globally.
* Automatically redirects the parent window to `/login` when a session cookie expires or is cleared.
* Prevents redirection loops and preserves session cookies.

### 5.4 Authentication (`auth.js`)
Handles signing out of the system cleanly via `POST /api/auth/logout`, destroying the server-side session, clearing cookies, and redirecting.

### 5.5 Navigation (`navigation.js`)
Controls display and hidden attributes across sections.
* Manages `hidden` class lists on `#chat-section`, `#errors-section`, `#settings-section`, `#whatsapp-section`, and `#analytics-section`.
* Coordinates heading titles and focuses sidebar button CSS configurations dynamically.

### 5.6 Customer and Conversation List (`users.js`)
* Renders active customers based on selected platform filter (`all`, `telegram`, `whatsapp`, `messenger`, `instagram`).
* Integrates unread-only sorting checkboxes.
* Controls badge indicators and online statuses.

### 5.7 Chat Rendering & Media Processing (`chat.js`)
* Dynamically fetches historical transcripts.
* Formats individual bubble nodes according to sender role (`admin` or other platforms).
* Implements direct previewing/renders of multimedia assets (Images, Videos, AMR/MP3 Audios, PDF Documents) securely using `window.Dashboard.utils` format classifiers.

### 5.8 Composer & Direct Sending (`composer.js`)
* Manages text entry inputs and keypress listener triggers.
* Integrates canned quick-text replies when `/` trigger is input.
* Handles file attachments, media previews, and base64 parsing pipelines prior to sending.

### 5.9 Conversation Controls (`conversationControls.js`)
* Drives client AI-automation statuses via `/api/chat/toggle-ai`.
* Triggers custom UI modal prompts for actions confirmation before dispatch.
* Coordinates manual agent assignments.

### 5.10 Analytics & Performance charts (`analytics.js`)
* Updates live dashboard stats via `/api/stats`.
* Destroys and redraws Chart.js doughnut and bar canvas maps.
* Feeds terminal outputs dynamically under `#live-logs-box`.

### 5.11 Error Tracking (`errors.js`)
* Fetches active incidents list and updates `#errors-table-body`.
* Handles incident solvers via `/api/errors/solve`.

### 5.12 WhatsApp Status Gate (`whatsapp.js`)
* Polling status via `/api/whatsapp/status`.
* Implements dynamic QR loading and standby disconnected overlays.

### 5.13 Settings & RAG Context (`settings.js`)
* Collects input fields and syncs channels metadata.
* Overwrites RAG files cleanly.

### 5.14 Broadcast Dispatcher (`broadcast.js`)
* Dispatches broadcast messages to all active channels.

### 5.15 Dashboard Entry Bootstrapper (`main.js`)
Coordinates safe bootstrapping on `DOMContentLoaded`:
1. Executes first-load telemetry pull.
2. Initializes polling loops with original frequency limits (3s stats/history, 5s WhatsApp).
3. Ensures no double-binding of event listeners or timers.

---

## 6. Polling & Event-Listener Architecture
The system relies strictly on central schedulers running in `main.js`:
* `setInterval(fetchStatsAndUsers, 3000)` -> stats, users, logs.
* `setInterval(fetchChatHistory, 3000)` -> message streams.
* `setInterval(fetchWhatsAppStatus, 5000)` -> QR/gateway.

All inline event attributes are fully mapped under `window.Dashboard` for robust, transparent browser routing.

---

## 7. Security Hardening & Safety Controls

### 7.1 Dynamic HTML Generation Safety
To prevent dynamic Cross-Site Scripting (XSS) injections from user-controlled content, a custom escaping utility is implemented in `utils.js`:
```javascript
escapeHTML: function(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
```
All dynamic database logs, error texts, and names are forced through this filter prior to template literals creation.

### 7.2 Static-File Security
The modularized code scripts are hosted strictly as public static files under `/css/` and `/js/`. No private keys, passwords, database passwords, session secrets, or system hashes are present.

---

## 8. Testing & Verification Strategy
Testing covers modular integrations end-to-end:
1. **Automated Static Assertions (`test/dashboard.test.js`):** Checks required assets exist, ensures the markup holds Cairo/Arabic fonts and RTL configurations, verifies IDs, and confirms unauthenticated API accesses are rejected with `401 Unauthorized` JSON objects.
2. **State & Channel Verification:** Ensures database connections, meta webhook responses, and message processing remain completely unchanged.
