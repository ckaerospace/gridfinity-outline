import { chromium } from 'playwright';
import fs from 'fs';
const gt = JSON.parse(fs.readFileSync('tests/synth/gt_manual.json'));
const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage(); await page.addInitScript(() => { localStorage.setItem('gf-intro-done', '1'); localStorage.setItem('gf-more-review', '1'); localStorage.setItem('gf-more-obj', '1'); });
await page.goto('http://localhost:8123/'); await page.waitForFunction(() => window.__gfReady);
const out = [];
for (const [mode, hv] of [['height given', 225], ['height estimated', 0]]) for (const c of gt) {
  await page.click('#btnAdd'); await page.setInputFiles('#fLib', 'tests/synth/' + c.file); await page.waitForSelector('#mCv', { timeout: 60000 });
  const info = await page.evaluate(() => { const d = window.__gfDebug.last; return { w: d.photo.w, h: d.photo.h }; });
  // photo is downscaled to max 2000 px: scale ROI corner coordinates
  const k = Math.min(1, 2000 / Math.max(...c.size)), box = await page.locator('#mCv').boundingBox();
  const rng = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647 - 0.5; })();
  for (const [x, y] of c.roi_px_full) await page.mouse.click(box.x + (x * k + rng() * 5) / info.w * box.width, box.y + (y * k + rng() * 5) / info.h * box.height);
  await page.fill('#mW', '190'); if (hv) await page.fill('#mH', String(hv)); await page.click('#mGo'); await page.waitForSelector('#rCv', { timeout: 60000 });
  const r = await page.evaluate(() => ({ outline: window.__gfDebug.last.outline, cal: { h: window.__gfDebug.last.cal.heightMM, est: window.__gfDebug.last.cal.heightEstimated }, timing: { total: 0 } }));
  out.push({ ...c, polygon: c.polygon.map(([x, y]) => [x - 10, y - 36]), result: { ...r, cal: { ...r.cal, tilt: c.tilt, found: 0 }, timing: { total: 0 } }, mode });
  console.log(mode, c.file, 'height used', r.cal.h.toFixed(2));
  await page.click('[data-x]');
}
fs.writeFileSync('tests/manual_results.json', JSON.stringify(out)); await browser.close();
