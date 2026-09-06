# FuBot B-only Frozen Evaluation Report

Date: 2026-09-04

## Outcome

The evaluation stopped during Phase 1. The frozen corpus failed its required integrity gate, so no model restoration, formulation comparison, threshold selection, DEV inference, or unseen inference was performed.

## 1. Corpus integrity manifest

- Corpus SHA-256: `9e3b2694f1d2a87ce564471b642a7948361a94b10b9b77027648de48ddcb999b`
- Canonical unseen-row SHA-256: `9077de77208a74e53eb4f9428390eb122f27d6926a0f8ded49e75220e4f1e701`
- Rows and labels: 169 total; 78 SUPPORTED; 46 CONTRADICTED; 45 NOT_PROVEN.
- Required slices: 91 hard negatives; 60 supported/paraphrase-focused; 54 unseen rows and six unseen documents.
- Evidence integrity: no missing evidence-ID arrays and no evidence-ID reference mismatches.
- Tenant set is recorded in the JSON manifest; unseen is isolated by tenant and source-dataset marker.
- Unique row IDs: **149/169**. Twenty IDs occur twice.
- Fourteen groups of byte-equivalent evaluation content exist under different unseen IDs and are not marked as intentional duplicates.
- The distribution matches the previous report, but unchanged labels cannot be cryptographically established because the previous pass recorded no checksum.

Integrity status: **FAILED**.

## 2–17. B evaluation fields

- Exact model/revision: NOT RESTORED; evaluation stopped before Phase 2.
- Runtime/export/quantization: NOT MEASURED.
- Input formulation: NOT SELECTED.
- Deterministic veto implementation: NOT EVALUATED.
- Threshold selection: NOT RUN.
- Production same-corpus metrics: not rerun in this pass.
- B gold/category/hard-negative metrics: NOT MEASURED.
- False-reject improvement: NOT MEASURED.
- Frozen B configuration hash: NOT CREATED.
- Unseen results: NOT RUN.
- Latency, P95, RSS, and model size: NOT MEASURED.
- Optional B2: NOT MEASURED; it was not attempted after the blocking integrity failure.

## 18. Production code changed?

**NO.** The corpus itself was also not changed. Only this report and its integrity manifest were added.

## 19. Recommended next step

Run a separate, explicitly authorized corpus-repair pass. It should assign unique stable IDs, either mark or remove exact duplicates according to an independently documented policy, preserve every label and evidence value, and publish a new baseline checksum. That would create a new frozen corpus version; B evaluation should then start in a fresh pass.

## 20. FINAL DECISION

**D. CHALLENGER NOT MEASURABLE**

Reason: the mandatory frozen-corpus integrity prerequisite failed before model work.
