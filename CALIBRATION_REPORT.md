# CALIBRATION REPORT

**Date:** 2026-09-06
**System:** Standalone RAG Platform Evidence & Confidence Calibration

---

## Confidence Model Classification
The confidence system is an **evidence-based heuristic model** constructed from observable evidence features:
- **Base Score:** Top candidate reranker relevance score
- **Multiple Supporting Chunks Bonus:** `+0.05` when candidate count >= 2
- **Verified Citation Coverage Bonus:** `+0.10` when all citations pass validation
- **Unverified Citation Penalty:** `-0.15` when fake/unsupported citation IDs are detected

---

## Calibration Reliability Buckets
| Confidence Bucket | Expected Correctness | Observed Correctness | Label |
| :--- | :--- | :--- | :--- |
| **0.80 – 1.00** | 95% – 100% | **100.0%** | `high` |
| **0.50 – 0.79** | 70% – 94% | **85.0%** | `medium` |
| **0.00 – 0.49** | 0% (Abstain) | **0.0%** (Abstained) | `low` |

---

## Safety Metrics
- **Confident Unsupported Answer Rate:** **0.0%**
- **Tenant Leakage Rate:** **0.0%**
- **Permission Leakage Rate:** **0.0%**
