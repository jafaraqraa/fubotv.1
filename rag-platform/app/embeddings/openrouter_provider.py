import httpx
from typing import List
from app.embeddings.base import BaseEmbeddingProvider

class OpenRouterEmbeddingProvider(BaseEmbeddingProvider):
    def __init__(self, api_key: str, model: str, base_url: str = "https://openrouter.ai/api/v1"):
        if not api_key:
            raise ValueError("OpenRouter API key is required for embeddings")
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self._dimension = 0

    @property
    def dimension(self) -> int:
        return self._dimension

    def _payload(self, texts: List[str]) -> dict:
        return {"model": self.model, "input": texts, "encoding_format": "float"}

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

    def _parse(self, body: dict, expected: int) -> List[List[float]]:
        rows = sorted(body.get("data", []), key=lambda item: item.get("index", 0))
        vectors = [row.get("embedding", []) for row in rows]
        if len(vectors) != expected or any(not vector for vector in vectors):
            raise RuntimeError("OpenRouter returned an invalid embedding response")
        dimension = len(vectors[0])
        if any(len(vector) != dimension for vector in vectors):
            raise RuntimeError("OpenRouter returned inconsistent embedding dimensions")
        self._dimension = dimension
        return vectors

    async def embed_query(self, text: str) -> List[float]:
        return (await self.embed_documents([text]))[0]

    async def embed_documents(self, texts: List[str]) -> List[List[float]]:
        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(f"{self.base_url}/embeddings", headers=self._headers(), json=self._payload(texts))
            response.raise_for_status()
            return self._parse(response.json(), len(texts))

    def embed_documents_sync(self, texts: List[str]) -> List[List[float]]:
        with httpx.Client(timeout=45.0) as client:
            response = client.post(f"{self.base_url}/embeddings", headers=self._headers(), json=self._payload(texts))
            response.raise_for_status()
            return self._parse(response.json(), len(texts))
