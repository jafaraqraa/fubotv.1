# Cost-Controlled Structured Grounded Generation Model Bake-Off

## Scope

Evaluation only. The 38-case deduplicated Decision Semantics v2 challenge subset was used unchanged. Every model received the same saved current/normal evidence package, Decision Semantics v2 prompt, native JSON schema, safe-partial policy, labels, and temperature. No production, retrieval, Qdrant, validator, Evidence Gate, dataset, prompt, Regression, or HOLDOUT change/run occurred.

Gemini was reconstructed from three compatible saved runs. GPT-5 Mini and Claude Sonnet 4.6 were each attempted for one round. No challenger qualified, so no confirmation runs were made.

## Challenge composition

- Total: 38 unique cases.
- Expected ANSWER: 11, including 10 stable controls and the genuine false-NO_ANSWER challenge.
- Expected NO_ANSWER: 12, including 10 stable controls and both forensic false-ANSWER challenges.
- Expected CLARIFY: all 15 adjudicated targeted cases.

## Metrics

| Model | Valid/provider errors | ANSWER | ANSWER controls | NO_ANSWER | CLARIFY | Unsupported | False ANSWER | False NO_ANSWER | Missed CLARIFY | False CLARIFY |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Gemini 2.5 Flash | 38/0 per run | 90.91% | 100% | 83.33% | 86.67% | 5.26% | 2 | 1 | 2 | 0/23 |
| GPT-5 Mini | 0/38 | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED |
| Claude Sonnet 4.6 | 38/0 | 90.91% | 90% | 83.33% | 93.33% | 5.26% | 2 | 1 | 1 | 1/23 = 4.35% |

Gemini's five primary metric SDs across its three saved runs are all 0 percentage points. No selected challenger exists, so challenger three-run mean/SD and stability distribution are not applicable.

Additional outcomes:

| Model | Evidence present but ignored | Generation omission | Malformed | Hallucinated evidence IDs | Tenant leakage |
|---|---:|---:|---:|---:|---:|
| Gemini | 1 | 0 | 0 | 0 | 0 |
| GPT-5 Mini | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED |
| Claude | 1 | 0 | 0 | 0 | 0 |

## Provider failure

All 38 GPT-5 Mini requests returned HTTP 404: `No endpoints found that can handle the requested parameters` under the frozen native structured-output configuration. They are provider/dependency failures, not accuracy failures. Changing structured-output mode or request parameters would violate the one-variable bake-off, so GPT was not retried under a different configuration.

## Latency, tokens, and provider-reported cost

| Model/run | Mean latency | P95 latency | Input tokens | Output tokens | Cost |
|---|---:|---:|---:|---:|---:|
| Gemini run 1 | 1,556.9 ms | 4,665.3 ms | 49,028 | 2,972 | $0.0221384 |
| Gemini run 2 | 1,006.5 ms | 1,842.5 ms | 49,028 | 2,985 | $0.0221709 |
| Gemini run 3 | 1,150.0 ms | 3,058.9 ms | 49,028 | 2,977 | $0.0221509 |
| Claude round 1 | 3,795.8 ms | 7,718.1 ms | 100,091 | 4,315 | $0.364998 |
| GPT round 1 | No valid generation | No valid generation | 0 | 0 | No generation cost reported |

## Critical forensic cases

### `electronics-n-01`

- Gemini: ANSWER in all 3 runs; cited `elec-contact_chunk_0_c37eea929623`; stated the related showroom location rather than proving the exact requested proposition.
- GPT-5 Mini: not measurable because every request failed at provider routing.
- Claude: ANSWER; cited `elec-contact_chunk_0_c37eea929623`; explicitly inferred that no Nablus branch exists. The evidence proves only the “only showroom in Al-Bireh” statement, so the exact requested proposition remains unsupported.

### `professional_services-n-03`

- Gemini: ANSWER in all 3 runs; cited `svc-support_chunk_0_19dc9459f9ae`; substituted the Sunday–Thursday schedule for the requested Friday proposition.
- GPT-5 Mini: not measurable.
- Claude: ANSWER; cited `svc-support_chunk_0_19dc9459f9ae`; explicitly inferred Friday unavailability and added exclusivity (`فقط`) not stated by the evidence.

Neither measurable model handled either forensic case correctly.

## Acceptance and selection

Claude failed mandatory gates: ANSWER controls 90% (<95%), NO_ANSWER 83.33% (<90%), Unsupported 5.26% (>1.5%), and both forensic cases incorrect. GPT was not measurable under the fixed configuration. First-round passers: none. Selected challenger: none.

Full DEV is not justified. The result does not establish that GPT-5 Mini is inaccurate, only that it is unavailable through the frozen adapter configuration. Claude demonstrates the same over-inference and is slower and substantially more expensive on this subset. The next step is to revise architecture around exact question-to-claim sufficiency rather than proceed with another full-model run.

MODEL BAKE-OFF:
FAIL

BEST MODEL:
NONE

SYSTEMATIC FALSE ANSWER:
NOT FIXED

GROUNDING SAFETY:
FAIL

NEXT STEP:
REVISE ARCHITECTURE

PRODUCTION CHANGE:
NO
