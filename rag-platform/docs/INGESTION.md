# Ingestion & Source Adapters

## Supported File Formats
- **PDF**: `PDFParser` extracts text while preserving page numbers and layout structure.
- **DOCX**: `DOCXParser` preserves paragraph hierarchy and heading levels.
- **TXT & Markdown**: `TextMDParser` preserves markdown sections (`# Heading`).
- **HTML**: `HTMLParser` strips tags while maintaining paragraph breaks.
- **CSV & XLSX**: `TableParser` converts rows into self-describing key-value strings (`Column: Value`).
- **JSON**: `JSONParser` formats record objects.

## Deduplication & Idempotency
Ingestion computes SHA-256 file checksums. Re-uploading an identical active document returns `status: already_exists` without re-chunking or re-embedding.
