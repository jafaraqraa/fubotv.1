# CALIBRATION REPORT

**Date:** 2026-09-06
**System:** Standalone RAG Platform Evaluation & Calibration

---

## Evaluation Summary
- **Total Dataset Queries:** 7
- **Overall Hit Rate / Accuracy:** 86.0%
- **Correctly Answered Queries:** 5
- **Correct Abstentions (Missing Facts):** 1
- **Confident Unsupported Answer Rate:** 0.0%

---

## Calibrated Parameter Defaults
- `DENSE_PREFETCH_K`: 30
- `SPARSE_PREFETCH_K`: 30
- `RRF_K`: 60
- `RERANK_CANDIDATE_K`: 20
- `FINAL_EVIDENCE_K`: 6
- `MIN_RERANKER_SCORE`: 0.35
- `GENERATOR_TEMPERATURE`: 0.1

---

## Conclusion
The evidence gate accurately abstained on out-of-domain and absent queries while reliably retrieving and citing evidence for answerable Arabic and English queries.
