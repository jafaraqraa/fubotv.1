# Multi-channel media messaging

The dashboard obtains its media contract from `GET /api/media/capabilities`; the backend remains authoritative.

New clients can upload multipart media through `POST /api/conversations/:conversationId/messages/media` using the `file` field plus an optional `caption` and `idempotencyKey`. The existing `POST /api/send-direct` JSON contract remains supported for backward compatibility.

| Channel | Image | Video | Audio | Voice | Document | Animation/sticker | Remote URL |
|---|---:|---:|---:|---:|---:|---:|---:|
| Messenger | yes | yes | yes | no | yes | no | no |
| Instagram | yes | yes | no | no | no arbitrary files | no | HTTPS share URL |
| Telegram | yes | yes | yes | yes | yes | yes | no |
| WhatsApp | yes | yes | yes | yes | yes | no | provider-specific |

## Lifecycle

Media is validated by MIME, extension, signature and channel size limit, then stored beneath the tenant's private media directory under a randomized key. A tenant-scoped database record is created before provider side effects. Its state advances through `uploaded`, `sending`, `sent`, `delivered`, `read`, or `failed`. Provider success requires a real provider message ID; fabricated IDs are forbidden. Retrying reuses the same logical message and attachment record.

Downloads use the authenticated `/api/media/:attachmentId/download` endpoint, which checks tenant ownership and prevents paths escaping the tenant storage root. The original filename is presentation metadata only and is never used as a storage key.

`Idempotency-Key` (or the compatibility JSON field `idempotencyKey`) is tenant scoped. Reusing a completed key returns the original result; reusing an in-progress, failed, or unknown key returns a conflict and does not send a second provider message.

## Provider configuration

- Meta: `MESSENGER_ACCESS_TOKEN`, `INSTAGRAM_ACCESS_TOKEN`, `MESSENGER_PAGE_ID`, `INSTAGRAM_ACCOUNT_ID`, `META_GRAPH_VERSION`.
- Telegram: the existing tenant bot token configuration.
- WhatsApp Web: an active tenant session.
- WhatsApp Cloud: tenant `phoneNumberId` and access token in the protected provider configuration.

Incoming Meta binary URLs are accepted only over HTTPS from Meta-owned host suffixes, downloaded with a deadline and a hard byte bound, validated, and materialized privately. Provider webhook signature and replay checks run before this work.

## Retention and operations

Failed media remains private so an authorized agent can retry or delete it. Deletion is rejected while uploading/sending and marks the record deleted after the file is removed. A production deployment should schedule retention cleanup for old failed/cancelled/deleted records according to its legal retention policy; no policy is silently assumed by the application.
