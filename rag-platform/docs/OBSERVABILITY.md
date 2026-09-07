# Observability & Request Tracing

## Tracing Specs
Every query execution generates a unique `trace_id` recorded in `request_traces` table:
- Millisecond latency breakdown (`normalization_ms`, `retrieval_ms`, `rerank_ms`, `gate_ms`, `context_ms`, `generation_ms`, `citation_ms`, `total_ms`)
- Gate decisions, confidence score/label, and citation status
- Never logs API keys, passwords, or secret tokens
