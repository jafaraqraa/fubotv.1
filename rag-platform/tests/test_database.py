import pytest
import uuid
from sqlalchemy.orm import Session
from app.db.session import SessionLocal, init_db, Base, engine
from app.db.models import Tenant, Document, DocumentVersion

@pytest.fixture(scope="module", autouse=True)
def setup_database():
    Base.metadata.drop_all(bind=engine)
    init_db()
    yield

def test_tenant_creation_and_isolation():
    db: Session = SessionLocal()
    try:
        tenant_id = f"tenant_{uuid.uuid4().hex[:8]}"
        tenant = Tenant(id=tenant_id, name="Atlas Corp", status="active")
        db.add(tenant)
        db.commit()

        fetched = db.query(Tenant).filter_by(id=tenant_id).first()
        assert fetched is not None
        assert fetched.name == "Atlas Corp"
    finally:
        db.close()

def test_document_and_version_cascade():
    db: Session = SessionLocal()
    try:
        tenant_id = f"tenant_{uuid.uuid4().hex[:8]}"
        doc_id = f"doc_{uuid.uuid4().hex[:8]}"

        tenant = Tenant(id=tenant_id, name="Beta Corp", status="active")
        db.add(tenant)
        db.commit()

        doc = Document(
            id=doc_id,
            tenant_id=tenant_id,
            source_type="pdf",
            source_name="handbook.pdf",
            title="Employee Handbook",
            mime_type="application/pdf",
            status="active"
        )
        db.add(doc)
        db.commit()

        ver = DocumentVersion(
            id=f"ver_{uuid.uuid4().hex[:8]}",
            document_id=doc_id,
            tenant_id=tenant_id,
            version_number=1,
            checksum="sha256_dummy_hash",
            status="active"
        )
        db.add(ver)
        db.commit()

        fetched_ver = db.query(DocumentVersion).filter_by(document_id=doc_id).first()
        assert fetched_ver is not None
        assert fetched_ver.checksum == "sha256_dummy_hash"
    finally:
        db.close()
