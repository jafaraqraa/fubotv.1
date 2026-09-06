# RAG v2 audit, architecture decision, and rollout record

Date: 2026-09-05  
Status: foundation implemented; production activation blocked pending dependency-backed evaluation

## Audit summary

The request path is `channel/web route -> services/ai.getAIResponse -> services/knowledge.retrieveContextAsync -> hybridRetrievalService -> Ollama embedding + Qdrant dense search + Qdrant text-match scan -> query-level RRF -> heuristic/cross-encoder reranking -> context optimizer -> evidence gate -> PromptBuilder -> configured generation provider -> answer validator -> grounding safety boundary`. Conversation history is loaded per tenant/user and used for referent resolution and generation. It is not an indexed source.

The ingestion paths are the manual `knowledge.txt` update/reindex routes and document upload/replace routes in `routes/api.js`. They call `knowledgeIndexingService` or `knowledgeDocumentService`, then extraction (`txt`, `pdf`, `docx`, image description, audio transcription), cleaning, injection scan, character-based chunking, Ollama embedding, Qdrant staging upload and count verification, SQLite activation, cache invalidation, and old-vector cleanup/reconciliation.

Components preserved because tests and inspection show useful safety properties:

- canonical tenant resolution and fail-closed tenant assertions;
- staged document/index activation and one-current-version database constraints;
- distributed operation leases, cancellation, bounded retries/timeouts, and reconciliation;
- original-text preservation, injection scanning, grounding prompt boundary, answer validation, and request traces;
- provider adapters and the public `getAIResponse` contract;
- version-aware, tenant-aware cache invalidation.

Root causes of unreliable retrieval:

- legacy chunks are measured in Unicode characters and have only a shallow heading field; parent/child context is absent;
- lexical search is a bounded Qdrant payload text scan, not BM25 or a sparse-vector index;
- the first-stage hybrid service compares normalized dense and substring-coverage scores with fixed weights; these are not commensurate score scales;
- RRF operates across query variants after that blending, rather than independently fusing dense and sparse ranked lists;
- the default embedding remains `nomic-embed-text`; model dimensions are configured rather than probed and bound to an index manifest;
- the single collection name is changed in place; aliases and separately validated embedding collections are absent;
- active-version filters exist but metadata naming is inconsistent (`tenantId` in Qdrant versus snake_case in the desired schema), and permission filtering is not a mandatory primitive in every query;
- a cosine threshold remains a prominent pre-rerank filter and is not backed by a versioned calibration artifact;
- answer generation defaults to provider temperature `0.2`, not the grounding contract's deterministic `0.0`;
- existing evaluation artifacts are valuable but do not provide one frozen dataset and runner covering every requested retrieval, answer, citation, abstention, isolation, latency, token, and cost metric.

Failure classification observed by inspection: parsing/quality failures can admit structurally weak text; chunking loses hierarchy; retrieval recall suffers from text-match sparse retrieval; ranking combines unlike scores; context uses character budgets; citation metadata is incomplete for page/version in some sources; abstention is heavily heuristic; permission metadata is incomplete; old/current versions are protected for primary paths but not expressed through one reusable filter; latency/cost evidence is fragmented. No production customer content was read for this audit.

## Configuration precedence and effective defaults

Legacy runtime precedence is `SQLite settings -> process.env (including dotenv/UI-written values) -> ragConfig.DEFAULTS`. The dashboard writes all three of SQLite, `.env`, and `process.env`; therefore the UI is an input mechanism, not a separate source of truth. AI task models use task rows/settings first, then `AI_MODEL`/`OPENROUTER_MODEL`, then `openrouter/free`. Provider temperature reads `AI_TEMPERATURE`, default `0.2`.

| Setting | Legacy effective fallback | v2 source/default |
|---|---:|---|
| implementation | no isolated selector | env `RAG_IMPLEMENTATION`; `legacy` |
| embedding model | `nomic-embed-text` | env; pinned `BAAI/bge-m3` |
| dimensions | `768` configured | must be probed; null until verified |
| distance | Qdrant collection state | `Cosine`, verified at startup (pending adapter) |
| dense candidates | dynamic K x 3 | 40 |
| sparse candidates | same bounded text scan | 40 |
| fusion | weighted 0.8/0.2 then query RRF k=60 | dense/sparse RRF, k=60 |
| reranker | task setting/env; fallback allowed | pinned Qwen3 0.6B; 24 candidates |
| final context | dynamic 3/5/7 | dynamic 1..8 |
| chunk size/overlap | 800/120 characters | 450/60 tokens |
| similarity threshold | 0.40 | no universal threshold; calibration required |
| answer model | task DB/settings -> env -> `openrouter/free` | existing provider adapter; pin before canary |
| temperature | env -> 0.2 | 0.0 |
| context budget | 3000 characters | 3000 estimated tokens |
| timeouts | Qdrant 10s, embedding 30s | retrieval 10s, rerank 15s, generation 60s |
| cache TTL | 300000 ms | 300000 ms; scope key contract required |
| tenant/version filters | code-built tenant + active index version | mandatory tenant + KB + active + current + permission filter |

## ADR: isolated RAG v2

Decision: retain legacy unchanged, build v2 in `src/rag_v2`, and keep `RAG_IMPLEMENTATION=legacy` until a separate collection passes offline and shadow gates. SQLite is authoritative; Qdrant is disposable and rebuilt from version/chunk rows. Each incompatible embedding uses a versioned collection. An alias is switched atomically only after manifest, dimension, distance, payload-index, checksum, count, isolation, and benchmark verification.

```text
Ingest: source -> validate -> parse/OCR -> reconstruct -> normalize dual text
        -> quality gate -> identity/version -> dedupe -> parent/child chunks
        -> dense + sparse vectors -> staging collection -> verify -> activate DB -> alias

Query: authenticated scope -> route/rewrite -> dense || sparse (same mandatory filter)
       -> RRF -> dedupe/diversify -> rerank -> evidence context -> sufficiency gate
       -> structured generation -> claim/citation verification -> answer or abstain
```

Retrieved content is always untrusted data and cannot invoke tools or alter permissions. `UNAUTHORIZED` responses disclose neither existence nor content.

## Database and Qdrant design

Migration `034_rag_v2_foundation.sql` adds document versions, chunks, restartable ingestion jobs, index manifests, and evaluation runs. It is additive and transactional. Rollback is application-level: set `RAG_IMPLEMENTATION=legacy`; the new tables can remain inert. Dropping them is deliberately not part of first rollout.

The target Qdrant collection uses named dense and sparse vectors and payload indexes for `tenant_id`, `knowledge_base_id`, `document_id`, `document_version_id`, `status`, `is_current`, `language`, `permissions`, `valid_from`, and `valid_to`. This repository change does not create or switch a live collection.

## Deployment, monitoring, and rollback

1. Back up SQLite/source files and snapshot the existing Qdrant collection.
2. Deploy code with `RAG_IMPLEMENTATION=legacy`; apply migration 034 through the normal transactional runner.
3. Probe chosen embedding dimensions and create a uniquely versioned v2 collection plus payload indexes; do not point the alias at it yet.
4. Run a dry-run backfill from SQLite, then resume-capable indexing; reconcile checksums/counts and run the frozen evaluation.
5. Use `shadow`, compare accuracy/leakage/latency/cost, then canary `v2` by an explicit traffic controller (not yet implemented).
6. Roll back immediately by restoring `RAG_IMPLEMENTATION=legacy`; never delete the legacy collection during initial rollout.

Monitor trace-stage p50/p95, empty retrieval, abstention, conflicts, citation accuracy, unsupported claims, cross-tenant denials, provider/Qdrant failures, ingestion failures, reconciliation differences, cache hits, tokens, and cost. Raw sensitive text must remain disabled in logs.

## Verification status and remaining risks

The deterministic v2 core and additive migration have unit tests. Real Qdrant named sparse vectors, embedding/reranker model benchmarks, OCR quality gates, parser isolation, ingestion worker/backfill, query router, post-generation regeneration, shadow/canary controller, dashboards, and a full metric runner remain unimplemented. Consequently no before/after quality or production performance claim is made, and v2 stays disabled.

