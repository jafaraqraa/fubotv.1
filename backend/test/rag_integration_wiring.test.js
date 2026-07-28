const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');

const projectRoot = path.join(__dirname, '..', '..');
const backendRoot = path.join(__dirname, '..');

test('RAG integration wiring contracts', async t => {
    await t.test('manual knowledge storage is tenant-scoped and canonical', () => {
        const previousRoot = process.env.RAG_TENANT_KNOWLEDGE_DIR;
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-knowledge-wiring-'));
        process.env.RAG_TENANT_KNOWLEDGE_DIR = root;
        const modulePath = require.resolve('../src/rag/storage/tenantKnowledgeStorage');
        delete require.cache[modulePath];
        const { getManualKnowledgePath } = require(modulePath);

        assert.strictEqual(
            getManualKnowledgePath('tenant-a'),
            path.join(root, 'tenant-a', 'knowledge.txt')
        );
        assert.notStrictEqual(
            getManualKnowledgePath('tenant-a'),
            getManualKnowledgePath('tenant-b')
        );
        assert.throws(
            () => getManualKnowledgePath('../tenant-b'),
            error => error.code === 'RAG_TENANT_REQUIRED'
        );

        if (previousRoot === undefined) delete process.env.RAG_TENANT_KNOWLEDGE_DIR;
        else process.env.RAG_TENANT_KNOWLEDGE_DIR = previousRoot;
        delete require.cache[modulePath];
    });

    await t.test('legacy default knowledge is never shared with another tenant', () => {
        const previousRoot = process.env.RAG_TENANT_KNOWLEDGE_DIR;
        delete process.env.RAG_TENANT_KNOWLEDGE_DIR;
        const modulePath = require.resolve('../src/rag/storage/tenantKnowledgeStorage');
        delete require.cache[modulePath];
        const { getManualKnowledgePath } = require(modulePath);

        const defaultPath = getManualKnowledgePath('default');
        const tenantAPath = getManualKnowledgePath('tenant-a');
        const tenantBPath = getManualKnowledgePath('tenant-b');
        assert.notStrictEqual(defaultPath, tenantAPath);
        assert.notStrictEqual(defaultPath, tenantBPath);
        assert.notStrictEqual(tenantAPath, tenantBPath);

        if (previousRoot !== undefined) process.env.RAG_TENANT_KNOWLEDGE_DIR = previousRoot;
        delete require.cache[modulePath];
    });

    await t.test('the indexer consumes the canonical tenant knowledge path', () => {
        const source = fs.readFileSync(
            path.join(backendRoot, 'src/rag/indexing/knowledgeIndexingService.js'),
            'utf8'
        );
        assert.match(source, /getManualKnowledgePath\(tenantId\)/);
        assert.doesNotMatch(
            source,
            /path\.join\(__dirname,\s*'\.\.',\s*'\.\.',\s*'\.\.',\s*DOCUMENT_ID\)/
        );
    });

    await t.test('playground passes its authorized tenant and request-scoped telemetry', () => {
        const source = fs.readFileSync(path.join(backendRoot, 'src/routes/api.js'), 'utf8');
        const playground = source.slice(
            source.indexOf("router.post('/rag/playground'"),
            source.indexOf('// GET /rag/source-types')
        );
        assert.match(playground, /tenantId:\s*req\.ragTenantId/);
        assert.match(playground, /retrievalTelemetry/);
        assert.doesNotMatch(playground, /getLastRetrievalProfiling/);
    });

    await t.test('request telemetry does not require the global last-result channel', async () => {
        const { retrieveContextAsync } = require('../src/services/knowledge');
        const first = {};
        const second = {};
        await Promise.all([
            retrieveContextAsync('', null, { tenantId: 'tenant-a', telemetry: first }),
            retrieveContextAsync('', null, { tenantId: 'tenant-b', telemetry: second })
        ]);
        assert.notStrictEqual(first, second);
        assert.strictEqual(first.mode, 'unavailable');
        assert.strictEqual(second.mode, 'unavailable');
        assert.notStrictEqual(first.metadata, second.metadata);
    });

    await t.test('scheduler uses the canonical configured tenant list including default', () => {
        const previousAdmin = process.env.RAG_ADMIN_TENANTS;
        const previousLegacy = process.env.RAG_LEGACY_TENANT_ID;
        delete process.env.RAG_ADMIN_TENANTS;
        delete process.env.RAG_LEGACY_TENANT_ID;
        const scheduler = require('../src/rag/services/ragReconciliationScheduler');
        assert.deepStrictEqual(scheduler.configuredTenants(), ['default']);

        if (previousAdmin !== undefined) process.env.RAG_ADMIN_TENANTS = previousAdmin;
        if (previousLegacy !== undefined) process.env.RAG_LEGACY_TENANT_ID = previousLegacy;
    });

    await t.test('manual save activates the new index and upload carries fallback auth', () => {
        const source = fs.readFileSync(
            path.join(projectRoot, 'frontend/public/js/dashboard/rag.js'),
            'utf8'
        );
        const save = source.slice(
            source.indexOf('saveManualKnowledge:'),
            source.indexOf('// L.')
        );
        assert.match(save, /\/api\/rag\/reindex/);
        assert.match(save, /reindexResult\.status !== 'active'/);

        const upload = source.slice(
            source.indexOf('handleFileUpload:'),
            source.indexOf('showVersioningModal:')
        );
        assert.match(upload, /xhr\.setRequestHeader\('X-Session-ID', sessionId\)/);
    });
});
