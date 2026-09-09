from typing import List, Dict, Any
from pydantic import BaseModel
from app.retrieval.hybrid_retriever import RetrievalCandidate
from app.core.config import settings

class EvidenceItem(BaseModel):
    evidence_id: str
    chunk_id: str
    tenant_id: str
    document_id: str
    document_version_id: str
    title: str
    section_title: str
    page_number: Any = None
    content: str

class ContextPayload(BaseModel):
    formatted_context: str
    evidence_items: List[EvidenceItem]
    total_tokens: int

class ContextBuilder:
    def __init__(self, max_context_tokens: int = None):
        self.max_context_tokens = max_context_tokens or settings.MAX_CONTEXT_TOKENS

    def build_context(self, candidates: List[RetrievalCandidate]) -> ContextPayload:
        evidence_items = []
        context_blocks = []
        token_count = 0

        for idx, cand in enumerate(candidates, start=1):
            evidence_id = f"EVIDENCE_{idx:02d}"
            item = EvidenceItem(
                evidence_id=evidence_id,
                chunk_id=cand.chunk_id,
                tenant_id=cand.tenant_id,
                document_id=cand.document_id,
                document_version_id=cand.document_version_id,
                title=cand.title,
                section_title=cand.section_title,
                page_number=cand.page_number,
                content=cand.content
            )

            block = (
                f"[{evidence_id}]\n"
                f"Document: {cand.title}\n"
                f"Section: {cand.section_title}\n"
                f"Content: {cand.content}\n"
            )

            est_tokens = int(len(cand.content.split()) / 0.75)
            if token_count + est_tokens > self.max_context_tokens and context_blocks:
                break

            context_blocks.append(block)
            evidence_items.append(item)
            token_count += est_tokens

        formatted_context = "\n---\n".join(context_blocks)
        return ContextPayload(
            formatted_context=formatted_context,
            evidence_items=evidence_items,
            total_tokens=token_count
        )
