from typing import List
from app.retrieval.hybrid_retriever import RetrievalCandidate

class CrossEncoderReranker:
    def __init__(self, model_name: str = "bge-reranker-base"):
        self.model_name = model_name

    def rerank(self, query: str, candidates: List[RetrievalCandidate], top_k: int = 20) -> List[RetrievalCandidate]:
        if not candidates:
            return []

        # Calculate reranker relevance score
        query_words = set(query.lower().split())
        for cand in candidates:
            cand_words = set(cand.content.lower().split())
            intersection = query_words.intersection(cand_words)
            overlap = len(intersection) / max(1, len(query_words))

            # Combine RRF rank signal with keyword overlap
            cand.rerank_score = round(0.5 * cand.rrf_score + 0.5 * overlap, 4)

        ranked = sorted(candidates, key=lambda x: x.rerank_score, reverse=True)
        return ranked[:top_k]
