// Smart select self-test on the three real photos: taps at zoom 1x/4x/8x and at image corners, plus a simulated out-of-memory.
// usage: PWB=webkit|chromium [URL=...] node tests/smart_selftest.mjs     (PWB, not BROWSER: that name is taken in some shells)
import * as pw from 'playwright';
const files = ['real-floss-blue-hard-shadow', 'real-white-part-soft-shadow', 'real-white-part-far-hard-shadow'], URL = process.env.URL || 'http://localhost:8123/';
const browser = await pw[process.env.PWB || 'chromium'].launch(); let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', n, d ?? ''); };
const mk = async (init) => { const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); if (init) await page.addInitScript(init); await page.goto(URL); await page.waitForFunction(() => window.__gfReady); page.errs = errs; return page; };
const open = async (page, f) => { await page.click('#btnAdd'); await page.setInputFiles('#fLib', `tests/real/${f}.jpg`); await page.waitForFunction(() => document.querySelector('#rCv'), null, { timeout: 90000 }); await page.waitForTimeout(400); await page.click('#rModes [data-m="smart"]'); await page.locator('#rCv').scrollIntoViewIfNeeded(); };
const tapAt = async (page, fx, fy) => { await page.locator('#rCv').scrollIntoViewIfNeeded(); const b = await page.locator('#rCv').boundingBox(); await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
  await page.waitForFunction(() => window.__gfDebug.smartDecMs !== undefined || window.__gfDebug.smartErr, null, { timeout: 180000 }); await page.waitForTimeout(150);
  return page.evaluate(() => { const d = window.__gfDebug, r = { err: d.smartErr, ms: d.smartDecMs, tap: window.__gfZoom.lastTap, w: __gfZoom.rectW(), h: __gfZoom.rectH(), z: __gfZoom.V.z, n: d.last.outline && d.last.outline.length };
    delete d.smartDecMs; delete d.smartErr; return r; }); };
const page = await mk();
for (const f of files) {
  await open(page, f); const t0 = Date.now(); let first = true;
  for (const [z, fx, fy, name] of [[1, .5, .5, 'center 1x'], [4, .5, .5, 'center 4x'], [8, .5, .5, 'center 8x'], [1, .01, .01, 'top-left corner'], [1, .99, .99, 'bottom-right corner'], [8, .99, .01, 'top-right corner 8x']]) {
    await page.evaluate((z) => { const Z = __gfZoom; Z.V.z = 1; Z.V.tx = Z.V.ty = 0; Z.draw(); if (z > 1) { const c = document.querySelector('#rCv').getBoundingClientRect(); Z.zoomAt(c.width / 2, c.height / 2, z); } }, z);
    const r = await tapAt(page, fx, fy);
    const inRange = r.tap && r.tap[0] >= 0 && r.tap[0] <= r.w && r.tap[1] >= 0 && r.tap[1] <= r.h;
    ok(`${f} ${name}`, !r.err && inRange && r.n > 0, JSON.stringify({ err: r.err, tap: r.tap && r.tap.map((v) => Math.round(v)), ms: Math.round(r.ms) }));
    await page.evaluate(() => { document.querySelector('#rAuto').click(); }); await page.click('#rModes [data-m="smart"]');
  }
  await page.click('[data-x]'); console.log(f, 'total s', (Date.now() - t0) / 1000);
}
ok('no uncaught page errors', page.errs.length === 0, page.errs.join('|'));
// simulated iOS failure: the shared wasm memory cannot be created
const bad = await mk(() => { const M = WebAssembly.Memory; WebAssembly.Memory = function (d) { if (d && d.shared) throw new RangeError('Out of memory'); return new M(d); }; WebAssembly.Memory.prototype = M.prototype; });
await open(bad, files[0]); const b = await bad.locator('#rCv').boundingBox(); await bad.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
await bad.waitForFunction(() => window.__gfDebug.smartErr, null, { timeout: 120000 }); await bad.waitForTimeout(300);
const s = await bad.evaluate(() => ({ info: document.querySelector('#rInfo').innerText, dis: document.querySelector('#rModes [data-m="smart"]').disabled, outline: window.__gfDebug.last.outline.length }));
ok('simulated OOM: friendly message + details + button disabled + classic outline intact', /more memory than this device allows/.test(s.info) && /Details:.*(Out of memory|memory)/i.test(s.info) && s.dis && s.outline > 3, JSON.stringify(s));
await browser.close(); console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0);
