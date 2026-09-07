import pytest
import uuid
from sqlalchemy.orm import Session
from app.db.session import SessionLocal, init_db
from app.db.models import Tenant
from app.ingestion.index_lifecycle import IndexLifecycleManager
from app.ingestion.ingestion_pipeline import IngestionPipeline
from app.config.config_service import ConfigurationService

@pytest.fixture(scope="module", autouse=True)
def setup_db():
    init_db()
    yield

def test_index_versioning_lifecycle_and_activation():
    db: Session = SessionLocal()
    try:
        tenant_id = f"tenant_{uuid.uuid4().hex[:8]}"
        tenant = Tenant(id=tenant_id, name="Test Tenant", status="active")
        db.add(tenant)
        db.commit()

        mgr = IndexLifecycleManager(db)
        idx_ver = mgr.create_index_version(
            tenant_id=tenant_id,
            collection_name="rag_v1_test",
            embedding_provider="ollama",
            embedding_model="nomic-embed-text",
            embedding_dimension=768
        )

        assert idx_ver.status == "BUILDING"

        mgr.mark_ready(idx_ver.id, doc_count=5, chunk_count=20)
        assert idx_ver.status == "READY"

        activated = mgr.activate_index(tenant_id, idx_ver.id)
        assert activated is True
        assert idx_ver.status == "ACTIVE"
    finally:
        db.close()

def test_ingestion_pipeline_and_deduplication():
    db: Session = SessionLocal()
    try:
        tenant_id = f"tenant_{uuid.uuid4().hex[:8]}"
        tenant = Tenant(id=tenant_id, name="Test Tenant", status="active")
        db.add(tenant)
        db.commit()

        pipeline = IngestionPipeline(db)
        file_bytes = b"Sample policy content for testing ingestion pipeline."

        res1 = pipeline.ingest_document(
            tenant_id=tenant_id,
            file_bytes=file_bytes,
            file_name="policy.txt",
            mime_type="text/plain",
            department="HR"
        )

        assert res1["status"] == "ready"
        assert res1["chunks_count"] > 0

        # Duplicate ingestion test
        res2 = pipeline.ingest_document(
            tenant_id=tenant_id,
            file_bytes=file_bytes,
            file_name="policy.txt",
            mime_type="text/plain",
            department="HR"
        )

        assert res2["status"] == "already_exists"
    finally:
        db.close()

@pytest.mark.asyncio
async def test_configuration_service_test_endpoint():
    cfg_service = ConfigurationService()
    res = await cfg_service.test_configuration()
    assert "database" in res
    assert res["database"] == "ok"
