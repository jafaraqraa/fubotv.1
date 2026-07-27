# DATABASE DOCUMENTATION

This document defines the SQLite database configuration, schema structures, relationships, indexing, migration, and backup recommendations.

---

## 1. SQLite Package & Version
* **Library:** `better-sqlite3` (v12.11.1)
* **Selection Rationale:** Extremely fast, provides synchronous execution native bindings for Node, requires no heavy external configurations, maintains CommonJS format natively, and simplifies transaction rollbacks.

---

## 2. Database Path and Configuration
* **Default Database Path:** `data/app.db` (created automatically on startup if the directory is missing).
* **Environment Variable:** `SQLITE_DB_PATH`
* **Configuration settings (PRAGMAs):**
  * `PRAGMA foreign_keys = ON;` (Forces constraint cascade deletions).
  * `PRAGMA busy_timeout = 5000;` (Avoids locked-database errors under multiple connections).
  * `PRAGMA journal_mode = WAL;` (Enables Write-Ahead Logging for high-concurrency reads and writes).

---

## 3. Migration Architecture
* **System:** Lightweight versioned migration system.
* **History Table:** `schema_migrations`
* **Fields:**
  * `version` (TEXT PRIMARY KEY) - Idempotent sequential numeric version (e.g., `'001'`, `'002'`).
  * `name` (TEXT NOT NULL) - Filename.
  * `applied_at` (DATETIME DEFAULT CURRENT_TIMESTAMP)

---

## 4. Complete Schema & Relationships

### 4.1 Table: `customers`
* **Purpose:** Stores root user identities.
* **Columns:**
  * `id` (TEXT PRIMARY KEY) — UUID.
  * `display_name` (TEXT NOT NULL)
  * `created_at` (DATETIME DEFAULT CURRENT_TIMESTAMP)
  * `updated_at` (DATETIME DEFAULT CURRENT_TIMESTAMP)

### 4.2 Table: `channel_accounts`
* **Purpose:** Maps communication channel identities.
* **Columns:**
  * `id` (TEXT PRIMARY KEY) — UUID.
  * `customer_id` (TEXT NOT NULL) — Foreign key references `customers(id)` ON DELETE CASCADE.
  * `channel` (TEXT NOT NULL) — `'telegram'`, `'whatsapp'`, `'messenger'`, `'instagram'`.
  * `external_user_id` (TEXT NOT NULL) — Numeric ID (Telegram) or phone address (WhatsApp).
  * `username` (TEXT)
  * `phone_number` (TEXT)
  * `profile_data` (TEXT) — JSON String.
  * `created_at` (DATETIME)
  * `updated_at` (DATETIME)
* **Constraints:** `UNIQUE(channel, external_user_id)`

### 4.3 Table: `conversations`
* **Purpose:** Persists conversational metadata, unread counters, assignments, and automation states.
* **Columns:**
  * `id` (TEXT PRIMARY KEY) — UUID.
  * `customer_id` (TEXT NOT NULL) — References `customers(id)`.
  * `channel_account_id` (TEXT NOT NULL) — References `channel_accounts(id)`.
  * `channel` (TEXT NOT NULL)
  * `status` (TEXT DEFAULT 'active')
  * `is_ai_enabled` (INTEGER DEFAULT 1) — 1/0 boolean flag.
  * `assignee` (TEXT DEFAULT 'ai') — Agent name or `'ai'`.
  * `unread_count` (INTEGER DEFAULT 0)
  * `last_message_at` (DATETIME)
* **Indexes:** `CREATE INDEX idx_conversations_last_msg ON conversations(last_message_at DESC);`

### 4.4 Table: `messages`
* **Purpose:** All conversation message logs, agent replies, and notes.
* **Columns:**
  * `id` (TEXT PRIMARY KEY) — UUID.
  * `conversation_id` (TEXT NOT NULL) — References `conversations(id)`.
  * `channel` (TEXT NOT NULL)
  * `external_message_id` (TEXT) — Uniquely identifies incoming channel events.
  * `direction` (TEXT NOT NULL) — `'inbound'`, `'outbound'`.
  * `sender_type` (TEXT NOT NULL) — `'user'`, `'admin'`, `'ai'`.
  * `role` (TEXT NOT NULL) — `'user'`, `'assistant'`.
  * `message_type` (TEXT DEFAULT 'text') — `'text'`, `'image'`, `'audio'`, `'video'`, `'document'`, `'note'`.
  * `content` (TEXT NOT NULL)
  * `is_internal_note` (INTEGER DEFAULT 0) — 1/0
  * `is_ai_generated` (INTEGER DEFAULT 0) — 1/0
  * `is_read` (INTEGER DEFAULT 0) — 1/0
  * `delivery_status` (TEXT DEFAULT 'delivered')
  * `metadata` (TEXT) — JSON String.
* **Indexes:**
  * `CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at ASC);`
  * `CREATE UNIQUE INDEX idx_messages_external ON messages(channel, external_message_id) WHERE external_message_id IS NOT NULL;`

### 4.5 Table: `settings`
* **Purpose:** Stores persistent non-secret application settings.
* **Columns:**
  * `key` (TEXT PRIMARY KEY)
  * `value` (TEXT)
  * `value_type` (TEXT)

### 4.6 Table: `activity_logs`
* **Purpose:** Persists latest operational actions.
* **Columns:**
  * `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
  * `time` (TEXT NOT NULL)
  * `action` (TEXT NOT NULL)

### 4.7 Table: `application_errors`
* **Purpose:** Technical incident tracking.
* **Columns:**
  * `id` (INTEGER PRIMARY KEY) — Date timestamp integer.
  * `date` (TEXT NOT NULL)
  * `time` (TEXT NOT NULL)
  * `type` (TEXT NOT NULL)
  * `message` (TEXT NOT NULL)
  * `solved` (INTEGER DEFAULT 0)

### 4.8 Table: `administrators`
* **Purpose:** Stores secure dashboard administrator accounts.
* **Columns:**
  * `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
  * `username` (TEXT NOT NULL UNIQUE)
  * `password_hash` (TEXT NOT NULL) — Stored securely as a bcrypt hash.
  * `display_name` (TEXT)
  * `is_active` (INTEGER DEFAULT 1) — 1/0
  * `created_at` (DATETIME DEFAULT CURRENT_TIMESTAMP)
  * `updated_at` (DATETIME DEFAULT CURRENT_TIMESTAMP)
  * `last_login_at` (DATETIME)

### 4.9 Table: `sessions`
* **Purpose:** Persists server-side user session data across reboots.
* **Columns:**
  * `sid` (TEXT PRIMARY KEY) — Unique Session ID.
  * `sess` (TEXT NOT NULL) — Session JSON parameters.
  * `expired` (DATETIME NOT NULL) — Expiration ISO string.
* **Indexes:** `CREATE INDEX idx_sessions_expired ON sessions(expired);`

---

## 5. Security & Secret Protection
* Absolute zero secrets (BOT_TOKEN, API keys, WhatsApp sessions) are stored in the SQLite tables. They remain 100% inside process memory and local `.env` variables.

---

## 6. Inspection Commands
To inspect database files directly from the command line:
```bash
sqlite3 data/app.db "SELECT * FROM schema_migrations;"
sqlite3 data/app.db "SELECT username FROM administrators;"
```
