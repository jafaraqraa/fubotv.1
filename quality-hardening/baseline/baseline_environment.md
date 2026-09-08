# HARDENING BASELINE ENVIRONMENT SPECIFICATION

**Date:** 2026-09-06
**Commit:** Frozen pre-hardening state
**Control Plane:** SQLite in WAL mode (`journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`)
**Vector Database:** Qdrant with named vectors (`dense` 768-dim, `sparse` BM25 term weights)
**Embeddings:** Ollama / OpenAI adapter (`nomic-embed-text`)
**Sparse Encoder:** `BM25SparseEncoder`
**Reranker:** `CrossEncoderReranker`
**Generator:** `GroundedGenerator` (`llama3.2:1b`)
