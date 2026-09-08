from app.core.config import settings
from app.embeddings.ollama_provider import OllamaEmbeddingProvider
from app.embeddings.openrouter_provider import OpenRouterEmbeddingProvider
import hashlib

def embedding_collection_name(provider: str, model: str) -> str:
    identity = f"{provider.strip().lower()}:{model.strip().lower()}"
    return f"rag_v1_{hashlib.sha256(identity.encode()).hexdigest()[:12]}"

def create_embedding_provider(provider: str = None, model: str = None, api_key: str = None):
    provider_name = (provider or settings.EMBEDDING_PROVIDER).strip().lower()
    model_name = (model or settings.EMBEDDING_MODEL).strip()
    if provider_name == "openrouter":
        return OpenRouterEmbeddingProvider(api_key or settings.OPENROUTER_API_KEY, model_name)
    if provider_name == "ollama":
        return OllamaEmbeddingProvider(
            base_url=settings.EMBEDDING_BASE_URL,
            model=model_name,
            expected_dim=settings.EMBEDDING_DIMENSION
        )
    raise ValueError(f"Unsupported embedding provider: {provider_name}")
