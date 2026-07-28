const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { initializeDatabase } = require('../src/database/initialize');
const { getLegacyTenantMigrationReport } = require('../src/rag/security/legacyTenantMigration');
const { getConfig } = require('../src/rag/config/ragConfig');

async function countQdrant(filter) {
    const headers = { 'Content-Type': 'application/json' };
    const apiKey = getConfig('QDRANT_API_KEY');
    if (apiKey) headers['api-key'] = apiKey;
    const response = await fetch(
        `${getConfig('QDRANT_URL')}/collections/${getConfig('QDRANT_COLLECTION')}/points/count`,
        {
            method: 'POST',
            headers,
            body: JSON.stringify({ exact: true, ...(filter ? { filter } : {}) })
        }
    );
    if (!response.ok) throw new Error(`Qdrant count failed with HTTP ${response.status}`);
    return (await response.json()).result?.count || 0;
}

async function main() {
    initializeDatabase();
    const sqlite = getLegacyTenantMigrationReport();
    const qdrantTotal = await countQdrant();
    const qdrantMissingTenantId = await countQdrant({
        must: [{ is_empty: { key: 'tenantId' } }]
    });
    const report = {
        generatedAt: new Date().toISOString(),
        sqlite,
        qdrant: { total: qdrantTotal, missingTenantId: qdrantMissingTenantId },
        safeToDeploy: Object.values(sqlite).every(value => value === 0) && qdrantMissingTenantId === 0,
        action: qdrantMissingTenantId
            ? 'Verify ownership, set RAG_LEGACY_TENANT_ID explicitly, then reindex each owned source. Unowned points stay inaccessible.'
            : 'No unowned Qdrant points detected.'
    };
    console.log(JSON.stringify(report, null, 2));
    require('../src/database/connection').close();
}

main().catch(error => {
    console.error(`[RAG Migration] Report failed: ${error.message}`);
    process.exitCode = 1;
});
