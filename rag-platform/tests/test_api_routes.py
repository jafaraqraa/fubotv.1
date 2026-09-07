import pytest
import uuid
from fastapi.testclient import TestClient
from app.main import app
from app.db.session import init_db

client = TestClient(app)

@pytest.fixture(scope="module", autouse=True)
def setup_api_db():
    init_db()
    yield

def test_document_upload_list_and_delete():
    tenant_id = f"tenant_{uuid.uuid4().hex[:8]}"
    headers = {"X-Tenant-ID": tenant_id}

    # 1. Upload document
    files = {"file": ("handbook.txt", b"Company working hours are 8 AM to 4 PM.", "text/plain")}
    res = client.post("/v1/documents", headers=headers, files=files)
    assert res.status_code == 201
    data = res.json()
    assert data["status"] == "ready"
    doc_id = data["document_id"]

    # 2. List documents
    res_list = client.get("/v1/documents", headers=headers)
    assert res_list.status_code == 200
    docs = res_list.json()
    assert len(docs) == 1
    assert docs[0]["id"] == doc_id

    # 3. Query engine
    res_query = client.post(
        "/v1/query",
        headers=headers,
        json={"tenant_id": tenant_id, "query": "What are working hours?"}
    )
    assert res_query.status_code == 200
    q_out = res_query.json()
    assert q_out["status"] in ["answered", "insufficient_evidence"]
    assert "trace_id" in q_out

    # 4. Delete document
    res_del = client.delete(f"/v1/documents/{doc_id}", headers=headers)
    assert res_del.status_code == 200
    assert res_del.json()["status"] == "deleted"

def test_config_test_route():
    res = client.post("/v1/config/test")
    assert res.status_code == 200
    assert "database" in res.json()
