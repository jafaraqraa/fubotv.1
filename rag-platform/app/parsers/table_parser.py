import io
import pandas as pd
from app.parsers.base import BaseParser, ParsedDocument

class TableParser(BaseParser):
    def parse(self, file_bytes: bytes, file_name: str) -> ParsedDocument:
        doc_title = file_name.rsplit(".", 1)[0]
        ext = file_name.rsplit(".", 1)[-1].lower()

        if ext == "csv":
            df = pd.read_csv(io.BytesIO(file_bytes))
        else:
            df = pd.read_excel(io.BytesIO(file_bytes))

        row_strings = []
        sections = []

        for idx, row in df.iterrows():
            row_cells = []
            for col in df.columns:
                val = row[col]
                if pd.notna(val):
                    row_cells.append(f"{col}: {val}")
            row_str = " | ".join(row_cells)
            if row_str.strip():
                row_strings.append(row_str)
                sections.append({
                    "title": f"Row {idx + 1}",
                    "content": row_str
                })

        full_content = "\n".join(row_strings)
        return ParsedDocument(
            title=doc_title,
            content=full_content,
            metadata={"total_rows": len(df)},
            sections=sections
        )
