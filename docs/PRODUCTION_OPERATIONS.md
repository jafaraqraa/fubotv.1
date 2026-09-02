# Production Operations

## Deployment

Run behind an HTTPS reverse proxy. Forward `Host`, `X-Forwarded-For`, and
`X-Forwarded-Proto`; do not expose port 3001 or Qdrant publicly. Configure
`ALLOWED_ORIGINS`, `SESSION_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`,
`METRICS_TOKEN`, `QDRANT_API_KEY`, and Meta signing secrets through the secret
manager, not in the image.

`/live` is the container liveness probe. `/ready` gates traffic until database
migrations, Qdrant ownership validation, and startup services finish.
`/health` reports process state. `/internal/metrics` requires
`Authorization: Bearer $METRICS_TOKEN`.

## Alerts

| Alert | Suggested condition |
|---|---|
| ServiceDown | `/live` fails for 2 minutes |
| NotReady | `/ready` fails for 5 minutes |
| Http5xx | 5xx ratio above 2% for 5 minutes |
| HighLatency | HTTP p95 above 2 seconds for 10 minutes |
| EventLoopBlocked | event-loop max above 500 ms |
| MemoryHigh | RSS above 85% container limit for 10 minutes |
| CrashLoop | more than 3 restarts in 15 minutes |
| RAGDependency | Qdrant/Ollama timeout counters increase for 5 minutes |
| WebhookFailure | webhook 5xx ratio above 1% |
| IndexFailure | indexing failure counter increases |
| DiskLow | data volume has less than 20% free space |
| BackupMissing | no verified backup in 24 hours |

## Backup and restore

Create an encrypted off-host destination, then run:

```bash
node backend/scripts/production-backup.js --output=/secure/backups/futhing-YYYYMMDD
node backend/scripts/verify-production-backup.js /secure/backups/futhing-YYYYMMDD
```

For the single-host deployment, `npm run backup` creates and verifies a full
SQLite/uploads/Qdrant backup under `backend/data/backups/production` and keeps
14 days by default. Override the destination and retention with
`FUTHING_BACKUP_DIR` and `FUTHING_BACKUP_RETENTION_DAYS`. WhatsApp session
storage is intentionally excluded unless the backup destination is encrypted.

The backup is successful only after the verifier passes. It contains a
WAL-consistent SQLite backup, uploads, checksums, and a downloaded Qdrant
collection snapshot. Also back up WhatsApp session storage only if the storage
location is encrypted and access-restricted.

Recovery order:

1. Stop application replicas.
2. Verify the selected backup.
3. Restore SQLite and uploads to empty volumes.
4. Restore the Qdrant snapshot into the configured collection.
5. Start one application replica and wait for `/ready`.
6. Run the database integrity audit and RAG reconciliation in dry-run mode.
7. Re-enable traffic, then additional replicas.

For accidental document deletion, prefer application version rollback. For
Qdrant-only loss, restore the snapshot or rebuild from active SQLite documents.
For provider outage, keep the application online in degraded mode and alert;
never bypass signature or tenant controls.

## Rollback

Deploy immutable image tags. Before migrations, create and verify a backup.
Rollback means restoring both the previous image and its compatible data
backup. Never run an older image against a schema it does not understand.
