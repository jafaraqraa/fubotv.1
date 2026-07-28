function normalizeTenantId(value) {
    if (typeof value !== 'string') return null;
    const tenantId = value.trim();
    if (!tenantId || tenantId.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(tenantId)) return null;
    return tenantId;
}

function configuredTenants() {
    const configured = [...new Set(
        String(process.env.RAG_ADMIN_TENANTS || process.env.RAG_LEGACY_TENANT_ID || '')
            .split(',')
            .map(normalizeTenantId)
            .filter(Boolean)
    )];
    // This installation ships with one explicitly named tenant. Authenticated
    // administrators are scoped to it unless deployment configuration supplies
    // a different/multi-tenant allowlist. This is server-side authorization,
    // never a tenant value derived from document or user content.
    return configured.length ? configured : ['default'];
}

function resolveAuthorizedTenant(req) {
    const sessionTenant = normalizeTenantId(req.session?.tenantId);
    const sessionTenants = Array.isArray(req.session?.allowedTenantIds)
        ? req.session.allowedTenantIds.map(normalizeTenantId).filter(Boolean)
        : [];
    const allowed = sessionTenant ? [sessionTenant] : (sessionTenants.length ? sessionTenants : configuredTenants());
    const requested = normalizeTenantId(
        req.headers['x-tenant-id'] || req.params?.tenantId || req.body?.tenantId || req.query?.tenantId
    );

    if (!allowed.length) {
        const error = new Error('لم يتم إعداد صلاحيات مستأجري RAG لهذا الحساب.');
        error.code = 'RAG_TENANT_NOT_CONFIGURED';
        throw error;
    }
    const tenantId = requested || (allowed.length === 1 ? allowed[0] : null);
    if (!tenantId) {
        const error = new Error('tenantId مطلوب عند إدارة أكثر من مستأجر.');
        error.code = 'RAG_TENANT_REQUIRED';
        throw error;
    }
    if (!allowed.includes(tenantId)) {
        const error = new Error('غير مصرح لهذا الحساب بالوصول إلى المستأجر المطلوب.');
        error.code = 'RAG_TENANT_FORBIDDEN';
        throw error;
    }
    return tenantId;
}

function requireRagTenant(req, res, next) {
    try {
        req.ragTenantId = resolveAuthorizedTenant(req);
        next();
    } catch (error) {
        console.warn(`[RAG Tenant] Unauthorized tenant access rejected operation=${req.method}:${req.path}`);
        res.status(error.code === 'RAG_TENANT_FORBIDDEN' ? 403 : 400).json({
            success: false,
            code: error.code,
            error: error.message
        });
    }
}

function requireTenantId(tenantId, operation) {
    const normalized = normalizeTenantId(tenantId);
    if (!normalized) {
        console.error(`[RAG Tenant] Missing tenantId. Operation aborted. operation=${operation}`);
        const error = new Error(`tenantId مطلوب لعملية RAG: ${operation}`);
        error.code = 'RAG_TENANT_REQUIRED';
        throw error;
    }
    return normalized;
}

module.exports = {
    normalizeTenantId,
    configuredTenants,
    resolveAuthorizedTenant,
    requireRagTenant,
    requireTenantId
};
