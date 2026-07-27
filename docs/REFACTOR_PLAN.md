# SAFE REFACTORING & MODULARIZATION PLAN — Phase 1

This document outlines the step-by-step plan for refactoring the customer support platform into a modular, robust architecture using SQLite for data persistence.

---

## 1. Refactoring Goals
* **Modular Separation of Concerns:** Move from a single-file monolith (`server.js`) to a clean, multi-layered architecture (Routes, Services, Adapters, Repositories).
* **Robust Data Persistence:** Migrate in-memory storage to a reliable, lightweight SQLite database.
* **Preserve Functionality:** Keep existing dashboard APIs, features, and Arabic-first RTL support intact.
* **Prevent Message Loss:** Use transactions to prevent message loss on server restarts.
* **Unified Message Interface:** Standardize communication across Telegram, WhatsApp, and other channels.

### Non-Goals:
* Adding new, unsupported channels or features.
* Completely rewriting the frontend dashboard layout.
* Migrating to PostgreSQL or other heavy database engines.

---

## 2. Proposed Architecture & Project Tree

To separate concerns, we will reorganize the project into the following directory structure:

```text
/ (repository root)
├── src/
│   ├── config/                 # Environment validation and constants
│   ├── database/               # SQLite connection and migration runner
│   │   ├── migrations/         # SQL schema migration files
│   │   └── connection.js       # db instantiation
│   ├── repositories/           # Data access objects (SQL writers and readers)
│   │   ├── customer.repo.js
│   │   ├── message.repo.js
│   │   └── error.repo.js
│   ├── adapters/               # External channel drivers (Standard interfaces)
│   │   ├── base.adapter.js     # Shared abstract Adapter
│   │   ├── telegram.adapter.js # Telegraf integration logic
│   │   └── whatsapp.adapter.js # whatsapp-web.js integration logic
│   ├── services/               # Core business services
│   │   ├── ai.service.js       # OpenRouter interface
│   │   ├── rag.service.js      # Keyword context search
│   │   └── message.router.js   # Central logic mapping user texts to AI or manual mode
│   └── routes/                 # HTTP Express routers
│       ├── api.routes.js       # Dashboard APIs
│       └── webhook.routes.js   # Meta callback verification and endpoints
├── public/                     # Frontend dashboard and landing assets
├── package.json
└── server.js                   # Minimal startup entry point
```

---

## 3. Dependency Flow & Architecture Boundaries

```text
       [Express Routes] -------------> [Message Router Service] <------------- [Adapters]
              |                                 |                                  |
              v                                 v                                  v
    [Dashboard Controller] ----------> [Business Services] -----------> [Adapters Standard Interface]
              |                                 |                                  |
              +---------------------------------+----------------------------------+
                                                |
                                                v
                                    [Data Access Repositories]
                                                |
                                                v
                                        [SQLite Database]
```

---

## 4. Unified Internal Message Model

We will define a standardized message interface to normalize payloads from all channels:

```typescript
interface UnifiedMessage {
  id: string;              // SQLite message row ID (UUID)
  externalId: string;      // Original message ID from the external channel
  userId: string;          // Customer platform identifier
  channel: 'telegram' | 'whatsapp' | 'messenger' | 'instagram';
  sender: 'user' | 'admin' | 'ai';
  text: string;            // Text content or local asset URL
  type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'note';
  timestamp: Date;
  status: 'pending' | 'delivered' | 'failed' | 'read';
}
```

---

## 5. Future Central Message-Router Design

Instead of duplicate handling logic, incoming messages will go through a **Central Message Router**:

```javascript
class MessageRouter {
  async handleInbound(unifiedMsg) {
    // 1. Prevent duplicate messages
    if (await messageRepo.existsByExternalId(unifiedMsg.externalId)) return;

    // 2. Fetch or create the customer profile
    let customer = await customerRepo.findByIdAndChannel(unifiedMsg.userId, unifiedMsg.channel);
    if (!customer) {
      customer = await customerRepo.create({
        userId: unifiedMsg.userId,
        channel: unifiedMsg.channel,
        name: unifiedMsg.username,
        isAIEnabled: true,
        assignee: 'ai'
      });
    }

    // 3. Save incoming message to SQLite
    await messageRepo.save(unifiedMsg);

    // 4. Determine response mode (AI or Manual)
    if (customer.isAIEnabled && customer.assignee === 'ai') {
      const responseText = await aiService.generateResponse(customer, unifiedMsg.text);
      await this.sendOutbound(customer, responseText);
    } else {
      // Manual mode: update the dashboard with the new message
      realtimeService.notifyDashboard('new_message', unifiedMsg);
    }
  }

  async sendOutbound(customer, text, type = 'text') {
    const adapter = adapterFactory.get(customer.channel);
    const externalMsg = await adapter.sendMessage(customer.userId, text, type);
    await messageRepo.save({
      userId: customer.userId,
      channel: customer.channel,
      sender: 'ai',
      text: text,
      type: type,
      externalId: externalMsg.id
    });
  }
}
```

---

## 6. Proposed SQLite Schema Design

We will use **SQLite** with raw SQL queries or a lightweight library (like `better-sqlite3`) to handle data persistence:

### Table Schema Definitions

#### 1. `customers`
Stores customer profiles and communication preferences:
* `id` (TEXT, PRIMARY KEY) - UUID.
* `userId` (TEXT, NOT NULL) - Platform-specific unique ID.
* `channel` (TEXT, NOT NULL) - One of `'telegram'`, `'whatsapp'`, `'messenger'`, `'instagram'`.
* `name` (TEXT, NOT NULL) - Customer display name.
* `isAIEnabled` (INTEGER, DEFAULT 1) - 1 for enabled, 0 for manual response mode.
* `assignee` (TEXT, DEFAULT 'ai') - Staff member ID or `'ai'`.
* `unreadCount` (INTEGER, DEFAULT 0) - Counter for unread messages.
* `lastSeen` (TEXT) - Last message timestamp.
* **Constraints:** `UNIQUE(userId, channel)`.

#### 2. `messages`
Stores all conversation records, automated replies, and internal notes:
* `id` (TEXT, PRIMARY KEY) - UUID.
* `externalId` (TEXT) - Original external message identifier.
* `customerId` (TEXT, FOREIGN KEY REFERENCES `customers(id)`) - The associated customer.
* `sender` (TEXT, NOT NULL) - One of `'user'`, `'admin'`, `'ai'`.
* `text` (TEXT, NOT NULL) - Message content or file attachment URL.
* `type` (TEXT, DEFAULT 'text') - Message type (text, image, audio, video, document, note).
* `timestamp` (DATETIME, DEFAULT CURRENT_TIMESTAMP) - Message date and time.
* `status` (TEXT, DEFAULT 'delivered') - One of `'pending'`, `'delivered'`, `'failed'`, `'read'`.
* **Indexes:** `CREATE INDEX idx_msg_cust ON messages(customerId, timestamp DESC)`.

#### 3. `errors`
Stores system and connection incidents:
* `id` (INTEGER, PRIMARY KEY AUTOINCREMENT) - Unique incident ID.
* `date` (TEXT, NOT NULL) - Date string.
* `time` (TEXT, NOT NULL) - Time string.
* `type` (TEXT, NOT NULL) - Issue category or origin.
* `message` (TEXT, NOT NULL) - Error description.
* `solved` (INTEGER, DEFAULT 0) - 1 for resolved, 0 for open.

#### 4. `settings`
Stores configuration parameters (removing the need to rewrite `.env` dynamically):
* `key` (TEXT, PRIMARY KEY) - Unique setting name.
* `value` (TEXT) - Config value.

---

## 7. Incremental Migration Phases

We will migrate the monolithic codebase to the modular architecture in 4 low-risk phases:

### Phase A: Setup and Database Implementation
* **Goal:** Set up SQLite and create repositories without breaking the monolithic `server.js` execution flow.
* **Steps:**
  1. Create `src/database/` and write migration scripts to define the database schema.
  2. Implement repository files under `src/repositories/`.
  3. Write unit tests to verify database reads, writes, and constraints.
* **Rollback Strategy:** Delete the sqlite database file. The application continues running using the in-memory `botData` fallback.

### Phase B: Business Logic and AI Extraction
* **Goal:** Extract AI logic, context lookup (RAG), and setting configurations into dedicated service files.
* **Steps:**
  1. Create `src/services/ai.service.js` and extract OpenRouter routing logic.
  2. Create `src/services/rag.service.js` and wrap synchronous `knowledge.txt` text parsing.
  3. Wire services to use the SQLite `settings` and `messages` tables.
* **Rollback Strategy:** Keep copy of extracted routines inside `server.js` and switch back using feature flags if needed.

### Phase C: Channel Adapters & Message Routing
* **Goal:** Extract Telegram and WhatsApp event handlers into separate adapters and route messages through the central router.
* **Steps:**
  1. Create `src/adapters/telegram.adapter.js` and move Telegraf bot setup.
  2. Create `src/adapters/whatsapp.adapter.js` and move the WhatsApp client setup.
  3. Connect adapters to the new central `MessageRouter`.
* **Rollback Strategy:** Switch back to the legacy `server.js` single-file endpoints.

### Phase D: Route Cleanup and Dashboard Integration
* **Goal:** Move Express endpoints into dedicated routes and update the dashboard UI to call the streamlined API.
* **Steps:**
  1. Reorganize Express routes into `src/routes/api.routes.js`.
  2. Update static dashboard endpoints to retrieve historical messages and states from SQLite.
  3. Run comprehensive integration and verification tests.

---

## 8. Definition of Done
The refactoring is complete when:
1. **Zero Data Loss:** All messages, customer states, and settings persist reliably across application restarts.
2. **Clean Project Structure:** No business logic, third-party integrations, or database writes remain in `server.js`.
3. **API Compatibility:** The dashboard continues to work seamlessly without visual regressions or broken Arabic translations.
4. **Passing Tests:** All unit and integration tests pass consistently.
