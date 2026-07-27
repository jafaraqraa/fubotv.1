# Current RAG Baseline Document

This document records the exact state of the Retrieval-Augmented Generation (RAG) system in the FUThing platform prior to the Phase 10.2 Part 1 implementation.

## 1. Current Knowledge Source
The system uses a single plain text file as its knowledge source.

## 2. Current Knowledge-File Path
The knowledge file is located at `backend/knowledge.txt`.

## 3. Current Document-Loading Behavior
The file is loaded synchronously and on-demand whenever a query is processed. It reads the entire file in UTF-8 encoding using Node's `fs.readFileSync`.

## 4. Current Chunking Behavior
The file content is divided into chunks simply by splitting the text by double newlines (`\n\n`). Chunks are then trimmed, and any empty chunks are filtered out.

## 5. Current Chunk-Size Behavior
There is no explicit character or token size limit or configuration. The chunk size depends entirely on the formatting of the original `knowledge.txt` (how paragraphs or blocks are separated by double newlines).

## 6. Current Overlap Behavior
No overlap is applied between adjacent chunks. Chunks are strictly isolated.

## 7. Current Retrieval Algorithm
A simple keyword-overlap keyword matching algorithm is used for retrieval.

## 8. Current Keyword-Overlap Algorithm
- The query text is converted to lowercase and split by whitespace into words.
- Words with a length of 2 or fewer characters are filtered out.
- Each chunk is scanned for the occurrence of these query words.

## 9. Current Scoring Behavior
- Each chunk's score is computed as the total count of query words that occur in the chunk (case-insensitive).
- There is no TF-IDF, BM25, or semantic similarity mapping.

## 10. Current Context-Building Behavior
- Chunks with a score greater than zero are sorted descending by score.
- The top 3 chunks are selected.
- These chunks are joined by double newlines to form the retrieved context.

## 11. Current OpenRouter Integration
The final answer is generated using OpenRouter. If context is retrieved, a grounding prompt is appended to the system instructions, guiding the model to reply based only on the retrieved context, and apologizing if the information is not present.

## 12. Current System-Prompt Integration
The default system prompt is loaded from `backend/system_prompt.txt` or falls back to a hardcoded default Arabic customer assistant prompt. The retrieved context (if any) is appended to this system prompt.

## 13. Current AI Message Flow
1. User sends a message via Telegram, WhatsApp, Messenger, or Instagram.
2. The message is processed by the unified pipeline.
3. If AI is enabled, `getAIResponse(userId, userText)` in `backend/src/services/ai.js` is called.
4. `retrieveContext(userText)` is called to search `backend/knowledge.txt`.
5. If context is found, the system prompt is updated with instructions and context.
6. The conversation history is fetched and system instructions are injected.
7. OpenRouter API is called, and the response is returned to the user.

## 14. Current Settings Integration
The system prompt and model are configured through the administrative settings. The system prompt is stored in `backend/system_prompt.txt`, and other parameters like `OPENROUTER_MODEL` are stored in SQLite and loaded to `process.env`.

## 15. Current Frontend Knowledge-Management Behavior
The administrator can edit the raw text of `knowledge.txt` using a textarea inside the Settings Drawer under the "قاعدة المعرفة" (Knowledge Base) card. Saving this writes the contents back to the file via `POST /api/config/knowledge`.

## 16. Existing Strengths
- Extremely lightweight and low latency.
- No external runtime dependencies or database installations (fully self-contained).
- Safe and straightforward editing capability.

## 17. Existing Technical Limitations
- Synchronous file-reads on every message block the event loop for larger knowledge bases.
- High memory usage and poor scalability if the text file grows.
- Simple string searches ignore word variations, synonyms, diacritics, and Arabic grammar.

## 18. Existing Retrieval-Quality Limitations
- No semantic matching (e.g., searching for "تكلفة" won't match "سعر" unless explicitly written).
- No diacritic/punctuation normalization.
- Inability to handle complex or misspelled queries.

## 19. Existing Persistence Behavior
Persistent state is confined to raw file writes in `knowledge.txt` and `system_prompt.txt`. There is no indexing database or chunk storage.

## 20. Exact Integration Points for the New RAG System
- **`backend/src/services/ai.js`**: `retrieveContext` remains the entry point for retrieval, but will be enhanced to support vector database lookups or fallback gracefully.
- **`backend/src/routes/api.js`**: Reindexing and status endpoints will be added under `/api/v1/rag/*`.
- **`backend/src/services/settingsService.js`**: Will store new RAG configurations (`RAG_CHUNK_SIZE`, `RAG_CHUNK_OVERLAP`, `RAG_EMBEDDING_MODEL`, `QDRANT_COLLECTION`, etc.).
- **`frontend/public/dashboard.html`**: A new "نظام المعرفة والـ RAG" card and settings layout will be integrated.
