import { chromium } from 'playwright';
const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })).newPage();
await page.goto('http://localhost:8123/'); await page.waitForFunction(() => window.__gfReady);
await page.click('#btnAdd'); await page.setInputFiles('#fLib', 'tests/real/real-white-part-soft-shadow.jpg'); await page.waitForSelector('#rCv', { timeout: 90000 }); await page.waitForTimeout(500);
await page.screenshot({ path: 'screenshots/09-review-white-part-shadow-removed.png' });
await page.fill('#rShN', '0'); await page.locator('#rShN').dispatchEvent('change'); await page.waitForTimeout(500);
console.log('shadow 0 bbox', await page.evaluate(() => { const o = window.__gfDebug.last.outline; const xs = o.map(p => p[0]), ys = o.map(p => p[1]); return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)].map(v => +v.toFixed(1)); }));
await page.screenshot({ path: 'screenshots/10-review-white-part-shadow-0.png' });
await browser.close();
