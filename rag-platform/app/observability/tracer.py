import time
import uuid
from typing import Dict, Any, Optional
from sqlalchemy.orm import Session
from app.db.models import RequestTrace

class RequestTracer:
    def __init__(self, tenant_id: str, original_query: str):
        self.trace_id = str(uuid.uuid4())
        self.tenant_id = tenant_id
        self.original_query = original_query
        self.start_time = time.time()
        self.timings: Dict[str, float] = {}

    def mark_step(self, step_name: str, duration_ms: float):
        self.timings[step_name] = round(duration_ms, 2)

    def finish_trace(
        self,
        db: Session,
        normalized_query: str,
        language: str,
        gate_decision: str,
        confidence_label: str,
        confidence_score: float,
        citation_status: str,
        user_id: Optional[str] = None,
        dense_count: int = 0,
        sparse_count: int = 0,
        selected_count: int = 0,
        error_code: Optional[str] = None
    ):
        total_ms = (time.time() - self.start_time) * 1000
        self.timings["total_ms"] = round(total_ms, 2)

        trace = RequestTrace(
            id=self.trace_id,
            tenant_id=self.tenant_id,
            user_id=user_id,
            original_query=self.original_query,
            normalized_query=normalized_query,
            language=language,
            gate_decision=gate_decision,
            citation_status=citation_status,
            confidence_label=confidence_label,
            confidence_score=confidence_score,
            dense_count=dense_count,
            sparse_count=sparse_count,
            selected_count=selected_count,
            latency_breakdown_json=self.timings,
            error_code=error_code,
            created_at=time.time()
        )
        db.add(trace)
        db.commit()
