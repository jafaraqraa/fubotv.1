# Troubleshooting Guide

## Error Codes
- `TENANT_REQUIRED`: Missing `X-Tenant-ID` header.
- `INVALID_QUERY`: Empty or malformed query string.
- `INSUFFICIENT_EVIDENCE`: Retrieval score below `MIN_RERANKER_SCORE`.
- `UNAUTHORIZED`: Invalid principal context or missing permissions.

## Diagnostics Endpoint
```bash
curl -X POST http://localhost:8000/v1/config/test
```
