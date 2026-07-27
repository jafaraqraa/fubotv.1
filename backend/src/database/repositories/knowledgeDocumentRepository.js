const db = require('../connection');

/**
 * Inserts a new knowledge document metadata record into SQLite.
 */
function insertDocument(doc) {
    const stmt = db.prepare(`
        INSERT INTO knowledge_documents (
            document_key, original_name, display_name, source_type, mime_type,
            storage_name, storage_path, file_size, content_hash, extracted_text_hash,
            language, status, is_enabled, chunk_count, vector_count, index_fingerprint,
            version, created_at, updated_at
        ) VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
    `);

    const result = stmt.run(
        doc.document_key,
        doc.original_name,
        doc.display_name,
        doc.source_type,
        doc.mime_type,
        doc.storage_name,
        doc.storage_path,
        doc.file_size,
        doc.content_hash,
        doc.extracted_text_hash,
        doc.language || 'ar',
        doc.status || 'uploaded',
        doc.is_enabled !== undefined ? doc.is_enabled : 1,
        doc.chunk_count || 0,
        doc.vector_count || 0,
        doc.index_fingerprint || null,
        doc.version !== undefined ? doc.version : 1
    );

    return result.lastInsertRowid;
}

/**
 * Retrieves a document record by its original file name.
 */
function getDocumentByOriginalName(name) {
    return db.prepare("SELECT * FROM knowledge_documents WHERE original_name = ? AND status != 'deleted' LIMIT 1").get(name);
}

/**
 * Updates an existing knowledge document metadata record.
 */
function updateDocument(id, updates) {
    const keys = Object.keys(updates);
    if (keys.length === 0) return false;

    const setClauses = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => updates[k]);
    values.push(id); // for WHERE clause

    const stmt = db.prepare(`
        UPDATE knowledge_documents
        SET ${setClauses}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `);

    const result = stmt.run(...values);
    return result.changes > 0;
}

/**
 * Retrieves a document record by ID.
 */
function getDocumentById(id) {
    return db.prepare('SELECT * FROM knowledge_documents WHERE id = ?').get(id);
}

/**
 * Retrieves a document record by its unique key.
 */
function getDocumentByKey(key) {
    return db.prepare('SELECT * FROM knowledge_documents WHERE document_key = ?').get(key);
}

/**
 * Retrieves a document record by its original file bytes hash (content_hash).
 */
function getDocumentByContentHash(hash) {
    return db.prepare('SELECT * FROM knowledge_documents WHERE content_hash = ?').get(hash);
}

/**
 * Retrieves a document record by its extracted text hash.
 */
function getDocumentByExtractedTextHash(hash) {
    return db.prepare('SELECT * FROM knowledge_documents WHERE extracted_text_hash = ?').get(hash);
}

/**
 * Deletes a document record from SQLite by ID.
 */
function deleteDocument(id) {
    const result = db.prepare('DELETE FROM knowledge_documents WHERE id = ?').run(id);
    return result.changes > 0;
}

/**
 * Helper to build filter criteria dynamically.
 */
function buildFilterQuery(filters) {
    const clauses = [];
    const values = [];

    if (filters.search) {
        clauses.push('(display_name LIKE ? OR original_name LIKE ?)');
        values.push(`%${filters.search}%`, `%${filters.search}%`);
    }
    if (filters.type) {
        clauses.push('source_type = ?');
        values.push(filters.type);
    }
    if (filters.status) {
        clauses.push('status = ?');
        values.push(filters.status);
    }
    if (filters.enabled !== undefined && filters.enabled !== null && filters.enabled !== '') {
        clauses.push('is_enabled = ?');
        values.push(filters.enabled === 'true' || filters.enabled === true || filters.enabled === 1 ? 1 : 0);
    }

    return { clauses, values };
}

/**
 * Lists document records with dynamic search, filtering, and pagination.
 */
function listDocuments(filters = {}) {
    const page = parseInt(filters.page || '1', 10);
    const limit = parseInt(filters.limit || '10', 10);
    const offset = (page - 1) * limit;

    const { clauses, values } = buildFilterQuery(filters);
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const sql = `
        SELECT * FROM knowledge_documents
        ${whereSql}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    `;

    const finalValues = [...values, limit, offset];
    return db.prepare(sql).all(...finalValues);
}

/**
 * Counts document records matching dynamic search and filtering criteria.
 */
function countDocuments(filters = {}) {
    const { clauses, values } = buildFilterQuery(filters);
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const sql = `
        SELECT COUNT(*) as total FROM knowledge_documents
        ${whereSql}
    `;

    const row = db.prepare(sql).get(...values);
    return row ? row.total : 0;
}

/**
 * Lists all active (enabled and successfully indexed) documents for query retrieval.
 */
function listAllEnabledDocuments() {
    return db.prepare("SELECT * FROM knowledge_documents WHERE is_enabled = 1 AND status = 'indexed'").all();
}

module.exports = {
    insertDocument,
    updateDocument,
    getDocumentById,
    getDocumentByKey,
    getDocumentByContentHash,
    getDocumentByExtractedTextHash,
    deleteDocument,
    listDocuments,
    countDocuments,
    listAllEnabledDocuments,
    getDocumentByOriginalName
};
