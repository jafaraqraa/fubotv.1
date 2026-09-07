from app.parsers.base import BaseParser
from app.parsers.pdf_parser import PDFParser
from app.parsers.docx_parser import DOCXParser
from app.parsers.text_md_parser import TextMDParser
from app.parsers.html_parser import HTMLParser
from app.parsers.table_parser import TableParser
from app.parsers.json_parser import JSONParser

def get_parser_for_file(file_name: str) -> BaseParser:
    ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
    if ext == "pdf":
        return PDFParser()
    elif ext in ["docx", "doc"]:
        return DOCXParser()
    elif ext in ["txt", "md", "markdown"]:
        return TextMDParser()
    elif ext in ["html", "htm"]:
        return HTMLParser()
    elif ext in ["csv", "xlsx", "xls"]:
        return TableParser()
    elif ext == "json":
        return JSONParser()
    else:
        return TextMDParser()
