# Zero-API Evidence-Package Forensics

## Scope

This analysis used only saved local artifacts, the local benchmark source fixture, and the saved runner construction logic. API calls: 0. No Gemini, OpenRouter, Qdrant, production, prompt, retrieval-ranking, validator, Evidence Gate, schema, or label changes were made.

## Reconstruction

The exact model-visible user payload is reconstructable for both cases and all three runs: ordered evidence IDs and full texts were saved, and the runner's deterministic serialization is known. Each case's payload is identical across its three runs. Scores are saved for analysis but were not sent. Document IDs/filenames were cross-referenced offline but were not sent. Explicit neighbor-expansion provenance was not saved; text equality with each one-chunk source shows no added neighbor text in these packages.

## Findings

| Case | Direct | Related only | Irrelevant | Behavior | Packaging | Label | Root cause |
|---|---:|---:|---:|---|---|---|---|
| `electronics-n-01` | 0 | 1 | 4 | Identical ANSWER/claim/citation 3/3 | Closed-world `المعرض الوحيد` cue promotes showroom scope to branch scope | Correct under strict grounding | MIXED |
| `professional_services-n-03` | 0 | 1 | 4 | Identical ANSWER/claim/citation 3/3 | Compact weekday range under broad support heading appears exhaustive | Correct under strict grounding | MIXED |

In both cases the claim text itself is supported by its cited evidence, which explains the validator's `SUPPORTED` result. The unsafe inference is not an invented sentence; it is the decision that a true adjacent fact constitutes an ANSWER to a different requested proposition. Neither response explicitly resolves the user's yes/no question.

## Next experiment

Run one limited **evidence-packaging experiment** before any model bake-off. Use the already defined offline packages A–D: preserve A; remove related/irrelevant material in B; atomically split mixed chunks verbatim in C; and supply only direct requested-attribute evidence in D. Freeze prompt, model, labels, schema, and retrieval ranking. This isolates whether proposition-level evidence presentation prevents the systematic answer-substitution behavior.

EVIDENCE FORENSICS:
COMPLETE

ELECTRONICS-N-01:
MIXED

PROFESSIONAL-SERVICES-N-03:
MIXED

PRIMARY BOTTLENECK:
Model-visible evidence promotes supported adjacent facts into answers without proving the exact requested proposition.

NEXT EXPERIMENT:
EVIDENCE PACKAGING

API CALLS:
0

PRODUCTION CHANGE:
NO
