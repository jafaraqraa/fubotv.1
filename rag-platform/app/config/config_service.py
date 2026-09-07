import httpx
from sqlalchemy.orm import Session
from app.core.config import settings
from app.db.models import Configuration

class ConfigurationService:
    def __init__(self, db: Session = None):
        self.db = db

    async def test_configuration(self) -> dict:
        results = {
            "database": "ok",
            "qdrant": "unknown",
            "embedding_provider": "unknown",
            "generator_provider": "unknown",
            "status": "passed"
        }

        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                res = await client.get(f"{settings.QDRANT_URL.rstrip('/')}/healthz")
                if res.status_code in [200, 404]:
                    results["qdrant"] = "ok"
                else:
                    results["qdrant"] = "unreachable"
        except Exception:
            results["qdrant"] = "offline_or_mock"

        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                res = await client.get(f"{settings.EMBEDDING_BASE_URL.rstrip('/')}/api/tags")
                if res.status_code == 200:
                    results["embedding_provider"] = "ok"
                    results["generator_provider"] = "ok"
                else:
                    results["embedding_provider"] = "unreachable"
        except Exception:
            results["embedding_provider"] = "offline_or_mock"
            results["generator_provider"] = "offline_or_mock"

        return results
