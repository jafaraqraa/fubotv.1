# Advanced Hybrid RAG Architecture — Part 1 Foundation

This document details the software and systems architecture designed and implemented for Part 1 of the Advanced Hybrid RAG system on the FUThing platform.

## 1. System Overview & Part 1 Architecture
The platform has transitioned from a legacy, synchronous keyword-matching retriever to a production-grade, local, vectorized RAG foundation.

```
[Document: knowledge.txt]
          ↓
[textDocumentLoader] (loads file, captures size, modifiedAt, computes SHA-256)
          ↓
[textCleaner] (conservative formatting, collapses blank lines, preserves headings)
          ↓
[arabicNormalizer] (strips diacritics, tatweel, normalizes Alef & Maqsura)
          ↓
[documentChunker] (structure-aware chunking, builds prev/next links & overlap)
          ↓
[ollamaEmbeddingProvider] (generates nomic-embed-text vector embeddings)
          ↓
[qdrantVectorStore] (stores cosine vectors, payload metadata, handles cleanups)
```

## 2. Infrastructure Layer
The infrastructure utilizes free, locally hosted tools to preserve absolute privacy and data sovereignty.

### Qdrant Local
- **Vector DB**: Persistent Qdrant instance.
- **Port**: 6333 (HTTP REST API), 6334 (gRPC).
- **Similarity Metric**: Cosine similarity.
- **Vector Dimensions**: Dynamically derived from the active Ollama model at runtime.
- **Payload**: Stores structured metadata, original text, and Arabic-normalized retrieval strings.

### Ollama Local
- **Embedding Provider**: Local Ollama HTTP service.
- **Default Model**: `nomic-embed-text`.
- **Port**: 11434.
- **Timeout**: 30000ms.
- **Rejection Rules**: Malformed arrays, zero vectors, and empty inputs are strictly rejected.

## 3. Data Ingestion & Processing Pipeline

### Document Loader (`textDocumentLoader.js`)
Reads `knowledge.txt` securely using UTF-8. Computes a stable document hash and compiles size and modification details to avoid redundant reads.

### Text Cleaner (`textCleaner.js`)
Conservatively cleans raw inputs. Normalizes carriage returns, collapses triple spaces, but strictly preserves heading structures, list layouts, and Q&A blocks to retain their semantic relationship.

### Arabic Normalizer (`arabicNormalizer.js`)
Strips all Arabic diacritics and tatweel characters. Normalizes:
- `أ`, `إ`, `آ` → `ا`
- `ى` → `ي`
Collapses duplicate spaces. Explicitly preserves meaningful Latin product names, technical terms, URLs, and numbers.

### Document Chunker (`documentChunker.js`)
Executes structure-aware chunking with a precedence of splits:
1. Section headings
2. Q&A blocks
3. Paragraph double-newlines
4. List items
5. Sentence boundaries
6. Space boundaries (words)
7. Character fallbacks

- **Linked List Links**: Every chunk maintains pointer linkages `previousChunkId` and `nextChunkId` (first's previous is `null`, final's next is `null`).
- **Chunk Size / Overlap**: Configuration parameter `RAG_CHUNK_SIZE` default `800` and `RAG_CHUNK_OVERLAP` default `120`, measured in Unicode characters.

## 4. Vector Store & Indexing Lifecycle

### Stable Hashing
Uses SHA-256 of text and document details to create stable chunk IDs of format:
`${documentId}_chunk_${index}_${contentHash.substring(0, 12)}`
Ensures that identical content produces deterministic, unique IDs, completely preventing duplicates.

### Incremental Synchronization
On execution:
- Loads current document details and checks the database for previous state.
- If hashes match, skip all redundant embedding and vector operations (`status: unchanged`).
- If hashes differ, embeds only current segments, upserts new nodes, and deletes stale vectors by filtering on the `documentId`.

### Indexing State Persistence
Stores operational metadata in a SQLite table: `rag_indexing_state`. Keeps:
- `document_id` (PRIMARY KEY)
- `document_hash`
- `last_status`
- `last_success_at`
- `last_duration_ms`
- `total_chunks`
- `last_error`
- `collection_name`
- `embedding_model`
- `chunk_size`
- `chunk_overlap`

## 5. Security & Authentication Boundaries
- **Route Access**: Status and Reindexing endpoints require full administrator authentication and active session cookies.
- **CSRF Defense**: All reindexing triggers are fully protected by cryptographic session-bound CSRF token validation headers.
- **Prototype Pollution Guard**: A global middleware rejects parameters containing `__proto__`, `prototype`, or `constructor` at raw JSON and object levels.
- **Rate-Limiter**: Spams on reindexing are blocked by an in-memory IP rate limiter.

## 6. Precedence Rules & Legacy Fallback
- **Precedence Model**: Environment deployment environment → SQLite database settings → `.env` defaults → Application defaults.
- **Graceful Fallback**: If the vector database or embedding provider is offline, the system transparently utilizes the legacy keyword retriever, logging the status.

## 7. Deferred Part 2 Roadmap
Hybrid BM25 retrieval, similarity thresholds, query expansion, neighbor chunk stitching, citations, confidence scores, and automatic human handoffs are deferred to Part 2.
