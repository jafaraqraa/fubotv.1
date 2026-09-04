# Limited Evidence Packaging Experiment

## Scope and method

Evaluation only. Gemini 2.5 Flash, Decision Semantics v2, native JSON schema, adjudicated labels, temperature 0.2, max tokens 700, and safe-partial policy were frozen. No production, retrieval, Qdrant, validator, Evidence Gate, model, prompt, or dataset change was made. Package A uses the compatible saved v2 runs. B/C/D received one run each. No additional repetitions were run because no candidate met the no-regression condition.

The targeted subset has 27 cases: two stable forensic false-ANSWER cases, ten stable ANSWER controls, ten stable NO_ANSWER controls, and five stable CLARIFY controls. The DEV labels contain no ANSWER case with more than one `expectedEvidenceId`; therefore the selected ANSWER controls are the available stable cases whose retrieved packages contain multiple chunks, and every transformation explicitly preserves their labeled gold chunk.

## Package construction

- A — exact current ordered evidence from the saved v2 artifact.
- B — manually adjudicated per-case removal of clearly irrelevant whole chunks; wording and order preserved.
- C — B split into proposition/single-rule units without paraphrasing, with `sourceId` provenance.
- D — C filtered by the exact entity, attribute, scope, time, and condition of the request; zero evidence was allowed.

At the fixture level, A contained 97 chunk units removed as clearly irrelevant and 30 retained units (10 supporting ANSWER controls and 20 related/context units). B contained those 30 units. C exposed 93 atomic/tightly-coupled propositions because mixed retained chunks were split; 63 were not request-aligned. D retained 30 aligned propositions. These are packaging-fixture classifications, not a production ontology.

## Metrics

| Package | Runs | ANSWER | NO_ANSWER | CLARIFY | Unsupported | False ANSWER | False NO_ANSWER | False CLARIFY | Generation omission | Evidence present but ignored |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A | 3 saved, identical metrics | 100% | 83.33% | 100% | 7.41% | 2 | 0 | 0 | 0 | 0 |
| B | 1 | 100% | 83.33% | 100% | 7.41% | 2 | 0 | 0 | 0 | 0 |
| C | 1 | 80% | 91.67% | 100% | 3.70% | 1 | 0 | 2 | 0 | 2 |
| D | 1 | 90% | 83.33% | 80% | 7.41% | 2 | 0 | 1 | 0 | 1 |

False CLARIFY for C occurred on two ANSWER controls, so its apparent NO_ANSWER/unsupported improvement is unsafe. D lost one ANSWER control, changed one NO_ANSWER control into ANSWER, and changed one CLARIFY control into NO_ANSWER.

## Evidence size

| Package | Evidence units | Related/context visible | Clearly irrelevant visible | Evidence characters | Input tokens | Mean input tokens/case | Token reduction vs A |
|---|---:|---:|---:|---:|---:|---:|---:|
| A | 127 | 20 | 97 | 20,675 | 35,520 | 1,315.6 | 0% |
| B | 30 | 20 | 0 | 5,200 | 26,016 | 963.6 | 26.76% |
| C | 93 propositions | 20 aligned plus 63 non-aligned propositions | 63 | 4,786 | 30,731 | 1,138.2 | 13.48% |
| D | 30 propositions | 20 | 0 | 1,767 | 25,450 | 942.6 | 28.35% |

Atomic markup increased token overhead relative to B despite slightly fewer evidence characters.

## Forensic cases

### `electronics-n-01`

| Package | Exact visible evidence | Decision | Answer summary | Claim/citation | Requested proposition proven? |
|---|---|---|---|---|---|
| A | Contact/showroom chunk plus four irrelevant chunks | ANSWER | Only showroom is in Al-Bireh | Supported showroom claim → `elec-contact…` | No |
| B | Original contact/showroom chunk only | ANSWER | Explicitly says no Nablus branch, then gives showroom location | Only showroom claim cited | No |
| C | Contact chunk split into location/hours and facade-image propositions | ANSWER | Explicitly says no Nablus branch | Only location proposition cited | No |
| D | Location/hours proposition only | ANSWER | Explicitly says no Nablus branch | Only location proposition cited | No |

This failure remained 4/4 package variants. Removing distractors and splitting/alignment strengthened rather than removed the unsupported closed-world inference.

### `professional_services-n-03`

| Package | Exact visible evidence | Decision | Answer/claims | Requested proposition proven? |
|---|---|---|---|---|
| A | Support chunk plus four irrelevant chunks | ANSWER | Email support is available Sunday–Thursday | No |
| B | Original support chunk only | ANSWER | Same related schedule claim | No |
| C | Split email schedule and package-duration propositions | NO_ANSWER | Empty answer/claims | No evidence proves it |
| D | Email schedule proposition only | NO_ANSWER | Empty answer/claims | No evidence proves it |

Atomic/request-aligned presentation fixed this case in the single C and D observations, but neither package was safe on controls.

## Acceptance and stop decision

| Requirement | Best observed safe result | Pass |
|---|---:|---|
| NO_ANSWER ≥ 90% | B: 83.33% | No |
| Unsupported ≤ 1.5% | B: 7.41% | No |
| ANSWER controls ≥ 95% | A/B: 100% | Yes |
| CLARIFY controls ≥ 85% | A/B: 100% | Yes |
| False CLARIFY ≤ 5% | A/B: 0% | Yes |
| Both forensic cases improve materially | No package | No |

B is the only transformed package with no control regression, but it changes neither false ANSWER. C improves one forensic case at the cost of a 20-point ANSWER-control collapse. D also fixes only that case and regresses both ANSWER and CLARIFY controls while introducing another false ANSWER. Under the stop rule, packaging alone is not enough and no candidate earns two additional runs.

Full DEV is not justified. A model bake-off is now justified because the exact closed-world over-inference survives prompt semantics, distractor removal, atomic splitting, and request alignment; the one packaging variant that reduced it was unsafe on controls.

EVIDENCE PACKAGING EXPERIMENT:
FAIL

BEST PACKAGE:
NONE

FALSE ANSWER:
NOT IMPROVED

CONTROL REGRESSION:
UNSAFE

PRIMARY CONCLUSION:
No evidence package fixed both systematic false ANSWER cases while preserving valid ANSWER and CLARIFY controls.

NEXT STEP:
MODEL BAKE-OFF

PRODUCTION CHANGE:
NO
