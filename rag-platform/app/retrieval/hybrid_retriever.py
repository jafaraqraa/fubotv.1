import asyncio
from typing import List, Dict, Any
from pydantic import BaseModel
from app.embeddings.base import BaseEmbeddingProvider
from app.sparse.bm25_encoder import BM25SparseEncoder
from app.retrieval.qdrant_manager import QdrantIndexManager

class RetrievalCandidate(BaseModel):
    chunk_id: str
    tenant_id: str
    document_id: str
    document_version_id: str
    title: str
    section_title: str
    page_number: Any = None
    content: str
    embedding_text: str
    content_hash: str
    dense_score: float = 0.0
    dense_rank: int = 0
    sparse_score: float = 0.0
    sparse_rank: int = 0
    rrf_score: float = 0.0
    rerank_score: float = 0.0

class HybridRetriever:
    def __init__(
        self,
        embedding_provider: BaseEmbeddingProvider,
        sparse_encoder: BM25SparseEncoder,
        qdrant_manager: QdrantIndexManager,
        rrf_k: int = 60
    ):
        self.embedding_provider = embedding_provider
        self.sparse_encoder = sparse_encoder
        self.qdrant_manager = qdrant_manager
        self.rrf_k = rrf_k

    async def retrieve_candidates(
        self,
        collection_name: str,
        query: str,
        tenant_id: str,
        roles: List[str] = None,
        department: str = None,
        dense_k: int = 30,
        sparse_k: int = 30,
        in_memory_chunks: List[Dict[str, Any]] = None
    ) -> List[RetrievalCandidate]:
        # 1. Embed dense and sparse query
        dense_vec = await self.embedding_provider.embed_query(query)
        sparse_encoded = self.sparse_encoder.encode_text(query)

        # 2. Build pre-retrieval authorization filter
        qdrant_filter = self.qdrant_manager.build_auth_filter(
            tenant_id=tenant_id,
            roles=roles,
            department=department
        )

        candidates: Dict[str, RetrievalCandidate] = {}

        # 3. Query native Qdrant named dense vector search
        dense_hits = self.qdrant_manager.search_dense(
            collection_name=collection_name,
            query_vector=dense_vec,
            query_filter=qdrant_filter,
            limit=dense_k
        )
        for h in dense_hits:
            payload = h["payload"]
            cid = payload.get("chunk_id", h["id"])
            candidates[cid] = RetrievalCandidate(
                chunk_id=cid,
                tenant_id=payload.get("tenant_id", tenant_id),
                document_id=payload.get("document_id", ""),
                document_version_id=payload.get("document_version_id", ""),
                title=payload.get("title", ""),
                section_title=payload.get("section_title", ""),
                page_number=payload.get("page_number"),
                content=payload.get("content", ""),
                embedding_text=payload.get("embedding_text", ""),
                content_hash=payload.get("content_hash", ""),
                dense_score=h["score"]
            )

        # 4. Query native Qdrant named sparse vector search
        if sparse_encoded["indices"]:
            sparse_hits = self.qdrant_manager.search_sparse(
                collection_name=collection_name,
                sparse_indices=sparse_encoded["indices"],
                sparse_values=sparse_encoded["values"],
                query_filter=qdrant_filter,
                limit=sparse_k
            )
            for h in sparse_hits:
                payload = h["payload"]
                cid = payload.get("chunk_id", h["id"])
                if cid in candidates:
                    candidates[cid].sparse_score = h["score"]
                else:
                    candidates[cid] = RetrievalCandidate(
                        chunk_id=cid,
                        tenant_id=payload.get("tenant_id", tenant_id),
                        document_id=payload.get("document_id", ""),
                        document_version_id=payload.get("document_version_id", ""),
                        title=payload.get("title", ""),
                        section_title=payload.get("section_title", ""),
                        page_number=payload.get("page_number"),
                        content=payload.get("content", ""),
                        embedding_text=payload.get("embedding_text", ""),
                        content_hash=payload.get("content_hash", ""),
                        sparse_score=h["score"]
                    )

        # If Qdrant search returned no hits (e.g. offline testing fallback with in-memory chunks)
        if not candidates and in_memory_chunks:
            for chk in in_memory_chunks:
                if chk.get("tenant_id") != tenant_id:
                    continue
                if chk.get("document_status", "active") != "active":
                    continue

                c_id = chk["id"]
                content = chk["content"]
                title = chk.get("title", "")

                query_tokens = query.lower().split()
                matched_tokens = sum(1 for t in query_tokens if t in content.lower() or t in title.lower())
                lexical_score = matched_tokens / max(1, len(query_tokens))

                candidates[c_id] = RetrievalCandidate(
                    chunk_id=c_id,
                    tenant_id=chk["tenant_id"],
                    document_id=chk["document_id"],
                    document_version_id=chk["document_version_id"],
                    title=title,
                    section_title=chk.get("section_title", title),
                    page_number=chk.get("page_number"),
                    content=content,
                    embedding_text=chk.get("embedding_text", content),
                    content_hash=chk["content_hash"],
                    dense_score=0.5 + (0.4 * lexical_score),
                    sparse_score=lexical_score
                )

        # 5. Reciprocal Rank Fusion (RRF)
        dense_sorted = sorted(candidates.values(), key=lambda x: x.dense_score, reverse=True)
        sparse_sorted = sorted(candidates.values(), key=lambda x: x.sparse_score, reverse=True)

        for rank, item in enumerate(dense_sorted, start=1):
            item.dense_rank = rank
            item.rrf_score += 1.0 / (self.rrf_k + rank)

        for rank, item in enumerate(sparse_sorted, start=1):
            item.sparse_rank = rank
            item.rrf_score += 1.0 / (self.rrf_k + rank)

        # 6. Candidate Deduplication by content_hash
        fused_candidates = sorted(candidates.values(), key=lambda x: x.rrf_score, reverse=True)
        deduped: List[RetrievalCandidate] = []
        seen_hashes = set()

        for cand in fused_candidates:
            if cand.content_hash not in seen_hashes:
                seen_hashes.add(cand.content_hash)
                deduped.append(cand)

        return deduped
