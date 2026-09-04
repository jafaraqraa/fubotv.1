# Gemini Structured Grounded Generation — DEV Offline Failure Analysis

## Scope and evidence quality

Analyzed only the three saved `google_gemini-2.5-flash-dev-run-{1,2,3}.json` files. Each has 100 rows, model `google/gemini-2.5-flash`, OpenRouter, `native_json_schema`, `safe_partial`, zero provider errors, zero malformed outputs, zero missing responses, zero hallucinated IDs, and zero tenant leakage.

The saved rows do **not** contain the complete `VERIFIED_EVIDENCE` block sent to the model. Cited and expected source text was reconstructed from the local DEV `companies.json`; uncited retrieved chunks cannot be proven after the fact. This prevents definitive retrieval/context attribution for a small subset, but does not prevent inspecting decisions, answers, cited claims, validator outcomes, and evaluator matching.

## Core results

| Measure | Result |
|---|---:|
| Responses | 300 |
| Failed case-runs | 56 |
| Unique cases with any failure | 20/100 |
| Stable pass | 80 |
| Mostly pass | 2 |
| Mostly fail | 0 |
| Stable fail | 18 |

Only `distribution-c-03` changed decision across runs (`CLARIFY/ANSWER/CLARIFY`). `fashion-a-06` kept `ANSWER` but omitted a required fact in one run. Thus nondeterminism affects two cases; most failures are systematic.

## Primary failure taxonomy

| Primary cause | Failed responses | Share of 56 |
|---|---:|---:|
| D1 Evaluator false rejection | 24 | 42.9% |
| A4 Missed clarify | 16 | 28.6% |
| D4 Expected-label/question problem | 6 | 10.7% |
| B1 Evidence present but ignored | 4 | 7.1% |
| C2 Over-generalization | 3 | 5.4% |
| B2 Related evidence mistaken for support | 3 | 5.4% |

## Expected ANSWER failures (31)

- 24 evaluator false rejections: semantically correct paraphrases/numeric forms fail lexical matching. Examples include `لا يتم التوزيع` vs `لا يغطي`, `يمكن إرجاع` vs `تقبل`, `8:30` vs `الثامنة والنصف`, and `لا يغطي` vs `لا يشمل`.
- 3 question/expected-fact mismatch: `electronics-a-12` can naturally mean delivery price or duration, while the label accepts only duration.
- 3 stable evidence-use failures: `clinic-a-11` returned `NO_ANSWER` despite the expected `clinic-changes` source containing the once/6-hours rule.
- 1 generation omission: `fashion-a-06` omitted the invoice condition in run 3.

## Expected NO_ANSWER failures (9)

| Case | Runs | Cause | Validator |
|---|---:|---|---|
| `electronics-n-01` | 3 | Over-generalized “only showroom in Al-Bireh” into “no Nablus branch”; the negative sentence was not represented as a cited claim | Rejected/partial |
| `professional_services-n-03` | 3 | Sunday–Thursday schedule was treated as an answer to Friday availability without an explicit Friday fact | Accepted |
| `professional_services-n-04` | 3 | Evidence says promotion runs Sep 1–5; answering “not after Sep 5” is logically supported, so expected `NO_ANSWER` is disputable | Rejected/contradicted |

Each group is 33.3% of the nine NO_ANSWER failures. Conservatively, six are real unsafe/related-evidence authorizations; three require label adjudication.

## Expected CLARIFY failures (16)

- Missing referent/entity: 13 responses (`distribution-c-01`, one run of `distribution-c-03`, `clinic-c-01`, `clinic-c-02`, `clinic-c-03`).
- Multiple candidate entities/attribute: 3 responses (`professional_services-c-02`); the model listed both package durations instead of asking which package.
- The failed outputs supplied no useful clarification question because they selected `ANSWER` or `NO_ANSWER`.
- Seven failures returned factually supported `ANSWER`s, while six returned `NO_ANSWER`; the core error is decision semantics/reference handling rather than claim fabrication.

## Unsupported outputs and validator

The evaluator's 3% “unsupported” metric is a proxy: any `ANSWER` on an expected `NO_ANSWER` case. It is not claim-level entailment.

- Raw proxy: 9/300 = 3%.
- If the saved validator result were enforced as the final gate: 3/300 = 1% would remain visible (`professional_services-n-03`).
- `electronics-n-01`: uncited negative/over-generalization, rejected by validator.
- `professional_services-n-03`: cited schedule is true but does not answer Friday; accepted by validator (three false accepts for question-level sufficiency).
- `professional_services-n-04`: date conclusion is logically supported but conflicts with the expected label and validator; this is not defensibly an invented claim.

The saved experimental benchmark does not store an actual post-validator final user response, so the 1% figure is a deterministic simulation from `validatorAccepted`, not an observed delivery metric.

## Validator/evaluator findings

- Evaluator false rejections: 24 responses across eight stable cases.
- Validator false rejections: 12 responses where answers are supported paraphrases (`clinic-a-06`, `clinic-a-12`, `clinic-a-13`, `fashion-a-08`).
- Validator false accepts: 3 responses (`professional_services-n-03`) at question-sufficiency level.
- Technically valid evidence IDs do not guarantee entailment; ID validity was 100%, but `electronics-n-01` proves that an uncited sentence can appear beside a valid cited claim.

## Cross-domain and language distribution

| Domain | Failed responses |
|---|---:|
| Clinic | 21 |
| Distribution | 10 |
| Electronics | 9 |
| Professional services | 9 |
| Fashion | 7 |

Tags are overlapping: Palestinian 38, hard paraphrase 22, MSA 18, ambiguous/clarify 16, typo 13, NO_ANSWER 9, temporal 3, multi-intent 3. The concentration in Palestinian/paraphrase cases is driven heavily by lexical evaluator misses and ambiguous follow-ups, not a single tenant retrieval failure.

## Architectural layer attribution

| Primary layer | Failed responses |
|---|---:|
| Evaluator/dataset | 30 |
| Structured generation decision/evidence sufficiency | 25 |
| Structured claim generation | 1 |
| Retrieval/evidence supplied | 0 proven |
| Evidence packaging | 0 proven |
| Multi-intent policy | 0 primary (3 secondary composition cases) |
| Validator | 0 primary, but 12 false-reject and 3 false-accept secondary outcomes |

No retrieval or packaging failure is asserted because the complete sent context was not persisted. Expected/cited local sources support the diagnosed facts, but that is weaker than saved prompt telemetry.

## Counterfactual impact (no double-counting)

- Fix semantic expected-fact matching: recover 24/195 ANSWER responses, raising measured ANSWER from 84.11% to about 96.41% without changing the model.
- Fix missed clarification perfectly: recover 16/45 CLARIFY responses, raising CLARIFY from 64.45% to 100%.
- Fix the six defensible NO_ANSWER authorization errors: recover 6/60, raising NO_ANSWER from 85% to 95% and reducing raw unsupported from 3% to 1%.
- Adjudicate the three temporal label disputes separately: potentially another 5 pp NO_ANSWER reporting change, but this is a dataset-definition effect rather than model improvement.
- Fix evidence-use/claim omissions: recover 4/195 ANSWER responses, about +2.05 pp.

## Ten worst cases

1. `professional_services-n-03` — stable related-evidence authorization and validator false acceptance.
2. `electronics-n-01` — stable uncited negative over-generalization.
3. `distribution-c-01` — stable missed clarify with two product candidates.
4. `professional_services-c-02` — stable missed clarify with two package durations.
5. `clinic-c-02` — stable policy answer to an unresolved personal appointment request.
6. `clinic-c-01` — stable `NO_ANSWER` instead of clarifying an unresolved service reference.
7. `clinic-c-03` — stable `NO_ANSWER` instead of clarifying which appointment.
8. `clinic-a-11` — stable `NO_ANSWER` despite the expected rescheduling evidence.
9. `electronics-a-12` — stable attribute ambiguity exposed by an underspecified question/label.
10. `professional_services-n-04` — stable disagreement among model, validator, and dataset about temporal entailment.

## Next experiment

Run one **offline evaluator/label adjudication replay** on these same saved 300 outputs: replace only expected-fact lexical matching with a deterministic, reviewed semantic-equivalence fixture for the 20 disputed cases and adjudicate the two underspecified labels (`electronics-a-12`, `professional_services-n-04`). Do not change the generation prompt or call another model. This isolates measured product failures from scoring artifacts before deciding whether a stronger model is worth testing.

Another model bake-off is not justified now: 30/56 failures are primarily evaluator/dataset artifacts, and the largest remaining real failure is systematic CLARIFY semantics, not broad stochastic language weakness.
