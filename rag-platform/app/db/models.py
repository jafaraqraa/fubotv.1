import time
import uuid
from sqlalchemy import Column, String, Integer, Float, Boolean, Text, DateTime, ForeignKey, JSON, Index
from sqlalchemy.orm import relationship
from app.db.session import Base

def generate_uuid():
    return str(uuid.uuid4())

class Tenant(Base):
    __tablename__ = "tenants"

    id = Column(String(64), primary_key=True, default=generate_uuid)
    name = Column(String(128), nullable=False)
    status = Column(String(32), nullable=False, default="active")
    created_at = Column(Float, default=time.time)
    updated_at = Column(Float, default=time.time, onupdate=time.time)
    metadata_json = Column(JSON, nullable=True)

class User(Base):
    __tablename__ = "users"

    id = Column(String(64), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(64), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    username = Column(String(128), nullable=False)
    role = Column(String(64), nullable=False, default="employee")
    status = Column(String(32), nullable=False, default="active")
    created_at = Column(Float, default=time.time)

class Document(Base):
    __tablename__ = "documents"

    id = Column(String(64), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(64), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    source_type = Column(String(64), nullable=False)  # pdf, docx, txt, md, html, csv, json, xlsx
    source_uri = Column(Text, nullable=True)
    source_name = Column(String(256), nullable=False)
    title = Column(String(256), nullable=False)
    mime_type = Column(String(128), nullable=False)
    language = Column(String(16), nullable=False, default="ar")
    department = Column(String(64), nullable=True, index=True)
    category = Column(String(64), nullable=True, index=True)
    tags = Column(JSON, nullable=True)
    security_level = Column(String(32), nullable=False, default="internal")
    allowed_roles = Column(JSON, nullable=True)
    allowed_users = Column(JSON, nullable=True)
    status = Column(String(32), nullable=False, default="draft")  # draft, processing, ready, active, superseded, archived, deleted, failed
    effective_from = Column(Float, nullable=True)
    effective_until = Column(Float, nullable=True)
    active_version_id = Column(String(64), nullable=True)
    checksum = Column(String(128), nullable=True)
    parser_name = Column(String(64), nullable=True)
    parser_version = Column(String(32), nullable=True)
    ingestion_version = Column(String(32), nullable=True)
    created_at = Column(Float, default=time.time)
    updated_at = Column(Float, default=time.time, onupdate=time.time)
    metadata_json = Column(JSON, nullable=True)

class DocumentVersion(Base):
    __tablename__ = "document_versions"

    id = Column(String(64), primary_key=True, default=generate_uuid)
    document_id = Column(String(64), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True)
    tenant_id = Column(String(64), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    version_number = Column(Integer, nullable=False, default=1)
    checksum = Column(String(128), nullable=False)
    file_path = Column(Text, nullable=True)
    raw_content = Column(Text, nullable=True)
    status = Column(String(32), nullable=False, default="active")
    created_at = Column(Float, default=time.time)

class Chunk(Base):
    __tablename__ = "chunks"

    id = Column(String(64), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(64), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    document_id = Column(String(64), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True)
    document_version_id = Column(String(64), ForeignKey("document_versions.id", ondelete="CASCADE"), nullable=False, index=True)
    chunk_index = Column(Integer, nullable=False)
    parent_section_id = Column(String(64), nullable=True)
    previous_chunk_id = Column(String(64), nullable=True)
    next_chunk_id = Column(String(64), nullable=True)
    title = Column(String(256), nullable=True)
    section_title = Column(String(256), nullable=True)
    heading_path = Column(String(512), nullable=True)
    page_number = Column(Integer, nullable=True)
    content = Column(Text, nullable=False)
    embedding_text = Column(Text, nullable=False)
    language = Column(String(16), nullable=False, default="ar")
    token_count = Column(Integer, nullable=False, default=0)
    char_count = Column(Integer, nullable=False, default=0)
    content_hash = Column(String(128), nullable=False)
    department = Column(String(64), nullable=True)
    category = Column(String(64), nullable=True)
    security_level = Column(String(32), nullable=False, default="internal")
    allowed_roles = Column(JSON, nullable=True)
    allowed_users = Column(JSON, nullable=True)
    effective_from = Column(Float, nullable=True)
    effective_until = Column(Float, nullable=True)
    document_status = Column(String(32), nullable=False, default="active")
    created_at = Column(Float, default=time.time)
    metadata_json = Column(JSON, nullable=True)

class IndexVersion(Base):
    __tablename__ = "index_versions"

    id = Column(String(64), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(64), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(32), nullable=False, default="BUILDING") # BUILDING, VALIDATING, READY, ACTIVE, FAILED, SUPERSEDED
    collection_name = Column(String(128), nullable=False)
    embedding_provider = Column(String(64), nullable=False)
    embedding_model = Column(String(128), nullable=False)
    embedding_dimension = Column(Integer, nullable=False)
    sparse_model = Column(String(128), nullable=True)
    reranker_model = Column(String(128), nullable=True)
    parser_version = Column(String(32), nullable=True)
    chunker_version = Column(String(32), nullable=True)
    configuration_version = Column(String(64), nullable=True)
    doc_count = Column(Integer, default=0)
    chunk_count = Column(Integer, default=0)
    created_at = Column(Float, default=time.time)
    activated_at = Column(Float, nullable=True)

class ActiveIndex(Base):
    __tablename__ = "active_indexes"

    tenant_id = Column(String(64), ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True)
    index_version_id = Column(String(64), ForeignKey("index_versions.id", ondelete="CASCADE"), nullable=False)
    activated_at = Column(Float, default=time.time)

class Configuration(Base):
    __tablename__ = "configurations"

    id = Column(String(64), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(64), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True)
    group_name = Column(String(64), nullable=False)
    key_name = Column(String(64), nullable=False)
    value_json = Column(JSON, nullable=False)
    version = Column(String(64), nullable=False, default="v1")
    created_at = Column(Float, default=time.time)
    updated_at = Column(Float, default=time.time, onupdate=time.time)

class RequestTrace(Base):
    __tablename__ = "request_traces"

    id = Column(String(64), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(64), nullable=False, index=True)
    user_id = Column(String(64), nullable=True)
    original_query = Column(Text, nullable=False)
    normalized_query = Column(Text, nullable=False)
    language = Column(String(16), nullable=False)
    query_type = Column(String(32), nullable=True)
    filters_json = Column(JSON, nullable=True)
    configuration_version = Column(String(64), nullable=True)
    index_version_id = Column(String(64), nullable=True)
    dense_model = Column(String(128), nullable=True)
    sparse_model = Column(String(128), nullable=True)
    reranker_model = Column(String(128), nullable=True)
    generator_model = Column(String(128), nullable=True)
    dense_count = Column(Integer, default=0)
    sparse_count = Column(Integer, default=0)
    fused_count = Column(Integer, default=0)
    reranked_count = Column(Integer, default=0)
    selected_count = Column(Integer, default=0)
    gate_decision = Column(String(32), nullable=False)
    citation_status = Column(String(32), nullable=True)
    confidence_label = Column(String(32), nullable=True)
    confidence_score = Column(Float, nullable=True)
    latency_breakdown_json = Column(JSON, nullable=True)
    error_code = Column(String(64), nullable=True)
    created_at = Column(Float, default=time.time)

class AuditEvent(Base):
    __tablename__ = "audit_events"

    id = Column(String(64), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(64), nullable=False, index=True)
    action = Column(String(64), nullable=False)  # document_ingested, document_deleted, index_activated, index_rolled_back, config_changed
    principal_id = Column(String(64), nullable=True)
    details_json = Column(JSON, nullable=True)
    timestamp = Column(Float, default=time.time)
