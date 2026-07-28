const path = require('path');
const { requireTenantId } = require('../security/tenantContext');

function getManualKnowledgePath(tenantId) {
    const normalizedTenantId = requireTenantId(tenantId, 'manual-knowledge-path');
    const configuredRoot = String(process.env.RAG_TENANT_KNOWLEDGE_DIR || '').trim();

    if (!configuredRoot) {
        // Preserve the existing single-tenant installation without allowing any
        // additional tenant to share its legacy source file.
        if (normalizedTenantId === 'default') {
            return path.join(__dirname, '..', '..', '..', 'knowledge.txt');
        }
        return path.join(
            __dirname,
            '..',
            '..',
            '..',
            'data',
            'rag-tenants',
            normalizedTenantId,
            'knowledge.txt'
        );
    }

    const root = path.resolve(configuredRoot);
    const tenantDirectory = path.resolve(root, normalizedTenantId);
    if (tenantDirectory !== root && !tenantDirectory.startsWith(`${root}${path.sep}`)) {
        const error = new Error('مسار تخزين معرفة المستأجر غير صالح.');
        error.code = 'RAG_TENANT_STORAGE_PATH_INVALID';
        throw error;
    }
    return path.join(tenantDirectory, 'knowledge.txt');
}

module.exports = { getManualKnowledgePath };
