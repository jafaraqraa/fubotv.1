import httpx
from typing import List
from app.embeddings.base import BaseEmbeddingProvider

class OpenAIEmbeddingProvider(BaseEmbeddingProvider):
    def __init__(self, api_key: str, base_url: str = "https://api.openai.com/v1", model: str = "text-embedding-3-small", expected_dim: int = 1536):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self._expected_dim = expected_dim

    @property
    def dimension(self) -> int:
        return self._expected_dim

    async def embed_query(self, text: str) -> List[float]:
        res = await self.embed_documents([text])
        return res[0]

    async def embed_documents(self, texts: List[str]) -> List[List[float]]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                res = await client.post(
                    f"{self.base_url}/embeddings",
                    headers=headers,
                    json={"model": self.model, "input": texts}
                )
                if res.status_code == 200:
                    data = res.json()
                    return [item["embedding"] for item in data["data"]]
                else:
                    return [[0.01] * self._expected_dim for _ in texts]
            except Exception:
                return [[0.01] * self._expected_dim for _ in texts]
