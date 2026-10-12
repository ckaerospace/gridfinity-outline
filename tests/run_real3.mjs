// Real photos through the real app: min-area rectangle, camera estimate, outline json + screenshot. usage: node tests/run_real3.mjs <tag>
import { chromium } from 'playwright'; import fs from 'fs';
const tag = process.argv[2] || 'now', files = ['real-floss-blue-hard-shadow', 'real-white-part-soft-shadow', 'real-white-part-far-hard-shadow'];
const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })).newPage(); await page.addInitScript(() => { localStorage.setItem('gf-intro-done', '1'); localStorage.setItem('gf-more-review', '1'); localStorage.setItem('gf-more-obj', '1'); });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.goto(process.env.URL || 'http://localhost:8123/'); await page.waitForFunction(() => window.__gfReady); fs.mkdirSync('screenshots/real', { recursive: true });
for (const f of files) {
  await page.click('#btnAdd'); await page.setInputFiles('#fLib', `tests/real/${f}.jpg`);
  await page.waitForFunction(() => document.querySelector('#rCv') || document.querySelector('#mCv'), null, { timeout: 90000 }); await page.waitForTimeout(400);
  const r = await page.evaluate(() => { const d = window.__gfDebug.last; return { o: d.outline, cam: d.cam, tilt: d.cal && d.cal.tilt, info: document.querySelector('#rInfo')?.textContent, manual: !!document.querySelector('#mCv') }; });
  if (!r.manual) await page.locator('#rCv').screenshot({ path: `screenshots/real/${f}-${tag}.png` });
  fs.writeFileSync(`tests/real/${f}-${tag}.outline.json`, JSON.stringify(r.o)); console.log(f, JSON.stringify({ cam: r.cam && { x: +r.cam.x.toFixed(0), y: +r.cam.y.toFixed(0), z: +r.cam.z.toFixed(0) }, tilt: r.tilt && +r.tilt.toFixed(1), info: r.info, n: r.o && r.o.length }));
  await page.click('[data-x]');
}
await browser.close();
