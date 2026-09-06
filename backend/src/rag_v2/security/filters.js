'use strict';

function buildAuthorizationFilter({ tenantId, knowledgeBaseId, permissionIds = [], includeHistorical = false, documentVersionId = null, asOf = null }) {
    if (!tenantId || !knowledgeBaseId) { const e = new Error('tenantId and knowledgeBaseId are mandatory'); e.code = 'RAG_V2_SCOPE_REQUIRED'; throw e; }
    const must = [
        { key: 'tenant_id', match: { value: String(tenantId) } },
        { key: 'knowledge_base_id', match: { value: String(knowledgeBaseId) } },
        { key: 'status', match: { value: 'active' } }
    ];
    if (documentVersionId) must.push({ key: 'document_version_id', match: { value: String(documentVersionId) } });
    else if (!includeHistorical) must.push({ key: 'is_current', match: { value: true } });
    if (asOf) {
        must.push({ key: 'valid_from', range: { lte: asOf } });
        must.push({ should: [{ is_empty: { key: 'valid_to' } }, { key: 'valid_to', range: { gt: asOf } }] });
    }
    const should = [{ is_empty: { key: 'permissions' } }];
    for (const permission of [...new Set(permissionIds.map(String))]) should.push({ key: 'permissions', match: { any: [permission] } });
    // A nested filter in Qdrant treats `should` as at-least-one when no `must`
    // condition is present. Numeric `min_should` is not a valid sibling form.
    must.push({ should });
    return { must };
}

function assertAuthorizedCandidate(candidate, scope) {
    return String(candidate.tenantId) === String(scope.tenantId)
        && String(candidate.knowledgeBaseId) === String(scope.knowledgeBaseId)
        && candidate.status === 'active'
        && (scope.includeHistorical || candidate.isCurrent === true)
        && (!(candidate.permissions || []).length || candidate.permissions.some(p => (scope.permissionIds || []).map(String).includes(String(p))));
}

module.exports = { buildAuthorizationFilter, assertAuthorizedCandidate };
