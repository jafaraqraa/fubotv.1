const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const AUDIT_QUERIES = Object.freeze({
    orphanMessages: `
        SELECT m.id FROM messages m
        LEFT JOIN conversations c ON c.id = m.conversation_id
        WHERE c.id IS NULL
    `,
    mismatchedMessageScope: `
        SELECT m.id FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE m.tenant_id <> c.tenant_id OR m.channel <> c.channel
    `,
    mismatchedConversationScope: `
        SELECT c.id FROM conversations c
        LEFT JOIN channel_accounts ca ON ca.id = c.channel_account_id
        WHERE ca.id IS NULL OR ca.customer_id <> c.customer_id OR ca.channel <> c.channel
    `,
    duplicateExternalMessages: `
        SELECT tenant_id || ':' || channel || ':' || external_message_id AS id
        FROM messages
        WHERE external_message_id IS NOT NULL
        GROUP BY tenant_id, channel, external_message_id
        HAVING COUNT(*) > 1
    `,
    duplicateActiveDocuments: `
        SELECT tenant_id || ':' || logical_document_id AS id
        FROM knowledge_documents
        WHERE is_active = 1
        GROUP BY tenant_id, logical_document_id
        HAVING COUNT(*) > 1
    `,
    malformedMessageMetadata: `
        SELECT id FROM messages
        WHERE metadata IS NOT NULL AND json_valid(metadata) = 0
    `,
    malformedApiKeyJson: `
        SELECT id FROM api_keys
        WHERE (capabilities IS NOT NULL AND json_valid(capabilities) = 0)
           OR (source IS NOT NULL AND json_valid(source) = 0)
    `,
    invalidConversationTimestamp: `
        SELECT id FROM conversations WHERE datetime(last_message_at) IS NULL
    `,
    impossibleMessageStatus: `
        SELECT id FROM messages
        WHERE delivery_status NOT IN ('pending','sending','sent','delivered','failed','read')
    `
});

function runIntegrityAudit(db, { sampleLimit = 20 } = {}) {
    const report = {
        generatedAt: new Date().toISOString(),
        foreignKeysEnabled: db.pragma('foreign_keys', { simple: true }) === 1,
        integrityCheck: db.pragma('integrity_check').map(row => Object.values(row)[0]),
        foreignKeyViolations: db.pragma('foreign_key_check'),
        checks: {}
    };

    for (const [name, sql] of Object.entries(AUDIT_QUERIES)) {
        const count = db.prepare(`SELECT COUNT(*) AS count FROM (${sql})`).get().count;
        const ids = db.prepare(`${sql} LIMIT ?`).all(sampleLimit).map(row => row.id);
        report.checks[name] = { count, ids };
    }

    report.ok = report.foreignKeysEnabled
        && report.integrityCheck.length === 1
        && report.integrityCheck[0] === 'ok'
        && report.foreignKeyViolations.length === 0
        && Object.values(report.checks).every(check => check.count === 0);
    return report;
}

async function createVerifiedBackup(db, destination) {
    const resolved = path.resolve(destination);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    if (fs.existsSync(resolved)) {
        const error = new Error(`Backup destination already exists: ${resolved}`);
        error.code = 'BACKUP_EXISTS';
        throw error;
    }
    await db.backup(resolved);
    const restored = new Database(resolved, { readonly: true, fileMustExist: true });
    try {
        restored.pragma('foreign_keys = ON');
        const verification = runIntegrityAudit(restored);
        const structurallyValid = verification.foreignKeysEnabled
            && verification.integrityCheck.length === 1
            && verification.integrityCheck[0] === 'ok'
            && verification.foreignKeyViolations.length === 0;
        if (!structurallyValid) {
            const error = new Error('Backup verification failed.');
            error.code = 'BACKUP_VERIFICATION_FAILED';
            error.verification = verification;
            throw error;
        }
        return { path: resolved, verification };
    } finally {
        restored.close();
    }
}

module.exports = {
    AUDIT_QUERIES,
    runIntegrityAudit,
    createVerifiedBackup
};
