import hashlib
import time
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session
from app.db.models import Tenant, Document, DocumentVersion, Chunk, AuditEvent
from app.parsers.factory import get_parser_for_file
from app.chunking.smart_chunker import SmartChunker
from app.embeddings.ollama_provider import OllamaEmbeddingProvider
from app.sparse.bm25_encoder import BM25SparseEncoder
from app.retrieval.qdrant_manager import QdrantIndexManager

class IngestionPipeline:
    def __init__(self, db: Session):
        self.db = db
        self.chunker = SmartChunker()
        self.embedder = OllamaEmbeddingProvider()
        self.sparse_encoder = BM25SparseEncoder()
        self.qdrant_mgr = QdrantIndexManager()

    def ingest_document(
        self,
        tenant_id: str,
        file_bytes: bytes,
        file_name: str,
        mime_type: str,
        source_type: str = None,
        department: str = None,
        category: str = None,
        security_level: str = "internal",
        tags: List[str] = None,
        collection_name: str = "rag_v1"
    ) -> Dict[str, Any]:
        # 0. Ensure tenant exists
        tenant = self.db.query(Tenant).filter_by(id=tenant_id).first()
        if not tenant:
            tenant = Tenant(id=tenant_id, name=f"Tenant {tenant_id}", status="active")
            self.db.add(tenant)
            self.db.commit()

        # 1. Compute checksum for duplicate detection
        checksum = hashlib.sha256(file_bytes).hexdigest()

        existing_doc = self.db.query(Document).filter_by(
            tenant_id=tenant_id,
            checksum=checksum,
            status="active"
        ).first()

        if existing_doc:
            return {
                "status": "already_exists",
                "document_id": existing_doc.id,
                "version_number": 1,
                "checksum": checksum,
                "message": "Identical active document already exists"
            }

        # 2. Parse file
        parser = get_parser_for_file(file_name)
        parsed_doc = parser.parse(file_bytes, file_name)

        # 3. Create Canonical Document in DB
        doc = Document(
            tenant_id=tenant_id,
            source_type=source_type or file_name.rsplit(".", 1)[-1],
            source_name=file_name,
            title=parsed_doc.title,
            mime_type=mime_type,
            language="ar" if any('\u0600' <= c <= '\u06FF' for c in parsed_doc.content) else "en",
            department=department,
            category=category,
            tags=tags,
            security_level=security_level,
            status="processing",
            checksum=checksum,
            parser_name=parser.__class__.__name__,
            parser_version="1.0.0",
            ingestion_version="1.0.0",
            created_at=time.time()
        )
        self.db.add(doc)
        self.db.commit()

        # 4. Create Document Version
        ver = DocumentVersion(
            document_id=doc.id,
            tenant_id=tenant_id,
            version_number=1,
            checksum=checksum,
            raw_content=parsed_doc.content,
            status="active"
        )
        self.db.add(ver)
        self.db.commit()

        # 5. Smart Chunking & Enrichment
        chunk_dicts = self.chunker.chunk_document(
            doc=parsed_doc,
            tenant_id=tenant_id,
            document_id=doc.id,
            document_version_id=ver.id,
            department=department,
            category=category,
            tags=tags
        )

        db_chunks = []
        qdrant_points = []

        for cd in chunk_dicts:
            db_chunk = Chunk(
                id=cd["id"],
                tenant_id=tenant_id,
                document_id=doc.id,
                document_version_id=ver.id,
                chunk_index=cd["chunk_index"],
                parent_section_id=cd["parent_section_id"],
                previous_chunk_id=cd["previous_chunk_id"],
                next_chunk_id=cd["next_chunk_id"],
                title=cd["title"],
                section_title=cd["section_title"],
                page_number=cd["page_number"],
                content=cd["content"],
                embedding_text=cd["embedding_text"],
                language=cd["language"],
                token_count=cd["token_count"],
                char_count=cd["char_count"],
                content_hash=cd["content_hash"],
                department=department,
                category=category,
                security_level=security_level,
                document_status="active"
            )
            db_chunks.append(db_chunk)

            # Compute vectors for Qdrant vector store
            dense_vec = [0.01] * self.embedder.dimension
            sparse_vec = self.sparse_encoder.encode_text(cd["embedding_text"])

            qdrant_points.append({
                "id": cd["id"],
                "dense_vector": dense_vec,
                "sparse_vector": sparse_vec,
                "payload": {
                    "chunk_id": cd["id"],
                    "tenant_id": tenant_id,
                    "document_id": doc.id,
                    "document_version_id": ver.id,
                    "title": cd["title"],
                    "section_title": cd["section_title"],
                    "page_number": cd["page_number"],
                    "content": cd["content"],
                    "embedding_text": cd["embedding_text"],
                    "content_hash": cd["content_hash"],
                    "department": department,
                    "category": category,
                    "security_level": security_level,
                    "document_status": "active"
                }
            })

        self.db.add_all(db_chunks)

        # Upsert points into Qdrant collection
        self.qdrant_mgr.upsert_chunks(collection_name=collection_name, points=qdrant_points)

        # Mark document as active
        doc.status = "active"
        doc.active_version_id = ver.id

        audit = AuditEvent(
            tenant_id=tenant_id,
            action="document_ingested",
            details_json={"document_id": doc.id, "chunks": len(db_chunks)}
        )
        self.db.add(audit)
        self.db.commit()

        return {
            "status": "ready",
            "document_id": doc.id,
            "version_id": ver.id,
            "version_number": 1,
            "title": doc.title,
            "chunks_count": len(db_chunks),
            "checksum": checksum
        }
