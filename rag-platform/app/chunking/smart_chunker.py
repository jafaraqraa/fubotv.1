import hashlib
import uuid
from typing import List, Dict, Any
from app.parsers.base import ParsedDocument
from app.core.normalization import normalize_text

class SmartChunker:
    def __init__(
        self,
        target_tokens: int = 500,
        overlap_tokens: int = 50,
        min_tokens: int = 50
    ):
        self.target_tokens = target_tokens
        self.overlap_tokens = overlap_tokens
        self.min_tokens = min_tokens

    def chunk_document(
        self,
        doc: ParsedDocument,
        tenant_id: str,
        document_id: str,
        document_version_id: str,
        department: str = None,
        category: str = None,
        tags: List[str] = None
    ) -> List[Dict[str, Any]]:
        chunks = []
        sections = doc.sections if doc.sections else [{"title": doc.title, "content": doc.content}]
        chunk_counter = 0

        for section_idx, sec in enumerate(sections):
            sec_title = sec.get("title") or doc.title
            sec_content = normalize_text(sec.get("content") or "")
            page_num = sec.get("page_number")
            section_id = f"sec_{section_idx + 1}"

            if not sec_content:
                continue

            words = sec_content.split()
            target_words = max(1, int(self.target_tokens * 0.75))
            overlap_words = int(self.overlap_tokens * 0.75)

            if len(words) <= target_words:
                word_blocks = [words]
            else:
                word_blocks = []
                start = 0
                while start < len(words):
                    end = min(start + target_words, len(words))
                    block = words[start:end]
                    if block:
                        word_blocks.append(block)
                    if end >= len(words):
                        break
                    start += (target_words - overlap_words)

            for block in word_blocks:
                content_text = " ".join(block).strip()
                if not content_text:
                    continue

                chunk_counter += 1
                chunk_id = str(uuid.uuid4())
                char_count = len(content_text)
                est_token_count = int(len(block) / 0.75)

                content_hash = hashlib.sha256(content_text.encode("utf-8")).hexdigest()

                # Build enriched embedding_text
                prefix_parts = [f"Document: {doc.title}"]
                if sec_title and sec_title != doc.title:
                    prefix_parts.append(f"Section: {sec_title}")
                if department:
                    prefix_parts.append(f"Department: {department}")
                if category:
                    prefix_parts.append(f"Category: {category}")
                if tags:
                    prefix_parts.append(f"Tags: {', '.join(tags)}")

                embedding_text = f"[{' | '.join(prefix_parts)}]\n\n{content_text}"

                chunk_data = {
                    "id": chunk_id,
                    "tenant_id": tenant_id,
                    "document_id": document_id,
                    "document_version_id": document_version_id,
                    "chunk_index": chunk_counter,
                    "parent_section_id": section_id,
                    "previous_chunk_id": None,
                    "next_chunk_id": None,
                    "title": doc.title,
                    "section_title": sec_title,
                    "page_number": page_num,
                    "content": content_text,
                    "embedding_text": embedding_text,
                    "language": "ar" if any('\u0600' <= c <= '\u06FF' for c in content_text) else "en",
                    "token_count": est_token_count,
                    "char_count": char_count,
                    "content_hash": content_hash,
                    "department": department,
                    "category": category
                }
                chunks.append(chunk_data)

        # Link previous and next chunk IDs
        for i in range(len(chunks)):
            if i > 0:
                chunks[i]["previous_chunk_id"] = chunks[i - 1]["id"]
            if i < len(chunks) - 1:
                chunks[i]["next_chunk_id"] = chunks[i + 1]["id"]

        return chunks
