-- Migration 008: Add tables for synonyms and retrieval analytics tracking
CREATE TABLE IF NOT EXISTS rag_synonyms (
    word TEXT PRIMARY KEY,
    synonyms TEXT NOT NULL, -- JSON array of synonym strings
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS retrieval_analytics (
    id TEXT PRIMARY KEY,
    query TEXT NOT NULL,
    intent TEXT NOT NULL,
    selected_top_k INTEGER NOT NULL,
    latency INTEGER NOT NULL, -- wall latency in milliseconds
    confidence REAL, -- similarity or rerank confidence score
    chunk_ids TEXT, -- JSON array of retrieved chunk IDs
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed some default synonyms
INSERT OR IGNORE INTO rag_synonyms (word, synonyms) VALUES ('الدفع', '["السداد", "فيزا", "كاش", "دفع"]');
INSERT OR IGNORE INTO rag_synonyms (word, synonyms) VALUES ('الشحن', '["التوصيل", "توصيل", "شحن"]');
INSERT OR IGNORE INTO rag_synonyms (word, synonyms) VALUES ('الشراء', '["الطلب", "طلب", "شراء"]');
INSERT OR IGNORE INTO rag_synonyms (word, synonyms) VALUES ('الارجاع', '["الاسترجاع", "استرجاع", "ارجاع", "استبدال"]');
