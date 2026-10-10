import { chromium } from 'playwright';
import fs from 'fs';
const URL = process.env.URL || 'http://localhost:8123/';
const dir = process.env.DIR || 'tests/synth', gt = JSON.parse(fs.readFileSync(dir + '/gt.json'));
const only = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null; const OUT = process.env.OUT || 'tests/synth_results.json';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
await page.goto(URL); await page.waitForFunction(() => window.__gfReady);
const out = [];
for (const c of gt) {
  if (only && !c.file.includes(only)) continue;
  await page.click('#btnAdd'); await page.waitForSelector('#fLib', { state: 'attached' });
  await page.setInputFiles('#fLib', `${dir}/${c.file}`);
  await page.waitForFunction(() => document.querySelector('#rCv') || document.querySelector('#mCv') || document.querySelector('.err'), null, { timeout: 90000 });
  const r = await page.evaluate(() => { const d = window.__gfDebug.last; return { cal: d.cal && { ok: d.cal.ok, found: d.cal.found, rms: d.cal.rms, tilt: d.cal.tilt }, timing: d.timing, tol: d.tol, outline: d.outline, manual: !!document.querySelector('#mCv'), err: document.querySelector('.err')?.textContent }; });
  out.push({ ...c, result: r });
  console.log(c.file, JSON.stringify({ cal: r.cal, t: r.timing && Object.fromEntries(Object.entries(r.timing).map(([k, v]) => [k, Math.round(v)])), n: r.outline?.length, manual: r.manual, err: r.err }));
  await page.click('[data-x]');
}
fs.writeFileSync(OUT, JSON.stringify(out));
await browser.close();
