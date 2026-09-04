# Experimental Claim Contract Architecture — Round 1

## Scope

Architecture research only. The experiment used Gemini 2.5 Flash, structured JSON at both reasoning stages, the current normal evidence package, frozen adjudicated labels, the current schema for final answers, safe-partial decision mapping, and the existing claim validator. No production, retrieval, Qdrant, validator, Evidence Gate, dataset, Regression, or HOLDOUT change/run occurred.

The targeted subset contains 38 cases: 11 ANSWER, 12 NO_ANSWER, and 15 CLARIFY. One round was run. It failed architecture acceptance badly at Stage 1, so the two confirmation rounds were not performed.

## Architecture tested

1. Stage 1 receives only the question and emits a claim contract.
2. Stage 2 receives the contract plus VERIFIED_EVIDENCE and emits proposition verdicts.
3. AMBIGUOUS deterministically maps to CLARIFY.
4. All required propositions NOT_PROVEN deterministically map to NO_ANSWER.
5. SUPPORTED/CONTRADICTED invokes a wording-only final generator.
6. The existing claim validator runs after generation.

Schemas: `claim-contract-schema.json` and `support-verdict-schema.json`. Raw run: `results/run-1.json`. Offline stage adjudication: `stage-adjudication.json`.

## Stage 1

| Metric | Result |
|---|---:|
| Referent-resolution accuracy | 29/38 = 76.32% |
| Requested-proposition accuracy | 13/22 inspectable resolved cases = 59.09% |
| Uninspectable contract | 1 case; a Stage-2 malformed row did not retain the already-generated contract |
| Earliest Stage-1 case failures | 10 |

Stage 1 overused AMBIGUOUS on clear named products, wholesale-order questions, and medical/business questions. It also changed “who is the family doctor?” into “what is the definition of a family doctor?”. The proposition threshold of 95% was missed by 35.91 percentage points.

## Stage 2

| Metric | Result |
|---|---:|
| Verdict accuracy against intended decisions | 11/15 = 73.33% |
| NOT_PROVEN accuracy among valid eligible verdicts | 7/9 = 77.78% |
| Related-evidence false support | 1 |
| Closed-world false inference | 1 |
| Malformed Stage-2 output | 1 |
| Earliest Stage-2 failures after excluding upstream contract errors | 3 |

The Friday-support case still converted a Sunday–Thursday statement into CONTRADICTED. Thus separating the stages did not eliminate the closed-world inference. A separate restock-date case was also mapped to CONTRADICTED under the frozen label, and one Stage-2 response failed the strict structure check.

## End-to-end metrics (pre-validator decision scoring)

| Metric | Claim Contract | Decision Semantics v2 baseline |
|---|---:|---:|
| ANSWER | 4/11 = 36.36% | 10/11 = 90.91% |
| NO_ANSWER | 7/12 = 58.33% | 10/12 = 83.33% |
| CLARIFY | 14/15 = 93.33% | 13/15 = 86.67% |
| Unsupported/raw false ANSWER | 2/38 = 5.26% | 2/38 = 5.26% |
| False ANSWER | 2 | 2 |
| False NO_ANSWER | 1 | 1 |
| False CLARIFY | 8/23 = 34.78% | 0/23 = 0% |
| Malformed | 1/38 = 2.63% | 0 |
| Hallucinated evidence IDs | 0 | 0 |
| Tenant leakage | 0 | 0 |

The architecture did not reduce the total false ANSWER count and also became overly conservative on many valid ANSWER and clear NO_ANSWER questions, which triggers the stop rule.

## Forensic acceptance

- Branch case: Stage 1 extracted `يوجد فرع في نابلس`; Stage 2 returned NOT_PROVEN; deterministic final decision NO_ANSWER. PASS.
- Friday-support case: Stage 1 extracted `الدعم متاح يوم الجمعة`; Stage 2 returned CONTRADICTED from the Sunday–Thursday schedule; final decision ANSWER. FAIL.

Only one of the two core systematic failures was fixed.

## Final generation and validator

No failure had final wording generation as its earliest cause. Of the six generated ANSWER outputs, the existing validator rejected two otherwise correct ANSWER outputs and accepted the question-level unsupported Friday answer. Raw unsupported remains 2/38. If validator acceptance were enforced as visibility, one raw false ANSWER would remain potentially visible, but two correct answers would also be suppressed.

## Runtime and cost

- Model calls: 60.
- Input tokens: 30,958.
- Output tokens: 4,397.
- Provider-reported cost: $0.0202799.
- Mean end-to-end latency: 1,826.6 ms per case.
- P95 end-to-end latency: 4,086.6 ms.

## Comparison and decision

Decision Semantics v2 had substantially higher ANSWER and NO_ANSWER accuracy with the same challenge cases. The Evidence Sufficiency and Packaging experiments failed to fix both forensic cases; this Claim Contract architecture fixes the branch case but repeats the Friday closed-world inference and introduces severe Stage-1 over-clarification. Therefore separating “what must be proven” from “does evidence prove it” is directionally useful but this model-driven implementation does not solve the systematic grounding problem safely.

Acceptance failed: ANSWER controls are far below 95%, NO_ANSWER below 90%, Unsupported above 1.5%, False CLARIFY above 5%, proposition extraction below 95%, one forensic case fails, and malformed exceeds 1%. Three-run confirmation and Full DEV are not justified.

CLAIM CONTRACT ARCHITECTURE:
FAIL

PROPOSITION EXTRACTION:
FAIL

SUPPORT VERDICT:
FAIL

SYSTEMATIC FALSE ANSWER:
NOT FIXED

GROUNDING SAFETY:
FAIL

NEXT STEP:
REVISE ARCHITECTURE

PRODUCTION CHANGE:
NO
