const { test, expect } = require('@playwright/test');
const { openDashboard, runAxe } = require('./helpers');

const sections = [
    'chat-section', 'errors-section', 'analytics-section', 'whatsapp-section',
    'rag-section', 'aimodels-section', 'usage-section', 'settings-section'
];

const overrides = {
    '/errors': route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
            {
                id: 1, date: '2026-08-28', time: '14:30', type: 'STARTUP_FAILED', solved: false,
                message: 'listen EADDRINUSE: address already in use :::3001'
            },
            {
                id: 2, date: '2026-08-28', time: '13:10', type: 'OPENROUTER_AI_PROVIDER_API', solved: true,
                message: 'OpenRouter API key expired.'
            }
        ])
    })
};

const viewports = [
    { width: 320, height: 700 }, { width: 360, height: 800 },
    { width: 375, height: 812 }, { width: 390, height: 844 },
    { width: 430, height: 932 }, { width: 768, height: 1024 },
    { width: 820, height: 1180 }, { width: 1024, height: 768 },
    { width: 1280, height: 800 }, { width: 1440, height: 900 },
    { width: 1920, height: 1080 }
];

for (const viewport of viewports) {
    test(`all dashboard pages avoid horizontal overflow at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await openDashboard(page, 'chat-section', overrides);
        for (const section of sections) {
            await page.evaluate(id => window.Dashboard.navigation.showSection(id, { skipUnsavedCheck: true }), section);
            const dimensions = await page.evaluate(() => ({
                viewport: document.documentElement.clientWidth,
                content: document.documentElement.scrollWidth
            }));
            expect(dimensions.content, `${section} overflowed at ${viewport.width}px`).toBeLessThanOrEqual(dimensions.viewport + 1);
            if (viewport.width <= 767) {
                await expect(page.locator('#page-title')).toBeVisible();
                await expect(page.locator('#mobile-menu-button')).toBeVisible();
            }
        }
    });
}

test('mobile page hierarchy uses compact progressive disclosure', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openDashboard(page, 'analytics-section', overrides);

    await expect(page.locator('.analytics-kpi-grid')).toHaveCSS('grid-template-columns', /[0-9.]+px [0-9.]+px/);
    await expect(page.locator('.analytics-kpi-card').first()).toHaveCSS('min-height', '104px');

    await page.evaluate(() => window.Dashboard.navigation.showSection('errors-section', { skipUnsavedCheck: true }));
    await expect(page.locator('.error-mobile-presentation').first()).toContainText('تعذر تشغيل إحدى خدمات النظام');
    await expect(page.locator('.error-technical-details').first()).not.toHaveAttribute('open', '');
    await page.locator('.error-technical-details summary').first().click();
    await expect(page.locator('.error-technical-details code').first()).toContainText('EADDRINUSE');

    await page.evaluate(() => window.Dashboard.navigation.showSection('whatsapp-section', { skipUnsavedCheck: true }));
    await expect(page.locator('#wa-qr-container')).toHaveCSS('min-height', '150px');
    await expect(page.locator('#wa-connection-badge')).toContainText(/متصل|غير متصل|جارٍ الاتصال|غير نشط|متعذر/);

    await page.evaluate(() => window.Dashboard.navigation.showSection('rag-section', { skipUnsavedCheck: true }));
    await expect(page.locator('#rag-advanced-toggle')).toBeVisible();
    await expect(page.locator('.rag-health-bar')).toBeHidden();
    await page.locator('#rag-advanced-toggle').click();
    await expect(page.locator('.rag-health-bar')).toBeVisible();
    await expect(page.locator('#rag-advanced-toggle')).toHaveAttribute('aria-expanded', 'true');
});

test('mobile drawer traps focus, closes externally, and restores focus', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openDashboard(page, 'chat-section', overrides);
    const trigger = page.locator('#mobile-menu-button');
    await trigger.focus();
    await trigger.press('Enter');
    await expect(page.locator('#dashboard-sidebar')).toHaveClass(/is-mobile-open/);
    await expect(page.locator('#dashboard-sidebar button, #dashboard-sidebar a').first()).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#dashboard-sidebar button, #dashboard-sidebar a').last()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();

    await trigger.press('Enter');
    await page.locator('#mobile-menu-backdrop').click({ position: { x: 4, y: 4 } });
    await expect(page.locator('#dashboard-sidebar')).not.toHaveClass(/is-mobile-open/);
});

test('administrator can create a verified backup from settings', async ({ page }) => {
    let started = false;
    await page.setViewportSize({ width: 390, height: 844 });
    await openDashboard(page, 'settings-section', {
        ...overrides,
        '/backups/status': route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                inProgress: started,
                latest: started ? null : {
                    id: 'futhing-20260828T192006Z',
                    createdAt: '2026-08-28T19:20:07.265Z',
                    sizeBytes: 1992294,
                    files: 6,
                    qdrantIncluded: true,
                    verified: true
                }
            })
        }),
        '/backups': (route, request) => {
            started = request.method() === 'POST';
            return route.fulfill({
                status: 202,
                contentType: 'application/json',
                body: JSON.stringify({ success: true, inProgress: true })
            });
        }
    });
    await expect(page.locator('#card-backup')).toBeVisible();
    await expect(page.locator('#badge-backup')).toHaveText('نسخة سليمة');
    await expect(page.locator('#backup-card-status')).toContainText('تشمل RAG');
    await page.locator('#backup-create-btn').click();
    await expect(page.locator('#badge-backup')).toHaveText('قيد التنفيذ');
    await expect(page.locator('#backup-create-btn')).toBeDisabled();
});

test('every major mobile page has no critical or serious axe violations', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openDashboard(page, 'chat-section', overrides);
    for (const section of sections) {
        await page.evaluate(id => window.Dashboard.navigation.showSection(id, { skipUnsavedCheck: true }), section);
        await page.waitForTimeout(80);
        const result = await runAxe(page);
        const severe = result.violations.filter(item => ['critical', 'serious'].includes(item.impact));
        expect(severe, `${section}: ${JSON.stringify(severe, null, 2)}`).toEqual([]);
    }
});
