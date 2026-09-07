# Database Control Plane Specification

## Primary Database: SQLite
Production safety settings enabled on every connection:
- `PRAGMA journal_mode=WAL;`
- `PRAGMA foreign_keys=ON;`
- `PRAGMA busy_timeout=5000;`

## Table Schemas
- `tenants`: Primary tenant registry (`id`, `name`, `status`)
- `users`: Principal identities and assigned roles
- `documents`: Canonical documents with metadata and checksums
- `document_versions`: Version history and raw content
- `chunks`: Chunk metadata, hierarchy links, and content hashes
- `index_versions`: State machine for index builds (`BUILDING`, `READY`, `ACTIVE`)
- `active_indexes`: Pointer to active index version per tenant
- `configurations`: Tenant-specific runtime overrides
- `request_traces`: Audit traces with millisecond latency breakdowns
- `audit_events`: System administrative action logs
