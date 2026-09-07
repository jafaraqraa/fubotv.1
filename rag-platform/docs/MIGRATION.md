# Migration Plan from Legacy Monolith

1. Legacy system (`backend/server.js`) remains active on original port.
2. New standalone RAG platform runs as independent service (`rag-platform/`).
3. External clients (web apps, CRMs, WhatsApp/Telegram channels) point HTTP queries to `POST /v1/query`.
4. Legacy index documents are re-ingested using `/v1/documents` endpoint into SQLite/Qdrant.
