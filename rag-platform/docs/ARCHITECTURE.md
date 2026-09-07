# Architecture Specification

## Target Stack
- **API Framework:** Python FastAPI (async)
- **Control Plane Database:** SQLite with WAL mode (`journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`)
- **Vector Storage:** Qdrant with named vectors (`dense` and `sparse`)
- **Embeddings:** Provider abstraction supporting Ollama (`nomic-embed-text`) and OpenAI/OpenRouter (`text-embedding-3-small`)
- **Reranker:** Cross-encoder reranker
- **Generator:** Grounded generator with prompt injection protection supporting Ollama and cloud LLMs

## Query Pipeline Flow
1. Request Validation (`/v1/query`)
2. Tenant & Principal Context Resolution (`X-Tenant-ID`, `X-Roles`, `X-Department`)
3. Pre-retrieval Authorization Filter Construction (Qdrant filter)
4. Query Normalization & Arabic/English Language Detection
5. Parallel Dense & BM25 Sparse Candidate Retrieval
6. Reciprocal Rank Fusion (RRF) & Content Hash Deduplication
7. Cross-Encoder Candidate Reranking
8. Evidence Sufficiency Gate Evaluation
9. Parent/Child Context Construction with Token Budget Selection (`EVIDENCE_01`, `EVIDENCE_02`)
10. Grounded Generation with Structured JSON Output
11. Citation Validation & Coverage Check
12. Evidence-based Confidence Calibration (`high`, `medium`, `low`)
13. Request Trace Persisted & Response Returned
