# FuBot rollback + P0-only stabilization — 2026-09-04

## Final status

**ROLLBACK DID NOT RECOVER THE EXPECTED STABLE BASELINE.**

Do not declare `STABLE LIMITED PRODUCTION READY`: Clinic and BarqTech ANSWER both remained 76.92%, below the required 90% and 80%. Work stopped without compensating matching rules or unseen-tenant tuning. The isolated P0 guard is retained because it blocked the real wrong conditional-policy branch and did not change either requested tenant's score.

## 1–6. Baseline, classification, rollback and final production delta

The nearest source-control commit (`3d09479`, 2026-09-02) predates substantial valid uncommitted safety/generalization work, so it is not the pre-pass baseline and could not be reverted safely. The exact block-level pre-edit classification is in `ROLLBACK_CLASSIFICATION.md`.

Rolled back from production:

- proposition-aware context selection and both `knowledge.js` call sites;
- the `activeReferent` module and all `ai.js` production dependencies/query rewriting;
- synthetic referent metadata consumption in Evidence Gate;
- rejected validator changes for newline preservation, numbered-list broadening and supported-core-without-fallback rewriting;
- the rejected combined reliability test.

Preserved earlier stable systems:

- CLARIFY ambiguity fields and user-resolvable versus live/business-state distinction;
- legacy history-reference handling from the dedicated CLARIFY work;
- derived arithmetic and provenance propagation;
- strict comparators, numeric units and Arabic clocks;
- complete-list safety already present before the rejected broadening;
- zero-business-claim fail-closed behavior, tenant integrity and Boundary enforcement.

Compared with the reconstructed stable baseline, the only final production delta is:

- new `backend/src/rag/security/conditionalPolicyGuard.js`;
- a small invocation/result hook in `backend/src/rag/intelligence/answerValidator.js`.

## 7–8. P0 tests and real reproduction

The P0 suite has 14 required generic controls plus one final-response integration test: **16/16 passed**. It covers middle/below/above values, inclusive and exclusive boundaries, correct/wrong outcomes, unit mismatch, overlap ambiguity, missing evidence ID, tenant mismatch, user values, a direct numeric fact and ordinary percentage arithmetic.

The real 47-hour pipeline reproduction selected the authoritative policy evidence, Gate returned ANSWER, generation again produced the wrong full-refund branch, the validator classified it `CONTRADICTED`, and the final customer response was the safe fallback. Wrong branch delivered: **0**. Boundary enforcement remained **100%**. P0 blocks; it does not invent or rewrite a replacement outcome.

## 9–11. Restored baseline versus baseline + P0

| Regression | Restored baseline | Baseline + final P0 | Required |
|---|---:|---:|---:|
| Clinic ANSWER | 10/13 = 76.92% | 10/13 = 76.92% | >=90% |
| Clinic CLARIFY | 3/3 = 100% | 3/3 = 100% | >=95% |
| Clinic NO_ANSWER | 4/4 = 100% | 4/4 = 100% | >=95% |
| BarqTech ANSWER | 10/13 = 76.92% | 10/13 = 76.92% | >=80% |
| BarqTech CLARIFY | 3/3 = 100% | 3/3 = 100% | >=95% |
| BarqTech NO_ANSWER | 4/4 = 100% | 4/4 = 100% | >=95% |

The exact requested tenant scores were unchanged by P0. Across the full non-deterministic 100-case run, ANSWER was 81.54% before P0 and 78.46% in the final P0 run; that 3.08-point variation was not tuned. CLARIFY stayed 86.67%, NO_ANSWER stayed 85%, tenant leaks stayed zero, and both runs had zero execution errors. The evaluator's aggregate unsupported-output rate was 3% in both runs; the Clinic and BarqTech slices were 0%.

## 12–16. Safety and regression

- Grounding Safety Suite: **88/88 scored**.
- Missed unsafe responses: **0**.
- Unsupported facts that the safety replay would deliver: **0**.
- Tenant leakage: **0**.
- Numeric misses: **0**.
- Temporal misses: **0**.
- Negation/exclusivity misses: **0**.
- P0 wrong-branch delivery: **0**.
- Targeted routing/STT/media/Evidence Gate/CLARIFY/provenance/Boundary/renderer suite: **150/150 passed**.
- Full `npm test`: **PASS**.

The safety replay reports three conservative candidate false blocks. The separate 100-case generalization evaluator reports a 3% unsupported-output rate outside the two requested tenant slices, so a universal unsupported-delivery claim cannot be made from that evaluator even though the formal 88-case safety suite is clean.

## 17–19. Experiment removal, limitations and decision

Production searches confirm:

- proposition-aware context selection: **absent**;
- `activeReferent` production dependency: **absent**;
- rejected validator numbered-list/newline/partial-core broadening: **absent**;
- earlier CLARIFY, provenance, derived arithmetic, complete-list safety, zero-claim fail-closed, tenant integrity and Boundary enforcement: **present**.

Anti-overfitting search of the final P0 production delta found zero acceptance tenant names, fixture/case IDs, exact questions, ceramics terminology, or case-specific numbers.

Known usefulness limitations remain unchanged and were not chased: semantic validator recall, old false fallbacks, context coverage, multi-turn behavior, unseen-tenant score and nonresponsive cases. Most importantly, reconstructing and rolling back the recorded experiment blocks did not reproduce the claimed historical Clinic/BarqTech ANSWER baseline. The absence of a clean pre-pass commit means that historical state cannot be proven or restored further without a separate source-control recovery decision.
