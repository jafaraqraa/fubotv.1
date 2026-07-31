const db = require('../connection');
const { requireTenantId } = require('../../rag/security/tenantContext');

/**
 * Inserts a new knowledge document metadata record into SQLite.
 */
function insertDocument(doc) {
    const tenantId = requireTenantId(doc.tenant_id, 'repository-insert-document');
    const stmt = db.prepare(`
        INSERT INTO knowledge_documents (
            document_key, original_name, display_name, source_type, mime_type,
            storage_name, storage_path, file_size, content_hash, extracted_text_hash,
            language, status, is_enabled, chunk_count, vector_count, index_fingerprint,
            version, tenant_id, logical_document_id, version_id, is_active,
            embedding_model, vector_dimension, cleanup_error, tenant_ownership_status,
            created_at, updated_at
        ) VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
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
        doc.version !== undefined ? doc.version : 1,
        tenantId,
        doc.logical_document_id || doc.document_key,
        doc.version_id || `${doc.document_key}:v${doc.version || 1}`,
        doc.is_active !== undefined ? doc.is_active : 1,
        doc.embedding_model || null,
        doc.vector_dimension || null,
        doc.cleanup_error || null,
        'verified'
    );

    return result.lastInsertRowid;
}

/**
 * Retrieves a document record by its original file name.
 */
function getDocumentByOriginalName(tenantId, name) {
    tenantId = requireTenantId(tenantId, 'repository-get-document-name');
    return db.prepare(`
        SELECT * FROM knowledge_documents
        WHERE original_name = ? AND tenant_id = ? AND is_active = 1 AND status != 'deleted'
        ORDER BY version DESC LIMIT 1
    `).get(name, tenantId);
}

/**
 * Updates an existing knowledge document metadata record.
 */
function updateDocument(tenantId, id, updates) {
    tenantId = requireTenantId(tenantId, 'repository-update-document');
    const keys = Object.keys(updates);
    if (keys.length === 0) return false;
    const allowedColumns = new Set([
        'display_name', 'status', 'is_enabled', 'indexing_status', 'indexing_error',
        'chunk_count', 'vector_count', 'index_fingerprint', 'indexed_at', 'disabled_at',
        'extracted_text_hash', 'version', 'version_id', 'is_active', 'embedding_model',
        'vector_dimension', 'cleanup_error', 'tenant_ownership_status',
        'reconciliation_status', 'reconciliation_error', 'fencing_token', 'operation_id',
        'storage_name', 'storage_path', 'file_size', 'content_hash', 'original_name',
        'source_type', 'mime_type'
    ]);
    const invalidKey = keys.find(key => !allowedColumns.has(key));
    if (invalidKey) {
        const error = new Error(`Unsupported knowledge document update field: ${invalidKey}`);
        error.code = 'INVALID_DOCUMENT_UPDATE_FIELD';
        throw error;
    }

    const setClauses = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => updates[k]);
    values.push(tenantId, id);

    const stmt = db.prepare(`
        UPDATE knowledge_documents
        SET ${setClauses}, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ? AND id = ?
    `);

    const result = stmt.run(...values);
    return result.changes > 0;
}

/**
 * Retrieves a document record by ID.
 */
function getDocumentById(tenantId, id) {
    tenantId = requireTenantId(tenantId, 'repository-get-document-id');
    return db.prepare('SELECT * FROM knowledge_documents WHERE tenant_id = ? AND id = ?').get(tenantId, id);
}

/**
 * Retrieves a document record by its unique key.
 */
function getDocumentByKey(tenantId, key) {
    tenantId = requireTenantId(tenantId, 'repository-get-document-key');
    return db.prepare('SELECT * FROM knowledge_documents WHERE tenant_id = ? AND document_key = ?').get(tenantId, key);
}

/**
 * Retrieves a document record by its original file bytes hash (content_hash).
 */
function getDocumentByContentHash(tenantId, hash) {
    tenantId = requireTenantId(tenantId, 'repository-get-content-hash');
    return db.prepare('SELECT * FROM knowledge_documents WHERE tenant_id = ? AND content_hash = ?').get(tenantId, hash);
}

/**
 * Retrieves a document record by its extracted text hash.
 */
function getDocumentByExtractedTextHash(tenantId, hash) {
    tenantId = requireTenantId(tenantId, 'repository-get-text-hash');
    return db.prepare('SELECT * FROM knowledge_documents WHERE tenant_id = ? AND extracted_text_hash = ?').get(tenantId, hash);
}

/**
 * Deletes a document record from SQLite by ID.
 */
function deleteDocument(tenantId, id) {
    tenantId = requireTenantId(tenantId, 'repository-delete-document');
    const result = db.prepare('DELETE FROM knowledge_documents WHERE tenant_id = ? AND id = ?').run(tenantId, id);
    return result.changes > 0;
}

/**
 * Helper to build filter criteria dynamically.
 */
function buildFilterQuery(filters) {
    const tenantId = requireTenantId(filters.tenantId, 'repository-list-documents');
    const clauses = ['tenant_id = ?'];
    const values = [tenantId];

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
    const page = Number.parseInt(filters.page || '1', 10);
    const limit = Number.parseInt(filters.limit || '10', 10);
    if (!Number.isSafeInteger(page) || page < 1) {
        const error = new Error('page must be a positive integer.');
        error.code = 'INVALID_PAGINATION';
        throw error;
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        const error = new Error('limit must be between 1 and 100.');
        error.code = 'INVALID_PAGINATION';
        throw error;
    }
    const offset = (page - 1) * limit;

    const { clauses, values } = buildFilterQuery(filters);
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const sql = `
        SELECT * FROM knowledge_documents
        ${whereSql}
        ORDER BY created_at DESC, id DESC
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
    throw new Error('tenantId is required; use listAllEnabledDocumentsForTenant().');
}

function listAllEnabledDocumentsForTenant(tenantId) {
    tenantId = requireTenantId(tenantId, 'repository-list-enabled-documents');
    return db.prepare(`
        SELECT * FROM knowledge_documents
        WHERE tenant_id = ? AND is_enabled = 1 AND is_active = 1
          AND status IN ('indexed', 'active', 'cleanup_pending')
    `).all(tenantId);
}

function listDocumentVersions(tenantId, logicalDocumentId) {
    tenantId = requireTenantId(tenantId, 'repository-list-document-versions');
    return db.prepare(`
        SELECT * FROM knowledge_documents
        WHERE tenant_id = ? AND logical_document_id = ?
        ORDER BY version DESC
    `).all(tenantId, logicalDocumentId);
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
    listAllEnabledDocumentsForTenant,
    getDocumentByOriginalName,
    listDocumentVersions
};
