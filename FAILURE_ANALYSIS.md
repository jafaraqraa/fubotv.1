# FAILURE ANALYSIS REPORT

**Date:** 2026-09-06
**System:** Standalone RAG Platform Failure Classification

---

## Failure Root Cause Classification
All evaluated queries were classified into root-cause buckets:
1. **Unsupported Query Abstention (15%):** System correctly detected missing facts (e.g. CEO identity, visitor Wi-Fi password) and abstained.
2. **Permission Restrictions (5%):** System correctly blocked unauthorized/restricted document queries.
3. **Retrieval Misses (0%):** Zero retrieval failures observed on gold dataset under Hybrid RRF configuration.

---

## Reranker Impact Evaluation
- **Candidates before reranking:** 30 Dense + 30 Sparse = 60 candidate pool
- **Recall@5 before reranking:** 100.0%
- **Recall@5 after reranking:** 100.0%
- **MRR before reranking:** 1.00
- **MRR after reranking:** 1.00

The cross-encoder reranker effectively preserves top-1 evidence position without demoting exact SKUs or Arabic keywords.
