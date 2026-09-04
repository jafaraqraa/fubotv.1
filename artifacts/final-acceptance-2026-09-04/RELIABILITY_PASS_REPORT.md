# FuBot high-impact reliability pass — 2026-09-04

## Decision

**LIMITED PRODUCTION READY**

The P0 numeric-policy unsafe delivery was eliminated, hard safety and tenant isolation held, and CLARIFY precision/recall improved to 100%. The requested usefulness targets were not met: acceptance ANSWER correctness is 30/46 (65.2%), multi-turn semantic success is 14/26 (53.8%), and the unseen-tenant ANSWER score is 8/12 (66.7%). Per the stop rule, no further tuning was performed after replay.

## Trace-first diagnosis

Representative acceptance traces were captured before implementation. F13 retrieved and selected the correct cancellation policy, the gate allowed generation, raw generation chose the full-refund outcome for a 47-hour value, claim validation compared numbers without binding the generated outcome to the satisfied interval, Boundary inherited that result, and the wrong answer was delivered. The first divergent layer was GENERATION; the safety escape was missing deterministic branch/outcome validation downstream.

Validator failures had four generic causes: negation was compared with an entire multi-policy chunk instead of the best proposition; user-supplied quantities were skipped too broadly; numbered complete-list scope was lost; and Arabic attached conjunction splitting damaged claims. Partial repair also replaced a usable supported core with a fallback. History used raw text heuristics and had no stable entity-only active referent. Context selection took top-K by generic ranking before ensuring requested-attribute coverage.

## Implementation

- Added deterministic conditional-policy extraction and branch selection. It preserves comparator inclusivity, ranges, units, tenant provenance and evidence IDs; ambiguity, no resolvable branch, unit mismatch, and competing branches fail closed. An answer claiming another branch outcome is contradicted.
- Tightened quantity handling while accepting harmless Arabic morphology, duration forms, formatting, complete numbered lists, and proposition-local negation. Alphanumeric identifiers remain non-quantities. Partial validation now removes unsafe extras while retaining a supported core.
- Added ephemeral entity-only active-referent state: active referent, type, source turn, confidence and candidates. Single referents resolve; multiple candidates clarify; social turns preserve state; explicit topic change updates it. No business fact is stored in history state.
- Added generic proposition-aware context selection for price, percentage, duration, threshold, location, hours, membership and policy requests. Within budget, each detected request gets a strong surviving candidate when available.

Production files changed for this pass:

- `backend/src/rag/intelligence/answerValidator.js`
- `backend/src/rag/intelligence/activeReferent.js`
- `backend/src/rag/intelligence/contextOptimizer.js`
- `backend/src/rag/intelligence/evidenceDecisionGate.js`
- `backend/src/services/ai.js`
- `backend/src/services/knowledge.js`

Test/artifact files added or updated:

- `backend/test/product_reliability_pass.test.js`
- `backend/test/answer_validator_policy.test.js`
- `artifacts/final-acceptance-2026-09-04/run-direct-cases.js`
- `artifacts/final-acceptance-2026-09-04/run-multiturn.js`
- `artifacts/final-acceptance-2026-09-04/unseen-observatory-fixture.json`

## Verification

Synthetic DEV contains 22 focused subtests across library, fitness, laboratory, and museum/tour domains. It covers exact interval boundaries, middle/below/above values, wrong branch, overlapping ambiguity, unit mismatch, cross-tenant evidence, duration equivalence, complete/incomplete lists, partial answers, one/two referents, social/topic changes, low-ranked direct evidence and two-intent context competition. Focused regression: **143/143 pass**. Full `npm test`: **PASS**.

Grounding Safety Suite: **88/88 scored**, missed unsafe 0, unsupported facts that would be delivered 0, tenant leakage 0, numeric/temporal/negation misses 0. It continues to report two conservative candidate false blocks.

## Same-corpus acceptance replay

| Metric | Before | After | Target |
|---|---:|---:|---:|
| ANSWER correctness | 29/46 (63.0%) | 30/46 (65.2%) | >=85% |
| False safe fallbacks on answerable cases | 16 | 15 | — |
| CLARIFY precision | 3/5 (60.0%) | 3/3 (100%) | — |
| CLARIFY recall | 3/3 (100%) | 3/3 (100%) | — |
| CLARIFY F1 | 75.0% | 100% | >=90% |
| Multi-turn semantic success | 13/26 (50.0%) | 14/26 (53.8%) | >=85% |
| Wrong numeric-policy delivery | 1 | 0 | 0 |
| Wrong delivered answer | 1 | 1 (nonresponsive F36) | 0 |
| Unsupported business facts delivered | 0 | 0 | 0 |
| Tenant leakage | 0 | 0 | 0 |

F13 is now a safe fallback rather than a wrong policy outcome. The remaining wrong answer, F36, gives a supported individual-session price instead of answering the group-capacity question; it is nonresponsive, not an unsupported fact.

## Frozen regressions

| Tenant | ANSWER | CLARIFY | NO_ANSWER | Target met? |
|---|---:|---:|---:|---|
| Clinic | 10/13 (76.9%) | 3/3 (100%) | 4/4 (100%) | ANSWER: no; others: yes |
| BarqTech | 10/13 (76.9%) | 3/3 (100%) | 4/4 (100%) | ANSWER: no; others: yes |

The full 100-case DEV regression scored ANSWER 81.5%, NO_ANSWER 85.0%, CLARIFY 86.7%, with zero tenant leaks. Its aggregate unsupported-output rate was 3%; the two requested tenant slices above each had 0% unsupported output.

## New unseen tenant

`reliability_unseen_observatory_20260904` is a community astronomy observatory, a sector absent from both the repair DEV fixtures and earlier acceptance fixtures. Five documents/five chunks were ingested into an isolated evaluation database and collection, then a frozen 20-case set was run once without tuning.

- ANSWER: **8/12 (66.7%)**, target >=80% — fail
- CLARIFY: **4/4 (100%)**, target >=80% — pass
- NO_ANSWER: **4/4 (100%)**, target >=90% — pass
- Unsupported delivered: **0**
- Tenant leakage: **0**
- Provider errors: **0**

## Anti-overfitting and limitations

Production changes contain none of the acceptance tenant names, fixture/benchmark IDs, acceptance questions, ceramics product names, or sector-specific rules. Embeddings, Qdrant, RRF, reranker, provider/model, prompt, tenant isolation, evidence-ID integrity, renderer, and enforcement configuration were not redesigned.

The dominant remaining failure family is still validator/boundary false rejection of valid multi-value, complete-list, negative-membership and duration propositions, with history extraction also failing some immediate price follow-ups because persisted input can appear twice in the history window. Context coverage improved selected cases but does not compensate for low semantic validation recall. These are usefulness failures; hard safety remained intact.

Artifacts: `direct-results-before-reliability.json`, `direct-results-after-reliability.json`, `multiturn-results-before-reliability.json`, `multiturn-results-after-reliability.json`, `generalization-dev-after-reliability.json`, and `unseen-observatory-results.json` in this directory.
