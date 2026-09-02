const { test, expect } = require('@playwright/test');
const { openDashboard, runAxe } = require('./helpers');

function localSqlTimestamp(date) {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const now = new Date();
const todayAt2229 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 22, 29, 34);
const yesterdayAt1733 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 17, 33, 9);
const olderConversation = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 35, 16, 27, 53);

const users = [
    {
        id: 'mobile-1', name: 'جعفر صاحب الاسم العربي الطويل للاختبار', platform: 'telegram',
        tenantId: 'default', unreadCount: 12, isAIEnabled: true, assignee: 'ai',
        managementRequested: false, lastSeen: localSqlTimestamp(todayAt2229),
        lastMessagePreview: 'ممكن تساعدني بمشكلة طويلة في المنتج قبل موعد التسليم؟'
    },
    {
        id: 'mobile-2', name: 'Very Long English Customer Name For Layout', platform: 'whatsapp',
        tenantId: 'default', unreadCount: 0, isAIEnabled: false, assignee: 'admin',
        managementRequested: true, lastSeen: localSqlTimestamp(yesterdayAt1733),
        lastMessagePreview: 'Thanks — شكراً لك، this is a mixed direction message preview'
    },
    {
        id: 'mobile-3', name: 'أبو المجد', platform: 'messenger', tenantId: 'default',
        unreadCount: 1, isAIEnabled: true, assignee: 'ai', managementRequested: false,
        lastSeen: localSqlTimestamp(olderConversation), lastMessagePreview: 'كم سعر الخطة الشهرية؟'
    }
];

const messages = [
    { id: 'm1', text: 'السلام عليكم', sender: 'user', timestamp: '2026-08-28 22:28:00' },
    { id: 'm2', text: 'وعليكم السلام، كيف يمكنني مساعدتك؟', sender: 'bot', timestamp: '2026-08-28 22:29:00' },
    { id: 'm3', type: 'image', text: '/api/v1/media/sample', sender: 'user', time: '22:30' },
    { id: 'm4', type: 'note', text: 'اتصل بالعميل غداً الساعة 10', sender: 'admin', time: '22:31' }
];

const apiOverrides = {
    '/users': route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(users) }),
    '/chat/mobile-1': route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(messages) }),
    '/media/capabilities': route => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, capabilities: { telegram: { mimeTypes: ['image/png', 'application/pdf'] } } })
    }),
    '/media/sample': route => route.fulfill({
        status: 200, contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="960"><rect width="100%" height="100%" fill="#dbeafe"/><circle cx="320" cy="420" r="150" fill="#2563eb"/></svg>'
    })
};

const viewports = [
    { width: 320, height: 700 }, { width: 360, height: 800 },
    { width: 375, height: 812 }, { width: 390, height: 844 },
    { width: 430, height: 932 }, { width: 390, height: 600 }
];

for (const viewport of viewports) {
    test(`mobile conversations master/detail is usable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await openDashboard(page, 'chat-section', apiOverrides);
        await expect(page.locator('#page-title')).toBeVisible();
        await expect(page.locator('#mobile-menu-button')).toBeVisible();
        await expect(page.locator('#mobile-menu-button')).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('#chat-customer-search-input')).toBeVisible();
        await expect(page.locator('#unread-only-toggle')).toBeAttached();
        await expect(page.locator('.chat-customer-row')).toHaveCount(3);

        const tabStrip = page.locator('.chat-platform-filters');
        await expect(tabStrip).toHaveCSS('overflow-x', 'auto');
        await page.locator('#filter-instagram').evaluate(element => element.scrollIntoView({ inline: 'center', block: 'nearest' }));
        const tabBox = await page.locator('#filter-instagram').boundingBox();
        expect(tabBox.x).toBeGreaterThanOrEqual(0);
        expect(tabBox.x + tabBox.width).toBeLessThanOrEqual(viewport.width + 1);

        let overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(1);

        await page.locator('[data-customer-id="mobile-1"]').click();
        await expect(page.locator('#chat-section')).toHaveClass(/mobile-conversation-open/);
        await expect(page.locator('#conversation-shell')).toBeVisible();
        await expect(page.locator('#conversation-mobile-back')).toBeVisible();
        await expect(page.locator('#direct-msg-input')).toBeVisible();
        await expect(page.locator('#media-upload-btn')).toBeVisible();
        await expect(page.locator('#send-btn')).toBeVisible();
        await expect(page.locator('#direct-msg-input')).toHaveCSS('font-size', '16px');
        await expect(page.locator('#media-upload-btn')).toHaveCSS('width', '44px');
        await expect(page.locator('.message-menu-trigger').first()).toHaveCSS('width', '44px');
        await expect(page.locator('.message-image')).toBeVisible();
        await expect(page.locator('.message-media-frame')).not.toHaveClass(/is-loading/);
        await expect(page.locator('.channel-internal-note')).toHaveAttribute('aria-label', /ملاحظة داخلية/);
        const mediaBox = await page.locator('.message-image').boundingBox();
        expect(mediaBox.width).toBeLessThanOrEqual(Math.min(viewport.width * .85, 360) + 1);
        const composerControls = await page.locator('#input-wrapper > :visible').evaluateAll(elements => elements.map(element => {
            const box = element.getBoundingClientRect();
            return { left: box.left, right: box.right };
        }));
        expect(composerControls.every(box => box.left >= -1 && box.right <= viewport.width + 1)).toBe(true);

        await page.locator('#direct-msg-input').fill('نص عربي طويل للاختبار\nEnglish multiline content that must wrap safely');
        const textareaHeight = await page.locator('#direct-msg-input').evaluate(element => element.getBoundingClientRect().height);
        expect(textareaHeight).toBeGreaterThanOrEqual(44);
        expect(textareaHeight).toBeLessThanOrEqual(121);
        await page.locator('#tab-note').click();
        await expect(page.locator('#direct-msg-input')).toHaveAttribute('placeholder', 'اكتب ملاحظة داخلية...');
        await expect(page.locator('#send-btn')).toContainText('حفظ الملاحظة');
        await expect(page.locator('#media-upload-btn')).toBeHidden();
        await page.locator('#tab-reply').click();
        await expect(page.locator('#send-btn')).toContainText('إرسال');
        await expect(page.locator('#media-upload-btn')).toBeVisible();
        const lastMessageIsReachable = await page.evaluate(() => {
            const chat = document.getElementById('chat-box');
            const note = chat?.querySelector('.channel-internal-note:last-of-type');
            if (!chat || !note) return false;
            chat.scrollTop = chat.scrollHeight;
            const chatRect = chat.getBoundingClientRect();
            const noteRect = note.getBoundingClientRect();
            return noteRect.bottom <= chatRect.bottom + 1 && noteRect.top >= chatRect.top - 1;
        });
        expect(lastMessageIsReachable).toBe(true);
        overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(1);

        await page.locator('#conversation-mobile-back').click();
        await expect(page.locator('.chat-customers-panel')).toBeVisible();
        await expect(page.locator('[data-customer-id="mobile-1"]')).toBeFocused();
    });
}

test('mobile conversation list is newest-first and uses contextual timestamps', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openDashboard(page, 'chat-section', apiOverrides);
    await expect(page.locator('.chat-customer-row').first()).toHaveAttribute('data-customer-id', 'mobile-1');
    await expect(page.locator('[data-customer-id="mobile-1"] .chat-customer-context-time')).toContainText('22:29');
    await expect(page.locator('[data-customer-id="mobile-2"] .chat-customer-context-time')).toHaveText('أمس');
    await expect(page.locator('[data-customer-id="mobile-3"] .chat-customer-context-time')).not.toHaveText(/أمس|^\d{2}:\d{2}$/);
    await expect(page.locator('[data-customer-id="mobile-1"] .chat-customer-preview')).toContainText('ممكن تساعدني');
});

test('affected mobile list and chat have no critical or serious axe violations', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openDashboard(page, 'chat-section', apiOverrides);
    let result = await runAxe(page);
    expect(result.violations.filter(item => ['critical', 'serious'].includes(item.impact)), JSON.stringify(result.violations, null, 2)).toEqual([]);
    await page.locator('[data-customer-id="mobile-1"]').click();
    result = await runAxe(page);
    expect(result.violations.filter(item => ['critical', 'serious'].includes(item.impact)), JSON.stringify(result.violations, null, 2)).toEqual([]);
});

for (const viewport of [{ width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1280, height: 800 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    test(`tablet/desktop keeps split conversation workspace at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await openDashboard(page, 'chat-section', apiOverrides);
        await expect(page.locator('.chat-customers-panel')).toBeVisible();
        await expect(page.locator('#conversation-shell')).toBeVisible();
        const display = await page.locator('#chat-section').evaluate(element => getComputedStyle(element).display);
        expect(display).toBe('flex');
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(1);
    });
}

for (const viewport of [
    { width: 320, height: 700 }, { width: 375, height: 812 },
    { width: 390, height: 844 }, { width: 430, height: 932 },
    { width: 768, height: 1024 }, { width: 1024, height: 768 },
    { width: 1280, height: 800 }, { width: 1440, height: 900 }
]) {
    test(`conversation list/detail visual baseline at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await openDashboard(page, 'chat-section', apiOverrides);
        await expect(page).toHaveScreenshot(`conversation-redesign-${viewport.width}-list.png`, {
            animations: 'disabled', maxDiffPixelRatio: 0.015
        });
        await page.locator('[data-customer-id="mobile-1"]').click();
        await expect(page).toHaveScreenshot(`conversation-redesign-${viewport.width}-detail.png`, {
            animations: 'disabled', maxDiffPixelRatio: 0.015
        });
    });
}
