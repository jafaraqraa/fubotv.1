# Candidate Reranking

## Cross-Encoder Reranker
Scores query-chunk pairs using token overlap and RRF rank positions to produce normalized candidate relevance scores (`rerank_score`).
Candidates are re-sorted and trimmed to `FINAL_EVIDENCE_K` (default 6).
