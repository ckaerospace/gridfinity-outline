// Real phone photos of the (tinted) sheet through the real app pipeline. usage: node tests/run_real2.mjs <tag>
import { chromium } from 'playwright'; import fs from 'fs';
const tag = process.argv[2] || 'after', URL = process.env.URL || 'http://localhost:8123/';
const files = ['real-floss-blue-hard-shadow', 'real-white-part-soft-shadow'];
const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })).newPage(); await page.addInitScript(() => { localStorage.setItem('gf-intro-done', '1'); localStorage.setItem('gf-more-review', '1'); localStorage.setItem('gf-more-obj', '1'); });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.goto(URL); await page.waitForFunction(() => window.__gfReady); fs.mkdirSync('screenshots/real', { recursive: true });
for (const f of files) {
  await page.click('#btnAdd'); await page.setInputFiles('#fLib', `tests/real/${f}.jpg`);
  await page.waitForFunction(() => document.querySelector('#rCv') || document.querySelector('#mCv') || document.querySelector('.err'), null, { timeout: 90000 });
  const r = await page.evaluate(() => { const d = window.__gfDebug.last; return { cal: d.cal && { ok: d.cal.ok, found: d.cal.found, rms: d.cal.rms, tilt: d.cal.tilt }, tol: d.tol, timing: d.timing, outline: d.outline, manual: !!document.querySelector('#mCv') }; });
  await page.waitForTimeout(400);
  if (!r.manual) await page.locator('#rCv').screenshot({ path: `screenshots/real/${f}-${tag}.png` });
  let bb = null; if (r.outline) { const xs = r.outline.map((p) => p[0]), ys = r.outline.map((p) => p[1]); bb = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]; }
  console.log(f, JSON.stringify({ cal: r.cal, tol: r.tol, manual: r.manual, bbox_mm: bb && bb.map((v) => +v.toFixed(1)), total_ms: r.timing && Math.round(r.timing.total), prep: r.timing && Math.round(r.timing.prep) }));
  fs.writeFileSync(`tests/real/${f}-${tag}.outline.json`, JSON.stringify(r.outline));
  await page.click('[data-x]');
}
await browser.close();
