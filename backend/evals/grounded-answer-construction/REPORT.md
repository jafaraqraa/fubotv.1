# FuBot Offline Grounded Answer Construction Prototype

Date: 2026-09-05. This is an isolated research prototype; it was not imported by production.

## 1–8. Architecture and methods

The pipeline is trusted evidence → deterministic proposition inventory → question/relation mapping → exact-relation selection → constrained rendering. Every proposition has a deterministic ID, tenant, type, normalized fields, polarity/scope/condition, evidence and document IDs, renderable text, and exact provenance. Untrusted, ID-less, and cross-tenant evidence is rejected before extraction.

Implemented types: `DIRECT_FACT`, `PRICE`, `DURATION`, `QUANTITY`, `DATE_OR_DAY`, `WORKING_HOURS`, `LOCATION`, `MEMBERSHIP`, `NEGATIVE_MEMBERSHIP`, `COMPLETE_LIST`, `THRESHOLD_RULE`, `CONDITIONAL_POLICY`, `RANGE`, `AVAILABILITY_STATIC`, and `CONTACT_OR_IDENTIFIER`.

Extraction uses generic Arabic relation patterns plus deterministic numbers, units, comparators, ranges, polarity, temporal scope, and conditions. Selection requires the requested relation and enforces exact numbers/units, current scope, complete-list closure, tenant ownership, and policy-branch comparison. Negative membership is derived only from an explicitly complete list. The only arithmetic derivation implemented is percentage discount over an approved price, with provenance retained.

Mode A renders approved text directly. Mode B in this run is a deterministic constrained paraphrase wrapper, not an LLM: it adds only a neutral phrase and then checks numbers, units, polarity, comparator, entities, and business tokens. Mutation tests prove fallback behavior for changed numbers, polarity, and entities.

Files created:

- `core.js`
- `core.test.js`
- `evaluate.js`
- `results.json`
- `REPORT.md`

Production source changed: **NO**.

## 9–26. Measured results

The fixed evaluation contains 30 answer-level scenarios: 17 ANSWER, 9 NO_ANSWER, and 4 CLARIFY. It covers all required safety structures. The CURRENT comparison is explicitly a same-evidence, gold-answer Production Validator proxy; live production generation was not invoked, so it is not presented as a full end-to-end production measurement.

As a separate proposition-level diagnostic, the unchanged DEV and unseen Corpus V2 files were scanned without using their claim labels as answer scenarios: 121/132 rows produced at least one trusted proposition, 11 failed closed, and tenant leakage was zero.

| Metric | CURRENT proxy | Construction A | Construction B |
|---|---:|---:|---:|
| Correct ANSWER rate | 94.12% | 76.47% | 76.47% |
| False safe fallback | 5.88% | 23.53% | 23.53% |
| Exact decision accuracy | 96.67% | 80.00% | 80.00% |
| CLARIFY precision | 100% | 100% | 100% |
| CLARIFY recall | 100% | 50.00% | 50.00% |
| NO_ANSWER accuracy | 100% | 100% | 100% |
| Unsupported facts delivered | 0 | 0 | 0 |
| Incorrect ANSWER decisions | 0 | 1 | 1 |
| Tenant leakage | 0 | 0 | 0 |
| Naturalness | n/a | 2.60/3 | 3.00/3 |
| Mean / P95 total latency | 3.65/3.31 ms* | 0.264/0.392 ms | 0.301/0.606 ms |

\* CURRENT's P95 is below its mean because one outlier raised the mean.

Construction A layer timings (mean/P95): extraction 0.146/0.170 ms; selection 0.116/0.294 ms; rendering 0.002/0.006 ms. Construction B: extraction 0.079/0.148 ms; selection 0.064/0.275 ms; constrained paraphrase and preservation 0.158/0.379 ms. Peak evaluation RSS was 62,872 KB. Mode B fallback rate was 0% for its safe built-in candidates; forced number, polarity, and entity mutations were rejected in tests.

Traceability safety was perfect: every delivered assertion came from a selected approved proposition or the verified complete-list derivation. Policy-branch cases were 2/2 correct and tenant leakage was zero. Decision correctness by structural cohort was numeric 4/5, temporal 3/4, and complete-list 4/5; the misses were safe fallbacks, not unsafe numeric/temporal/list deliveries.

One factually supported availability proposition was delivered for the deliberately ambiguous question `هل هذا متاح؟`, where the expected decision was CLARIFY. It is traceable but decisionally incorrect. No unsupported business fact, wrong policy branch, numeric mutation, temporal mutation, or paraphrase-added fact was delivered.

Failure attribution uses exactly the first divergent layer:

- `PROPOSITION_SELECTION`: 4
- `QUESTION_RELATION_MAPPING`: 2
- all other layers: 0

The construction paths produced four safe fallbacks on answerable cases: complete-list query mapping, threshold selection, quantity selection, and date/day selection. Two CLARIFY cases were mishandled by relation mapping. False fallbacks worsened from 5.88% to 23.53%, rather than improving by 25%.

## 27–29. Assessment and next step

The code contains no company, clinician, branch, bakery, electronics, ceramics, or test-entity vocabulary. Rules operate at linguistic relation/type level. The test suite passes 25/25 generic contract tests.

Major limitations:

- Generic extraction loses useful coverage when one sentence fits overlapping types such as threshold plus condition or date plus static availability.
- A single-primary-type proposition is too restrictive for compound but deterministic facts.
- Relation mapping cannot reliably distinguish underspecified pronouns from safely resolved referents without a trusted history input.
- Mode B naturalness was measured with a deterministic wrapper because no valid paraphrase-model credential was used; it does not establish LLM paraphraser behavior.
- The CURRENT baseline is a validator proxy, limiting end-to-end comparative certainty.

Do not integrate or enable shadow. Preserve the result as evidence that construction-by-proposition is traceably safe but currently reduces usefulness. A future pass, if separately authorized, should first redesign multi-relation proposition representation and evaluate it on a larger independently adjudicated answer-level corpus—not add case-specific patterns.

## 30. FINAL DECISION

**B. SAFE BUT NOT USEFUL ENOUGH**

Both construction modes delivered zero unsupported facts and zero tenant/policy/numeric/temporal safety violations. However, supported ANSWER coverage was 76.47%, false fallbacks worsened materially, and CLARIFY recall fell to 50%, so the usefulness and no-regression gates failed.
