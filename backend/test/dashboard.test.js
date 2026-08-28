const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
process.env.SESSION_SECRET = 'dashboard_test_session_secret_32_characters';

// Load App for server-based integration checks
const app = require('../src/app');

test('Dashboard Structure and Static Assets Suite', async (t) => {
    // Start temporary test server on an auto-allocated random open port
    const server = app.listen(0);
    const port = server.address().port;
    const baseUrl = `http://localhost:${port}`;

    // Clean up server after tests
    t.after(() => {
        server.close();
    });

    await t.test('1. Check required frontend files exist', () => {
        const dashboardHtmlPath = path.join(__dirname, '..', '..', 'frontend', 'public', 'dashboard.html');
        const loginHtmlPath = path.join(__dirname, '..', '..', 'frontend', 'public', 'login.html');
        const dashboardCssPath = path.join(__dirname, '..', '..', 'frontend', 'public', 'css', 'dashboard.css');
        const mainJsPath = path.join(__dirname, '..', '..', 'frontend', 'public', 'js', 'dashboard', 'main.js');

        assert.strictEqual(fs.existsSync(dashboardHtmlPath), true, 'dashboard.html must exist');
        assert.strictEqual(fs.existsSync(loginHtmlPath), true, 'login.html must exist');
        assert.strictEqual(fs.existsSync(dashboardCssPath), true, 'dashboard.css must exist');
        assert.strictEqual(fs.existsSync(mainJsPath), true, 'main.js must exist');
    });

    await t.test('2. Verify all modular JavaScript files exist', () => {
        const modules = [
            'state.js', 'utils.js', 'api.js', 'auth.js', 'navigation.js',
            'users.js', 'chat.js', 'composer.js', 'conversationControls.js',
            'analyticsApi.js', 'analyticsStore.js', 'analyticsDashboard.js',
            'errors.js', 'whatsapp.js', 'settings.js',
            'aimodels.js', 'main.js'
        ];

        modules.forEach(file => {
            const filepath = path.join(__dirname, '..', '..', 'frontend', 'public', 'js', 'dashboard', file);
            assert.strictEqual(fs.existsSync(filepath), true, `${file} must exist`);
        });
    });

    await t.test('3. Verify Dashboard HTML configuration (RTL and Arabic UI)', () => {
        const dashboardHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'public', 'dashboard.html'), 'utf8');

        // Assert RTL layout direction
        assert.match(dashboardHtml, /dir="rtl"/, 'Dashboard must have RTL direction configure');
        assert.match(dashboardHtml, /lang="ar"/, 'Dashboard must have Arabic lang configure');

        // Assert critical labels
        assert.match(dashboardHtml, /لوحة التحكم والدعم الفني/, 'Arabic title must be preserved');
        assert.match(dashboardHtml, /الدعم والدردشة/, 'Arabic navigation item must be preserved');
        assert.match(dashboardHtml, /تتبع الأعطال/, 'Arabic navigation item must be preserved');
        assert.match(dashboardHtml, /تحليلات الأداء/, 'Arabic navigation item must be preserved');
    });

    await t.test('4. Verify presence of critical element IDs in dashboard.html', () => {
        const dashboardHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'public', 'dashboard.html'), 'utf8');

        const criticalIds = [
            'page-title', 'badge-errors-count', 'badge-wa-status', 'users-list',
            'current-chat-user', 'current-chat-id', 'chat-assignee-select',
            'assignee-container', 'chat-box', 'media-preview-container',
            'media-filename', 'media-upload-input', 'canned-responses-overlay',
            'direct-msg-input', 'send-btn', 'errors-table-body',
            'platformChart', 'messageChart', 'wa-connection-badge', 'wa-qr-container',
            'wa-logout-btn', 'knowledge-input', 'confirm-modal'
        ];

        criticalIds.forEach(id => {
            assert.match(dashboardHtml, new RegExp(`id="${id}"`), `ID "${id}" must exist in dashboard.html`);
        });
    });

    await t.test('5. Verify script dependency references in dashboard.html', () => {
        const dashboardHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'public', 'dashboard.html'), 'utf8');

        const scripts = [
            '/js/dashboard/state.js',
            '/js/dashboard/utils.js',
            '/js/dashboard/api.js',
            '/js/dashboard/auth.js',
            '/js/dashboard/navigation.js',
            '/js/dashboard/users.js',
            '/js/dashboard/chat.js',
            '/js/dashboard/composer.js',
            '/js/dashboard/conversationControls.js',
            '/js/dashboard/analyticsApi.js',
            '/js/dashboard/analyticsStore.js',
            '/js/dashboard/analyticsDashboard.js',
            '/js/dashboard/errors.js',
            '/js/dashboard/whatsapp.js',
            '/js/dashboard/settings.js',
            '/js/dashboard/aimodels.js',
            '/js/dashboard/main.js'
        ];

        scripts.forEach(script => {
            const escaped = script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            assert.match(
                dashboardHtml,
                new RegExp(`src="${escaped}(?:\\?[^"]*)?"`),
                `Script reference to "${script}" must exist`
            );
        });
    });

    await t.test('6. Verify no hardcoded secrets or hashes exist in the frontend files', () => {
        const jsDir = path.join(__dirname, '..', '..', 'frontend', 'public', 'js', 'dashboard');
        const files = fs.readdirSync(jsDir);

        files.forEach(file => {
            const content = fs.readFileSync(path.join(jsDir, file), 'utf8');
            assert.strictEqual(content.includes('process.env.SESSION_SECRET'), false, 'Server session secrets should not exist in frontend files');
            assert.strictEqual(content.includes('Admin@123456'), false, 'Admin plaintext default passwords should not exist in frontend files');
            assert.match(content, /^(?!.*\$2[ayb]\$\d+\$[./0-9A-Za-z]{53}).*$/s, 'No bcrypt hashes should exist in frontend files');
        });
    });

    await t.test('7. Verify protected routing behavior for dashboard via native fetch', async () => {
        // Unauthenticated access to /dashboard.html should redirect to /login (Express returns 302 to redirect)
        const resHtml = await fetch(`${baseUrl}/dashboard.html`, { redirect: 'manual' });
        assert.strictEqual(resHtml.status, 302, 'Should return 302 status for unauthenticated layout request');
        assert.strictEqual(resHtml.headers.get('location'), '/login', 'Should redirect to /login');

        // Unauthenticated access to /api/* with JSON Accept header should yield 401 Unauthorized
        const resApi = await fetch(`${baseUrl}/api/stats`, {
            headers: { 'Accept': 'application/json' }
        });
        assert.strictEqual(resApi.status, 401, 'Unauthenticated API access must return 401 status');
        const bodyApi = await resApi.json();
        assert.strictEqual(bodyApi.success, false, 'API response success flag must be false');
    });

    await t.test('8. Verify public Meta webhooks remain accessible and unaffected by session auth', async () => {
        // Querying the Meta webhook verification route with invalid credentials
        const resWebhook = await fetch(`${baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=invalid_token`);
        assert.strictEqual(resWebhook.status, 403, 'Public meta webhook route should evaluate to 403 Forbidden with invalid verify token');
    });
});
