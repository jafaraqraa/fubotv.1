const db = require('../connection');

const JSON_FIELDS = new Set([
    'retrieved_chunks_json', 'selected_context_chunk_ids_json',
    'claims_json', 'boundary_reasons_json'
]);

const ALLOWED_FIELDS = new Set([
    'message_id', 'tenant_id', 'conversation_id', 'route', 'intent',
    'retrieval_query', ...JSON_FIELDS, 'evidence_gate_decision',
    'evidence_gate_reason', 'raw_model_output', 'boundary_decision',
    'enforcement_active', 'fallback_source', 'final_response_type'
]);

function safeRawOutput(value) {
    if (value == null) return null;
    return String(value)
        .replace(/(?:sk|AIza|xox[baprs])-[-\w]{12,}/g, '[REDACTED]')
        .replace(/Bearer\s+[-\w.]+/gi, 'Bearer [REDACTED]');
}

function normalizeValue(key, value) {
    if (JSON_FIELDS.has(key)) return JSON.stringify(value ?? []);
    if (key === 'raw_model_output') return safeRawOutput(value);
    if (key === 'enforcement_active') return value == null ? null : (value ? 1 : 0);
    return value == null ? null : String(value);
}

function createTrace(input) {
    db.prepare(`
        INSERT INTO rag_request_traces (
            request_id, message_id, tenant_id, conversation_id,
            retrieval_query, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(
        String(input.requestId), input.messageId || null, String(input.tenantId),
        input.conversationId || null, input.retrievalQuery || null
    );
}

function updateTrace(requestId, changes) {
    const entries = Object.entries(changes || {}).filter(([key]) => ALLOWED_FIELDS.has(key));
    if (!entries.length) return false;
    const assignments = entries.map(([key]) => `${key} = ?`).join(', ');
    const values = entries.map(([key, value]) => normalizeValue(key, value));
    return db.prepare(`
        UPDATE rag_request_traces SET ${assignments}, updated_at = CURRENT_TIMESTAMP
        WHERE request_id = ?
    `).run(...values, String(requestId)).changes === 1;
}

function getTrace(requestId) {
    return db.prepare('SELECT * FROM rag_request_traces WHERE request_id = ?')
        .get(String(requestId));
}

module.exports = { createTrace, updateTrace, getTrace, safeRawOutput };
