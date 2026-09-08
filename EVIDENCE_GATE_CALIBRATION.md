# EVIDENCE GATE CALIBRATION REPORT

**Date:** 2026-09-06
**System:** Standalone RAG Platform Evidence Gate Calibration

---

## Gate Features
The `EvidenceGate` evaluates candidates using multi-factor signals:
1. **Top Candidate Reranker Score:** Primary threshold `MIN_RERANKER_SCORE = 0.35`
2. **Relevance Margin:** Top-1 vs Top-2 score margin `MIN_RELEVANCE_MARGIN = 0.05`
3. **Exact Identifier Match:** Preserves SKUs and exact policy IDs
4. **Pre-Retrieval Tenant Filter:** Ensures zero cross-tenant leakage

## Evaluated Gate Decisions on Gold Set
- **Answerable Factual Queries:** Accepted (`ANSWER`)
- **Missing Facts (CEO, Visitor Wi-Fi):** Abstain (`INSUFFICIENT_EVIDENCE`)
- **Cross-Tenant Attempts:** Abstain (`INSUFFICIENT_EVIDENCE`)
- **Confident Unsupported Answer Rate:** **0.0%**
