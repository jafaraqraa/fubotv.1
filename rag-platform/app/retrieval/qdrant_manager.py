from qdrant_client import QdrantClient, models
from typing import List, Dict, Any, Optional
from app.core.config import settings

class QdrantIndexManager:
    def __init__(self, url: str = None, api_key: str = None):
        self.url = url or settings.QDRANT_URL
        self.api_key = api_key or settings.QDRANT_API_KEY
        self.client = QdrantClient(url=self.url, api_key=self.api_key if self.api_key else None)

    def ensure_collection(self, collection_name: str, dense_dim: int = 768):
        try:
            collections = [c.name for c in self.client.get_collections().collections]
            if collection_name not in collections:
                self.client.create_collection(
                    collection_name=collection_name,
                    vectors_config={
                        "dense": models.VectorParams(
                            size=dense_dim,
                            distance=models.Distance.COSINE
                        )
                    },
                    sparse_vectors_config={
                        "sparse": models.SparseVectorParams(
                            index=models.SparseIndexParams(on_disk=False)
                        )
                    }
                )
                indexed_fields = [
                    ("tenant_id", models.PayloadSchemaType.KEYWORD),
                    ("document_id", models.PayloadSchemaType.KEYWORD),
                    ("document_version_id", models.PayloadSchemaType.KEYWORD),
                    ("document_status", models.PayloadSchemaType.KEYWORD),
                    ("department", models.PayloadSchemaType.KEYWORD),
                    ("category", models.PayloadSchemaType.KEYWORD),
                    ("security_level", models.PayloadSchemaType.KEYWORD),
                    ("effective_from", models.PayloadSchemaType.FLOAT),
                    ("effective_until", models.PayloadSchemaType.FLOAT)
                ]
                for field_name, field_type in indexed_fields:
                    self.client.create_payload_index(
                        collection_name=collection_name,
                        field_name=field_name,
                        field_schema=field_type
                    )
        except Exception:
            pass

    def upsert_chunks(self, collection_name: str, points: List[Dict[str, Any]]):
        if not points:
            return

        qdrant_points = []
        for p in points:
            q_point = models.PointStruct(
                id=p["id"],
                vector={
                    "dense": p["dense_vector"],
                    "sparse": models.SparseVector(
                        indices=p["sparse_vector"]["indices"],
                        values=p["sparse_vector"]["values"]
                    )
                },
                payload=p["payload"]
            )
            qdrant_points.append(q_point)

        try:
            self.ensure_collection(collection_name, dense_dim=len(points[0]["dense_vector"]))
            self.client.upsert(collection_name=collection_name, points=qdrant_points)
        except Exception:
            pass

    def build_auth_filter(
        self,
        tenant_id: str,
        roles: List[str] = None,
        department: str = None,
        security_level: str = "internal",
        extra_filters: Dict[str, Any] = None
    ) -> models.Filter:
        must_conditions = [
            models.FieldCondition(key="tenant_id", match=models.MatchValue(value=tenant_id)),
            models.FieldCondition(key="document_status", match=models.MatchValue(value="active"))
        ]

        if department:
            must_conditions.append(
                models.FieldCondition(key="department", match=models.MatchValue(value=department))
            )

        if extra_filters:
            for k, v in extra_filters.items():
                if v is not None:
                    must_conditions.append(
                        models.FieldCondition(key=k, match=models.MatchValue(value=v))
                    )

        return models.Filter(must=must_conditions)

    def search_dense(
        self,
        collection_name: str,
        query_vector: List[float],
        query_filter: models.Filter,
        limit: int = 30
    ) -> List[Dict[str, Any]]:
        try:
            results = self.client.search(
                collection_name=collection_name,
                query_vector=("dense", query_vector),
                query_filter=query_filter,
                limit=limit
            )
            return [
                {
                    "id": str(r.id),
                    "score": r.score,
                    "payload": r.payload
                }
                for r in results
            ]
        except Exception:
            return []

    def search_sparse(
        self,
        collection_name: str,
        sparse_indices: List[int],
        sparse_values: List[float],
        query_filter: models.Filter,
        limit: int = 30
    ) -> List[Dict[str, Any]]:
        try:
            results = self.client.search(
                collection_name=collection_name,
                query_vector=models.NamedSparseVector(
                    name="sparse",
                    vector=models.SparseVector(indices=sparse_indices, values=sparse_values)
                ),
                query_filter=query_filter,
                limit=limit
            )
            return [
                {
                    "id": str(r.id),
                    "score": r.score,
                    "payload": r.payload
                }
                for r in results
            ]
        except Exception:
            return []
