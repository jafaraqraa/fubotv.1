# UNIFIED INTERNAL MESSAGE CONTRACT

This document defines the unified internal message model and specifications for normalization, routing, validation, and delivery across Telegram, WhatsApp, Messenger, and Instagram.

---

## 1. Design Principles
1. **Consistency:** All incoming and outgoing platform payloads are converted to one standard JSON structure.
2. **Channel Isolation:** Boundaries are explicitly enforced via `channel + externalUserId` composite definitions to prevent crossing lines.
3. **Decoupled Business Logic:** Normalizers only parse and map; they do not fetch DB models, execute API routes, or alter session states.
4. **Media Reference Integrity:** Files are stored locally under `public/uploads/` directory; references and filenames are stored in SQLite, never raw base64.

---

## 2. Inbound Message Model Schema

```json
{
  "channel": "telegram",
  "externalMessageId": "platform-message-id",
  "externalUserId": "platform-user-id",
  "customer": {
    "displayName": "Ahmed",
    "username": "ahmed_username",
    "phoneNumber": null,
    "profileData": {}
  },
  "direction": "incoming",
  "senderType": "customer",
  "messageType": "text",
  "content": "Hello",
  "media": null,
  "timestamp": "2026-07-12T19:00:00.000Z",
  "metadata": {}
}
```

### Media Payload Extension Example

```json
{
  "channel": "whatsapp",
  "externalMessageId": "whatsapp-msg-99",
  "externalUserId": "970599123456@c.us",
  "customer": {
    "displayName": "Samer",
    "username": null,
    "phoneNumber": "970599123456",
    "profileData": {}
  },
  "direction": "incoming",
  "senderType": "customer",
  "messageType": "image",
  "content": "/uploads/1783880000000_whatsapp.jpg",
  "media": {
    "localPath": "/app/public/uploads/1783880000000_whatsapp.jpg",
    "publicUrl": "/uploads/1783880000000_whatsapp.jpg",
    "fileName": "1783880000000_whatsapp.jpg",
    "mimeType": "image/jpeg"
  },
  "timestamp": "2026-07-12T19:05:00.000Z",
  "metadata": {}
}
```

---

## 3. Outbound Message Model Schema

```json
{
  "channel": "telegram",
  "externalUserId": "123456",
  "direction": "outgoing",
  "senderType": "ai",
  "messageType": "text",
  "content": "يا هلا بالورد... دامت الأفراح",
  "media": null,
  "conversationId": "uuid-conv-id",
  "metadata": {}
}
```

### Outgoing Agent Media Schema

```json
{
  "channel": "whatsapp",
  "externalUserId": "970599123456@c.us",
  "direction": "outgoing",
  "senderType": "agent",
  "messageType": "document",
  "content": "/uploads/1783881000000_sent.pdf",
  "media": {
    "localPath": "/app/public/uploads/1783881000000_sent.pdf",
    "publicUrl": "/uploads/1783881000000_sent.pdf",
    "fileName": "1783881000000_sent.pdf",
    "mimeType": "application/pdf"
  },
  "conversationId": "uuid-conv-id",
  "metadata": {
    "agentName": "سارة"
  }
}
```

---

## 4. Enum Definitions

### `channel` Enums
* `telegram`
* `whatsapp`
* `messenger`
* `instagram`

### `direction` Enums
* `incoming`
* `outgoing`

### `senderType` Enums
* `customer`
* `ai`
* `agent`
* `system`

### `messageType` Enums
* `text`
* `image`
* `audio`
* `video`
* `document`
* `note`
