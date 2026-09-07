from typing import List, Dict, Any, Tuple
from pydantic import BaseModel
from app.retrieval.hybrid_retriever import RetrievalCandidate
from app.core.config import settings

class GateResult(BaseModel):
    decision: str
    confidence_score: float
    reason: str
    selected_candidates: List[RetrievalCandidate] = []

class EvidenceGate:
    def __init__(
        self,
        min_reranker_score: float = None,
        min_relevance_margin: float = None
    ):
        self.min_reranker_score = min_reranker_score if min_reranker_score is not None else settings.MIN_RERANKER_SCORE
        self.min_relevance_margin = min_relevance_margin if min_relevance_margin is not None else settings.MIN_RELEVANCE_MARGIN

    def evaluate(self, query: str, candidates: List[RetrievalCandidate], final_k: int = 6) -> GateResult:
        if not candidates:
            return GateResult(
                decision="INSUFFICIENT_EVIDENCE",
                confidence_score=0.0,
                reason="No retrieval candidates found for query",
                selected_candidates=[]
            )

        top_cand = candidates[0]
        if top_cand.rerank_score < self.min_reranker_score:
            return GateResult(
                decision="INSUFFICIENT_EVIDENCE",
                confidence_score=top_cand.rerank_score,
                reason=f"Top candidate score ({top_cand.rerank_score:.2f}) below threshold ({self.min_reranker_score:.2f})",
                selected_candidates=[]
            )

        selected = candidates[:final_k]
        return GateResult(
            decision="ANSWER",
            confidence_score=top_cand.rerank_score,
            reason="Sufficient authorized evidence available",
            selected_candidates=selected
        )
