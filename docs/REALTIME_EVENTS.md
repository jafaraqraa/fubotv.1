# Real-Time Event Contract — FUThing Portal

This document specifies the standard real-time envelope structure and individual event contracts for Socket.IO communications in Phase 8.

---

## 1. Standard Event Envelope Contract
Every event emitted from the backend server to the admin dashboard conforms strictly to the following schema structure, ensuring idempotency and trace security (Tasks 8 & 9):

```json
{
  "version": 1,
  "eventId": "uuid-v4-or-unique-safe-id",
  "occurredAt": "ISO-8601-UTC-timestamp",
  "data": {}
}
```

### Required Fields
*   `version` (Type: `integer`): Contract specification version (currently `1`).
*   `eventId` (Type: `string`): Cryptographically random unique identifier. Used by dashboard to prevent duplicate render processing.
*   `occurredAt` (Type: `string`): High-precision UTC timestamp representing when state persistence succeeded in SQLite.
*   `data` (Type: `object`): Event-specific payload.

---

## 2. Event Catalog & Payload Contracts

### 2.1 `realtime:ready`
*   **Direction:** Server-to-Client (S -> C)
*   **Trigger:** Dispatched automatically upon successful Socket.IO handshake authentication.
*   **Payload:**
    ```json
    {
      "message": "Connected to real-time system",
      "admin": {
        "username": "admin",
        "displayName": "المدير العام"
      }
    }
    ```

### 2.2 `message:created`
*   **Direction:** S -> C
*   **Trigger:** Dispatched when a new customer reply, AI automation reply, manual agent response, or private internal note is successfully written into SQLite.
*   **Payload:**
    ```json
    {
      "userId": "tg_user_123",
      "sender": "customer",
      "text": "Hello, I have a question.",
      "type": "text",
      "isNote": false,
      "time": "12:00 م"
    }
    ```

### 2.3 `unread:updated`
*   **Direction:** S -> C
*   **Trigger:** Dispatched when a customer's unread counter is incremented or reset (e.g. read clearance).
*   **Payload:**
    ```json
    {
      "userId": "tg_user_123",
      "unreadCount": 3
    }
    ```

### 2.4 `customer:created` / `customer:updated`
*   **Direction:** S -> C
*   **Trigger:** Dispatched when a new customer registers on any communication channel or their attributes are mutated (e.g., active flags, lastSeen timestamps).
*   **Payload:**
    ```json
    {
      "id": "tg_user_123",
      "name": "Ahmed",
      "platform": "telegram",
      "unreadCount": 0,
      "isAIEnabled": true,
      "lastSeen": "12:05 م"
    }
    ```

### 2.5 `conversation:ai-updated`
*   **Direction:** S -> C
*   **Trigger:** Dispatched when the AI state (Enabled/Disabled) is modified for a specific user thread.
*   **Payload:**
    ```json
    {
      "userId": "tg_user_123",
      "isAIEnabled": false
    }
    ```

### 2.6 `conversation:assignment-updated`
*   **Direction:** S -> C
*   **Trigger:** Dispatched when a conversation is assigned to a different staff member.
*   **Payload:**
    ```json
    {
      "userId": "tg_user_123",
      "assignee": "احمد"
    }
    ```

### 2.7 `stats:updated`
*   **Direction:** S -> C
*   **Trigger:** Dispatched when telemetry indicators change (counters increment, status changes, new logs are pushed).
*   **Payload:**
    ```json
    {
      "usersCount": 14,
      "messagesCount": 112,
      "activeErrorsCount": 0,
      "status": "نشط"
    }
    ```

### 2.8 `activity-log:created`
*   **Direction:** S -> C
*   **Trigger:** Dispatched when a new entry is appended to the system log in SQLite.
*   **Payload:**
    ```json
    {
      "time": "12:05 م",
      "action": "تم تحديث إعدادات تيليجرام"
    }
    ```

### 2.9 `application-error:created` / `application-error:updated`
*   **Direction:** S -> C
*   **Trigger:** Dispatched when a backend error occurs, or when an error is resolved by the administrator.
*   **Payload:**
    ```json
    {
      "id": 1,
      "type": "فشل جلب الملف",
      "message": "Error reading template file",
      "solved": false,
      "date": "2026-07-13",
      "time": "12:00 م"
    }
    ```

### 2.10 `whatsapp:status-updated`
*   **Direction:** S -> C
*   **Trigger:** Dispatched when the headless Puppeteer gateway status or QR code payload changes.
*   **Payload:**
    ```json
    {
      "status": "انتظار المسح",
      "qr": "data:image/png;base64,..."
    }
    ```

---

## 3. Security and Protection Policies
*   **No credentials or secrets:** Event payloads must never include plaintext passwords, hashes, session identifiers, or environment keys.
*   **RTL and Escaper preservation:** Content text must be escaped on client modules using `window.Dashboard.utils.escapeHTML` prior to dynamic DOM injection.
