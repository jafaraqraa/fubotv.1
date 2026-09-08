# THREE FAILURE ROOT CAUSE REPORT

**Date:** 2026-09-06
**Audited Queries:** `h21`, `h22`, `h38`

---

## 1. Failure Audit: `h21`
- **Query:** `"What is the company policy on tuition reimbursement?"`
- **Target Evidence Chunk:** `"Tuition reimbursement is up to 3000 USD per year for approved courses."`
- **Observed Behavior:** Dense embedding score was moderate, but sparse BM25 score for `"tuition reimbursement"` was low relative to general onboarding text, causing reranker score to land at ~0.31 (below `0.35` threshold).
- **Classification:** `QUERY_UNDERSTANDING_FAILURE` + `SPARSE_RECALL_FAILURE`
- **Systemic Remediation:** Enhance query normalization with controlled synonym expansion and BM25 tokenization for compound policy terms without altering exact SKUs or user intent.

---

## 2. Failure Audit: `h22`
- **Query:** `"هل تقوم الشركة بدعم تكاليف الدراسة والدورات؟"`
- **Target Evidence Chunk:** `"تغطي الشركة تكاليف الدراسة والدورات حتى 3000 دولار سنوياً."`
- **Observed Behavior:** Arabic orthographic variance between `"بدعم تكاليف"` and `"تغطي تكاليف"` led to a slight dip in BM25 term matching.
- **Classification:** `ARABIC_LANGUAGE_FAILURE` + `NORMALIZATION_FAILURE`
- **Systemic Remediation:** Refine Arabic normalization in `app/core/normalization.py` to handle Alef/Ya/Tatweel variants and common prefix prepositions while preserving Arabic digits and exact codes.

---

## 3. Failure Audit: `h38`
- **Query:** `"What is the capital expense approval threshold for managers?"`
- **Target Evidence Chunk:** `"Manager capital expense approval threshold is up to 10000 USD."`
- **Observed Behavior:** Multi-concept query combining role (`Manager`), topic (`capital expense`), and predicate (`approval threshold`).
- **Classification:** `MULTI_CONCEPT_FAILURE` + `CHUNK_ENRICHMENT_FAILURE`
- **Systemic Remediation:** Prepend structured section paths and key entity tags in chunk `embedding_text` and implement multi-keyword preservation in BM25 tokenization.
