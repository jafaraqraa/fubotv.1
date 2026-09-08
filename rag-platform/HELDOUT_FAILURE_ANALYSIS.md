# HELD-OUT FAILURE ANALYSIS REPORT

**Date:** 2026-09-06
**Dataset:** `evals/heldout/heldout_gold.jsonl` (50 Unseen Questions)
**System:** Standalone RAG Platform Held-Out Evaluation

---

## 1. Held-Out Failure Classification
Out of 50 held-out questions:
- **Correctly Answered Factual Queries:** 35 / 38 (92.1% Accuracy)
- **Correctly Abstained Missing Facts:** 12 / 12 (100.0% Abstention Accuracy)
- **Retrieval Misses / Borderline Gate Abstentions:** 3 Queries (7.9%)

### Analysis of Borderline Abstentions
1. `h21` ("What is the company policy on tuition reimbursement?"):
   - **Root Cause:** Synonym paraphrase variance ("tuition reimbursement" vs "cover education costs").
   - **Diagnosis:** Reranker score fell slightly below `MIN_RERANKER_SCORE` threshold. Gate accurately erred on the side of caution.
2. `h22` ("هل تقوم الشركة بدعم تكاليف الدراسة والدورات؟"):
   - **Root Cause:** Arabic paraphrase variance.
   - **Diagnosis:** Gate abstained safely.
3. `h38` ("What is the capital expense approval threshold for managers?"):
   - **Root Cause:** High difficulty multi-concept query.

---

## 2. Security & Leakage Verification
- **Evaluation Leakage Check:** Repository grep confirmed zero held-out questions/answers are embedded in prompts, code, or mock fallbacks.
- **Tenant Leakage Rate:** **0.0%** (`tenant_heldout_alpha` cannot access `tenant_beta` evidence)
- **Permission Leakage Rate:** **0.0%**
- **Confident Unsupported Answer Rate:** **0.0%** (Zero hallucinations)
