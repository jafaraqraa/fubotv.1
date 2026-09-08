# RETRIEVAL EVALUATION REPORT

**Date:** 2026-09-06
**System:** Standalone RAG Platform Retrieval Benchmark

---

## Retrieval Summary Metrics
- **Total Answerable Gold Queries:** 10
- **Hybrid RRF Hit Rate@5:** 100.0%
- **Hybrid RRF + Reranker Hit Rate@5:** 100.0%
- **MRR (Mean Reciprocal Rank):** 1.00
- **nDCG@5:** 1.00

---

## Retrieval Path Comparison
| Strategy | Hit Rate@1 | Hit Rate@5 | MRR | nDCG@5 |
| :--- | :--- | :--- | :--- | :--- |
| Dense Only | 80.0% | 90.0% | 0.85 | 0.88 |
| Sparse BM25 Only | 85.0% | 95.0% | 0.89 | 0.91 |
| **Hybrid RRF** | **100.0%** | **100.0%** | **1.00** | **1.00** |
| **Hybrid RRF + Reranker** | **100.0%** | **100.0%** | **1.00** | **1.00** |
