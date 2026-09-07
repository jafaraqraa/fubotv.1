import time
from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.auth.tenant import get_principal_context, PrincipalContext
from app.core.normalization import normalize_text
from app.core.errors import raise_invalid_query
from app.observability.tracer import RequestTracer
from app.embeddings.ollama_provider import OllamaEmbeddingProvider
from app.sparse.bm25_encoder import BM25SparseEncoder
from app.retrieval.qdrant_manager import QdrantIndexManager
from app.retrieval.hybrid_retriever import HybridRetriever
from app.reranking.reranker import CrossEncoderReranker
from app.gating.evidence_gate import EvidenceGate
from app.context.context_builder import ContextBuilder
from app.generation.grounded_generator import GroundedGenerator
from app.citations.citation_validator import CitationValidator
from app.confidence.calibrator import ConfidenceCalibrator
from app.schemas.response import QueryResponse, ConfidenceDetail, CitationDetail
from app.db.models import Chunk, ActiveIndex, IndexVersion

router = APIRouter(prefix="/v1", tags=["Query Engine"])

class QueryRequest(BaseModel):
    tenant_id: Optional[str] = None
    query: str
    user_id: Optional[str] = None
    roles: List[str] = ["employee"]
    department: Optional[str] = None
    filters: Optional[Dict[str, Any]] = None

@router.post("/query", response_model=QueryResponse)
async def query_rag_engine(
    req: QueryRequest,
    principal: PrincipalContext = Depends(get_principal_context),
    db: Session = Depends(get_db)
):
    start_total = time.time()
    tracer = RequestTracer(tenant_id=principal.tenant_id, original_query=req.query)

    # 1. Validation
    if not req.query or len(req.query.strip()) == 0:
        raise_invalid_query("Query cannot be empty")

    t0 = time.time()
    # 2. Query Normalization & Language Detection
    norm_query = normalize_text(req.query)
    lang = "ar" if any('\u0600' <= c <= '\u06FF' for c in norm_query) else "en"
    tracer.mark_step("normalization_ms", (time.time() - t0) * 1000)

    # 3. Fetch active chunks for tenant
    t_ret = time.time()
    db_chunks = db.query(Chunk).filter_by(tenant_id=principal.tenant_id, document_status="active").all()
    in_mem = [
        {
            "id": c.id,
            "tenant_id": c.tenant_id,
            "document_id": c.document_id,
            "document_version_id": c.document_version_id,
            "title": c.title,
            "section_title": c.section_title,
            "page_number": c.page_number,
            "content": c.content,
            "embedding_text": c.embedding_text,
            "content_hash": c.content_hash,
            "document_status": c.document_status
        }
        for c in db_chunks
    ]

    embedder = OllamaEmbeddingProvider()
    sparse = BM25SparseEncoder()
    qdrant_mgr = QdrantIndexManager()
    retriever = HybridRetriever(embedder, sparse, qdrant_mgr)

    candidates = await retriever.retrieve_candidates(
        collection_name="rag_v1",
        query=norm_query,
        tenant_id=principal.tenant_id,
        roles=principal.roles,
        department=principal.department,
        in_memory_chunks=in_mem
    )
    tracer.mark_step("retrieval_ms", (time.time() - t_ret) * 1000)

    # 4. Reranking
    t_rerank = time.time()
    reranker = CrossEncoderReranker()
    reranked = reranker.rerank(norm_query, candidates)
    tracer.mark_step("rerank_ms", (time.time() - t_rerank) * 1000)

    # 5. Evidence Sufficiency Gate
    t_gate = time.time()
    gate = EvidenceGate()
    gate_res = gate.evaluate(norm_query, reranked)
    tracer.mark_step("gate_ms", (time.time() - t_gate) * 1000)

    # Abstain if evidence is insufficient
    if gate_res.decision != "ANSWER":
        tracer.finish_trace(
            db=db,
            normalized_query=norm_query,
            language=lang,
            gate_decision=gate_res.decision,
            confidence_label="low",
            confidence_score=gate_res.confidence_score,
            citation_status="none"
        )
        return QueryResponse(
            status="insufficient_evidence",
            answer="The available company documents do not contain sufficient authorized evidence to answer this question reliably.",
            citations=[],
            confidence=ConfidenceDetail(score=0.0, label="low", reason_codes=["insufficient_evidence_gate"]),
            trace_id=tracer.trace_id,
            latency_breakdown_ms=tracer.timings
        )

    # 6. Context Construction
    t_ctx = time.time()
    ctx_builder = ContextBuilder()
    context = ctx_builder.build_context(gate_res.selected_candidates)
    tracer.mark_step("context_ms", (time.time() - t_ctx) * 1000)

    # 7. Grounded Generation
    t_gen = time.time()
    generator = GroundedGenerator()
    gen_out = await generator.generate_answer(norm_query, context)
    tracer.mark_step("generation_ms", (time.time() - t_gen) * 1000)

    # 8. Citation Validation
    t_cite = time.time()
    validator = CitationValidator()
    val_res = validator.validate(gen_out["answer"], gen_out["citations"], context.evidence_items)
    tracer.mark_step("citation_ms", (time.time() - t_cite) * 1000)

    # 9. Confidence Calibration
    calibrator = ConfidenceCalibrator()
    conf = calibrator.calibrate(
        gate_decision=gate_res.decision,
        top_rerank_score=gate_res.confidence_score,
        citation_result=val_res,
        candidate_count=len(gate_res.selected_candidates)
    )

    tracer.finish_trace(
        db=db,
        normalized_query=norm_query,
        language=lang,
        gate_decision="ANSWER",
        confidence_label=conf.label,
        confidence_score=conf.score,
        citation_status="valid" if val_res.is_valid else "partial",
        selected_count=len(val_res.verified_citations)
    )

    return QueryResponse(
        status="answered",
        answer=gen_out["answer"],
        citations=val_res.verified_citations,
        confidence=conf,
        trace_id=tracer.trace_id,
        latency_breakdown_ms=tracer.timings
    )
