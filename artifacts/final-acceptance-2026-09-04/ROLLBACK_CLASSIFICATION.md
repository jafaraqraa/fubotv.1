# Reliability-pass rollback classification (pre-edit)

The repository has no commit boundary for the rejected pass: the six named files are layered over older uncommitted, valid safety/generalization work. Commit `3d09479` predates that work, so reverting files or the commit would destroy unrelated baseline functionality. Classification therefore uses the named symbols/blocks introduced in the recorded reliability pass.

## `answerValidator.js`

- **KEEP_PREVIOUS_STABLE:** derived-claim integration and provenance; proposition relationship model; Arabic clocks; strict numeric/comparator safety that predates the rejected pass; tenant-aware normalized chunks; complete-list safety already present before the pass; zero-claim fail-closed behavior.
- **KEEP_P0 (after baseline measurement):** conditional branch extraction/resolution and the classification hook that blocks wrong/ambiguous outcomes.
- **ROLLBACK_RELIABILITY:** newline-only sanitizer; changed attached-conjunction splitting; expanded user-value numeric treatment; proposition-local best-sentence negation; numbered-list broadening; supported-core-without-fallback rewrite; day/kilogram and comparator parsing additions made specifically for the rejected pass except the minimum parsing required by isolated P0.
- **UNRELATED:** all other validator/security work visible in the large pre-existing uncommitted diff.

## `contextOptimizer.js`

- **KEEP_PREVIOUS_STABLE:** `findOverlapLength`, `optimizeContext`.
- **ROLLBACK_RELIABILITY:** coverage normalization/tokens, requested propositions, proposition scoring, `selectChunksForCoverage`, and their exports.

## `knowledge.js`

- **KEEP_PREVIOUS_STABLE / UNRELATED:** retrieval, tenant filtering, reranking, Top-K calculation, evidence registration, context budgeting and telemetry.
- **ROLLBACK_RELIABILITY:** importing and calling `selectChunksForCoverage` in the two retrieval branches; restore ordered `.slice(0, dynamicTopK)`.

## `activeReferent.js`

- **ROLLBACK_RELIABILITY:** the entire new module and every production dependency. It did not exist in the stable state.

## `ai.js`

- **KEEP_PREVIOUS_STABLE / UNRELATED:** routing, STT/media, trace, Evidence Gate, provenance, Boundary, renderer path and existing conversation history.
- **ROLLBACK_RELIABILITY:** active-referent imports/state, synthetic referent metadata, rewritten retrieval/gate/prompt question and active-referent telemetry. Restore the original user text and original history at those call sites.

## `evidenceDecisionGate.js`

- **KEEP_PREVIOUS_STABLE:** ambiguity contract (`missingField`, `missingType`, `canUserResolve`, `alreadySpecified`, `requiresLiveData`), live-state distinction, tenant filtering, legacy history-referent logic and generic CLARIFY behavior.
- **ROLLBACK_RELIABILITY:** declared/synthetic `referents` consumption, explicit-location exceptions added for the rejected pass, and the new narrow status predicate added during its compatibility repair.

## Other working-tree changes

Every other modified/untracked production file is **UNRELATED** to this rollback and will be preserved. Acceptance/evaluation artifacts remain evidence and are not production dependencies.
