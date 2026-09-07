# BASELINE CONFIGURATION RECORD

**Date:** 2026-09-06
**System:** Standalone Production-Grade RAG Platform

---

## Service & Control Plane Specs
- **Service Stack:** Python / FastAPI
- **Database Engine:** SQLite in WAL mode (`journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`)
- **Vector Store:** Qdrant with named vectors (`dense` 768-dim / Cosine, `sparse` BM25 term weights)

## Active Models & Dimensionality
- **Dense Embedding Model:** `nomic-embed-text` (768 dimensions via Ollama / OpenAI adapter)
- **Sparse Encoder:** `BM25SparseEncoder` (term frequency & log-weighted sparse indices/values)
- **Reranker Model:** `bge-reranker-base` (`CrossEncoderReranker`)
- **Generator Model:** `llama3.2:1b` (`GroundedGenerator` with structured JSON format)

## Baseline Retrieval Parameters
- `DENSE_PREFETCH_K`: 30
- `SPARSE_PREFETCH_K`: 30
- `RRF_K`: 60
- `RERANK_CANDIDATE_K`: 20
- `FINAL_EVIDENCE_K`: 6
- `MIN_RERANKER_SCORE`: 0.35
- `MIN_RELEVANCE_MARGIN`: 0.05

## Baseline Chunking & Context Budgets
- `TARGET_CHUNK_TOKENS`: 500
- `OVERLAP_TOKENS`: 50
- `MAX_CONTEXT_TOKENS`: 3000
- `RESERVED_ANSWER_TOKENS`: 1000
