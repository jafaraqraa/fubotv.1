# RAG observability contract

All counters exposed by the RAG admin API have an explicit source, scope,
collection timestamp, freshness and exactness. `null` means unavailable; it is
never converted to zero.

| Metric | Source / formula | Scope | Semantics |
|---|---|---|---|
| `qdrantPointsCount` | Qdrant collection info `points_count` | collection | Qdrant-reported physical points |
| `qdrantVectorsCount` | Qdrant collection info `vectors_count` | collection | stored vectors when the installed Qdrant version exposes it |
| `indexedVectorsCount` | Qdrant `indexed_vectors_count` | collection | internal indexing statistic, not active knowledge |
| `embeddingDimension` | collection vector configuration `size` | collection/vector name | embedding width, never a count |
| `collectionSegmentsCount` | Qdrant `segments_count` | collection | storage segments |
| `physical.qdrantPoints` | exact Qdrant count filtered by `tenantId` | tenant | all tenant points, including non-active lifecycle states |
| `physical.stagingPoints` | exact Qdrant count filtered by tenant and lifecycle | tenant | staging points only |
| `logical.activeDocuments` | distinct active logical IDs in SQLite | tenant | logical documents, not upload history |
| `logical.activeVersions` | active lifecycle rows in SQLite | tenant | active versions |
| `logical.activeChunks` | sum of expected chunks for active SQLite versions | tenant | expected logical knowledge |
| consistency counters | latest completed reconciliation summary | tenant | audit snapshot; unavailable before reconciliation |
| cache hit/miss rate | `hit / (hit + miss)` and `miss / (hit + miss)` | tenant/process | `null` when no lookup occurred |
| dependency duration | `performance.now()` around the real dependency operation | process/stage | failed attempts are included |
| p50/p95/p99 | nearest-rank over actual retained samples | process/stage | unavailable below five samples |

Document/version activation requires an exact server-side Qdrant count filtered
by `tenantId`, `documentId`, `documentVersionId`, `indexVersionId`, and
`lifecycle`. The expected count is read back from the SQLite staging operation.
Collection-wide statistics are never used as activation proof.

## Endpoint

`GET /api/admin/rag/metrics-summary` (also available under `/api/v1`) requires
the existing authenticated administrator session, CSRF policy, and authorized
RAG tenant context.

## Runtime aggregation limitation

Dependency latency samples and cache event counters are intentionally marked
`process_local` and `distributedSafe: false`. They are operational samples, not
cluster totals. SQLite lifecycle counts and exact Qdrant counts remain safe
across workers. A multi-node deployment should scrape each process into
Prometheus/OpenTelemetry and aggregate there; the API never presents local
samples as cluster-wide values.
