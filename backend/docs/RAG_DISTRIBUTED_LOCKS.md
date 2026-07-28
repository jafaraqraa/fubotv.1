# Distributed RAG mutation leases

RAG mutations use SQLite-backed leases in `rag_operation_locks`. SQLite is the
existing shared coordination dependency for this deployment, so no second
locking system or unsafe in-memory fallback is used.

## Lock keys and conflicts

| Resource | Key | Conflicts |
|---|---|---|
| Document mutation | `rag:document:{tenantId}:{logicalDocumentId}` | index, reindex, replace, retry, and delete for the same document; tenant cleanup; collection rebuild |
| Manual knowledge | `rag:knowledge_txt:{tenantId}` | update, reindex, and delete for the tenant; tenant cleanup; collection rebuild |
| Reconciliation scan | `rag:reconcile:{tenantId}` | destructive tenant cleanup |
| Tenant cleanup | `rag:cleanup:{tenantId}` | every active mutation or reconciliation scan for that tenant |
| Collection rebuild | `rag:collection:{tenantId}:{collection}` | every tenant mutation |
| Migration | `rag:migration:{migrationName}` | the same migration across all instances |

Retrieval is read-only and does not acquire mutation locks.

Document operations deliberately share one resource key rather than separate
operation-specific keys. This is what makes replace, delete, and reindex
mutually exclusive without blocking unrelated documents or tenants.

## Lease and fencing behavior

- Acquisition is a single SQLite transaction with a unique lock key.
- Every acquisition has a cryptographically random owner token.
- Every reclaim increments a persistent monotonic fencing token.
- Heartbeats renew only when owner token and fencing token still match.
- Critical activation, deletion, rollback, cleanup, and cache invalidation
  revalidate ownership before writing.
- A lost lease aborts the operation signal and raises `RAG_LOCK_LOST`.
- Release is compare-and-set by owner token and fencing token. It never deletes
  or releases another process's lease.
- Expired leases can be reclaimed atomically. Startup and periodic scans mark
  the associated operation record `abandoned`; staging recovery remains
  idempotent in the indexing services.
- Mutation requests fail closed with `RAG_LOCK_SERVICE_UNAVAILABLE` if lock
  storage is unavailable.

`rag_operations` stores the operation lifecycle independently of the lease.
Idempotency is keyed by tenant, operation type, and `Idempotency-Key`.

## HTTP behavior

Conflicting mutation endpoints return:

```json
{
  "success": false,
  "code": "RAG_OPERATION_IN_PROGRESS",
  "retryable": true
}
```

The status is HTTP 409 with `Retry-After: 1`. A lock-storage outage returns
HTTP 503. Owner tokens are never returned or logged.

## Configuration

```env
RAG_DISTRIBUTED_LOCK_ENABLED=true
RAG_LOCK_PROVIDER=sqlite
RAG_LOCK_TTL_MS=60000
RAG_LOCK_HEARTBEAT_MS=15000
RAG_LOCK_MAX_WAIT_MS=15000
RAG_LOCK_RETRY_DELAY_MS=250
RAG_LOCK_STALE_SCAN_INTERVAL_MS=60000
RAG_INSTANCE_ID=optional-diagnostic-name
```

The heartbeat must be less than half the TTL. Production startup rejects
disabled distributed locks when multiple workers are configured.

## Deployment limitation

SQLite coordinates multiple Node/PM2 workers on the same host and containers
that safely share the same SQLite database file and locking semantics. It is
not suitable for independent Kubernetes replicas with separate database
files, nor for SQLite on filesystems that do not preserve POSIX locks. Such a
deployment must first add a Redis or PostgreSQL lock provider; selecting an
unsupported provider fails closed.

