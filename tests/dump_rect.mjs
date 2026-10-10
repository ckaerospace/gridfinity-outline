import { chromium } from 'playwright'; import fs from 'fs';
const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage();
await page.goto('http://localhost:8123/'); await page.waitForFunction(() => window.__gfReady);
for (const f of process.argv.slice(2)) {
  await page.click('#btnAdd'); await page.setInputFiles('#fLib', `tests/real/${f}.jpg`); await page.waitForSelector('#rCv', { timeout: 90000 });
  const r = await page.evaluate(() => { const m = window.__gfDebug.rectMat; let s = ''; const d = m.data, CH = 0x8000; for (let i = 0; i < d.length; i += CH) s += String.fromCharCode.apply(null, d.subarray(i, i + CH)); return { w: m.cols, h: m.rows, b64: btoa(s) }; });
  fs.writeFileSync(`/tmp/${f}.rgba`, Buffer.from(r.b64, 'base64')); fs.writeFileSync(`/tmp/${f}.json`, JSON.stringify([r.w, r.h])); console.log(f, r.w, r.h);
  await page.click('[data-x]');
}
await browser.close();
