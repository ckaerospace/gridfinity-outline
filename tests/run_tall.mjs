// Tall-object tests: renders in tests/tall (tools/synth.py tall tests/tall). Runs the real app; sets 'Object height' to the true height and records raw and corrected outlines.
import { chromium } from 'playwright'; import fs from 'fs';
const URL = process.env.URL || 'http://localhost:8123/', dir = 'tests/tall', gt = JSON.parse(fs.readFileSync(dir + '/gt.json'));
const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.goto(URL); await page.waitForFunction(() => window.__gfReady); const out = [];
for (const c of gt) {
  await page.click('#btnAdd'); await page.setInputFiles('#fLib', `${dir}/${c.file}`);
  await page.waitForFunction(() => document.querySelector('#rCv') || document.querySelector('#mCv'), null, { timeout: 90000 });
  const raw = await page.evaluate(() => ({ o: window.__gfDebug.last.outline, cam: window.__gfDebug.last.cam, tilt: window.__gfDebug.last.cal.tilt }));
  let corr = null, note = null;
  if (c.height > 0) { await page.fill('#rHN', String(c.height)); await page.dispatchEvent('#rHN', 'change'); await page.waitForTimeout(150); corr = await page.evaluate(() => window.__gfDebug.last.outlineCorr); note = await page.evaluate(() => document.querySelector('#rInfo').textContent); }
  out.push({ ...c, raw, corr, note }); await page.click('[data-x]');
}
fs.writeFileSync('tests/tall_results.json', JSON.stringify(out)); await browser.close();
