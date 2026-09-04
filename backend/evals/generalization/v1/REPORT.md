# FuBot multi-company generalization baseline v1

Evaluation date: 2026-09-02. Production behavior was not changed. The benchmark used an isolated SQLite database and the dedicated Qdrant collection `fubot_generalization_v1`.

## Corpus and split

Five fictional tenants were evaluated: برق تك (`gen_electronics`), سند للتوزيع (`gen_distribution`), عيادة نبع الطبية (`gen_clinic`), خيط وزيتونة (`gen_fashion`), and مرتكز للاستشارات (`gen_services`). Each tenant has six sources (30 total): products/services, policies, delivery/hours, returns/cancellation, availability/contact, and a current or expired offer as appropriate to its domain.

The 150 cases contain 100 ANSWER, 25 NO_ANSWER, and 25 CLARIFY cases. DEV contains 100 cases (65/20/15); the frozen HOLDOUT contains 50 (35/5/10). Coverage includes 110 Palestinian Arabic, 35 noisy/typo, 65 difficult paraphrase, 20 multi-intent, 20 temporal, 10 cross-tenant traps, and one image-derived knowledge case.

## Retrieval

| Split | Recall@1 | Recall@5 | MRR | Mean ms | P50 ms | P95 ms | Errors | Tenant leaks |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| DEV | 84.62% | 100.00% | 0.9069 | 91.2 | 83.0 | 164.9 | 0 | 0 |
| HOLDOUT | 88.57% | 94.29% | 0.9143 | 116.3 | 107.9 | 178.7 | 0 | 0 |

DEV Recall@5 by company was 100% for every company. HOLDOUT Recall@5 was 85.71% for electronics and clinic, and 100% for distribution, fashion, and services. HOLDOUT Recall@5 by relevant tag: Palestinian 94.29%, typo/noisy 80.00%, hard paraphrase 92.00%, multi-intent 93.33%, temporal 100%, image 100%.

## Generation (three runs)

| Split/run | ANSWER | NO_ANSWER | CLARIFY | Unsupported output | Mean ms | P95 ms |
|---|---:|---:|---:|---:|---:|---:|
| DEV 1 | 58.46% | 75.00% | 46.67% | 5.00% | 1540.5 | 2861.8 |
| DEV 2 | 58.46% | 70.00% | 46.67% | 6.00% | 1573.9 | 2915.9 |
| DEV 3 | 60.00% | 65.00% | 46.67% | 7.00% | 1440.2 | 2482.4 |
| DEV mean (population SD) | 58.97% (0.73 pp) | 70.00% (4.08 pp) | 46.67% (0.00 pp) | 6.00% (0.82 pp) | 1518.2 (56.8) | 2753.4 (192.9) |
| HOLDOUT 1 | 25.71% | 80.00% | 10.00% | 2.00% | 1942.3 | 3619.5 |
| HOLDOUT 2 | 25.71% | 100.00% | 10.00% | 0.00% | 1684.1 | 3985.6 |
| HOLDOUT 3 | 31.43% | 100.00% | 10.00% | 0.00% | 1683.4 | 3200.1 |
| HOLDOUT mean (population SD) | 27.62% (2.70 pp) | 93.33% (9.43 pp) | 10.00% (0.00 pp) | 0.67% (0.94 pp) | 1769.9 (121.9) | 3601.7 (320.9) |

Stable correct rate across all decisions was 52/100 (52%) on DEV and 14/50 (28%) on HOLDOUT. The partially unstable rate was 15% on DEV and 6% on HOLDOUT.

## Per-company generation means

| Company | DEV ANSWER | DEV NO | DEV CLARIFY | HOLDOUT ANSWER | HOLDOUT NO | HOLDOUT CLARIFY |
|---|---:|---:|---:|---:|---:|---:|
| برق تك | 84.62% | 91.67% | 66.67% | 33.33% | 100% | 50% |
| سند للتوزيع | 53.85% | 66.67% | 66.67% | 19.05% | 100% | 0% |
| عيادة نبع الطبية | 25.64% | 75.00% | 33.33% | 28.57% | 100% | 0% |
| خيط وزيتونة | 71.79% | 66.67% | 33.33% | 14.29% | 100% | 0% |
| مرتكز للاستشارات | 58.97% | 50.00% | 33.33% | 42.86% | 66.67% | 0% |

Overall correctness by category (all decisions) was: DEV Palestinian 60.51%, MSA 57.14%, typo 52.00%, hard paraphrase 50.48%, multi-intent 73.33%, temporal 80.00%, cross-tenant traps 66.67%. HOLDOUT Palestinian 34.07%, MSA 0%, typo 23.33%, hard paraphrase 34.44%, multi-intent 28.89%, temporal 37.78%, and image 0%.

## Regression scorecard and gap

| Suite | Recall@5 | MRR | ANSWER | NO_ANSWER | CLARIFY | Unsupported |
|---|---:|---:|---:|---:|---:|---:|
| Existing frozen 83-case regression | 100% | 1.0000 | 91.33% | 100% | 100% | 0% |
| New DEV | 100% | 0.9069 | 58.97% | 70.00% | 46.67% | 6.00% |
| New frozen HOLDOUT | 94.29% | 0.9143 | 27.62% | 93.33% | 10.00% | 0.67% |

Regression minus HOLDOUT gaps: ANSWER 63.71 pp, NO_ANSWER 6.67 pp, CLARIFY 90.00 pp; unsupported output regressed by 0.67 pp. By the requested heuristic this is weak generalization and substantial domain brittleness.

## DEV diagnosis

Across the 48 DEV cases that were not correct in all three runs, earliest-failure classification was: RETRIEVAL_MISS 22, EVIDENCE_GATE_FALSE_ANSWER 14, EVIDENCE_GATE_FALSE_NO_ANSWER 8, GENERATION_MISSED_FACT 3, and MULTI_INTENT_FAILURE 1. Here, RETRIEVAL_MISS includes the application routing path not invoking or not presenting the expected evidence during generation even when the standalone retrieval benchmark found it; it is not evidence of a Qdrant isolation failure.

The dominant generic bottleneck is tenant-independent routing/prompt contamination. Representative failures answered with FUThing-specific policies, currencies, branches, and generic medical/service wording even though the active tenant's correct evidence existed. Ambiguous prompts frequently became ANSWER or NO_ANSWER rather than CLARIFY. This explains why standalone retrieval is much stronger than end-to-end generation.

No Qdrant payload from a different tenant appeared in any retrieval or generation telemetry (zero leaks across all runs). Nevertheless, unsupported business outputs occurred in DEV (5–7% of all cases per run) and HOLDOUT once (2% in run 1), so the safety result does not meet the regression baseline.

## Reproduction

Use `node backend/scripts/build-generalization-v1.js`, then `node backend/scripts/evaluate-generalization-v1.js setup`. Run retrieval with `retrieval dev|holdout` and generation with `generation dev|holdout`. Generation requires `GENERALIZATION_CONFIG_DB` to point to a local configuration database containing the selected provider/model; secrets are never embedded in benchmark artifacts.

GENERALIZATION VERDICT:
WEAK

NEXT SYSTEM IMPROVEMENT:
Make company-knowledge routing and the final system prompt tenant-neutral and evidence-exclusive, eliminating hard-coded FUThing business facts while preserving the existing retrieval and validator safety behavior.
