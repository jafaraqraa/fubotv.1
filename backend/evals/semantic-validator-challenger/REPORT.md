# FuBot Semantic Validator Shadow Challenger Report

Date: 2026-09-04. Scope: offline/shadow only. The production validator, P0 guard, Boundary, routing, generation, and delivery were not modified.

## 1–2. Gold corpus and adjudication

The frozen corpus has 169 independently labelled claim/evidence pairs: 78 SUPPORTED, 46 CONTRADICTED, and 45 NOT_PROVEN. It contains 91 hard negatives, 60 focused supported paraphrases, and a frozen 54-case unseen-tenant slice. Rows retain tenant, question, exact claim, evidence and IDs, expected verdict, flags, source, and adjudication note. Disagreement-prone rows were manually labelled only from the supplied tenant evidence.

The unseen tenant is an artisan sourdough bakery, represented by six frozen documents. It was evaluated after the corpus builder was frozen and no tuning followed its results.

## 3. Production validator benchmark

This is the standalone production validator's claim-level result on the new synthetic gold corpus, not the final Boundary delivery result:

| Metric | Result |
|---|---:|
| SUPPORTED precision / recall / F1 | 70.37% / 24.36% / 36.19% |
| CONTRADICTED precision / recall | 53.85% / 60.87% |
| NOT_PROVEN precision / recall | 31.11% / 62.22% |
| Unsafe accepts | 8/91 (8.79%) |
| False rejects | 59/78 (75.64%) |
| Mean / P95 claim latency | 1.31 / 1.50 ms |

The separate authoritative Grounding Safety Boundary replay remains 88/88 with zero delivered unsupported facts, tenant leakage, numeric misses, temporal misses, or negation/exclusivity misses.

## 4–5. Challenger A

Design: offline CommonJS validator with Arabic normalization, relation-aware lexical/character semantic matching, evidence selection, tenant filtering, and deterministic vetoes for exact values, comparator, temporal-current scope, polarity, complete lists, and relation mismatch. Semantic similarity can never bypass a veto.

| Metric | Result |
|---|---:|
| SUPPORTED precision / recall / F1 | 80.65% / 32.05% / 45.87% |
| CONTRADICTED precision / recall | 50.00% / 71.74% |
| NOT_PROVEN precision / recall | 48.61% / 77.78% |
| Unsafe accepts | 6/91 (6.59%) |
| False rejects | 53/78 (67.95%) |
| Mean / P95 latency | 0.17 / 0.29 ms |
| Evaluation process peak RSS | 62,336 KB |
| External API cost | $0 |

It fails the zero-unsafe-accept rule. The main failures are missing-premise temporal/availability claims: topical overlap was still too permissive.

## 6–7. Challenger B

Two reproducible B implementations are included: a local quantized `mDeBERTa-v3-base-mnli-xnli` ONNX runner with deterministic vetoes, and a strict JSON-schema, temperature-zero OpenRouter batch judge. Both return only the required verdict, confidence, evidence IDs, and reason code.

No valid current-corpus metrics are reported. The local model/runtime artifacts were absent, and the configured evaluation API key returned `API key expired` before any case was scored. Historical NLI results are deliberately not substituted because they use a different 55-pair dataset. Cost incurred in this pass: $0. Operational feasibility is therefore unproven.

## 8–11. Safety and usefulness comparison

| Slice | Production unsafe | A unsafe | Production false reject | A false reject |
|---|---:|---:|---:|---:|
| All gold | 8/91 | 6/91 | 59/78 | 53/78 |
| Hard negatives | 8/91 | 6/91 | n/a | n/a |
| Supported/paraphrase corpus | n/a | n/a | captured in all-gold rate | captured in all-gold rate |

A reduces false rejects by only 10.17% relative, short of the required 30%, and still has unsafe accepts. It is therefore not a candidate for shadow integration.

## 12. Unseen tenant

| Metric | Production | Challenger A |
|---|---:|---:|
| SUPPORTED precision | 75.00% | 53.85% |
| SUPPORTED recall | 50.00% | 38.89% |
| Unsafe accepts | 3/36 (8.33%) | 6/36 (16.67%) |
| False rejects | 9/18 (50.00%) | 11/18 (61.11%) |

The unseen thresholds are missed and the slice was not used for tuning afterward.

## 13–15. Operations, choice, and integration

A is operationally cheap but unsafe. B's current latency, memory, and cost could not be established because neither model path was available. No challenger is chosen. Shadow runtime integration status: **not integrated**. No production file imports these evaluators and no customer-facing behavior changed.

## 16. Disagreement taxonomy

Production/A outcomes: both supported 18; production rejects/A supports 13; production supports/A rejects 9; both reject with same type 63; different reject type 66. The 13 potential usefulness wins cannot proceed because A also has unsafe accepts.

## 17. Remaining risks

- The gold set is intentionally adversarial but partly template-generated; expand it with more independently sourced real claim/evidence pairs before any promotion decision.
- B needs a valid evaluation credential or restored pinned local model, then exactly one frozen-corpus run.
- A needs a redesigned missing-premise detector; threshold tuning alone would not address its unsafe semantic errors.
- The standalone production-validator mapping is diagnostic and must not be confused with the full safe delivery stack.

## 18. FINAL DECISION

**C. CHALLENGER UNSAFE**

Challenger A produced unsafe accepts. Challenger B was not measurable in the current environment. Per the promotion rule, no challenger was promoted or connected even in production shadow telemetry.
