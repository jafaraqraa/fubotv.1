const { test, expect } = require('@playwright/test');
const { openDashboard, mockDashboardApi } = require('./helpers');

const viewports = [320, 375, 390, 430, 768, 1024, 1280, 1440];
const screens = [
    ['conversations', 'chat-section'],
    ['analytics', 'analytics-section'],
    ['rag', 'rag-section'],
    ['settings', 'settings-section'],
    ['ai-models', 'aimodels-section'],
    ['integrations', 'whatsapp-section'],
    ['usage', 'usage-section'],
    ['errors', 'errors-section']
];

for (const width of viewports) {
    test(`approved RTL visual baselines at ${width}px`, async ({ page }) => {
        const height = width <= 430 ? 844 : width === 768 ? 1024 : 900;
        await page.setViewportSize({ width, height });
        await mockDashboardApi(page);

        await page.goto('/login', { waitUntil: 'domcontentloaded' });
        await expect(page).toHaveScreenshot(`${width}-login.png`, { animations: 'disabled', maxDiffPixelRatio: 0.015 });

        await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(300);
        for (const [name, section] of screens) {
            await page.evaluate(id => window.Dashboard.navigation.showSection(id, { skipUnsavedCheck: true }), section);
            await page.evaluate(id => { document.getElementById(id).scrollTop = 0; }, section);
            await page.waitForTimeout(name === 'rag' ? 500 : 120);
            await expect(page).toHaveScreenshot(`${width}-${name}.png`, { animations: 'disabled', maxDiffPixelRatio: 0.015 });
        }

        await page.evaluate(() => { void window.Dashboard.feedback.confirm({
            title: 'حذف المستند',
            description: 'سيتم حذف المستند وإزالته من قاعدة المعرفة، ولن يستخدمه المساعد في الإجابات القادمة.',
            confirmLabel: 'حذف المستند',
            destructive: true
        }); });
        await expect(page).toHaveScreenshot(`${width}-dialog.png`, { animations: 'disabled', maxDiffPixelRatio: 0.015 });
    });
}

test('responsive edge content remains reachable without page-level horizontal clipping', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 520 });
    await openDashboard(page, 'rag-section');
    await page.evaluate(() => {
        document.querySelector('#rag-overview-embedding-model').textContent = 'provider/extremely-long-english-model-name-without-spaces-2026-preview';
        document.querySelector('.rag-page-header p').textContent = 'هذا نص عربي طويل جداً لاختبار الالتفاف الصحيح ومنع تداخل المحتوى مع الأزرار والعناوين في أقصر شاشة مدعومة';
    });
    const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
    await expect(page.locator('#mobile-menu-button')).toBeVisible();
});

for (const width of [320, 390, 430]) {
    test(`all dashboard sections fit the mobile viewport at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 844 });
        await openDashboard(page, 'chat-section');
        for (const section of ['errors-section', 'analytics-section', 'whatsapp-section', 'settings-section', 'usage-section', 'rag-section', 'aimodels-section']) {
            await page.evaluate(id => window.Dashboard.navigation.showSection(id, { skipUnsavedCheck: true }), section);
            await expect(page.locator('#page-title')).toBeVisible();
            await expect(page.locator('#mobile-menu-button')).toBeVisible();
            const dimensions = await page.evaluate(() => ({
                viewport: document.documentElement.clientWidth,
                content: document.documentElement.scrollWidth
            }));
            expect(dimensions.content, `${section} overflows at ${width}px`).toBeLessThanOrEqual(dimensions.viewport + 1);
        }
    });
}
