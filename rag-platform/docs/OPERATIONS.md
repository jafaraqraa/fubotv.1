# Operations & Commands

## Startup Commands
```bash
docker compose up -d --build
```

## Health & Readiness Checks
```bash
curl http://localhost:8000/health
curl http://localhost:8000/ready
```

## Atomic Index Rollback
```bash
curl -X POST http://localhost:8000/v1/indexes/{index_version_id}/rollback \
  -H "X-Tenant-ID: tenant_a"
```
