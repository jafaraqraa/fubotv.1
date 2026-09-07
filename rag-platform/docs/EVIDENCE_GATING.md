# Evidence Sufficiency Gate

## Gating Policy
The `EvidenceGate` evaluates top reranker candidate scores against `MIN_RERANKER_SCORE` (0.35).
If evidence is insufficient or missing:
- Returns `decision = "INSUFFICIENT_EVIDENCE"`
- **Generator LLM is NOT called**
- Returns deterministic abstention answer: *"The available company documents do not contain sufficient authorized evidence to answer this question reliably."*
