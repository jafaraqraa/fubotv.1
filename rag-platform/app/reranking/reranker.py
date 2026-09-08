from typing import List
import httpx
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

class OpenRouterReranker:
    def __init__(self, api_key: str, model_name: str, base_url: str = "https://openrouter.ai/api/v1"):
        if not api_key:
            raise ValueError("OpenRouter API key is required for reranking")
        self.api_key = api_key
        self.model_name = model_name
        self.base_url = base_url.rstrip("/")

    async def rerank(self, query: str, candidates: List[RetrievalCandidate], top_k: int = 20) -> List[RetrievalCandidate]:
        if not candidates:
            return []
        documents = [f"{c.title}\n{c.section_title}\n{c.content}" for c in candidates]
        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(
                f"{self.base_url}/rerank",
                headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                json={"model": self.model_name, "query": query, "documents": documents, "top_n": min(top_k, len(documents))}
            )
            response.raise_for_status()
            results = response.json().get("results", [])
        ranked = []
        for item in results:
            index = int(item["index"])
            if 0 <= index < len(candidates):
                candidate = candidates[index]
                candidate.rerank_score = round(float(item.get("relevance_score", 0.0)), 4)
                ranked.append(candidate)
        return ranked
