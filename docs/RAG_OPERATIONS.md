# RAG Infrastructure Operations Guide

This guide describes installation, operations, maintenance, and disaster recovery procedures for the FUThing Advanced Local RAG system.

## 1. Local Vector Database: Qdrant

### Installation & Launch with Docker
Run a localized, pinned, persistent Qdrant instance:

```bash
docker run -d -p 6333:6333 -p 6334:6334 \
  -v $(pwd)/qdrant_data:/qdrant/storage \
  --name futhing-qdrant \
  qdrant/qdrant:v1.9.0
```

### Port Configuration
- **HTTP API Port**: `6333` (used by backend REST calls).
- **gRPC Port**: `6334`.

### Persistence
The flag `-v $(pwd)/qdrant_data:/qdrant/storage` ensures that vector indexes and collection payloads survive docker container rebuilds, server reboots, and laptops shutting down.

### Managing Qdrant Container
- **Stop**: `docker stop futhing-qdrant`
- **Start**: `docker start futhing-qdrant`
- **Restart**: `docker restart futhing-qdrant`
- **Check Health**: `curl http://127.0.0.1:6333/readyz`

---

## 2. Local Embedding Provider: Ollama

### Installation & Launch
1. Download Ollama from the [official website](https://ollama.com).
2. Install the application for your operating system.
3. Start the Ollama background service (typically runs on `http://127.0.0.1:11434`).

### Fetching the Default Model
To pull the standard embedding model `nomic-embed-text`:

```bash
ollama pull nomic-embed-text
```

### Verification
Confirm that the model is fully installed and loaded:

```bash
curl http://127.0.0.1:11434/api/tags
```
Verify that `"nomic-embed-text"` appears in the returned JSON model list.

---

## 3. Starting the FUThing Project

Once Docker (Qdrant) and Ollama are launched, bootstrap the workspace:

```bash
# From repository root
npm run dev
```

The system will start, connect to SQLite, and automatically query vector services asynchronously. If available, status updates will show green. If offline, the backend outputs a non-blocking console log and falls back to legacy keyword retrieval.

---

## 4. Administrative Operations

### Checking Health & RAG Status
Administrators can check statuses directly inside the Admin Dashboard Settings under the **نظام المعرفة والـ RAG** card.
Or by sending an authenticated versioned HTTP GET call:

```bash
GET /api/v1/rag/status
Headers:
  Cookie: connect.sid=<session_id>
```

### Triggering Reindexing
To parse `knowledge.txt` and synchronize vector collections:
1. Open the settings drawer for **نظام المعرفة والـ RAG**.
2. Scroll to Section 5: **إدارة فهرس المعرفة**.
3. Click the blue button: **إعادة فهرسة قاعدة المعرفة**.
4. Or trigger via authenticated POST REST call:

```bash
POST /api/v1/rag/reindex
Headers:
  Cookie: connect.sid=<session_id>
  X-CSRF-Token: <csrf_token>
```

---

## 5. Troubleshooting & Error Recovery

### 1. Qdrant Unreachable
- **Symptom**: "تعذر الاتصال بقاعدة البيانات المتجهية Qdrant." Toast or log.
- **Remedy**: Verify if the Docker container is running (`docker ps`). Start it if stopped (`docker start futhing-qdrant`). Check port conflicts.

### 2. Ollama Offline
- **Symptom**: "تعذر الاتصال بخدمة Ollama المحلية."
- **Remedy**: Launch the Ollama desktop application or run `ollama serve` in a shell.

### 3. Model Missing
- **Symptom**: "نموذج التضمين المحدد غير متوفر في Ollama."
- **Remedy**: Run `ollama pull nomic-embed-text`.

### 4. Vector Dimension Conflict
- **Symptom**: "تعذر المتابعة: حجم المتجه في المجموعة الحالية غير متوافق..."
- **Remedy**: This occurs if you swap the embedding model but keep the same collection name.
  1. Delete the collection in Qdrant:
     `curl -X DELETE http://127.0.0.1:6333/collections/futhing_knowledge`
  2. Change collection name in settings.
  3. Re-trigger reindexing to let Qdrant rebuild with the new model dimensions.

### 5. Custom Chunking Modification
You can safely edit parameters `RAG_CHUNK_SIZE` and `RAG_CHUNK_OVERLAP` in the dashboard settings drawer. Saving these does not overwrite the index. Click **إعادة فهرسة** to make changes effective.

### 6. Rollback to Legacy Fallback
If local vector databases are completely corrupted, ensure `RAG_LEGACY_FALLBACK` is enabled in RAG settings (set to true). The system will automatically handle all queries using the lightweight, double-newline keyword overlap scorer without any customer interruption.
