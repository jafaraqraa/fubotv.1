const { test, expect } = require('@playwright/test');
const { mockDashboardApi, openDashboard, runAxe } = require('./helpers');

test('login validation, failure, loading, and success', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'تسجيل الدخول' }).click();
    await expect(page.locator('#error-alert')).toBeVisible();
    await expect(page.locator('#username')).toHaveAttribute('aria-invalid', 'true');

    await page.route('**/api/v1/auth/login', async route => route.fulfill({ status: 401, contentType: 'application/json', body: '{"success":false}' }));
    await page.locator('#username').fill('wrong');
    await page.locator('#password').fill('wrong');
    await page.getByRole('button', { name: 'تسجيل الدخول' }).click();
    await expect(page.locator('#error-alert')).toContainText('تعذر تسجيل الدخول');

    await page.unroute('**/api/v1/auth/login');
    await page.route('**/api/v1/auth/login', async route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"sessionId":"e2e"}' }));
    await page.locator('#username').fill('admin');
    await page.locator('#password').fill('valid-password');
    await Promise.all([page.waitForURL('**/dashboard'), page.getByRole('button', { name: 'تسجيل الدخول' }).click()]);
});

test('navigation restores section after refresh and mobile drawer is keyboard accessible', async ({ page }) => {
    await openDashboard(page);
    await page.locator('#btn-rag').click();
    await expect(page.locator('#rag-section')).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#rag-section')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#mobile-menu-button').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#dashboard-sidebar')).toHaveClass(/is-mobile-open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#dashboard-sidebar')).not.toHaveClass(/is-mobile-open/);
});

test('unified dialog traps focus, supports Escape, and restores focus', async ({ page }) => {
    await openDashboard(page);
    await page.locator('#btn-chat').focus();
    await page.evaluate(() => { void window.Dashboard.feedback.confirm({ title: 'حذف مستند', description: 'سيتم حذف المستند من قاعدة المعرفة.', confirmLabel: 'حذف', destructive: true }); });
    await expect(page.locator('#ux-confirm-dialog')).toBeVisible();
    await expect(page.locator('#ux-confirm-cancel')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#ux-confirm-accept')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#ux-confirm-dialog')).toBeHidden();
    await expect(page.locator('#btn-chat')).toBeFocused();
});

test('conversation controls remain reachable on mobile and assignment sends feedback', async ({ page }) => {
    await openDashboard(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.evaluate(() => {
        const shell = document.getElementById('chat-section');
        shell.classList.add('mobile-conversation-open');
        const assignee = document.getElementById('assignee-container');
        assignee?.classList.remove('hidden');
    });
    await expect(page.locator('#chat-assignee-select')).toBeVisible();
    await expect(page.locator('#chat-header-actions')).toBeVisible();
});

test('RAG destructive action has contextual copy and no browser dialog', async ({ page }) => {
    await openDashboard(page, 'rag-section');
    await page.evaluate(() => {
        window.Dashboard.state.ragSelectedDocIds = new Set(['1', '2']);
        window.Dashboard.rag.executeBulkAction('delete');
    });
    await expect(page.locator('#ux-confirm-title')).toHaveText('حذف المستندات المحددة');
    await expect(page.locator('#ux-confirm-description')).toContainText('لن يستخدمها المساعد');
    await page.locator('#ux-confirm-cancel').click();
});

test('core pages have no critical or serious axe violations', async ({ page }) => {
    await page.goto('/login');
    let result = await runAxe(page);
    expect(result.violations.filter(v => ['critical', 'serious'].includes(v.impact)), JSON.stringify(result.violations, null, 2)).toEqual([]);

    await openDashboard(page);
    for (const section of ['chat-section', 'settings-section', 'aimodels-section', 'rag-section', 'errors-section']) {
        await page.evaluate(id => window.Dashboard.navigation.showSection(id), section);
        await page.waitForTimeout(100);
        result = await runAxe(page);
        expect(result.violations.filter(v => ['critical', 'serious'].includes(v.impact)), `${section}: ${JSON.stringify(result.violations, null, 2)}`).toEqual([]);
    }
});
