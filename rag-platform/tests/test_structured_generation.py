from app.context.context_builder import ContextBuilder
from app.generation.grounded_generator import GroundedGenerator
from app.retrieval.hybrid_retriever import RetrievalCandidate

CATALOG = """Company Profile AtlasTech Solutions is a fictional company.
INV-SMART-10 SmartGrid 10 Inverter 10 kW 12,400 5 years
KnowledgeBot Plus 11,500 1,900 20,000 AI conversations/month
Up to 5 unused annual-leave days may be carried into the next calendar year."""

def context():
    candidate = RetrievalCandidate(
        chunk_id="c1", tenant_id="t1", document_id="d1", document_version_id="v1",
        title="Handbook", section_title="Catalog", content=CATALOG,
        embedding_text=CATALOG, content_hash="h1"
    )
    return ContextBuilder().build_context([candidate])

def test_structured_answers_are_short_and_exact():
    generator = GroundedGenerator()
    cases = {
        "شو اسم شركتكم": "AtlasTech Solutions",
        "قديش سعر SmartGrid 10؟": "12,400",
        "كم الاشتراك الشهري لـ KnowledgeBot Plus؟": "1,900",
        "قديش بقدر ارحل من الاجازة؟": "5 أيام",
    }
    for query, expected in cases.items():
        answer = generator._structured_answer(query, context())
        assert expected in answer
        assert len(answer) < 180
