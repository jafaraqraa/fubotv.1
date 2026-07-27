# Polling Architecture Baseline — FUThing Administration Portal

This document contains a comprehensive audit and specification of the pre-WebSocket polling baseline as of Phase 7, satisfying Task 2 of Phase 8.

---

## 1. Inventory of Polling Schedulers

The system relies on three distinct central `setInterval` polling loops declared in `public/js/dashboard/main.js` and executed upon standard `DOMContentLoaded` completion:

| Timer Name | Interval | Location | Target Endpoint | Primary DOM Sections Updated |
| :--- | :--- | :--- | :--- | :--- |
| `fetchStatsAndUsers` | **3000ms** | `public/js/dashboard/analytics.js` | `GET /api/stats`<br>`GET /api/users` | `#stat-users`, `#stat-messages`, `#stat-status`, `#live-logs-box`, `#badge-errors-count`, `#users-list` |
| `fetchChatHistory` | **3000ms** | `public/js/dashboard/chat.js` | `GET /api/chat/:selectedUserId` | `#chat-box` |
| `fetchWhatsAppStatus` | **5000ms** | `public/js/dashboard/whatsapp.js` | `GET /api/whatsapp/status` | `#wa-connection-badge`, `#badge-wa-status`, `#wa-qr-container`, `#wa-logout-btn` |

---

## 2. Dynamic Update Workflows

### 2.1 Statistics & Logs Polling (`fetchStatsAndUsers`)
*   **Trigger:** Automated interval tick every 3 seconds.
*   **Behavior:** Pulls database telemetry, recent activity logs, and active configurations. Updates total subscribers and interactions counters. Redraws Chart.js canvases (doughnut distribution and weekly traffic) when changes are detected. Re-populates the `#live-logs-box` system console and unread error badges. Refetches active customer profiles and re-renders the conversation sidebar.
*   **Scope:** Global.

### 2.2 Chat History Polling (`fetchChatHistory`)
*   **Trigger:** Automated interval tick every 3 seconds, bound strictly to the condition that `window.Dashboard.state.selectedUserId` is not null.
*   **Behavior:** Fetches direct message threads and staff notes. Decodes attachments (Images, Videos, AMR/MP3 Audios, PDF Documents) using mime-type format helpers, constructs message bubble layouts, and scrolls `#chat-box` to bottom height.
*   **Scope:** Active Conversation.

### 2.3 WhatsApp Gateway Polling (`fetchWhatsAppStatus`)
*   **Trigger:** Automated interval tick every 5 seconds.
*   **Behavior:** Pulls the headless Puppeteer gateway status from the backend. Dynamically updates connection standby indicators and injects generated QR codes into `#wa-qr-container` when waiting for client authentication.
*   **Scope:** WhatsApp Tab & Sidebar Status.

---

## 3. Operational Analysis and Structural Limitations

### 3.1 Overlapping and Duplicate Timer Risks
*   *Timer Overlap:* Because polling triggers sequentially using `setInterval` rather than a recursive self-calling `setTimeout` promise chain, an HTTP request that experiences network lag beyond 3 seconds could overlap with subsequent intervals. This creates network congestion and duplicate state processing.
*   *Duplicate Timer Creation:* During section toggles (inside `navigation.js`), `showSection()` re-triggers `fetchStatsAndUsers()` or `fetchWhatsAppStatus()` immediately, bypassing intervals. If not managed carefully, this can cause duplicate parallel execution pipelines.

### 3.2 Expected Latency & request Frequency
*   **Maximum Connected Latency:** State mutations (e.g., a customer sending an incoming message) can take up to **3000ms** to render on the admin's workspace, creating a laggy user experience.
*   **Request Volume:**
    *   `fetchStatsAndUsers`: 20 requests per minute
    *   `fetchChatHistory`: 20 requests per minute (when active)
    *   `fetchWhatsAppStatus`: 12 requests per minute
    *   **Total baseline traffic:** Up to **52 HTTP requests per minute per active browser tab**, placing unnecessary processing loads on Express and SQLite.

### 3.3 Network and Lifecycle Behaviors
*   **Network Failure:** If a user loses connection, requests fail silently with console exceptions. Upon restoration, requests resume, but any transient intermediate failures are lost unless full page refreshes occur.
*   **Session Expiration:** Upon session cookie invalidation, the 3-second polling loops receive `401 Unauthorized` responses and globally redirect the page to `/login`.
*   **Browser Sleep & Tab Visibility:** Polling loops continue running aggressively in the background when the tab is inactive or hidden, wasting client CPU cycles and inflating server request traffic.
