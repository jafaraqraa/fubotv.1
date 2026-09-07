from abc import ABC, abstractmethod
from pydantic import BaseModel
from typing import List, Dict, Any, Optional

class ParsedDocument(BaseModel):
    title: str
    content: str
    metadata: Dict[str, Any] = {}
    sections: List[Dict[str, Any]] = []  # List of {"title": str, "content": str, "page_number": int}

class BaseParser(ABC):
    @abstractmethod
    def parse(self, file_bytes: bytes, file_name: str) -> ParsedDocument:
        pass
