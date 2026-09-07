from abc import ABC, abstractmethod
from typing import List

class BaseEmbeddingProvider(ABC):
    @abstractmethod
    async def embed_query(self, text: str) -> List[float]:
        pass

    @abstractmethod
    async def embed_documents(self, texts: List[str]) -> List[List[float]]:
        pass

    @property
    @abstractmethod
    def dimension(self) -> int:
        pass
