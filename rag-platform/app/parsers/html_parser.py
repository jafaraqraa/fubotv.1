import re
from app.parsers.base import BaseParser, ParsedDocument

class HTMLParser(BaseParser):
    def parse(self, file_bytes: bytes, file_name: str) -> ParsedDocument:
        raw_html = file_bytes.decode("utf-8", errors="replace")
        # Strip HTML tags simply while preserving readable breaks
        clean_text = re.sub(r'<br\s*/?>', '\n', raw_html, flags=re.IGNORECASE)
        clean_text = re.sub(r'</p>', '\n\n', clean_text, flags=re.IGNORECASE)
        clean_text = re.sub(r'<[^>]+>', ' ', clean_text)
        clean_text = re.sub(r'[ \t]+', ' ', clean_text).strip()

        doc_title = file_name.rsplit(".", 1)[0]
        return ParsedDocument(
            title=doc_title,
            content=clean_text,
            metadata={},
            sections=[{"title": doc_title, "content": clean_text}]
        )
