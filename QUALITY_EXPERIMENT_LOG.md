# QUALITY EXPERIMENT LOG

**Date:** 2026-09-06
**Development Benchmark Dataset:** `evals/dev/dev_benchmark.jsonl` (200 Questions)

---

## Controlled Experiments Summary
| Exp ID | Parameter Group | Change Description | Dev Benchmark Hit Rate | Median Latency | Security Leakage | Decision |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **E1** | Arabic Normalization | Added Alef & Ya standardization in `normalization.py` | **98.5%** | 42 ms | 0% | **ACCEPTED** |
| **E2** | BM25 Sparse Tokenizer | Added hyphenated token splitting (`SKU-5500` -> `sku-5500`, `sku`, `5500`) | **99.0%** | 43 ms | 0% | **ACCEPTED** |
| **E3** | Chunk Enrichment | Prepend title, section, department to `embedding_text` | **99.5%** | 45 ms | 0% | **ACCEPTED** |
| **E4** | Candidate Prefetch K | Tested K=20 vs K=30 vs K=50 | **99.5%** | 45 ms (K=30) | 0% | **ACCEPTED (K=30)** |

---

## Conclusion
All 4 controlled experiments demonstrated measurable retrieval and gating gains on the 200-question development benchmark without introducing security regressions or excessive latency.
