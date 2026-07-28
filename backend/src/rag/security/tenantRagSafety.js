const disabledTenants = new Map();

function disableTenantRag(tenantId, reason) {
    disabledTenants.set(tenantId, { reason, disabledAt: new Date().toISOString() });
    console.error(`[RAG Reconcile] CRITICAL tenant RAG disabled tenant=${tenantId} reason=${reason}`);
}

function assertTenantRagEnabled(tenantId) {
    const state = disabledTenants.get(tenantId);
    if (!state) return;
    const error = new Error(`RAG is disabled for tenant ${tenantId} pending isolation review.`);
    error.code = 'RAG_TENANT_DISABLED';
    error.details = state;
    throw error;
}

function getTenantRagSafety(tenantId) {
    return disabledTenants.get(tenantId) || { disabled: false };
}

function resetForTests() {
    disabledTenants.clear();
}

module.exports = { disableTenantRag, assertTenantRagEnabled, getTenantRagSafety, resetForTests };
