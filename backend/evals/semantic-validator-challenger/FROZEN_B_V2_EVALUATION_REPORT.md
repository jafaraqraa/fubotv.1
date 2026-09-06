# FuBot Frozen B-only Semantic Validator Evaluation on Corpus V2

Date: 2026-09-04. Scope: offline DEV evaluation only. No production integration or unseen inference occurred.

## 1. Corpus integrity

All Phase 0 checks passed before inference. DEV file SHA-256 is `3aa1fbe23ae66d52676795a17e2790b2c766840e0854924b110d3e8d777c6ae2`; its canonical-row hash is `9e62e2d2e6c6103b6a26630aef560f7abeafaa737705beeb18f581c83245a6d6`. Unseen file SHA-256 is `8fad6143b3fe018587b70965acd29a058ccac0a46f7fc7d21d1de6b54f58db59`; its canonical-row hash is `732e046570061da4bb9ddd557e2fc94a3e04cfa1a74e97c6596cda1de824b247`. Counts and labels match the manifests, and DEV/unseen fingerprint overlap is zero.

## 2. Production Validator baseline on DEV V2

| Class | TP | FP | FN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|
| SUPPORTED | 6 | 5 | 31 | 54.55% | 16.22% | 25.00% |
| CONTRADICTED | 20 | 15 | 8 | 57.14% | 71.43% | 63.49% |
| NOT_PROVEN | 16 | 30 | 11 | 34.78% | 59.26% | 43.84% |

Unsafe accepts: 5/55. False rejects: 31/37 (83.78%). Mean/P95 latency: 1.69/2.55 ms. Errors: 0. Evaluation-process peak RSS: 61,516 KB.

## 3–4. Exact B model and runtime

- Repository: `MoritzLaurer/mDeBERTa-v3-base-mnli-xnli`
- Model and tokenizer revision: `704310ca0bb8eb15bca150fc1e11083cd423dd02`
- Artifact: repository `onnx/model_quantized.onnx`
- Artifact SHA-256: `27c39e884c14b03cf46cfc5485971b6db70ff330220d93dfe729c63fde43af0e`
- Artifact size: 338,679,133 bytes; complete local snapshot: 359,318,964 bytes.
- Quantization: repository-provided dynamic INT8; `DynamicQuantizeLinear` and `MatMulInteger` operators were verified. Exporter metadata is not present.
- Runtime: Python 3.12.3, ONNX Runtime 1.29.0, Transformers 4.57.6, Tokenizers 0.22.2, NumPy 2.5.2, SentencePiece 0.2.2, CPU only.

## 5–6. Formulation comparison and selection

Each formulation was evaluated only on 92-row DEV. A and B are equivalent on this corpus because each row has one bounded evidence sentence. B won the final latency tie-break.

| Formulation | Safe threshold | Unsafe | SUPPORTED precision | Recall | False rejects | Mean/P95 ms |
|---|---:|---:|---:|---:|---:|---:|
| A: best proposition | 0.05 | 0 | 100% | 27.03% | 27 | 30.23/42.53 |
| B: bounded evidence block | 0.05 | 0 | 100% | 27.03% | 27 | 29.78/42.26 |
| C: local evidence + normalized claim | 0.75 | 0 | 100% | 13.51% | 32 | 30.66/44.98 |

Selected formulation: **B**.

## 7–8. Threshold search

The bounded grid covered 0.05 through 1.00 in 0.01 increments. All 96 thresholds had zero unsafe accepts because deterministic vetoes excluded the unsafe candidates. Among precision-safe thresholds, 0.05 maximized recall.

| Threshold | Unsafe | Precision | Recall | F1 | False rejects |
|---|---:|---:|---:|---:|---:|
| 0.05 (selected) | 0 | 100% | 27.03% | 42.55% | 27 |
| 0.50 | 0 | 100% | 27.03% | 42.55% | 27 |
| 0.75 | 0 | 100% | 24.32% | 39.13% | 28 |
| 0.90 | 0 | 100% | 10.81% | 19.51% | 33 |
| 0.99 | 0 | 100% | 2.70% | 5.26% | 36 |

No final configuration was frozen: DEV failed the recall and usefulness gates.

## 9–11. B DEV result and hard-negative gate

| Class | TP | FP | FN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|
| SUPPORTED | 10 | 0 | 27 | 100% | 27.03% | 42.55% |
| CONTRADICTED | 8 | 7 | 20 | 53.33% | 28.57% | 37.21% |
| NOT_PROVEN | 27 | 40 | 0 | 40.30% | 100% | 57.45% |

DEV unsafe accepts: 0. Hard-negative unsafe accepts: **0/55**. False rejects fell from 31 to 27, a 12.90% relative improvement; the required improvement was at least 30%. Supported recall missed the 90% target by 62.97 percentage points.

The pre-NLI vetoes cover tenant/trusted-evidence mismatch, exact numeric and unit mismatch, comparator/range mismatch, temporal current-versus-historical mismatch, polarity, closed-list membership, conditional branches, relation mismatch, and deterministically visible missing premises including appointment availability. NLI cannot override a veto.

## 12. Category breakdown

`Correct` is exact three-class verdict accuracy in the cohort.

| Existing V2 category | Total | Production correct | B correct | Production unsafe | B unsafe | Production FR | B FR |
|---|---:|---:|---:|---:|---:|---:|---:|
| Supported/paraphrase | 37 | 6 | 10 | 0 | 0 | 31 | 27 |
| Numeric | 50 | 23 | 19 | 5 | 0 | 13 | 11 |
| Threshold | 11 | 8 | 0 | 0 | 0 | 3 | 3 |
| Conditional policy | 6 | 0 | 0 | 4 | 0 | 2 | 2 |
| Temporal | 23 | 11 | 10 | 0 | 0 | 11 | 9 |
| Duration | 9 | 2 | 4 | 0 | 0 | 7 | 5 |
| Complete list | 15 | 1 | 10 | 0 | 0 | 10 | 5 |
| Negative membership | 2 | 0 | 0 | 0 | 0 | 2 | 2 |
| Multi-value | 4 | 0 | 2 | 0 | 0 | 4 | 2 |
| History-resolved referent | 2 | 2 | 0 | 0 | 0 | 0 | 2 |
| Hard negative | 55 | 36 | 35 | 5 | 0 | 0 | 0 |
| Cross-tenant | 11 | 4 | 11 | 1 | 0 | 0 | 0 |
| Missing-premise temporal | 4 | 4 | 4 | 0 | 0 | 0 | 0 |
| Missing-premise availability | 4 | 4 | 4 | 0 | 0 | 0 | 0 |
| Related but not entailed | 8 | 8 | 4 | 0 | 0 | 0 | 0 |

All 92 DEV rows carry the existing `direct` flag. V2 does not independently encode colloquial-Arabic or spelling-variation flags, so separate metrics for those two cohorts are `N/A`; they were not inferred after seeing results.

## 13–15. Configuration and unseen

- Frozen B config SHA-256: **NOT CREATED (DEV failed)**.
- Unseen metrics: **NOT RUN**.
- Unseen unsafe accepts: **NOT RUN**.

The unseen corpus was never passed to the model. This follows the instruction to freeze and run unseen only if DEV passes.

## 16–19. Operations

- Selected single-claim mean/P95 inference latency: 29.78/42.26 ms.
- Model load time: 1,459.39 ms.
- Peak RSS: 1,272,340 KB (about 1.21 GiB).
- CPU utilization during the timed run: approximately 322% across four configured inference threads.
- One 92-claim padded batch: 5,094.00 ms total, 55.37 ms/claim; batching the variable-length corpus was slower than serial single-claim inference.
- Model artifact/local-snapshot sizes: 338,679,133 / 359,318,964 bytes.
- CPU-only execution is feasible for offline evaluation, but its memory footprint is material for later shadow deployment.

## 20. Optional B2

**NOT_MEASURED.** The configured OpenRouter evaluation credential was already confirmed expired; B2 was not used to alter local B.

## 21. Production source changed?

**NO.** Only offline evaluator scripts and result/report artifacts were added. No runtime shadow integration was enabled.

## 22. Recommended next step

Do not promote or integrate this challenger. Preserve these frozen results as evidence that this pinned NLI formulation is safe only at unusably low recall. Per the stop rule, do not patch B, try another NLI model, or run unseen within this pass.

## 23. FINAL DECISION

**B. CHALLENGER NOT BETTER ENOUGH**

B met the zero-unsafe DEV and hard-negative gates, but missed supported recall and relative false-reject-improvement targets by a wide margin.
