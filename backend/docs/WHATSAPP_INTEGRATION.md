# WhatsApp Multi-Provider System Architecture and API Documentation

This document outlines the architecture, lifecycles, database schemas, webhooks, and sequence flows of the Provider-based WhatsApp Integration system in the platform.

---

## 1. Architecture Diagram

```
                        +----------------------------+
                        |  Chat Dashboard UI (Admin) |
                        +--------------+-------------+
                                       |
                                       v REST APIs
                        +--------------+-------------+
                        |   Express Backend Router   |
                        +--------------+-------------+
                                       |
                                       v
                        +--------------+-------------+
                        |  WhatsAppProviderManager   |
                        +-------+--------------+-----+
                                |              |
            +-------------------+              +-------------------+
            | (Instantiates)                                       | (Instantiates)
            v                                                      v
+-----------+------------+                              +----------+-------------+
|   WhatsAppWebProvider  |                              |WhatsAppBusinessCloudPr |
+-----------+------------+                              +----------+-------------+
            | (Wraps)                                              | (Pings Meta Graph)
            v                                                      v
     [whatsapp-web.js]                                      [Meta Cloud API]
```

---

## 2. Provider Lifecycle

```
    [Unconfigured / Standby]
               |
               v Config Supplied
          [initialize()]
               |
               +---> (If Web) ---> [qr] Event ---> [انتظار المسح] Status
               |                                           |
               |                                       [ready] Event
               |                                           |
               +-------------------------------------------v
               |
               v
           [متصل] Status (Active & Ready)
               |
               +---> [sendMessage()] / [receiveMessage()]
               |
          [destroy()] Called
               |
               v
         [غير متصل] Status (Resources Released)
```

---

## 3. Database Schema

### `whatsapp_tenant_configs`
This table isolates credentials, sessions, and configurations per tenant:

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `tenant_id` | TEXT | PRIMARY KEY | The unique tenant/workspace identifier (defaults to `'default'`). |
| `provider_type` | TEXT | NOT NULL DEFAULT `'web'` | `'web'` (for `whatsapp-web.js`) or `'cloud'` (for Cloud API). |
| `config_json` | TEXT | NOT NULL DEFAULT `'{}'` | JSON serialized credentials (e.g. `accessToken`, `phoneNumberId`, `verifyToken`). |
| `enabled` | INTEGER | DEFAULT 1 | Whether this gateway configuration is enabled. |
| `created_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | Record creation timestamp. |
| `updated_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | Last update timestamp. |

---

## 4. API Documentation

### Get WhatsApp Config
* **Endpoint**: `GET /api/whatsapp/config`
* **Query Params**: `tenantId` (optional, defaults to `'default'`)
* **Response**:
  ```json
  {
    "success": true,
    "providerType": "cloud",
    "config": {
      "phoneNumberId": "10928374829",
      "verifyToken": "my_verify_token",
      "accessToken": "EAAQ..." // Masked for security
    }
  }
  ```

### Save WhatsApp Config & Switch Provider
* **Endpoint**: `POST /api/whatsapp/config`
* **Body Payload**:
  ```json
  {
    "tenantId": "default",
    "providerType": "cloud",
    "config": {
      "phoneNumberId": "10928374829",
      "verifyToken": "my_verify_token",
      "accessToken": "EAAQ..." // Send masked string to preserve old token or cleartext to overwrite
    }
  }
  ```
* **Response**:
  ```json
  {
    "success": true,
    "message": "تم تحديث إعدادات بوابة واتساب وتفعيل المزود بنجاح!"
  }
  ```

---

## 5. Webhook Flow (Cloud API)

### 1. Webhook Handshake (GET)
* **Webhook Verification URL**: `GET /api/webhooks/whatsapp/:tenantId`
* **Flow**:
  1. Meta Developer Portal triggers GET handshake with `hub.mode`, `hub.verify_token`, and `hub.challenge`.
  2. Router fetches `config_json` for `tenantId` from SQLite.
  3. Validates `hub.verify_token` against the stored `verifyToken`.
  4. Returns `hub.challenge` plain-text to complete verification.

### 2. Event Delivery (POST)
* **Webhook Message Receiver URL**: `POST /api/webhooks/whatsapp/:tenantId`
* **Flow**:
  1. Meta POSTs JSON payload containing incoming message.
  2. Server parses message:
     - For Text: Normalizes text content directly.
     - For Media (Image, Audio, Video, Doc): Fetches download URL via Meta `/media` API, downloads file to `public/uploads`, and assigns local path.
  3. Passes normalized payload to the centralized `processIncomingMessage(normalized)`.

---

## 6. Sequence Diagrams

### Message Reception and AI Auto-Reply

```
Meta Cloud/Web Client       Webhooks Router        Incoming Message Processor          AI Service
         |                         |                            |                           |
         |----(Inbound MSG)------->|                            |                           |
         |                         |----(Normalize & Process)-->|                           |
         |                         |                            |----(RAG/Context/AI)------>|
         |                         |                            |                           |
```
