import pytest
from app.embeddings.ollama_provider import OllamaEmbeddingProvider
from app.sparse.bm25_encoder import BM25SparseEncoder
from app.retrieval.qdrant_manager import QdrantIndexManager
from app.retrieval.hybrid_retriever import HybridRetriever

@pytest.mark.asyncio
async def test_hybrid_retrieval_and_tenant_isolation():
    embedder = OllamaEmbeddingProvider(expected_dim=768)
    sparse_encoder = BM25SparseEncoder()
    qdrant_mgr = QdrantIndexManager()

    retriever = HybridRetriever(
        embedding_provider=embedder,
        sparse_encoder=sparse_encoder,
        qdrant_manager=qdrant_mgr
    )

    test_chunks = [
        {
            "id": "c1",
            "tenant_id": "tenant_atlas",
            "document_id": "doc1",
            "document_version_id": "v1",
            "title": "Leave Policy",
            "section_title": "Annual Leave",
            "content": "Annual leave for full-time employees is 30 paid days per year.",
            "embedding_text": "Annual leave for full-time employees is 30 paid days per year.",
            "content_hash": "hash1",
            "document_status": "active"
        },
        {
            "id": "c2",
            "tenant_id": "tenant_other",  # Different tenant
            "document_id": "doc2",
            "document_version_id": "v1",
            "title": "Secret Policy",
            "section_title": "Annual Leave",
            "content": "Other tenant confidential data about 30 days leave.",
            "embedding_text": "Other tenant confidential data about 30 days leave.",
            "content_hash": "hash2",
            "document_status": "active"
        }
    ]

    candidates = await retriever.retrieve_candidates(
        collection_name="test_collection",
        query="كم عدد أيام الإجازة السنوية؟",
        tenant_id="tenant_atlas",
        in_memory_chunks=test_chunks
    )

    # Verify tenant isolation: only tenant_atlas returned
    assert len(candidates) == 1
    assert candidates[0].tenant_id == "tenant_atlas"
    assert candidates[0].chunk_id == "c1"
    assert candidates[0].rrf_score > 0.0
