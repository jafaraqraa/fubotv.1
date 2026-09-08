from typing import List
from app.retrieval.hybrid_retriever import RetrievalCandidate
from app.core.normalization import search_tokens

class CrossEncoderReranker:
    def __init__(self, model_name: str = "bge-reranker-base"):
        self.model_name = model_name

    def rerank(self, query: str, candidates: List[RetrievalCandidate], top_k: int = 20) -> List[RetrievalCandidate]:
        if not candidates:
            return []

        # Calculate reranker relevance score
        query_words = search_tokens(query)
        for cand in candidates:
            cand_words = search_tokens(f"{cand.title} {cand.section_title} {cand.content}")
            intersection = query_words.intersection(cand_words)
            overlap = len(intersection) / max(1, len(query_words))

            # Lexical/identifier evidence is authoritative; retrieval signals
            # break ties without overwhelming short, precise Arabic questions.
            identifiers = {w for w in query_words if any(ch.isdigit() for ch in w)}
            identifier_score = 1.0 if identifiers and identifiers.issubset(cand_words) else 0.0
            retrieval_signal = max(cand.dense_score, cand.sparse_score, cand.rrf_score)
            cand.rerank_score = round(min(1.0, 0.65 * overlap + 0.25 * identifier_score + 0.10 * retrieval_signal), 4)

        ranked = sorted(candidates, key=lambda x: x.rerank_score, reverse=True)
        return ranked[:top_k]
