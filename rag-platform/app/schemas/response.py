from pydantic import BaseModel
from typing import List, Optional, Any, Dict

class CitationDetail(BaseModel):
    evidence_id: str
    document_id: str
    document_version_id: str
    title: str
    section: str
    page: Optional[Any] = None

class ConfidenceDetail(BaseModel):
    score: float
    label: str  # high, medium, low
    reason_codes: List[str] = []

class QueryResponse(BaseModel):
    status: str  # answered, insufficient_evidence, permission_denied, invalid_query, error
    answer: str
    citations: List[CitationDetail] = []
    confidence: ConfidenceDetail
    trace_id: str
    latency_breakdown_ms: Optional[Dict[str, float]] = None
