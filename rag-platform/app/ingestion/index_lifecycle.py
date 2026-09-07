import time
from sqlalchemy.orm import Session
from app.db.models import IndexVersion, ActiveIndex, AuditEvent

class IndexLifecycleManager:
    def __init__(self, db: Session):
        self.db = db

    def create_index_version(
        self,
        tenant_id: str,
        collection_name: str,
        embedding_provider: str,
        embedding_model: str,
        embedding_dimension: int,
        sparse_model: str = "bm25",
        reranker_model: str = "bge-reranker-base"
    ) -> IndexVersion:
        index_ver = IndexVersion(
            tenant_id=tenant_id,
            status="BUILDING",
            collection_name=collection_name,
            embedding_provider=embedding_provider,
            embedding_model=embedding_model,
            embedding_dimension=embedding_dimension,
            sparse_model=sparse_model,
            reranker_model=reranker_model,
            created_at=time.time()
        )
        self.db.add(index_ver)
        self.db.commit()
        self.db.refresh(index_ver)
        return index_ver

    def mark_ready(self, index_version_id: str, doc_count: int, chunk_count: int):
        idx_ver = self.db.query(IndexVersion).filter_by(id=index_version_id).first()
        if idx_ver:
            idx_ver.status = "READY"
            idx_ver.doc_count = doc_count
            idx_ver.chunk_count = chunk_count
            self.db.commit()

    def activate_index(self, tenant_id: str, index_version_id: str) -> bool:
        idx_ver = self.db.query(IndexVersion).filter_by(id=index_version_id, tenant_id=tenant_id).first()
        if not idx_ver or idx_ver.status not in ["READY", "SUPERSEDED"]:
            return False

        # Mark current active index as superseded
        active = self.db.query(ActiveIndex).filter_by(tenant_id=tenant_id).first()
        if active:
            prev_idx = self.db.query(IndexVersion).filter_by(id=active.index_version_id).first()
            if prev_idx:
                prev_idx.status = "SUPERSEDED"
            active.index_version_id = index_version_id
            active.activated_at = time.time()
        else:
            new_active = ActiveIndex(tenant_id=tenant_id, index_version_id=index_version_id, activated_at=time.time())
            self.db.add(new_active)

        idx_ver.status = "ACTIVE"
        idx_ver.activated_at = time.time()

        audit = AuditEvent(
            tenant_id=tenant_id,
            action="index_activated",
            details_json={"index_version_id": index_version_id, "collection": idx_ver.collection_name}
        )
        self.db.add(audit)
        self.db.commit()
        return True

    def rollback_index(self, tenant_id: str, target_index_version_id: str) -> bool:
        return self.activate_index(tenant_id, target_index_version_id)
