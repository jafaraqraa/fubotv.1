const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const outputDir = path.resolve(__dirname, '..', '..', 'docs', 'screenshots', 'conversation-ui');
    fs.mkdirSync(outputDir, { recursive: true });
    const fixture = `file://${path.resolve(__dirname, 'fixtures', 'conversation-visual.html')}`;
    for (const channel of ['whatsapp', 'telegram', 'messenger', 'instagram']) {
        for (const viewport of [
            { name: 'desktop', width: 1440, height: 900 },
            { name: 'mobile', width: 390, height: 844 }
        ]) {
            const page = await browser.newPage();
            await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
            await page.goto(`${fixture}?channel=${channel}`, { waitUntil: 'networkidle0' });
            await page.screenshot({
                path: path.join(outputDir, `${channel}-${viewport.name}.png`),
                fullPage: false
            });
            await page.close();
        }
    }
    await browser.close();
    console.log(`Captured conversation screenshots in ${outputDir}`);
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
