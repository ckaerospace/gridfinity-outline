import { chromium } from 'playwright';
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage(); await page.goto('http://localhost:8123/'); await page.waitForFunction(() => window.__gfReady);
await page.evaluate(async () => { await navigator.serviceWorker.ready; }); await page.waitForTimeout(2500);
const cached = await page.evaluate(async () => (await (await caches.open('gf-outline-v1')).keys()).length);
await ctx.setOffline(true); await page.reload(); await page.waitForFunction(() => window.__gfReady, null, { timeout: 15000 });
await page.click('#btnAdd'); await page.setInputFiles('#fLib', 'tests/synth/rect50x30_dark_t20_s101.jpg'); await page.waitForSelector('#rCv', { timeout: 60000 });
console.log('offline OK; cached files:', cached, '| outline pts', await page.evaluate(() => window.__gfDebug.last.outline.length));
await browser.close();
