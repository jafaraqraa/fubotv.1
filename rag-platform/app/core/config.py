import os
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    APP_NAME: str = "Standalone RAG Platform"
    APP_ENV: str = "development"
    APP_HOST: str = "0.0.0.0"
    APP_PORT: int = 8000
    APP_SECRET_KEY: str = "change-me-in-production"
    RAG_DEBUG: bool = False

    DATABASE_URL: str = "sqlite:///./rag_platform.db"
    SQLITE_WAL_MODE: bool = True
    SQLITE_BUSY_TIMEOUT_MS: int = 5000

    QDRANT_URL: str = "http://localhost:6333"
    QDRANT_API_KEY: str = ""
    QDRANT_COLLECTION_PREFIX: str = "rag"

    EMBEDDING_PROVIDER: str = "ollama"
    EMBEDDING_MODEL: str = "nomic-embed-text"
    EMBEDDING_DIMENSION: int = 768
    EMBEDDING_BASE_URL: str = "http://localhost:11434"

    SPARSE_PROVIDER: str = "bm25"
    SPARSE_MODEL: str = "bm25_standard"

    RERANKER_PROVIDER: str = "cross_encoder"
    RERANKER_MODEL: str = "bge-reranker-base"

    GENERATOR_PROVIDER: str = "ollama"
    GENERATOR_MODEL: str = "llama3.2:1b"
    GENERATOR_BASE_URL: str = "http://localhost:11434"
    GENERATOR_TEMPERATURE: float = 0.1

    OPENROUTER_API_KEY: str = ""
    OPENAI_API_KEY: str = ""

    DENSE_PREFETCH_K: int = 30
    SPARSE_PREFETCH_K: int = 30
    RRF_K: int = 60
    RERANK_CANDIDATE_K: int = 20
    FINAL_EVIDENCE_K: int = 6

    MAX_CONTEXT_TOKENS: int = 3000
    RESERVED_ANSWER_TOKENS: int = 1000

    MIN_RERANKER_SCORE: float = 0.35
    MIN_RELEVANCE_MARGIN: float = 0.05
    EVIDENCE_GATE_ENABLED: bool = True

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()
