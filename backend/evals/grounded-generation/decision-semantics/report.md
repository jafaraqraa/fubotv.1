# Limited Decision-Semantics Experiment

## Scope and freeze compliance

This is an evaluation-only preparation. No production code, retrieval, Qdrant, embeddings, reranking, Evidence Gate, validator, routing, PromptBuilder, tenant logic, knowledge, source labels, adjudication fixture, schema, model, or baseline prompt was changed.

The experimental prompt is a separate copy. It adds only a generic ordered decision procedure: resolve the referent; clarify unresolved or multiple referents; use NO_ANSWER for a clear request whose requested fact is not proven; reject related-but-insufficient evidence; and use ANSWER only for a resolved request proven by cited evidence. It contains no DEV case IDs, company names, products, prices, or dataset dates.

## Offline fixture validation

- Source DEV cases: 100.
- Targeted subset: 38 unique cases.
- Expected CLARIFY: 15 (all adjudicated DEV CLARIFY cases).
- Expected NO_ANSWER: 12 (2 genuine false-ANSWER targets and 10 stable controls).
- Expected ANSWER: 11 (1 genuine false-NO_ANSWER target and 10 stable controls).
- Case IDs, tenant IDs, questions, expected decisions, and adjudicated facts were validated before any provider call.
- Controls were selected deterministically: two stable adjudicated 3/3 passes per domain for each control decision.

## Old saved Gemini behavior on this exact subset

| Run | CLARIFY | NO_ANSWER | ANSWER control |
|---|---:|---:|---:|
| 1 | 10/15 = 66.67% | 10/12 = 83.33% | 10/10 = 100% |
| 2 | 9/15 = 60.00% | 10/12 = 83.33% | 10/10 = 100% |
| 3 | 10/15 = 66.67% | 10/12 = 83.33% | 10/10 = 100% |
| Aggregate | 29/45 = 64.44% | 30/36 = 83.33% | 30/30 = 100% |

Old raw unsupported proxy: 6/114 = 5.26%. Old missed CLARIFY: 16/45. Old false CLARIFY: 0/69 non-CLARIFY responses.

### Old transition matrix

| Expected | → ANSWER | → NO_ANSWER | → CLARIFY |
|---|---:|---:|---:|
| ANSWER | 30 | 3 | 0 |
| NO_ANSWER | 6 | 30 | 0 |
| CLARIFY | 10 | 6 | 29 |

## Provider availability and stop decision

The locally persisted provider telemetry was successfully synchronized with OpenRouter on 2026-09-03 16:42:32. The configured OpenRouter key is enabled, but the provider-reported limit is 0.30, usage is 0.3048674, and remaining balance is 0. No generation request was made.

Under the task's provider-unavailable stop rule, all three experimental runs are NOT MEASURED. There is consequently no new transition matrix, case-by-case improvement/regression comparison, acceptance decision, or justification for full DEV verification.

## Required final fields

1. Exact experimental prompt change: the ordered generic referent-resolution, evidence-sufficiency, and CLARIFY-vs-NO_ANSWER procedure in `system-instructions-v2.txt`.
2. Files created/modified: four files in this directory plus generated `targeted-subset.json`; production files modified: none.
3. Targeted subset size: 38.
4. CLARIFY cases: 15.
5. NO_ANSWER cases: 12 (10 controls, 2 targeted failures).
6. ANSWER controls: 10 (plus 1 targeted false-NO_ANSWER case).
7. Provider availability: unavailable; zero remaining OpenRouter balance.
8. Run 1: NOT MEASURED.
9. Run 2: NOT MEASURED.
10. Run 3: NOT MEASURED.
11. CLARIFY mean: NOT MEASURED.
12. NO_ANSWER mean: NOT MEASURED.
13. ANSWER-control mean: NOT MEASURED.
14. New unsupported rate: NOT MEASURED.
15. Missed CLARIFY before vs after: 16/45 vs NOT MEASURED.
16. False CLARIFY before vs after: 0/69 vs NOT MEASURED.
17. New decision transition matrix: NOT MEASURED.
18. Cases improved: NOT MEASURED.
19. Cases regressed: NOT MEASURED.
20. Acceptance passed: NOT MEASURED.
21. Full DEV verification justified: no; targeted experiment must be measured first.

DECISION-SEMANTICS EXPERIMENT:
NOT MEASURED

MISSED CLARIFY:
NOT MEASURED

CONTROL REGRESSION:
NOT MEASURED

NEXT STEP:
WAIT FOR PROVIDER

PRODUCTION CHANGE:
NO
