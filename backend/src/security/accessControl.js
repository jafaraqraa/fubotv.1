const db = require('../database/connection');
const { normalizeTenantId } = require('../rag/security/tenantContext');

const ROLE_PERMISSIONS = Object.freeze({
    super_admin: ['*', 'system:manage'],
    admin: [
        'conversations:read', 'conversations:write', 'messages:send',
        'analytics:read', 'knowledge:read', 'knowledge:manage', 'integrations:manage',
        'ai:manage', 'settings:manage', 'errors:manage'
    ],
    manager: [
        'conversations:read', 'conversations:write', 'messages:send',
        'analytics:read', 'knowledge:read', 'knowledge:manage'
    ],
    agent: ['conversations:read', 'conversations:write', 'messages:send'],
    viewer: ['conversations:read', 'analytics:read', 'knowledge:read']
});

function getMemberships(administratorId) {
    return db.prepare(`
        SELECT at.tenant_id, at.role
        FROM administrator_tenants at
        JOIN tenants t ON t.id = at.tenant_id
        WHERE at.administrator_id = ? AND at.is_active = 1 AND t.is_active = 1
        ORDER BY at.tenant_id
    `).all(administratorId).map(row => ({
        tenantId: row.tenant_id,
        role: row.role,
        permissions: ROLE_PERMISSIONS[row.role] || []
    }));
}

function hasPermission(membership, permission) {
    return Boolean(membership && (
        membership.permissions.includes('*') || membership.permissions.includes(permission)
    ));
}

function requestedTenant(req) {
    return normalizeTenantId(
        req.headers['x-tenant-id'] || req.params?.tenantId
        || req.body?.tenantId || req.query?.tenantId
    );
}

function audit({ actorId = null, tenantId = null, action, resourceType = null,
    resourceId = null, outcome, metadata = null }) {
    try {
        db.prepare(`
            INSERT INTO security_audit_log
                (actor_id, tenant_id, action, resource_type, resource_id, outcome, metadata_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(actorId, tenantId, action, resourceType, resourceId, outcome,
            metadata ? JSON.stringify(metadata) : null);
    } catch (error) {
        console.error(`[Security Audit] Failed to persist event action=${action}: ${error.message}`);
    }
}

function attachAccessContext(req, res, next) {
    const memberships = getMemberships(req.session.userId);
    if (!memberships.length) {
        audit({ actorId: req.session.userId, action: 'tenant_access', outcome: 'denied' });
        return res.status(403).json({ success: false, error: 'No active tenant membership' });
    }

    const requested = requestedTenant(req);
    const membership = requested
        ? memberships.find(item => item.tenantId === requested)
        : (memberships.length === 1 ? memberships[0]
            : memberships.find(item => item.tenantId === req.session.tenantId));

    if (!membership) {
        audit({
            actorId: req.session.userId, tenantId: requested, action: 'tenant_access',
            outcome: 'denied'
        });
        return res.status(requested ? 403 : 400).json({
            success: false,
            error: requested ? 'Tenant access denied' : 'tenantId is required'
        });
    }

    req.access = { memberships, membership };
    req.tenantId = membership.tenantId;
    req.role = membership.role;
    req.session.tenantId = membership.tenantId;
    req.session.allowedTenantIds = memberships.map(item => item.tenantId);
    req.session.rolesByTenant = Object.fromEntries(
        memberships.map(item => [item.tenantId, item.role])
    );
    next();
}

function requirePermission(permission) {
    return (req, res, next) => {
        if (hasPermission(req.access?.membership, permission)) return next();
        audit({
            actorId: req.session?.userId, tenantId: req.tenantId,
            action: 'permission_denied', resourceType: permission, outcome: 'denied'
        });
        return res.status(403).json({ success: false, error: 'Permission denied' });
    };
}

module.exports = {
    ROLE_PERMISSIONS,
    getMemberships,
    hasPermission,
    requestedTenant,
    attachAccessContext,
    requirePermission,
    audit
};
