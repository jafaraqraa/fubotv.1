# Standalone Production-Grade RAG Platform

A modular, multi-tenant knowledge retrieval and grounded generation platform built with **Python**, **FastAPI**, **SQLite** (with WAL mode), and **Qdrant**.

---

## Architecture Overview
The platform decouples retrieval intelligence from frontend/messaging channels. All tenant behavior, security parameters, and documents are context-driven rather than hardcoded.

```
Request → Auth/Tenant Resolution → Validation → Normalization → Authorization Filters
        → Dense Retrieval + Sparse BM25 Search → Reciprocal Rank Fusion (RRF)
        → Deduplication → Cross-Encoder Reranking → Evidence Sufficiency Gate
        → Context Construction → Grounded Generator → Citation Validator
        → Calibrated Confidence → Trace & Structured Response
```

---

## Beginner-Friendly Quick Start

### 1. Requirements
- Python 3.11+
- Docker & Docker Compose (optional for Qdrant)

### 2. Environment Setup
```bash
cp .env.example .env
```

### 3. Local Installation & Startup
```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -e .

# Start FastAPI server
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 4. Health & Readiness Verification
```bash
curl http://localhost:8000/health
curl http://localhost:8000/ready
```

### 5. Upload First Document (Ingestion)
```bash
curl -X POST http://localhost:8000/v1/documents \
  -H "X-Tenant-ID: company_a" \
  -F "department=HR" \
  -F "file=@employee_handbook.pdf"
```

### 6. Query the RAG Platform
```bash
curl -X POST http://localhost:8000/v1/query \
  -H "X-Tenant-ID: company_a" \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "company_a",
    "query": "How many annual leave days do employees receive?"
  }'
```

### 7. Run Unit Tests & Evaluation Suite
```bash
# Run pytest test suite
pytest tests/ -v

# Run evaluation runner
python3 -m app.evaluation.runner
```

---

## Documentation Suite
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) - Pipeline architecture & component interaction
- [CONFIGURATION.md](docs/CONFIGURATION.md) - Precedence and environment variables
- [DATABASE.md](docs/DATABASE.md) - SQLite relational schema and WAL settings
- [INGESTION.md](docs/INGESTION.md) - Parsing and document versioning
- [CHUNKING.md](docs/CHUNKING.md) - Smart format-specific chunkers
- [RETRIEVAL.md](docs/RETRIEVAL.md) - Dense, sparse BM25, and RRF fusion
- [RERANKING.md](docs/RERANKING.md) - Candidate reranking and scoring
- [EVIDENCE_GATING.md](docs/EVIDENCE_GATING.md) - Evidence sufficiency and abstention
- [CITATIONS.md](docs/CITATIONS.md) - Citation validation and claim support
- [SECURITY.md](docs/SECURITY.md) - Multi-tenant isolation and pre-retrieval filters
- [OBSERVABILITY.md](docs/OBSERVABILITY.md) - Query tracing and latency breakdown
- [EVALUATION.md](docs/EVALUATION.md) - Dataset runner and retrieval metrics
- [CALIBRATION_REPORT.md](CALIBRATION_REPORT.md) - Calibrated thresholds report
- [OPERATIONS.md](docs/OPERATIONS.md) - Startup, shutdown, and index rollback
- [MIGRATION.md](docs/MIGRATION.md) - Migration path from legacy Node.js monolith
- [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) - Error codes and diagnostic steps
