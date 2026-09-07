import io
from pypdf import PdfReader
from app.parsers.base import BaseParser, ParsedDocument

class PDFParser(BaseParser):
    def parse(self, file_bytes: bytes, file_name: str) -> ParsedDocument:
        reader = PdfReader(io.BytesIO(file_bytes))
        sections = []
        full_text_list = []

        for page_idx, page in enumerate(reader.pages):
            page_text = page.extract_text() or ""
            page_num = page_idx + 1
            if page_text.strip():
                sections.append({
                    "title": f"Page {page_num}",
                    "content": page_text,
                    "page_number": page_num
                })
                full_text_list.append(page_text)

        full_content = "\n\n".join(full_text_list)
        doc_title = file_name.rsplit(".", 1)[0]

        return ParsedDocument(
            title=doc_title,
            content=full_content,
            metadata={"total_pages": len(reader.pages)},
            sections=sections
        )
