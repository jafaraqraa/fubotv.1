# Smart Chunking & Enrichment

## Strategy-based Chunking
`SmartChunker` splits parsed document sections into canonical chunks while maintaining:
- `chunk_index`
- `parent_section_id`
- `previous_chunk_id` / `next_chunk_id` links

## Chunk Enrichment
To maximize retrieval relevance without cluttering display text, each chunk stores:
- `content`: Clean text for presentation
- `embedding_text`: Enriched string prepending metadata (`[Document: ... | Section: ... | Department: ...]`)
