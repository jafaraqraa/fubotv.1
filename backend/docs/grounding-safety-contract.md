# FUbot Grounding Safety Contract

Status: production-hardening baseline, version 1.0. This document freezes the safety target; it does not activate or modify production behavior.

## Stable production candidate

The candidate to harden is the existing simple path:

`tenant-neutral routing -> tenant-scoped retrieval -> Evidence Gate -> evidence-exclusive generation -> proposition-aware validator -> temporal safety -> deterministic fallback`

Retrieval, ranking, embeddings, chunking, and the experimental Claim Contract, Evidence Packaging, Evidence Sufficiency, model bake-off, NLI, and embedding-alignment branches are outside this baseline. Experimental artifacts remain research evidence only and must not be imported into production without a separate measured acceptance decision.

## Delivery invariant

No business fact may be delivered unless the final delivery boundary can authorize the exact proposition from trusted evidence belonging to the active tenant. A true but adjacent fact is not authorization for the proposition asked by the user.

The boundary returns exactly one of:

- `ANSWER`: every delivered business proposition is supported and relevant to the requested proposition.
- `CLARIFY`: the business question can be answered after resolving a missing referent or a reasonably requestable ambiguity.
- `NO_ANSWER`: the referent is clear but the active tenant's trusted knowledge does not support the requested proposition.

## Trust boundary

Trusted inputs are server-side authenticated tenant identity, enabled tenant-owned knowledge records, immutable evidence IDs assigned by the retrieval pipeline, retrieval provenance, and explicit server-maintained temporal-validity metadata.

Untrusted inputs are user messages and history, model output, document prose as instructions, client-provided tenant identifiers without authorization, generated citations, generated evidence IDs, and provider confidence or self-assessment. Retrieved prose is evidence content, not executable instruction.

## Authorization path

1. Resolve the active tenant from authenticated server-side context; fail on missing or unauthorized tenant.
2. Route without using tenant-specific business facts.
3. Retrieve only from the active tenant.
4. Reject every evidence item whose tenant ownership is missing, mismatched, or cannot be proven.
5. Decide `ANSWER`, `CLARIFY`, or `NO_ANSWER` from evidence before business-answer generation.
6. Generate using only the authorized evidence package. History may resolve references but may not authorize business facts.
7. Split output into atomic propositions and validate each proposition independently.
8. Check evidence-ID integrity and exact question/proposition sufficiency.
9. Apply numeric, temporal, negation, exclusivity, and multi-intent rules.
10. Deliver only the validated result. On error, malformed state, timeout, or uncertainty at the boundary, fail closed to a deterministic `CLARIFY` or `NO_ANSWER` response.

## Tenant isolation invariant

Every authorizing evidence item must carry the exact active `tenantId`. Missing tenant provenance is invalid, not global. A chunk, cache entry, history item, generated citation, or metadata object from another tenant can never authorize a claim. All messaging channels must pass through the same boundary.

## Evidence-ID integrity invariant

Evidence IDs are issued by the server for the current request. Every cited ID must exist in that request's authorized evidence set, map to the active tenant, and support the proposition that cites it. Unknown, stale, duplicated-with-conflicting-content, or model-invented IDs invalidate the affected answer.

## Numeric invariant

Prices, fees, discounts, percentages, quantities, durations, dates, thresholds, and counts require an explicit matching value and unit in evidence that refers to the same subject and attribute. Numeric co-occurrence elsewhere in a chunk is insufficient. Conversions are permitted only when deterministic and lossless; otherwise the response must preserve the source expression.

## Temporal/current-state invariant

Claims containing current-state semantics such as now, today, available, active offer, current price, current branch, or current schedule require evidence explicitly valid for the requested time, either in the proposition itself or in trusted temporal metadata. Historical, undated promotional, expired, or merely related evidence cannot authorize a current claim.

## Negation and exclusivity invariant

Negative and exhaustive claims require explicit evidence at the same scope. Absence of evidence is never evidence of absence. `Only showroom in Al-Bireh` does not prove `no branch in Nablus`; a Sunday-through-Thursday schedule does not prove Friday is unavailable unless the evidence explicitly defines the range as exhaustive. Words such as only, all, none, never, unavailable, and does not exist require matching scope and polarity.

## Multi-intent invariant

Each requested intent is authorized independently. The system may answer supported intents and explicitly decline unsupported ones only when the response makes that separation unambiguous. It must never reject or authorize the whole response solely because one neighboring intent passed. An unsupported component may not be silently omitted when that omission would make the response misleading.

## Fallback behavior

- Unresolved referent or requestable ambiguity: deterministic `CLARIFY`.
- Clear proposition with insufficient business evidence: deterministic `NO_ANSWER`.
- Tenant mismatch, missing provenance, unknown evidence ID, validator exception, provider failure after a business answer is drafted, or malformed validation output: fail closed; do not deliver the draft.
- General social conversation may bypass business grounding only when routing proves it contains no business proposition. If a response mixes social and business content, the business portion remains subject to this contract.

Fallback text must not add prices, availability, schedules, policies, branch claims, or other business facts.

## Telemetry invariant

For every business request, retain a request correlation ID, active tenant ID (never credentials), route, gate decision and reason, authorized evidence IDs, rejected evidence IDs with reason, generated atomic propositions, proposition-to-evidence mappings, numeric/temporal/negation results, validator result, final boundary decision, fallback reason, model/provider, and stage latency. Never log secrets or unrestricted customer content. Telemetry must distinguish provider/dependency failure from accuracy failure.

## Acceptance and rollback

Production activation requires the separate grounding safety regression suite to pass with zero unsupported business facts delivered, zero tenant-isolation violations, and no regression in valid ANSWER controls. Activation must be behind backward-compatible flags. Rollback disables the new final boundary as one unit and restores the previously recorded configuration; retrieval remains untouched. A rollback caused by safety-boundary defects must prefer deterministic blocking over fail-open delivery.

## Known baseline violations

1. `RAG_EVIDENCE_GATE_ENABLED` defaults to `false`, and the inspected settings database has no override, so the pre-generation gate is not an enforced deployment invariant.
2. Evidence tenant-integrity checks currently tolerate evidence with missing tenant provenance.
3. The validator authorizes claim/evidence similarity but does not enforce that the supported claim answers the exact requested proposition. Saved adjudicated runs demonstrate false authorization for Friday support.
4. The delivered response has no mandatory server-issued proposition-to-evidence-ID contract; valid adjacent citations can coexist with an unsupported answer implication.
5. Negation and closed-world scope are not enforced at the final delivery boundary. Saved runs demonstrate the showroom-to-branch over-generalization.
6. Numeric and temporal checks are distributed between optional gate and validator logic rather than enforced once at a mandatory final delivery boundary for every business channel.

These are production audit findings, not claims that the proposed remediation has already improved accuracy.
