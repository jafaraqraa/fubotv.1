# Configuration Guide

## Configuration Precedence
1. Tenant Database Configuration Table (`configurations`)
2. Environment Variables (`.env`)
3. Code Application Defaults (`app/core/config.py`)

## Core Environment Variables
- `DATABASE_URL`: SQLite connection string (`sqlite:///./rag_platform.db`)
- `SQLITE_WAL_MODE`: Enable Write-Ahead Logging (`true`)
- `SQLITE_BUSY_TIMEOUT_MS`: Lock retry timeout (`5000`)
- `QDRANT_URL`: Qdrant endpoint (`http://localhost:6333`)
- `EMBEDDING_PROVIDER`: Dense embedding provider (`ollama` or `openai`)
- `EMBEDDING_MODEL`: Embedding model name (`nomic-embed-text`)
- `EMBEDDING_DIMENSION`: Vector dimensionality (`768`)
- `GENERATOR_PROVIDER`: Generator provider (`ollama` or `openai`)
- `GENERATOR_MODEL`: Generator model (`llama3.2:1b`)
- `MIN_RERANKER_SCORE`: Evidence gate threshold (`0.35`)
