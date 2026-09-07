import json
from app.parsers.base import BaseParser, ParsedDocument

class JSONParser(BaseParser):
    def parse(self, file_bytes: bytes, file_name: str) -> ParsedDocument:
        raw_str = file_bytes.decode("utf-8", errors="replace")
        data = json.loads(raw_str)
        doc_title = file_name.rsplit(".", 1)[0]
        sections = []
        full_strings = []

        if isinstance(data, list):
            for idx, item in enumerate(data):
                if isinstance(item, dict):
                    formatted = " | ".join([f"{k}: {v}" for k, v in item.items()])
                else:
                    formatted = str(item)
                sections.append({"title": f"Record {idx + 1}", "content": formatted})
                full_strings.append(formatted)
        elif isinstance(data, dict):
            for k, v in data.items():
                formatted = f"{k}: {v}"
                sections.append({"title": k, "content": formatted})
                full_strings.append(formatted)
        else:
            full_strings.append(str(data))
            sections.append({"title": doc_title, "content": str(data)})

        return ParsedDocument(
            title=doc_title,
            content="\n".join(full_strings),
            metadata={},
            sections=sections
        )
