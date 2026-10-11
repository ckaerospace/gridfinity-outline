// Peak WebAssembly memory during Smart select. usage: PWB=webkit|chromium node tests/mem_probe.mjs [photo]
import * as pw from 'playwright';
const b = await pw[process.env.PWB || 'chromium'].launch(); const page = await (await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' })).newPage();
await page.addInitScript(() => { window.__mem = []; const g = WebAssembly.Memory.prototype.grow; WebAssembly.Memory.prototype.grow = function (n) { const r = g.call(this, n); window.__mem.push(Math.round(this.buffer.byteLength / 1048576)); return r; };
});
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.goto(process.env.URL || 'http://localhost:8123/'); await page.waitForFunction(() => window.__gfReady);
await page.click('#btnAdd'); await page.setInputFiles('#fLib', process.argv[2] || 'tests/real/real-floss-blue-hard-shadow.jpg');
await page.waitForFunction(() => document.querySelector('#rCv'), null, { timeout: 90000 }); await page.waitForTimeout(400);
await page.click('#rModes [data-m="smart"]'); await page.locator('#rCv').scrollIntoViewIfNeeded(); const bb = await page.locator('#rCv').boundingBox(); await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
await page.waitForFunction(() => window.__gfDebug.smartDecMs !== undefined || window.__gfDebug.smartErr, null, { timeout: 180000 });
console.log(JSON.stringify(await page.evaluate(() => ({ grows: window.__mem, peakMB: Math.max(0, ...window.__mem), err: window.__gfDebug.smartErr, enc: window.__gfDebug.smartEncMs }))));
await b.close();
