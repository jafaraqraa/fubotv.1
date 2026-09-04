# Gemini DEV Adjudicated Offline Replay

## Scope

This replay scored the same 300 saved Gemini DEV outputs. It made no model, OpenRouter, Qdrant, Regression, or HOLDOUT calls and changed no generated answer, production component, source dataset, prompt, schema, or validator.

## Reviewed fixtures

- 9 narrow semantic-equivalence entries, tied to individual cases and local evidence.
- 3 explicit label adjudications.
- 27 failed responses corrected as evaluation/dataset errors: 21 semantic matching errors and 6 label/expected-fact errors.

### Label decisions

| Case | Decision | Reason |
|---|---|---|
| `electronics-a-12` | `KEEP_ORIGINAL_LABEL` | Palestinian “كم بوخذ التوصيل؟” asks duration; the three saved fee answers remain wrong. |
| `professional_services-n-04` | `CHANGE_EXPECTED_DECISION` to ANSWER | Evidence restricts the offer to Sep 1–5, which entails that it does not continue after Sep 5. |
| `electronics-a-13` | `CHANGE_EXPECTED_FACTS` to “منفصلة” | The question asks whether installation and delivery are separate, not the installation price. |

## Metrics

| Metric | Original | Adjudicated | Difference |
|---|---:|---:|---:|
| ANSWER | 164/195 = 84.10% | 191/198 = 96.46% | +12.36 pp |
| NO_ANSWER | 51/60 = 85.00% | 51/57 = 89.47% | +4.47 pp |
| CLARIFY | 29/45 = 64.44% | 29/45 = 64.44% | 0 pp |
| Overall scored correctness | 244/300 = 81.33% | 271/300 = 90.33% | +9.00 pp |
| Decision accuracy | 272/300 = 90.67% | 275/300 = 91.67% | +1.00 pp |

## Unsupported safety

- `RAW_MODEL_UNSUPPORTED`: 6/300 = 2.00%.
- `VALIDATOR_ACCEPTED_UNSUPPORTED`: 3/300 = 1.00%.
- `FINAL_POTENTIALLY_VISIBLE_UNSUPPORTED`: 3/300 = 1.00%, simulated from saved `validatorAccepted`; no actual post-validator delivered response was stored.

The six raw cases are three `electronics-n-01` over-generalizations and three `professional_services-n-03` related-evidence false supports. The latter three remain validator false accepts.

## Validator review

- All 12 previously identified validator false rejections remain false rejections after adjudication.
- The label correction for `professional_services-n-04` exposes 3 additional semantically correct answers rejected by the validator, for 15 total false-rejected responses.
- All 3 previously identified validator false accepts remain false accepts.

## Genuine remaining failures

| Category | Responses |
|---|---:|
| MISSED_CLARIFY | 16 |
| EVIDENCE_PRESENT_BUT_IGNORED | 3 |
| FALSE_NO_ANSWER | 3 |
| OVER_GENERALIZATION | 3 |
| RELATED_EVIDENCE_FALSE_SUPPORT | 3 |
| GENERATION_OMISSION | 1 |
| **Total** | **29** |

Remaining affected cases: `electronics-a-12`, `electronics-n-01`, `distribution-c-01`, `distribution-c-03`, `clinic-a-11`, `clinic-c-01`, `clinic-c-02`, `clinic-c-03`, `fashion-a-06`, `professional_services-n-03`, and `professional_services-c-02`.

## Stability after adjudication

| Class | Cases |
|---|---:|
| STABLE_PASS | 89 |
| MOSTLY_PASS | 2 |
| MOSTLY_FAIL | 0 |
| STABLE_FAIL | 9 |

The remaining behavior is predominantly systematic, not random.

## Acceptance

| Requirement | Result | Pass |
|---|---:|---|
| ANSWER ≥ 78% | 96.46% | Yes |
| NO_ANSWER ≥ 90% | 89.47% | No |
| CLARIFY ≥ 75% | 64.44% | No |
| Unsupported ≤ 1.5% | 2.00% raw | No |

Gemini does not pass DEV after clean measurement.

## Next experiment

Run one narrowly scoped **generic decision-semantics prompt experiment** on the existing DEV ambiguity and insufficiency subset. Strengthen only the distinction between: (a) unresolved referent → CLARIFY, (b) clear request with absent fact → NO_ANSWER, and (c) multiple candidate facts → do not list all candidates as an ANSWER. Use no company names, case IDs, or attribute ontology. Measure repeated CLARIFY, NO_ANSWER, and unsupported outcomes against the adjudicated fixture before any model bake-off or production integration.

The model bake-off is not justified yet because missed clarification is the largest remaining category and is systematic across tenants; it should first be tested as a decision-policy problem under clean measurement.
