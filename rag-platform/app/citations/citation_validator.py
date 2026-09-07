import re
from typing import List, Dict, Tuple
from pydantic import BaseModel
from app.context.context_builder import EvidenceItem
from app.schemas.response import CitationDetail

class CitationValidationResult(BaseModel):
    is_valid: bool
    verified_citations: List[CitationDetail]
    coverage_score: float
    invalid_ids: List[str]

class CitationValidator:
    def validate(
        self,
        answer: str,
        claimed_citations: List[str],
        evidence_items: List[EvidenceItem]
    ) -> CitationValidationResult:
        evidence_map: Dict[str, EvidenceItem] = {e.evidence_id: e for e in evidence_items}

        # Also extract any inline citations like [EVIDENCE_01] from answer prose
        inline_citations = re.findall(r'\[(EVIDENCE_\d{2})\]', answer)
        all_claimed = list(set(claimed_citations + inline_citations))

        verified = []
        invalid = []

        for cid in all_claimed:
            if cid in evidence_map:
                ev = evidence_map[cid]
                verified.append(CitationDetail(
                    evidence_id=ev.evidence_id,
                    document_id=ev.document_id,
                    document_version_id=ev.document_version_id,
                    title=ev.title,
                    section=ev.section_title,
                    page=ev.page_number
                ))
            else:
                invalid.append(cid)

        total_supplied = len(evidence_items)
        coverage = len(verified) / max(1, total_supplied) if total_supplied > 0 else 0.0

        return CitationValidationResult(
            is_valid=len(invalid) == 0 and len(verified) > 0,
            verified_citations=verified,
            coverage_score=coverage,
            invalid_ids=invalid
        )
