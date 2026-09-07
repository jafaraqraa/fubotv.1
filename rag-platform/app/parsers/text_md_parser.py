import re
from app.parsers.base import BaseParser, ParsedDocument

class TextMDParser(BaseParser):
    def parse(self, file_bytes: bytes, file_name: str) -> ParsedDocument:
        text = file_bytes.decode("utf-8", errors="replace")
        sections = []
        doc_title = file_name.rsplit(".", 1)[0]

        # Check for markdown headers (# Heading)
        heading_matches = list(re.finditer(r'^(#{1,6})\s+(.+)$', text, re.MULTILINE))
        if heading_matches:
            for idx, match in enumerate(heading_matches):
                title = match.group(2).strip()
                start_pos = match.end()
                end_pos = heading_matches[idx + 1].start() if idx + 1 < len(heading_matches) else len(text)
                section_content = text[start_pos:end_pos].strip()
                sections.append({
                    "title": title,
                    "content": section_content
                })
        else:
            sections = [{"title": doc_title, "content": text}]

        return ParsedDocument(
            title=doc_title,
            content=text,
            metadata={},
            sections=sections
        )
