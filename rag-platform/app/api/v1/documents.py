from fastapi import APIRouter, Depends, UploadFile, File, Form, Header, status, HTTPException
from typing import Optional, List
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.auth.tenant import get_principal_context, PrincipalContext
from app.ingestion.ingestion_pipeline import IngestionPipeline
from app.db.models import Document, Chunk, DocumentVersion
from app.retrieval.qdrant_manager import QdrantIndexManager

router = APIRouter(prefix="/v1", tags=["Documents"])

@router.post("/documents", status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile = File(...),
    department: Optional[str] = Form(None),
    category: Optional[str] = Form(None),
    security_level: str = Form("internal"),
    embedding_provider: Optional[str] = Form(None),
    embedding_model: Optional[str] = Form(None),
    x_embedding_api_key: Optional[str] = Header(None, alias="X-Embedding-API-Key"),
    principal: PrincipalContext = Depends(get_principal_context),
    db: Session = Depends(get_db)
):
    file_bytes = await file.read()
    pipeline = IngestionPipeline(db, embedding_provider, embedding_model, x_embedding_api_key)
    res = pipeline.ingest_document(
        tenant_id=principal.tenant_id,
        file_bytes=file_bytes,
        file_name=file.filename,
        mime_type=file.content_type or "application/octet-stream",
        department=department,
        category=category,
        security_level=security_level
    )
    return res

@router.get("/documents")
async def list_documents(
    principal: PrincipalContext = Depends(get_principal_context),
    db: Session = Depends(get_db)
):
    docs = db.query(Document).filter_by(tenant_id=principal.tenant_id, status="active").all()
    return [
        {
            "id": d.id,
            "title": d.title,
            "source_name": d.source_name,
            "department": d.department,
            "category": d.category,
            "status": d.status,
            "created_at": d.created_at
        }
        for d in docs
    ]

@router.get("/documents/{document_id}")
async def get_document(
    document_id: str,
    principal: PrincipalContext = Depends(get_principal_context),
    db: Session = Depends(get_db)
):
    doc = db.query(Document).filter_by(id=document_id, tenant_id=principal.tenant_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc

@router.delete("/documents/{document_id}")
async def delete_document(
    document_id: str,
    principal: PrincipalContext = Depends(get_principal_context),
    db: Session = Depends(get_db)
):
    doc = db.query(Document).filter_by(id=document_id, tenant_id=principal.tenant_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    QdrantIndexManager().delete_document(principal.tenant_id, doc.id)
    db.query(Chunk).filter_by(tenant_id=principal.tenant_id, document_id=doc.id).delete(synchronize_session=False)
    db.query(DocumentVersion).filter_by(tenant_id=principal.tenant_id, document_id=doc.id).delete(synchronize_session=False)
    db.delete(doc)
    db.commit()
    return {"status": "deleted", "document_id": document_id}
