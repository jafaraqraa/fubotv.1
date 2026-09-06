# FuBot reliability repair — 2026-09-05

Status: IMPLEMENTED AND LOCALLY TESTED; LIVE ACCEPTANCE NOT RUN.
No production instance, original customer database, provider account, or customer messaging channel was modified.

## Evidence

The supplied ZIP contained source, evaluation manifests and reports, but not the ten raw Madar traces/payloads or a configured live deployment. The Madar numeric counterexamples in the new tests are explicitly synthetic reconstructions of the reported rules. They are not represented as original production replays.

Against the original source, the initial 11 extraction/policy regression tests failed 10 and passed 1. The corresponding cases pass after repair. Further tests cover correct and incorrect branches, valid provenance through enforced Boundary, Arabic digits, table column swaps, missing amounts, conservative references, independent lexical filtering and four held-out synthetic business sectors.

## Root causes repaired

1. `sanitizeEvidence` previously joined structural lines with spaces. It now preserves line breaks. Table and conditional-policy parsing can operate on their original structure.
2. `conditionalPolicyGuard` now scopes known policy relations, parses closed ranges, distinguishes hour/minute compound inputs, validates claimed numeric outcomes and echoed conditions, and rejects mismatched policy topics. It returns a source-backed proof for the selected branch. This is conservative deterministic logic, not universal natural-language entailment.
3. `answerValidator` rejects cross-policy numeric support, projects table columns into individual entity/field facts, copies a unit only when explicitly in the column header, and transports a proved conditional branch's original evidence ID. It also rejects a related exclusion statement offered instead of a requested amount. Existing Boundary enforcement remains intact.
4. `documentExtractionService` uses `new PDFParse(...).getText()` and closes resources in `finally`, matching the installed v2 API. DOCX conversion preserves cell/row boundaries and disables embedded style maps/external file access. Blank or corrupt extraction fails explicitly.
5. Markdown table rows keep header associations during chunking; overlap cannot push a chunk beyond the configured size. Existing indexed documents require reindexing from source. DOCX grids are retained without guessing whether the first row is a header.
6. Independent Qdrant text-filter retrieval uses the same tenant, lifecycle, version, model and media filter as vector retrieval. Results are locally scored and merged; no semantic score is fabricated for lexical-only results. This is bounded filtered lexical recall (100 points), not a new sparse/BM25 index. Its real recall and latency on large datasets are unmeasured.
7. Requested-field ranking precedes top-K in the standard retrieval path. Gate and Boundary receive parsed serialized context, including only actual selected evidence. Neighbor text keeps its own source ID. Arbitrary partial-chunk truncation was removed; only lossless identical-statement repetition compaction remains. If no complete chunk fits, retrieval yields no usable evidence.
8. Follow-up entity text is conservatively extracted from user messages only, using a separate bounded history lookup (24 user turns). It is transported into retrieval, generation and validation. Missing/multiple entities clarify; history is never business evidence. This does not implement persistent structured dialogue state or a multilingual coreference model.
9. Migration 033 adds `reliability_json` with reference status, query hashes, candidate-stage counts, pre-budget IDs and selected text hashes/lengths. The existing retrieval query field records the effective search input. It does not retain full prompt bytes or all history; multistep retrieval telemetry remains less detailed than the standard path.

## Validation

| Check | Result | Scope |
|---|---|---|
| New default reliability gate | 92/92 pass | Unit/contract/real local extraction, including existing reliability controls |
| Broader focused suite | 273/273 pass | Validator, Gate, Boundary, tenant isolation, documents, routing, traces; overlaps the gate |
| Final wiring subset | 11/11 pass | Last query-transport and trace edits |
| Existing frozen safety replay | 88 scored; 0 missed unsafe; 3 false blocks | Replays saved answers with reconstructed evidence; no fresh generation |
| Full default npm command | Exit 1 | Original WhatsApp stale-PID test fails in this runtime |
| Original-source WhatsApp comparison | Same stale-PID failure | Confirms not introduced by the RAG edits |
| Tests after WhatsApp and frontend | Pass; frontend 21/21 | Run separately after the unrelated default-command failure |
| Live Madar 10/34 cases | NOT RUN | Live source/services/credentials unavailable |
| New live cross-sector generation | NOT RUN | Synthetic deterministic controls are not LLM performance measurements |

The 273-case suite preceded only the final trace-on-clarification and Arabic decimal normalization refinements; affected paths were rechecked by the final 92-case gate and 11-case wiring subset. No passing count is an assertion of 100% answer correctness.

Commands and logs are provided beside this report. `npm run test:reliability --prefix backend` is now included in pretest so it cannot silently be omitted by the ordinary npm test list. The existing failing WhatsApp test was not disabled. The full default command was first blocked by an empty locally created app database; initializing the local schema resolved that setup problem before the reported full run.

## Remaining acceptance work

On an isolated copy of the real installation, apply the new migration, reindex original files, then run real user questions through getAIResponse with the actual tenant, model and retrieval services. Repeatedly measure correct answers, incorrect answers, safe clarifications, false fallbacks, false blocks, tenant isolation and latency. Include exact 24/48h cancellation, exact 4h lateness, 4h+1min, product daily/weekly/deposit columns, operator vs renter age, and previous rental vs credit approval. Extend beyond Madar with unseen companies. Do not deploy the old rejected patch in targeted-reliability.

Scanned PDFs still require OCR outside this change; Excel/CSV support was not added. DOCX merged cells and complex PDF layouts are not certified. Arbitrary policy syntax, languages and pronouns remain outside a universal guarantee. Existing 3 replay false blocks are unresolved.

## Official references consulted

- PDF v2 API: https://github.com/mehmet-kozan/pdf-parse
- DOCX conversion and table handling: https://github.com/mwilliamson/mammoth.js/
- Qdrant text filtering versus lexical ranking: https://qdrant.tech/documentation/search/text-search/
- Qdrant hybrid retrieval: https://qdrant.tech/documentation/search/hybrid-queries/
