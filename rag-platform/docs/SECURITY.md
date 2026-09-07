# Security & Multi-Tenancy

## Multi-Tenant Isolation
- Every database record and Qdrant vector payload stores `tenant_id`.
- Requests require `X-Tenant-ID` header and fail closed if missing (`TENANT_REQUIRED`).
- Qdrant pre-retrieval filters restrict vector search before top-k candidates are selected.

## Prompt Injection Defense
- System prompt rules explicitly instruct generator to treat document text as data only, ignoring internal instructions like *"Ignore previous instructions"*.
