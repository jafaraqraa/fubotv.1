const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './frontend/e2e',
    timeout: 30_000,
    expect: { timeout: 7_000 },
    fullyParallel: false,
    retries: 0,
    reporter: [['list'], ['html', { outputFolder: 'artifacts/playwright-report', open: 'never' }]],
    use: {
        baseURL: 'http://127.0.0.1:5173',
        locale: 'ar-EG',
        timezoneId: 'Asia/Jerusalem',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure'
    },
    projects: [{ name: 'chromium', use: { browserName: 'chromium' } }]
});
