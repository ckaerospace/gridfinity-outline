// Smart select (MobileSAM) vs classic on the real photos. usage: node tests/run_smart.mjs [tag]
import * as pw from 'playwright'; import fs from 'fs';
const tag = process.argv[2] || 'smart', files = ['real-floss-blue-hard-shadow', 'real-white-part-soft-shadow', 'real-white-part-far-hard-shadow'];
const browser = await pw[process.env.PWB || 'chromium'].launch(); const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' })).newPage();
page.on('pageerror', (e) => console.log('PAGEERR', e.message)); page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
await page.goto(process.env.URL || 'http://localhost:8123/'); await page.waitForFunction(() => window.__gfReady);
const out = {};
for (const f of files) {
  await page.click('#btnAdd'); await page.setInputFiles('#fLib', `tests/real/${f}.jpg`);
  await page.waitForFunction(() => document.querySelector('#rCv'), null, { timeout: 90000 }); await page.waitForTimeout(400);
  const classic = await page.evaluate(() => window.__gfDebug.last.outline);
  const rectInfo = await page.evaluate(() => { const d = window.__gfDebug; return { w: d.last.rectSize[0], h: d.last.rectSize[1] }; });
  const cx = classic.reduce((s, p) => s + p[0], 0) / classic.length, cy = classic.reduce((s, p) => s + p[1], 0) / classic.length;
  const tap = async (x_mm, y_mm, btn) => { await page.click(`#rModes [data-m="${btn}"]`); await page.locator('#rCv').scrollIntoViewIfNeeded(); const pos = await page.evaluate(([x, y]) => { const c = document.querySelector('#rCv'), b = c.getBoundingClientRect(), d = window.__gfDebug.rectInfo; return null; }, [0, 0]);
    const r = await page.evaluate(([x, y]) => { const c = document.querySelector('#rCv'), b = c.getBoundingClientRect(); return { b: [b.left, b.top, b.width, b.height], cw: c.width, ch: c.height }; }, [0, 0]);
    // outline coords are sheet mm; rect px = (mm - roi0) * s, roi0 = (10,36), s = 4 (or less)
    const s = Math.min(4, 1400 / 225), px = (x_mm - 10) * s, py = (y_mm - 36) * s;
    await page.mouse.click(r.b[0] + px / r.cw * r.b[2], r.b[1] + py / r.ch * r.b[3]); };
  const t0 = Date.now(); await tap(cx, cy, 'smart');
  const extra = process.env.EXTRA ? ({ 'real-white-part-soft-shadow': [[0, 22], [0, -22]] }[f] || []) : [];
  for (const [dx, dy] of extra) { await page.waitForFunction(() => window.__gfDebug.smartDecMs !== undefined, null, { timeout: 180000 }); await page.evaluate(() => { delete window.__gfDebug.smartDecMs; }); await tap(cx + dx, cy + dy, 'smart'); }
  await page.waitForFunction(() => window.__gfDebug.smartDecMs !== undefined || window.__gfDebug.smartErr, null, { timeout: 180000 });
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => { const d = window.__gfDebug; return { o: d.last.outline, enc: d.smartEncMs, dec: d.smartDecMs, iou: d.smartIou, err: d.smartErr, info: document.querySelector('#rInfo').textContent }; });
  await page.locator('#rCv').screenshot({ path: `screenshots/real/${f}-${tag}.png` });
  fs.writeFileSync(`tests/real/${f}-${tag}.outline.json`, JSON.stringify(r.o)); out[f] = { classic, smart: r.o };
  console.log(f, JSON.stringify({ enc_ms: Math.round(r.enc), dec_ms: Math.round(r.dec), predIoU: r.iou, err: r.err, info: r.info, total_s: (Date.now() - t0) / 1000 }));
  await page.click('[data-x]'); await page.evaluate(() => { delete window.__gfDebug.smartDecMs; delete window.__gfDebug.smartErr; });
}
fs.writeFileSync('/tmp/smart_out.json', JSON.stringify(out)); await browser.close();
