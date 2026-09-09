from app.context.context_builder import ContextBuilder
from app.retrieval.hybrid_retriever import RetrievalCandidate


def test_only_evidence_visible_to_generator_can_be_cited():
    candidates = [RetrievalCandidate(chunk_id=str(i), tenant_id="municipal-test",
        document_id="synthetic", document_version_id="1", title="دليل تجريبي",
        section_title="متطلبات الخدمة", content="مستند مطلوب " * 20,
        embedding_text="", content_hash=str(i)) for i in range(3)]
    context = ContextBuilder(max_context_tokens=60).build_context(candidates)
    assert len(context.evidence_items) == 1
    assert "EVIDENCE_02" not in context.formatted_context
