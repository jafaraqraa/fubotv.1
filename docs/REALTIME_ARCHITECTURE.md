# Real-Time Architecture — FUThing Platform

This document describes the architectural layout, modules separation, handshake protocols, lifecycle gates, and fallback safety boundaries for Phase 8 real-time updates using Socket.IO.

---

## 1. Core Purpose & Scope
The purpose of Phase 8 is to establish secure, instantaneous server-to-dashboard communications, eliminating the up to 3 to 5-second latency of active REST polling while preserving the robustness of standard HTTP REST calls as initial-data loaders and safety network failovers.

---

## 2. Technology Selection
*   **Engine:** Socket.IO (`^4.8.3`)
*   **Reason for selection:** Battle-tested, built-in session-auth integration, automatic reconnection strategies, room-segment multiplexing, and direct same-origin compatibility out of the box with Express servers.

---

## 3. Real-Time Architecture Diagram

```text
                       [External Platform Channels]
                      (Telegram, WhatsApp, Meta webhook)
                                     │
                                     ▼
                     [Unified Incoming Message Pipeline]
                                     │
                                     ▼
                           [SQLite Persistence]
                           (WAL mode, Transactions)
                                     │
                                     ▼
                        [Real-Time Event Publisher]
                                     │
                                     ▼
                     [Authenticated Socket.IO Server]
                     - Reuses Connect.sid session auth
                     - segment room: 'admins'
                                     │
                                     ▼
                     [Secure Admin Dashboard Client]
                        /js/dashboard/realtime.js
                     - Bounded eventId cache
                     - Tab visibility state managers
```

---

## 4. Initialization & Server Composition
The Express app is integrated into an HTTP server instance using Node.js's native `http` module:
```javascript
const http = require('http');
const httpServer = http.createServer(app);
```
On startup inside `server.js`:
*   `initializeSocketServer(httpServer)` configures the single Socket.IO server cleanly.
*   The application listens on `httpServer.listen(PORT)`, starting Express and the real-time server as a single unified process.
*   Circular dependencies are prevented because the `eventPublisher` holds a passive `io` reference assigned via dependency injection at boot.

---

## 5. Security & Session Authentication Reuse
Socket.IO relies exclusively on the existing cookie-session authentication state:
*   Handshakes are intercepted by `socketAuthMiddleware` in `socketAuth.js`.
*   Handshake cookies parse the `connect.sid` cookie value.
*   Cryptographic signatures are decoupled, extracting the unsigned session ID to query the SQLite `sessions` table directly.
*   If the session record exists, is unexpired, and has an active `userId`, the connection is accepted and registered to the `'admins'` security room.
*   Otherwise, the socket connection is rejected immediately with an `unauthorized` connect_error. No internal details are disclosed.

---

## 6. Persistence Before Emission Rule
The publisher adheres strictly to a transaction-safe persistence-before-emission rule:
1.  Verify, process, and persist data in SQLite (autoritative source of truth).
2.  Upon database success, trigger event publishing from the repository or processor boundaries.
3.  Transmit events over Socket.IO.
This guarantees that the dashboard never processes or renders optimistic successes before records are fully committed.

---

## 7. Event & Payload Design
Every broadcast payload is structured minimally and wrapped in a versioned envelope contract:
```json
{
  "version": 1,
  "eventId": "evt_9979c135-263a-4467",
  "occurredAt": "2026-07-13T12:00:00.000Z",
  "data": {}
}
```
All details like secrets, password hashes, and session keys are strictly omitted.

---

## 8. Dashboard Client & Fallback Safety Schedulers
The client `public/js/dashboard/realtime.js` establishes a single socket connection:
*   **State Primary Mode:** When connected, Socket.IO updates the UI instantly, and high-frequency 3-second polling fallback timers are cleared.
*   **Low-Frequency Reconciliation:** A 45-second background scheduler polls endpoints silently to double-check sync and rectify any missed packets.
*   **Fallback Fallback Mode:** Upon disconnect, the client automatically reactivates the high-frequency 3-second polling loops to ensure continuous availability.
*   **Visiblity Change:** Disables background traffic when the tab is hidden, and triggers a single debounced REST reconciliation on wake.
*   **Event De-duplication:** Tracks and ignores duplicate occurrences of `eventId` using a size-limited cache (maximum 100 entries).
