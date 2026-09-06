# Madar differential diagnosis — 2026-09-05

Status: **ROOT CAUSE IDENTIFIED — NOT FIXED**. Multiple independent losses are demonstrated; a single minimal correction has not been proven. No production change or new customer message was made.

## Evidence and ingestion

`baseline-evidence.json` preserves ten actual production traces, their customer messages, and all ten live Madar Qdrant payloads. Document 25 is active under tenant `default`, with 10 chunks/10 vectors. Source SHA-256: `0b9f60d68d0039c7dcbb64dd9038d220f554b341f063ed2402555260b93832ad`, matching the payload document hash. Historical chunk IDs contain the matching content-hash prefixes. Madar is a business identity inside `default`, not a separately named tenant in this installation.

Indexed evidence: chunk 1 contains the MX20 420/2450/1500 table and SL10 minimum `يومان`; chunk 2 contains renter 21/operator 23; chunks 6/7 contain prior-approval credit and nonautomatic entitlement; chunk 3 contains all cancellation branches including inclusive 24–48 hours. Therefore this is not missing ingestion.

## Primary actual differential

F request `fcef877f-4596-4558-8f5d-7f937deb8446`: tenant default; COMPANY_KNOWLEDGE/Pricing; stored retrieval query equals the user's question. Returned candidates: chunk 8 (0.62840808), chunk 2 (0.51880236), chunk 0 (0.51428072). Selected context: 8,2. The price table in chunk 1 is absent even from the persisted ranked candidates. Gate: ANSWER/evidence_available. Raw generation: `المعلومة مش متوفرة عندي حاليًا.` Claim: UNSUPPORTED/missing_evidence, no evidence IDs. Boundary: ALLOW, no reasons; internal final response NO_ANSWER, fallback_source=message_processor_ai_unknown_answer. Customer output is the same unavailable-information fallback. First demonstrated loss: **RETRIEVAL** (the recorded candidates are post-reranking; the earlier vector/keyword stage is not recorded).

P request `ecf50c07-122f-42c9-b920-d3ab12f0cc13`: tenant default; COMPANY_KNOWLEDGE/Returns; candidates chunk 3 (0.639731008), chunk 4 (0.554398); selected 3,4. Gate: ANSWER/evidence_available. Raw and delivered text: `إذا ألغيت قبل 47 ساعة، بترجعلك 50% من المبلغ.` Claim: SUPPORTED/validator_supported, evidence chunk 3, numeric PASS, negation PASS. Boundary ALLOW, enforcement active, final ANSWER. The harder question passed because its necessary policy reached generation; the daily-price fact did not.

## Eight-case matrix

PASS/FAIL below means availability of the required fact or correctness/responsiveness at that stage. A validator rejecting an unsafe generation is explicitly marked as a safety PASS. P0 standalone results were not persisted and are marked NOT_CAPTURED, not invented as PASS or NOT_REACHED.

| Case | Retrieval | Selected context | Gate | Generation | Validator | P0 | Boundary | Final | First demonstrated loss |
|---|---|---|---|---|---|---|---|---|---|
| 1 daily | FAIL: no chunk 1 | FAIL: 8,2 | FAIL: ANSWER/evidence_available without price | FAIL: already fallback | UNSUPPORTED/missing_evidence | NOT_CAPTURED | ALLOW | NO_ANSWER | RETRIEVAL |
| 2 deposit | PASS: chunk 1 rank 7 | FAIL: 5,9 | FAIL: sufficient verdict for wrong relation | FAIL: exclusion instead of amount | SUPPORTED/validator_supported | NOT_CAPTURED | ALLOW | wrong-relation ANSWER | CONTEXT_SELECTION; preceding referent resolution not captured |
| 3 inclusion | PASS: 1,2 | PASS: 1,2 | PASS | PASS: excludes deposit; gives 1500 | FAIL: both claims UNSUPPORTED/missing_evidence, empty evidence IDs | NOT_CAPTURED | ALLOW of final fallback | NO_ANSWER | VALIDATOR/provenance stage; exact internal rejection substep unrecorded |
| 4 weekly | FAIL: only 9,5,7 | FAIL: 9,5 | FAIL: ANSWER/evidence_available without weekly price | FAIL: already fallback | UNSUPPORTED/missing_evidence | NOT_CAPTURED | ALLOW | NO_ANSWER | RETRIEVAL; prior HISTORY_REFERENCE transport absent |
| 5 minimum | PASS: chunk 1 rank 5 | FAIL: 5,3 | FAIL: ANSWER/evidence_available without minimum | FAIL: already fallback | UNSUPPORTED/missing_evidence | NOT_CAPTURED | ALLOW | NO_ANSWER | CONTEXT_SELECTION |
| 6 age | PASS: chunk 2 rank 3 | FAIL: 5,8 | FAIL: ANSWER/evidence_available without ages | FAIL: permits operating at 22 conditionally | PASS safety: CONTRADICTED/missing_evidence | NOT_CAPTURED | ALLOW of fallback | NO_ANSWER | CONTEXT_SELECTION |
| 7 credit | FAIL: only 5,4; no 6/7 | FAIL: 5,4 | FAIL: ANSWER/evidence_available without credit rule | FAIL: already fallback | UNSUPPORTED/missing_evidence | NOT_CAPTURED | ALLOW | NO_ANSWER | RETRIEVAL |
| 8 cancellation | PASS: 3,4 | PASS: 3,4 | PASS | PASS: 50% | SUPPORTED/validator_supported | NOT_CAPTURED | ALLOW | correct ANSWER | none |

The same daily and credit failures appear in repeated original requests, not merely a single generated sample.

## Related fact and history

Deposit amount 1500 was retrieved but not selected. The selected chunk 9 explicitly says daily price excludes deposit; generation copied that true relation, validator supported it and Boundary allowed it. This establishes context loss followed by nonresponsive generation being accepted. It does not establish that the validator itself transformed the requested relation. Gate's actual verdict was ANSWER/evidence_available. Its exact historical input was not stored; source shows it receives profiling.topChunks, whereas context serialization retains a budgeted subset, so they can differ.

Source `ai.js` passes `userText` directly as retrievalText and does not pass conversation history into retrieveContext. Both follow-up retrieval queries are literally unresolved pronoun questions. `getChatHistoryForAI` retains only the last six messages, and buildPrompt receives this history after retrieval. For the deposit turn the earlier excavator question remains in the recent stored messages; by the weekly turn the initial excavator question is outside the six-message window (assuming the observed user message was already saved, consistent with message timestamps). No safe single active MX20 referent is persisted. Thus retrieval has **REFERENCE_LOST / no explicit resolved referent transport**; a claim of REFERENCE_RESOLVED_BUT_DOWNSTREAM_FAILED cannot be verified for the model prompt. History was not treated as business evidence during this diagnosis.

Source `knowledge.js` ranks/slices candidates, then `buildBudgetedEvidenceContext` greedily fits serialized chunks to a character budget and retains only fitted evidence IDs. The observed two-chunk selection is real; the exact historical budget value, rejected context reason, and pre-budget top-K are not captured. Consequently no arbitrary increase in budget/top-K was applied.

## Limits and disposition

These are original runtime records, not recreated inference. Exact normalized/expanded queries, history payload, Gate payload, generation input bytes, and standalone P0 return value were not persisted. They remain unknown. No guessed values substitute for them. The recorded validator/provenance verdict explains case 3's rejection but does not by itself isolate its internal numeric/table logic.

Observed semantic score: **1/8**, unchanged because no fix was applied. Additional smoke and safety regression were not run: their requirement is conditional on a code correction. P0 control delivered 50%; separate P0 invocation result and fresh 88-case score are NOT_RUN. Across these eight delivered messages: no unsupported business assertion or cross-tenant evidence is demonstrated, but case 2 is a true, nonresponsive assertion. This is a case-specific observation, not a full safety-suite certification.

Files added: capture.js, baseline-evidence.json, REPORT.md under backend/evals/madar-differential/. Production/prototype files changed: none.

**ROOT CAUSE IDENTIFIED — NOT FIXED**: retrieval omission, selected-context loss, and a separate validator/provenance rejection coexist. The requested single-cause prerequisite for a production fix is not satisfied.
