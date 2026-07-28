const db = require('../../database/connection');
const { normalizeTenantId } = require('./tenantContext');

function tableCount(table, where = '1=1') {
    return db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get().count;
}

function getLegacyTenantMigrationReport() {
    return {
        documentsUnverified: tableCount('knowledge_documents', "tenant_ownership_status != 'verified'"),
        indexStatesUnverified: tableCount('rag_indexing_state', "tenant_ownership_status != 'verified'"),
        retrievalLogsUnowned: tableCount('retrieval_analytics', "tenant_id IS NULL OR tenant_ownership_status != 'verified'")
    };
}

function applyExplicitLegacyTenantMigration() {
    const before = getLegacyTenantMigrationReport();
    const total = Object.values(before).reduce((sum, value) => sum + value, 0);
    if (!total) return { before, after: before, migrated: false };

    const tenantId = normalizeTenantId(process.env.RAG_LEGACY_TENANT_ID);
    if (!tenantId) {
        const message = `[RAG Migration] Ambiguous legacy ownership detected: ${JSON.stringify(before)}. Set RAG_LEGACY_TENANT_ID explicitly after verifying ownership.`;
        if (process.env.NODE_ENV === 'production') {
            const error = new Error(message);
            error.code = 'RAG_LEGACY_OWNERSHIP_AMBIGUOUS';
            throw error;
        }
        console.warn(message);
        return { before, after: before, migrated: false, blocked: true };
    }

    require('../runtime/distributedLockService').withSynchronousLease({
        tenantId: 'global',
        resourceType: 'migration',
        resourceId: 'legacy_tenant_ownership',
        operation: 'legacy_tenant_migration'
    }, lease => db.transaction(() => {
        lease.assertOwnership();
        db.prepare(`
            UPDATE knowledge_documents
            SET tenant_id = ?, tenant_ownership_status = 'verified'
            WHERE tenant_ownership_status != 'verified'
        `).run(tenantId);
        db.prepare(`
            UPDATE rag_indexing_state
            SET tenant_id = ?, tenant_ownership_status = 'verified'
            WHERE tenant_ownership_status != 'verified'
        `).run(tenantId);
        db.prepare(`
            UPDATE retrieval_analytics
            SET tenant_id = ?, tenant_ownership_status = 'verified'
            WHERE tenant_id IS NULL OR tenant_ownership_status != 'verified'
        `).run(tenantId);
        for (const [resourceType, count] of Object.entries(before)) {
            if (!count) continue;
            db.prepare(`
                INSERT INTO rag_tenant_migration_audit (
                    resource_type, resource_id, previous_tenant_id,
                    assigned_tenant_id, status, details
                ) VALUES (?, '*', NULL, ?, 'verified', ?)
            `).run(resourceType, tenantId, JSON.stringify({ count }));
        }
    })());

    const after = getLegacyTenantMigrationReport();
    console.log(`[RAG Migration] Explicit legacy ownership migration completed tenant=${tenantId} before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
    console.warn('[RAG Migration] SQLite ownership migrated. Legacy Qdrant points without tenantId remain inaccessible and must be reindexed for this tenant.');
    return { before, after, migrated: true, tenantId };
}

async function assertQdrantTenantOwnershipSafe() {
    try {
        const { countPoints } = require('../vector/qdrantVectorStore');
        const missingTenantId = await countPoints({
            must: [{ is_empty: { key: 'tenantId' } }]
        });
        if (!missingTenantId) return { missingTenantId: 0 };
        const message = `[RAG Migration] Qdrant contains ${missingTenantId} unowned point(s). Reindex them through an explicitly configured tenant before production startup.`;
        if (process.env.NODE_ENV === 'production') {
            const error = new Error(message);
            error.code = 'RAG_QDRANT_OWNERSHIP_AMBIGUOUS';
            throw error;
        }
        console.warn(message);
        return { missingTenantId, blocked: true };
    } catch (error) {
        if (error.code === 'RAG_QDRANT_OWNERSHIP_AMBIGUOUS') throw error;
        if (process.env.NODE_ENV === 'production') {
            const wrapped = new Error(`[RAG Migration] Unable to verify Qdrant tenant ownership: ${error.message}`);
            wrapped.code = 'RAG_QDRANT_AUDIT_FAILED';
            throw wrapped;
        }
        console.warn(`[RAG Migration] Qdrant ownership audit unavailable: ${error.message}`);
        return { unavailable: true };
    }
}

module.exports = {
    getLegacyTenantMigrationReport,
    applyExplicitLegacyTenantMigration,
    assertQdrantTenantOwnershipSafe
};
