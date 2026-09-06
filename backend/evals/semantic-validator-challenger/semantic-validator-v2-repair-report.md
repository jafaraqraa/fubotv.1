# Semantic Validator Gold Corpus V2 Repair Report

## Outcome

Corpus V2 passes the integrity gate. This was a dataset-only pass: no validator was run, no model was restored, and no production source was changed.

## Historical input and V1 audit

- Input: `gold-corpus-v1.json`
- Preserved V1 SHA-256: `9e3b2694f1d2a87ce564471b642a7948361a94b10b9b77027648de48ddcb999b`
- V1: 169 rows; 78 SUPPORTED; 46 CONTRADICTED; 45 NOT_PROVEN.
- Unique legacy IDs: 149. Twenty duplicate-ID groups were found. Every duplicated legacy ID identifies two distinct fingerprints, so both semantic rows were preserved under different deterministic V2 IDs.
- Exact content: 28 duplicate groups. All lacked a documented weighting/control rationale and were classified `ACCIDENTAL_DUPLICATE`.
- Removed: 37 excess copies (23 from DEV, 14 from unseen). The canonical rows record the removed IDs in `deduplicatedFromIds` and retain source IDs in `legacyIds`.
- Intentional identical controls retained: 0.
- Label conflicts: 0.
- Conservative near-duplicate detector found 34 groups sharing tenant, question, evidence, and verdict but differing in claim text. They are documented as `SEMANTIC_VARIANTS_PRESERVED`; none was removed because their wording is not byte-equivalent.

## Fingerprint and identity policy

The SHA-256 content fingerprint uses stable-key UTF-8 JSON containing tenant ID, question, claim, sorted evidence tenant/text pairs, and expected verdict. It normalizes line endings and trims outer whitespace only. It excludes row IDs, evidence IDs, timestamps, filenames, comments, and array order. V2 IDs combine a source slug with the first 16 hex characters of the full fingerprint; collision and uniqueness assertions pass.

## V2 results

| Metric | DEV | Unseen | Combined |
|---|---:|---:|---:|
| Rows | 92 | 40 | 132 |
| Unique IDs | 92 | 40 | 132 |
| Unique fingerprints | 92 | 40 | 132 |
| SUPPORTED | 37 | 14 | 51 |
| CONTRADICTED | 28 | 14 | 42 |
| NOT_PROVEN | 27 | 12 | 39 |
| Hard negatives | 55 | 26 | 81 |
| Supported/paraphrase flag | 37 | 0 | 37 |
| Accidental groups removed | 14 | 14 | 28 |
| Excess rows removed | 23 | 14 | 37 |

DEV/unseen fingerprint overlap is 0. DEV contains no unseen tenant or source rows. Evidence arrays, evidence-ID references, and tenant ownership pass; cross-tenant evidence appears only in the explicitly preserved cross-tenant controls. There are no invalid labels, missing required fields, label conflicts, or undocumented intentional duplicates.

## Determinism and hashes

Two in-memory builds from the unchanged historical input were byte-identical and matched every materialized output. All 15 integrity tests pass.

- DEV file SHA-256: `3aa1fbe23ae66d52676795a17e2790b2c766840e0854924b110d3e8d777c6ae2`
- DEV canonical-row hash: `9e62e2d2e6c6103b6a26630aef560f7abeafaa737705beeb18f581c83245a6d6`
- Unseen file SHA-256: `8fad6143b3fe018587b70965acd29a058ccac0a46f7fc7d21d1de6b54f58db59`
- Unseen canonical-row hash: `732e046570061da4bb9ddd557e2fc94a3e04cfa1a74e97c6596cda1de824b247`

## Files

- `repair-corpus-v2.js`
- `corpus-v2-integrity.test.js`
- `semantic-validator-gold-v2.json`
- `semantic-validator-unseen-v2.json`
- `semantic-validator-gold-v2-manifest.json`
- `semantic-validator-unseen-v2-manifest.json`
- `semantic-validator-v2-audit.json`
- `semantic-validator-v2-repair-report.md`

## Final status

**CORPUS V2 READY FOR FROZEN B EVALUATION**
