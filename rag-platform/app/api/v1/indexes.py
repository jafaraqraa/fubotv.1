from fastapi import APIRouter, Depends, status, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.auth.tenant import get_principal_context, PrincipalContext
from app.ingestion.index_lifecycle import IndexLifecycleManager
from app.db.models import IndexVersion, ActiveIndex

router = APIRouter(prefix="/v1", tags=["Index Management"])

class IndexBuildRequest(BaseModel):
    collection_name: Optional[str] = "rag_v1"

@router.post("/indexes/build", status_code=status.HTTP_201_CREATED)
async def build_index(
    req: IndexBuildRequest,
    principal: PrincipalContext = Depends(get_principal_context),
    db: Session = Depends(get_db)
):
    mgr = IndexLifecycleManager(db)
    idx_ver = mgr.create_index_version(
        tenant_id=principal.tenant_id,
        collection_name=req.collection_name,
        embedding_provider="ollama",
        embedding_model="nomic-embed-text",
        embedding_dimension=768
    )
    mgr.mark_ready(idx_ver.id, doc_count=1, chunk_count=1)
    return {"index_version_id": idx_ver.id, "status": idx_ver.status}

@router.get("/indexes")
async def list_indexes(
    principal: PrincipalContext = Depends(get_principal_context),
    db: Session = Depends(get_db)
):
    indexes = db.query(IndexVersion).filter_by(tenant_id=principal.tenant_id).all()
    return indexes

@router.post("/indexes/{index_version_id}/activate")
async def activate_index(
    index_version_id: str,
    principal: PrincipalContext = Depends(get_principal_context),
    db: Session = Depends(get_db)
):
    mgr = IndexLifecycleManager(db)
    success = mgr.activate_index(principal.tenant_id, index_version_id)
    if not success:
        raise HTTPException(status_code=400, detail="Unable to activate index version")
    return {"status": "activated", "index_version_id": index_version_id}

@router.post("/indexes/{index_version_id}/rollback")
async def rollback_index(
    index_version_id: str,
    principal: PrincipalContext = Depends(get_principal_context),
    db: Session = Depends(get_db)
):
    mgr = IndexLifecycleManager(db)
    success = mgr.rollback_index(principal.tenant_id, index_version_id)
    if not success:
        raise HTTPException(status_code=400, detail="Unable to rollback to index version")
    return {"status": "rolled_back", "index_version_id": index_version_id}
