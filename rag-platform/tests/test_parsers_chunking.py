import pytest
from app.parsers.factory import get_parser_for_file
from app.parsers.table_parser import TableParser
from app.parsers.json_parser import JSONParser
from app.parsers.text_md_parser import TextMDParser
from app.core.normalization import normalize_text
from app.chunking.smart_chunker import SmartChunker

def test_text_md_parser():
    md_content = "# Employee Handbook\n\nWorking hours are from 8 AM to 4 PM.\n\n## Leave Policy\nAnnual leave is 30 days."
    parser = get_parser_for_file("handbook.md")
    parsed = parser.parse(md_content.encode("utf-8"), "handbook.md")

    assert parsed.title == "handbook"
    assert len(parsed.sections) == 2
    assert parsed.sections[0]["title"] == "Employee Handbook"
    assert "Working hours" in parsed.sections[0]["content"]

def test_csv_table_parser():
    csv_content = "SKU,Product,Price\nSKU-101,Widget A,150\nSKU-102,Widget B,250"
    parser = TableParser()
    parsed = parser.parse(csv_content.encode("utf-8"), "products.csv")

    assert "SKU: SKU-101" in parsed.content
    assert "Price: 150" in parsed.content
    assert len(parsed.sections) == 2

def test_json_parser():
    json_content = '[{"id": "HR-17", "title": "Sick Leave", "days": 15}]'
    parser = JSONParser()
    parsed = parser.parse(json_content.encode("utf-8"), "policies.json")

    assert "id: HR-17" in parsed.content
    assert "title: Sick Leave" in parsed.content

def test_arabic_english_normalization():
    raw_text = "  مرحباً   بكمـ   \r\n\r\n\r\n    Welcome! SKU-9900   "
    normalized = normalize_text(raw_text)

    assert "مرحباً بكم" in normalized
    assert "Welcome! SKU-9900" in normalized
    assert "ـ" not in normalized

def test_smart_chunker_enrichment_and_links():
    md_content = "# Policy\nWorking hours: 8 AM to 4 PM.\n\n# Vacation\n30 days annual leave."
    parser = TextMDParser()
    parsed = parser.parse(md_content.encode("utf-8"), "policy.md")

    chunker = SmartChunker(target_tokens=100)
    chunks = chunker.chunk_document(
        parsed,
        tenant_id="tenant_a",
        document_id="doc_1",
        document_version_id="ver_1",
        department="HR"
    )

    assert len(chunks) == 2
    assert chunks[0]["next_chunk_id"] == chunks[1]["id"]
    assert chunks[1]["previous_chunk_id"] == chunks[0]["id"]
    assert "Document: policy" in chunks[0]["embedding_text"]
    assert "Department: HR" in chunks[0]["embedding_text"]
