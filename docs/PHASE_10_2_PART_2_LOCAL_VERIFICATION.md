# PHASE 10.2 PART 2: LOCAL INFRASTRUCTURE & RAG END-TO-END VERIFICATION GUIDE

This document provides exact Ubuntu terminal commands and expected outcomes for the project owner to verify the **Advanced Hybrid RAG Foundation (Part 2)** running on their local Ubuntu machine where Ollama and Qdrant are hosted.

---

## 1. INFRASTRUCTURE HEALTH CHECKS

### A. Verify Ollama Service & Models
Ollama runs by default on port `11434`. Verify that Ollama is healthy and has `nomic-embed-text` installed.

```bash
# Check Ollama REST health API
curl -s http://127.0.0.1:11434/

# Expected Output:
# "Ollama is running"

# List locally installed models
curl -s http://127.0.0.1:11434/api/tags | jq .

# Expected Output (must include "nomic-embed-text"):
# {
#   "models": [
#     {
#       "name": "nomic-embed-text:latest",
#       ...
#     }
#   ]
# }
```

### B. Verify Qdrant Vector DB Status & Collections
Qdrant runs by default on port `6333` (HTTP REST). Verify that Qdrant is healthy and check if the `futhing_knowledge` collection exists.

```bash
# Check Qdrant ready API
curl -s http://127.0.0.1:6333/readyz

# Expected Output:
# "all systems operational"

# Check active collections
curl -s http://127.0.0.1:6333/collections | jq .

# Expected Output (should include "futhing_knowledge"):
# {
#   "result": {
#     "collections": [
#       { "name": "futhing_knowledge" }
#     ]
#   },
#   "status": "ok",
#   "time": 0.001
# }
```

---

## 2. REINDEXING & PAYLOAD VERIFICATION (800/120 ➔ 500/80)

Perform a Full Reindex from the administrative dashboard or via the API, and inspect Qdrant to confirm chunk parameters and Index Fingerprint behaviors.

### Step 1: Initial Indexing (Chunk Size 800, Overlap 120)
1. Open the **RAG settings drawer** in the administrative panel.
2. Set **Chunk Size (حجم المقطع)** to `800` and **Chunk Overlap (التداخل)** to `120`.
3. Click **Save Settings (حفظ الإعدادات)**.
4. Click **Full Reindex (إعادة فهرسة قاعدة المعرفة)** and wait for successful completion.

Now verify directly in Qdrant that payloads contain the correct parameters:

```bash
# Scroll/Query Qdrant points to see their payload structures
curl -s -X POST http://127.0.0.1:6333/collections/futhing_knowledge/points/scroll \
  -H "Content-Type: application/json" \
  -d '{"limit": 1, "with_payload": true}' | jq .

# Expected Payload snippet:
# {
#   "result": {
#     "points": [
#       {
#         "id": "...",
#         "payload": {
#           "chunkSize": 800,
#           "chunkOverlap": 120,
#           "source": "knowledge.txt",
#           ...
#         }
#       }
#     ]
#   }
# }
```

Record the **Index Fingerprint** displayed in the Status panel.

---

### Step 2: Parametric Change & Rebuild (Chunk Size 500, Overlap 80)
1. In the settings drawer, change **Chunk Size** to `500` and **Chunk Overlap** to `80`.
2. Click **Save Settings**.
3. Observe the system warning that settings have changed and a reindex is required.
4. Click **Full Reindex**.

Verify that:
- Old points (800 size) are cleanly deleted.
- New points (500 size) are generated and upserted.
- Total chunk count has changed appropriately.
- The **Index Fingerprint** in the Status section is updated to reflect the new parameters.

```bash
# Verify the active parameters in the Qdrant payload again
curl -s -X POST http://127.0.0.1:6333/collections/futhing_knowledge/points/scroll \
  -H "Content-Type: application/json" \
  -d '{"limit": 1, "with_payload": true}' | jq .

# Expected Payload snippet (must reflect the updated values):
# "chunkSize": 500
# "chunkOverlap": 80
```

---

## 3. REAL HYBRID RAG END-TO-END VERIFICATION

Test the system's responses by interacting through the real message path (e.g. Chat section, test question input, or connected platforms) and watch the server logs:

```bash
# Monitor the live backend server logs
tail -f backend/dev.log
# Or read logs directly from your console running the dev server
```

### Test Cases

#### A. Question: `ما طرق الدفع؟`
**Expected logs & actions:**
- Server logs `[RAG Mode] hybrid`.
- Ollama generates the query embedding using `nomic-embed-text`.
- Qdrant returns candidate points.
- Dynamic Top-K estimates a valid top-k value (e.g. `5`).
- Re-ranking sorts the relevant chunks (giving boosts to exact phrase matches like "طرق الدفع").
- Context builds within the maximum budget limit and is injected into the OpenRouter prompt.
- **Expected response:** AI lists the exact payment methods matching `knowledge.txt` (e.g., Credit Card, Cash on Delivery).

#### B. Question: `هل يمكن الدفع بالفيزا؟`
**Expected logs & actions:**
- Similar to above, `[RAG Mode] hybrid` is printed.
- Re-ranking applies coverage reward and matches relevant payment chunks.
- AI answers affirmatively based on physical facts in the knowledge base.

#### C. Question: `هل يوجد دفع عند الاستلام؟`
**Expected logs & actions:**
- Similar to above, `[RAG Mode] hybrid` is printed.
- AI confirms COD (الدفع عند الاستلام) is supported, matching the knowledge document exactly.

---

## 4. NO-RESULTS BEHAVIOR VERIFICATION

Ask a question that has absolutely no reference in the knowledge base (e.g., `ما هو وزن كوكب المشتري بالطن؟` or `هل تبيعون تذاكر طيران؟`).

**Expected logs & behavior:**
- Server executing retrieval will log `[RAG Mode] hybrid-no-results` because candidate scores fell below the similarity threshold (`0.40`).
- **Legacy fallback must NOT be activated** (since this is not a technical failure, just a no-result outcome).
- The assistant returns the controlled apologetic response:
  *"أعتذر منك بشدة، لا أملك هذه المعلومة حالياً. يرجى انتظار رد الإدارة يدوياً لخدمتك بشكل أفضل."*
- Confirm that the AI did not invent (hallucinate) any details.

---

## 5. TECHNICAL FALLBACK VERIFICATION

To verify the safety fallback mode under database infrastructure offline events:

1. Temporarily stop the Qdrant service on your machine:
   ```bash
   # If running via systemctl
   sudo systemctl stop qdrant
   # If running via Docker Compose / Docker
   docker stop qdrant
   ```
2. Send a user message (e.g., `ما طرق الدفع؟`).
3. Verify that the message pipeline **does not crash** and logs:
   ```text
   [RAG Mode] hybrid-failed - Error: Connect to 127.0.0.1:6333 failed
   [RAG Fallback] Activating legacy keyword retrieval
   [RAG Mode] legacy-fallback
   ```
4. Confirm that the AI still responds correctly based on the keyword-overlap scoring of `knowledge.txt`!
5. Restore the Qdrant service:
   ```bash
   # If running via systemctl
   sudo systemctl start qdrant
   # If running via Docker Compose / Docker
   docker start qdrant
   ```
6. Send the message again and confirm the system automatically recovers to:
   ```text
   [RAG Mode] hybrid
   ```

---

## 6. RESTART PERSISTENCE VERIFICATION

Verify settings and points survive server/service reboots:

1. Stop the backend/frontend servers cleanly (press `Ctrl+C` on `dev.js`).
2. Restart using the project start command:
   ```bash
   npm run dev
   ```
3. Open the dashboard Settings drawer and verify **Chunk Size remains 500** and **Chunk Overlap remains 80**.
4. Confirm that Qdrant retains all rebuilt points and the SQLite `rag_indexing_state` table holds the correct **Index Fingerprint**.
5. Ask `ما طرق الدفع؟` once more and verify the server logs `[RAG Mode] hybrid` successfully.
