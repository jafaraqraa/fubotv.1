import pytest
from app.context.context_builder import EvidenceItem, ContextPayload
from app.generation.grounded_generator import GroundedGenerator
from app.citations.citation_validator import CitationValidator
from app.confidence.calibrator import ConfidenceCalibrator

@pytest.mark.asyncio
async def test_generation_citation_validation_and_calibration():
    evidence_item = EvidenceItem(
        evidence_id="EVIDENCE_01",
        chunk_id="c1",
        tenant_id="tenant_atlas",
        document_id="d1",
        document_version_id="v1",
        title="Employee Handbook",
        section_title="Annual Leave",
        content="Annual leave is 30 paid days per year."
    )
    context = ContextPayload(
        formatted_context="[EVIDENCE_01]\nAnnual leave is 30 paid days per year.",
        evidence_items=[evidence_item],
        total_tokens=20
    )

    generator = GroundedGenerator(provider="ollama")
    gen_out = await generator.generate_answer("How many annual leave days?", context)

    assert "answer" in gen_out
    assert len(gen_out["citations"]) > 0

    validator = CitationValidator()
    val_res = validator.validate(gen_out["answer"], gen_out["citations"], [evidence_item])

    assert val_res.is_valid is True
    assert len(val_res.verified_citations) == 1
    assert val_res.verified_citations[0].evidence_id == "EVIDENCE_01"

    calibrator = ConfidenceCalibrator()
    conf = calibrator.calibrate(
        gate_decision="ANSWER",
        top_rerank_score=0.8,
        citation_result=val_res,
        candidate_count=1
    )

    assert conf.label in ["high", "medium"]
    assert conf.score > 0.7
