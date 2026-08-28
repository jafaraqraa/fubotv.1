const fs = require('node:fs');
const path = require('node:path');

async function mockDashboardApi(page, overrides = {}) {
    await page.route('**/socket.io/**', route => route.abort());
    await page.route('**/api/v1/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const endpoint = url.pathname.replace(/^\/api\/v1/, '');
        if (overrides[endpoint]) return overrides[endpoint](route, request);
        let body = { success: true };
        if (endpoint.includes('/auth/check')) body = { authenticated: true, success: true };
        else if (endpoint.includes('/analytics') || endpoint.includes('/stats')) body = { success: true, stats: {}, users: [], modelStats: [] };
        else if (endpoint.includes('/chat/users') || endpoint === '/users') body = { success: true, users: [] };
        else if (endpoint.includes('/errors')) body = [];
        else if (endpoint.includes('/settings')) body = { success: true, settings: {} };
        else if (endpoint.includes('/whatsapp/status')) body = { success: true, connected: true, status: 'connected' };
        else if (endpoint.includes('/providers/api-keys')) body = { success: true, keys: [], providers: [] };
        else if (endpoint.includes('/rag/health') || endpoint.includes('/rag/status')) body = { success: true, status: 'active' };
        else if (endpoint.includes('/rag/documents')) body = { success: true, documents: [], data: [] };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
}

async function openDashboard(page, sectionId = 'chat-section', overrides = {}) {
    await mockDashboardApi(page, overrides);
    await page.addInitScript(id => {
        if (!localStorage.getItem('futh_dashboard_active_section')) localStorage.setItem('futh_dashboard_active_section', id);
    }, sectionId);
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(350);
}

async function runAxe(page) {
    const axePath = require.resolve('axe-core/axe.min.js');
    await page.addScriptTag({ content: fs.readFileSync(axePath, 'utf8') });
    return page.evaluate(async () => window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
        resultTypes: ['violations']
    }));
}

module.exports = { mockDashboardApi, openDashboard, runAxe };
