from typing import List
from app.schemas.response import ConfidenceDetail
from app.citations.citation_validator import CitationValidationResult

class ConfidenceCalibrator:
    def calibrate(
        self,
        gate_decision: str,
        top_rerank_score: float,
        citation_result: CitationValidationResult,
        candidate_count: int
    ) -> ConfidenceDetail:
        if gate_decision != "ANSWER":
            return ConfidenceDetail(
                score=0.0,
                label="low",
                reason_codes=["insufficient_evidence_gate"]
            )

        reason_codes = []
        score = top_rerank_score

        if candidate_count >= 2:
            reason_codes.append("multiple_supporting_chunks")
            score += 0.05

        if citation_result.is_valid:
            reason_codes.append("citation_validation_passed")
            score += 0.1
        else:
            reason_codes.append("unverified_citations_detected")
            score -= 0.15

        final_score = round(max(0.0, min(1.0, score)), 2)

        if final_score >= 0.75:
            label = "high"
        elif final_score >= 0.45:
            label = "medium"
        else:
            label = "low"

        return ConfidenceDetail(
            score=final_score,
            label=label,
            reason_codes=reason_codes
        )
