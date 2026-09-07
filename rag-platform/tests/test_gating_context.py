import pytest
from app.retrieval.hybrid_retriever import RetrievalCandidate
from app.reranking.reranker import CrossEncoderReranker
from app.gating.evidence_gate import EvidenceGate
from app.context.context_builder import ContextBuilder

def test_reranker_and_evidence_gating_pass():
    candidates = [
        RetrievalCandidate(
            chunk_id="c1",
            tenant_id="tenant_a",
            document_id="d1",
            document_version_id="v1",
            title="HR Policy",
            section_title="Annual Leave",
            content="Employees receive 30 days of paid annual leave each year.",
            embedding_text="...",
            content_hash="h1",
            rrf_score=0.03
        )
    ]

    reranker = CrossEncoderReranker()
    reranked = reranker.rerank("annual leave days", candidates)

    gate = EvidenceGate(min_reranker_score=0.1)
    gate_res = gate.evaluate("annual leave days", reranked)

    assert gate_res.decision == "ANSWER"
    assert len(gate_res.selected_candidates) == 1

def test_evidence_gating_abstention_on_weak_score():
    candidates = [
        RetrievalCandidate(
            chunk_id="c2",
            tenant_id="tenant_a",
            document_id="d2",
            document_version_id="v1",
            title="Irrelevant Doc",
            section_title="General",
            content="Cafeteria menu offers sandwiches on Tuesdays.",
            embedding_text="...",
            content_hash="h2",
            rrf_score=0.001
        )
    ]

    reranker = CrossEncoderReranker()
    reranked = reranker.rerank("annual leave days", candidates)

    gate = EvidenceGate(min_reranker_score=0.8)  # High threshold
    gate_res = gate.evaluate("annual leave days", reranked)

    assert gate_res.decision == "INSUFFICIENT_EVIDENCE"
    assert len(gate_res.selected_candidates) == 0

def test_context_builder_stable_ids():
    candidates = [
        RetrievalCandidate(
            chunk_id="c1",
            tenant_id="tenant_a",
            document_id="d1",
            document_version_id="v1",
            title="Leave Policy",
            section_title="Annual Leave",
            content="30 days paid annual leave.",
            embedding_text="...",
            content_hash="h1"
        )
    ]

    builder = ContextBuilder(max_context_tokens=1000)
    ctx = builder.build_context(candidates)

    assert len(ctx.evidence_items) == 1
    assert ctx.evidence_items[0].evidence_id == "EVIDENCE_01"
    assert "[EVIDENCE_01]" in ctx.formatted_context
