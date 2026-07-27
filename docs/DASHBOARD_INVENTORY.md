# Dashboard Inventory — FUThing Administration Portal

This document contains a comprehensive, itemized inventory of all components, styling, states, variables, functions, and endpoints of the administration dashboard as of Phase 6. This serves as the precise behavior baseline for Phase 7 modularization.

## 1. File Metadata
* **File Path:** `public/dashboard.html`
* **Total File Size:** 92 KB (approx. 94,200 bytes)
* **Total Line Count:** 1498 lines
* **HTML Markup Line Count:** Lines 1 - 535 (approx. 535 lines)
* **Inline CSS Line Count:** Lines 30 - 41 (approx. 12 lines)
* **Inline JavaScript Line Count:** Lines 537 - 1496 (approx. 960 lines)

## 2. External Assets & Dependencies
### External Stylesheets
* **Cairo, Inter, & Poppins Fonts:** `https://fonts.googleapis.com/css2?family=Poppins:wght@750&family=Inter:wght@400;500;600&family=Cairo:wght@400;600;700&display=swap`

### External Scripts
* **Tailwind CSS Utility Engine:** `https://cdn.tailwindcss.com`
* **Chart.js Visualization Library:** `https://cdn.jsdelivr.net/npm/chart.js`

---

## 3. Frontend State Variables
The inline script maintains the following global states:
* `selectedUserId` (Type: `string | null`): Currently selected customer/user ID in the active chat view.
* `isModelLoaded` (Type: `boolean`): Sync flag ensuring AI model selector matches server config once.
* `isKnowledgeLoaded` (Type: `boolean`): Sync flag ensuring knowledge textarea matches server base once.
* `isPromptLoaded` (Type: `boolean`): Sync flag ensuring prompt textarea matches server instructions once.
* `isAdminIdLoaded` (Type: `boolean`): Sync flag ensuring admin Telegram notification ID matches once.
* `isWaAutoReplyLoaded` (Type: `boolean`): Sync flag ensuring WhatsApp auto-reply setting matches once.
* `isMetaVerifyLoaded` (Type: `boolean`): Sync flag for Meta verify token input once.
* `isMessengerLoaded` (Type: `boolean`): Sync flag for FB page token input once.
* `isInstagramLoaded` (Type: `boolean`): Sync flag for Instagram token input once.
* `isMessengerAutoReplyLoaded` (Type: `boolean`): Sync flag for FB Messenger auto-reply checkbox once.
* `isInstagramAutoReplyLoaded` (Type: `boolean`): Sync flag for Instagram auto-reply checkbox once.
* `usersCache` (Type: `Array`): Client cache containing list of all fetched active connections.
* `pendingToggleUserId` (Type: `string | null`): Temporarily stores selected user ID for the AI-toggle action.
* `currentChatFilter` (Type: `string`): Filter channel filter ('all', 'telegram', 'whatsapp', 'messenger', 'instagram').
* `showUnreadOnly` (Type: `boolean`): Filter flag toggling whether to display unread conversations only.
* `platformChartInstance` (Type: `Chart | null`): Keeps reference to the platform-distribution doughnut chart.
* `messageChartInstance` (Type: `Chart | null`): Keeps reference to the weekly volume traffic chart.
* `pendingSettingsPayload` (Type: `Object | null`): Stores payload for the pending settings synchronization.
* `pendingSettingsType` (Type: `string`): Stores settings type ('ai', 'telegram', 'whatsapp', 'messenger', 'instagram', 'meta').
* `currentMessageType` (Type: `string`): Active mode for response writing ('reply' or 'note').
* `selectedMediaFile` (Type: `File | null`): Currently staged local media attachment for direct transmission.
* `cannedResponses` (Type: `Array`): Static array of quick-text response triggers:
  - `/ترحيب`
  - `/حساب`
  - `/توصيل`
  - `/دوام`

---

## 4. Function Inventory
* `showSection(sectionId)`: Switches display between core views (Chat, Errors, Settings, WhatsApp, Analytics) and toggles active sidebar classes.
* `setChatFilter(filter)`: Applies selected channel filter on active conversation lists.
* `toggleUnreadFilter()`: Toggles display of unread conversations only.
* `renderUsersList()`: Renders customer list dynamically under `#users-list` using filters and `usersCache`.
* `renderAnalyticsCharts(platforms, messagesCount)`: Creates/re-creates Chart.js instances for performance tracking.
* `fetchStatsAndUsers()`: Primary polling fetch pulling server-side telemetry, database stats, terminal logs, and system configs.
* `fetchErrors()`: Pulls unresolved incident logs and populates the errors table.
* `solveError(id)`: Flags a system incident log as resolved.
* `selectUser(userId)`: Focuses workspace on selected customer, updates titles, toggles control displays, and triggers chat retrieval.
* `assignChat(userId, assignee)`: Assigns conversation assignee manual worker or AI.
* `triggerFileInput()`: Simulates click on hidden attachment file input.
* `handleFileSelection()`: Handles selected local media metadata staging.
* `clearMediaUpload()`: Clears staged media file and resets input preview elements.
* `setMessageType(type)`: Switches composer between direct replies (Blue styling) and internal notes (Amber styling).
* `detectCannedResponseTrigger(element)`: Displays popup overlay when '/' trigger prefix is entered in input.
* `selectCannedResponse(text)`: Overwrites input with selected quick-text.
* `handleInputKey(event)`: Dispatches text submission on Enter keypress.
* `openSettingsConfirmModal(type, payload, titleText, descText, iconLabel, btnColorClass)`: Triggers modal confirmation before sync of configs.
* `openConfirmModal(userId, userName, currentAIState)`: Triggers modal confirmation for toggling bot state.
* `closeConfirmModal()`: Cleanly closes modal.
* `executeToggleAI()`: Dispatches server-side toggle for AI enabled status on current customer.
* `fetchChatHistory()`: Fetches message transcripts, processes file types, and updates message bubbles in `#chat-box`.
* `sendDirectMessage()`: Transmits text payload or local media attachment to customer.
* `saveKnowledgeBase()`: Overwrites core `knowledge.txt` content.
* `saveNewSettingsPayload(payload, type)`: Internal handler performing settings synchronizations.
* `executeSaveSettings()`: Coordinates save configurations confirmations.
* `sendBroadcast()`: Dispatches message to all active channels.
* `fetchWhatsAppStatus()`: Polls gateway connectivity and updates QR displays or connection badges.
* `logoutWhatsApp()`: Requests termination of active WhatsApp session.
* `submitAISettings()`: Collects inputs and triggers AI configuration modal.
* `submitTelegramSettings()`: Collects inputs and triggers Telegram bot configuration modal.
* `submitWhatsAppSettings()`: Collects inputs and triggers WhatsApp auto-reply configuration modal.
* `submitMessengerSettings()`: Collects inputs and triggers FB Messenger configuration modal.
* `submitInstagramSettings()`: Collects inputs and triggers Instagram configuration modal.
* `submitMetaVerifySettings()`: Collects inputs and triggers Webhook token verification modal.
* `logoutAdmin()`: Terminates backend administrator dashboard session.

---

## 5. API Endpoints Covered
* `GET /api/stats` -> Core server metrics, system logs, error telemetry, config parameters.
* `GET /api/users` -> Active connections list.
* `GET /api/errors` -> Active incident logs.
* `POST /api/errors/solve` -> Resolves incident item.
* `POST /api/chat/assign` -> Assigns chat owner.
* `POST /api/chat/toggle-ai` -> Toggles client AI-controlled status.
* `GET /api/chat/:userId` -> Conversation transcript history.
* `POST /api/send-direct` -> Transmits message / note.
* `POST /api/config/knowledge` -> Writes RAG text context.
* `POST /api/config/settings` -> Writes channel parameters.
* `POST /api/broadcast` -> Dispatches broadcast payload.
* `GET /api/whatsapp/status` -> Fetches WhatsApp web QR or ready state.
* `POST /api/whatsapp/logout` -> Logs out active WhatsApp gateway connection.
* `POST /api/auth/logout` -> Logs out admin.

---

## 6. DOM Selectors Inventory
The inline script retrieves and updates the following DOM nodes:
* `#page-title`
* `#badge-errors-count`
* `#badge-wa-status`
* `#system-status-indicator`
* `#system-status`
* `#users-list`
* `#current-chat-user`
* `#current-chat-id`
* `#chat-assignee-select`
* `#chat-header-actions`
* `#assignee-container`
* `#direct-msg-input`
* `#send-btn`
* `#media-upload-btn`
* `#chat-box`
* `#tab-reply`
* `#tab-note`
* `#media-preview-container`
* `#media-filename`
* `#media-upload-input`
* `#canned-responses-overlay`
* `#broadcast-msg`
* `#stat-users`
* `#stat-messages`
* `#stat-status`
* `#live-logs-box`
* `#errors-table-body`
* `#analytics-stat-users`
* `#analytics-stat-messages`
* `#platformChart`
* `#messageChart`
* `#wa-connection-badge`
* `#wa-qr-container`
* `#wa-logout-btn`
* `#openrouter-input`
* `#model-select`
* `#prompt-input`
* `#token-input`
* `#admin-id-input`
* `#wa-autoreply-select`
* `#meta-verify-input`
* `#messenger-autoreply-select`
* `#messenger-token-input`
* `#instagram-autoreply-select`
* `#instagram-token-input`
* `#knowledge-input`
* `#confirm-modal`
* `#confirm-modal-title`
* `#confirm-modal-text`
* `#confirm-modal-icon`
* `#confirm-yes-btn`

---

## 7. Global Timer Operations
The dashboard relies on three distinct long-running polling processes:
* `fetchStatsAndUsers()` every **3000ms** (3 seconds)
* `fetchChatHistory()` every **3000ms** (3 seconds)
* `fetchWhatsAppStatus()` every **5000ms** (5 seconds)
