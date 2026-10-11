import { chromium } from 'playwright';
const URL = process.env.URL || 'http://localhost:8123/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(URL); await page.waitForFunction(() => window.__gfReady);
await page.click('#btnAdd'); await page.waitForSelector('#fLib', { state: 'attached' });
await page.setInputFiles('#fLib', process.env.IMG || 'tests/synth/wrench_steel_t20_s107.jpg'); await page.waitForSelector('#rCv', { timeout: 60000 }); await page.waitForTimeout(400);
const cdp = await ctx.newCDPSession(page);
const results = []; const ok = (n, c, d) => { results.push([n, !!c, d]); console.log(c ? 'PASS' : 'FAIL', n, d ?? ''); };
const Z = () => page.evaluate(() => ({ z: __gfZoom.V.z, tx: __gfZoom.V.tx, ty: __gfZoom.V.ty }));
const box = () => page.locator('#rCv').boundingBox();
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
const sleep = (ms) => page.waitForTimeout(ms);
// canvas backing store sharp
const info = await page.evaluate(() => { const c = document.querySelector('#rCv'); return [c.width, c.height, c.clientWidth, devicePixelRatio, __gfZoom.rectW()]; });
ok('backing store = css x dpr', info[0] === Math.round(info[2] * info[3]), JSON.stringify(info));
// pinch via CDP: fingers at centre +-40 -> +-160 (4x spread)
let b = await box(); const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
await touch('touchStart', [[cx - 40, cy], [cx + 40, cy]]);
for (let i = 1; i <= 10; i++) { const d = 40 + 12 * i; await touch('touchMove', [[cx - d, cy], [cx + d, cy]]); await sleep(16); }
await touch('touchEnd', []); await sleep(100);
let z = await Z(); ok('pinch zooms in (CDP 2-finger)', z.z > 2.5, 'z=' + z.z.toFixed(2));
// two-finger pan
const before = await Z();
await touch('touchStart', [[cx - 40, cy], [cx + 40, cy]]);
for (let i = 1; i <= 8; i++) { await touch('touchMove', [[cx - 40 + 6 * i, cy + 5 * i], [cx + 40 + 6 * i, cy + 5 * i]]); await sleep(16); }
await touch('touchEnd', []); await sleep(100);
let after = await Z(); ok('two-finger pan moves image, zoom unchanged', Math.abs(after.z - before.z) < 0.05 && Math.abs(after.tx - before.tx) > 20, `dtx=${(after.tx - before.tx).toFixed(1)} dty=${(after.ty - before.ty).toFixed(1)}`);
// pinch out
await touch('touchStart', [[cx - 150, cy], [cx + 150, cy]]);
for (let i = 1; i <= 12; i++) { const d = 150 - 11 * i; await touch('touchMove', [[cx - d, cy], [cx + d, cy]]); await sleep(16); }
await touch('touchEnd', []); await sleep(100);
z = await Z(); ok('pinch out returns toward fit', z.z < 1.6, 'z=' + z.z.toFixed(2));
await page.click('#zFit'); z = await Z(); ok('Fit resets', z.z === 1 && z.tx === 0 && z.ty === 0);
// buttons
for (let i = 0; i < 6; i++) await page.click('#zIn'); z = await Z(); ok('+ button caps at 8x', Math.abs(z.z - 8) < 1e-6, 'z=' + z.z);
await page.click('#zFit');
// double tap
b = await box(); await page.touchscreen.tap(b.x + 100, b.y + 100); await sleep(60); await page.touchscreen.tap(b.x + 100, b.y + 100); await sleep(400);
z = await Z(); const lt = await page.evaluate(() => __gfZoom.lastTap); ok('double-tap zooms to 3x without selecting', Math.abs(z.z - 3) < 0.01 && lt === null, `z=${z.z} lastTap=${JSON.stringify(lt)}`);
await page.touchscreen.tap(b.x + 100, b.y + 100); await sleep(60); await page.touchscreen.tap(b.x + 100, b.y + 100); await sleep(400);
z = await Z(); ok('double-tap again resets', z.z === 1);
// tap accuracy at 4x and 8x, several modes
async function tapTest(zoom, mode, label) {
  await page.click('#zFit'); await page.evaluate((zm) => { const c = document.querySelector('#rCv'); __gfZoom.zoomAt(c.clientWidth * 0.62, c.clientHeight * 0.55, zm); }, zoom);
  await page.click(`#rModes [data-m="${mode}"]`); await page.evaluate(() => { __gfZoom.lastTap = null; document.querySelector('#rCv').scrollIntoView({ block: 'center' }); }); await sleep(100);
  const worst = [];
  for (const [fx, fy] of [[0.3, 0.3], [0.7, 0.45], [0.5, 0.8], [0.2, 0.65]]) {
    await page.evaluate(() => document.querySelector('#rCv').scrollIntoView({ block: 'center' })); await sleep(60);
    const r = await page.evaluate(() => { const c = document.querySelector('#rCv'), bb = c.getBoundingClientRect(), V = __gfZoom.V, k = bb.width / __gfZoom.rectW(); return { bb: bb.toJSON(), V: { ...V }, k }; });
    const sx = r.bb.x + r.bb.width * fx, sy = r.bb.y + r.bb.height * fy;
    const ex = (sx - r.bb.x - r.V.tx) / (r.k * r.V.z), ey = (sy - r.bb.y - r.V.ty) / (r.k * r.V.z);
    await page.touchscreen.tap(sx, sy); await sleep(420);
    const t = await page.evaluate(() => __gfZoom.lastTap); worst.push(Math.hypot(t[0] - ex, t[1] - ey));
    await sleep(350);
  }
  ok(`tap accuracy ${label} (${mode}) < 1 px`, Math.max(...worst) < 1, 'max err ' + Math.max(...worst).toFixed(4) + ' img px');
}
await tapTest(4, 'pick', '4x'); await tapTest(8, 'add', '8x');
// Smart modes: just ensure mapping through act() (model not loaded in headless test to save time): check lastTap
await tapTest(4, 'remove', '4x');
await page.click('#zFit');
await page.click('#rAuto'); await sleep(300); await page.click('#zFit'); await page.evaluate(() => document.querySelector('#rCv').scrollIntoView({ block: 'start' })); await page.evaluate(() => { const c = document.querySelector('#rCv'), q = __gfDebug.seg, o = __gfDebug.last.outline, v = o[Math.floor(o.length / 3)], k = c.clientWidth / __gfZoom.rectW(); __gfZoom.zoomAt((v[0] - q.x0) * q.s * k, (v[1] - q.y0) * q.s * k, 4); }); await sleep(100);
// end-to-end landmark: find a drawn outline pixel (blue stroke) on the canvas at 4x, tap exactly there, mapped point must lie on the outline within 1 image px
for (const zm of [4, 8]) {
  await page.click('#zFit'); await page.click('#rAuto'); await sleep(300); await page.click('#rModes [data-m="pick"]');
  await page.evaluate((zm) => { const c = document.querySelector('#rCv'), q = __gfDebug.seg, o = __gfDebug.last.outline, v = o[Math.floor(o.length / 3)], k = c.clientWidth / __gfZoom.rectW(); __gfZoom.zoomAt((v[0] - q.x0) * q.s * k, (v[1] - q.y0) * q.s * k, zm); c.scrollIntoView({ block: 'center' }); }, zm); await sleep(150);
  await page.evaluate(() => document.querySelector('#rCv').scrollIntoView({ block: 'start' })); await page.screenshot({ path: `screenshots/zoom-${zm}x-review.png` });
  const lm = await page.evaluate(() => { const c = document.querySelector('#rCv'), ctx = c.getContext('2d'), d = ctx.getImageData(0, 0, c.width, c.height).data, bb = c.getBoundingClientRect(), dpr = devicePixelRatio;
    const pts = []; for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) { const i = 4 * (y * c.width + x); if (d[i] > 100 && d[i] < 150 && d[i + 1] > 165 && d[i + 1] < 195 && d[i + 2] > 240) pts.push([x, y]); }
    if (!pts.length) return null; const p = pts[Math.floor(pts.length / 2)]; return { cx: bb.x + p[0] / dpr, cy: bb.y + p[1] / dpr, n: pts.length }; });
  if (!lm) { ok('outline visible at ' + zm + 'x', false); continue; }
  const pre = await page.evaluate(() => ({ o: __gfDebug.last.outline, s: __gfDebug.seg.s, x0: __gfDebug.seg.x0, y0: __gfDebug.seg.y0 }));
  await page.touchscreen.tap(lm.cx, lm.cy); await sleep(450);
  const t = await page.evaluate(() => __gfZoom.lastTap);
  const P = pre.o.map(([x, y]) => [(x - pre.x0) * pre.s, (y - pre.y0) * pre.s]); let best = 1e9;
  for (let i = 0; i < P.length; i++) { const A = P[i], B = P[(i + 1) % P.length], dx = B[0] - A[0], dy = B[1] - A[1], L = dx * dx + dy * dy || 1; const u = Math.max(0, Math.min(1, ((t[0] - A[0]) * dx + (t[1] - A[1]) * dy) / L)); best = Math.min(best, Math.hypot(t[0] - A[0] - u * dx, t[1] - A[1] - u * dy)); }
  ok(`landmark tap lands on drawn outline at ${zm}x (overlay aligned with mapping)`, best < 1, 'distance to outline ' + best.toFixed(3) + ' img px');
}
// desktop-style: mouse wheel + drag + click mapping
const dctx = await browser.newContext({ viewport: { width: 1000, height: 900 } }); const dp = await dctx.newPage();
await dp.goto(URL); await dp.waitForFunction(() => window.__gfReady); await dp.click('#btnAdd'); await dp.setInputFiles('#fLib', process.env.IMG || 'tests/synth/wrench_steel_t20_s107.jpg'); await dp.waitForSelector('#rCv', { timeout: 60000 }); await dp.waitForTimeout(400);
const db = await dp.locator('#rCv').boundingBox(); await dp.mouse.move(db.x + db.width / 2, db.y + db.height / 2); await dp.mouse.wheel(0, -600); await dp.waitForTimeout(100);
const dz = await dp.evaluate(() => __gfZoom.V.z); ok('wheel zooms (desktop)', dz > 1.5, 'z=' + dz.toFixed(2));
const t0 = await dp.evaluate(() => __gfZoom.V.tx); await dp.mouse.move(db.x + 200, db.y + 200); await dp.mouse.down(); await dp.mouse.move(db.x + 250, db.y + 230, { steps: 5 }); await dp.mouse.up();
const t1 = await dp.evaluate(() => ({ tx: __gfZoom.V.tx, lt: __gfZoom.lastTap })); ok('mouse drag pans, no select', Math.abs(t1.tx - t0) > 20 && t1.lt === null, `dtx=${(t1.tx - t0).toFixed(1)}`);
await dp.evaluate(() => { const c = document.querySelector('#rCv'); __gfZoom.zoomAt(c.clientWidth * 0.4, c.clientHeight * 0.4, 5); });
const rr = await dp.evaluate(() => { const bb = document.querySelector('#rCv').getBoundingClientRect(), V = __gfZoom.V; return { bb: bb.toJSON(), V, k: bb.width / __gfZoom.rectW() }; });
const sx = rr.bb.x + 300, sy = rr.bb.y + 250; await dp.mouse.click(sx, sy); const mt = await dp.evaluate(() => __gfZoom.lastTap);
const ex = (300 - rr.V.tx) / (rr.k * rr.V.z), ey = (250 - rr.V.ty) / (rr.k * rr.V.z); ok('desktop click mapping < 1 px', Math.hypot(mt[0] - ex, mt[1] - ey) < 1, `err ${Math.hypot(mt[0] - ex, mt[1] - ey).toFixed(4)}`);
// drag without moving far on touch: tap with 3px jitter still selects
ok('no page errors', errs.length === 0, JSON.stringify(errs));
const fails = results.filter((r) => !r[1]).length; console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); await browser.close(); process.exit(fails ? 1 : 0);
