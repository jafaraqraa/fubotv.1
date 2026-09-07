# Hybrid Retrieval & RRF Fusion

## Retrieval Architecture
- **Dense Retriever**: Vector search on Qdrant named vector `dense` using cosine distance.
- **Sparse Retriever**: Lexical term-frequency search on Qdrant named vector `sparse` using BM25 token weights.
- **Reciprocal Rank Fusion (RRF)**: Merges rank positions using $RRF\_Score = \frac{1}{60 + r_{dense}} + \frac{1}{60 + r_{sparse}}$.
- **Deduplication**: Filters out duplicate chunks using `content_hash`.
