import { chromium } from 'playwright';
import fs from 'fs';
const URL = process.env.URL || 'http://localhost:8123/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, acceptDownloads: true, colorScheme: process.env.SCHEME || 'dark' });
const page = await ctx.newPage(); await page.addInitScript(() => { localStorage.setItem('gf-intro-done', '1'); localStorage.setItem('gf-more-review', '1'); localStorage.setItem('gf-more-obj', '1'); });
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const shot = (n) => page.screenshot({ path: `screenshots/${n}.png` });
await page.goto(URL); await page.waitForFunction(() => window.__gfReady); await page.evaluate(() => { localStorage.clear(); });
await page.reload(); await page.waitForFunction(() => window.__gfReady);
await shot('01-empty');
async function capture(file, tag) {
  await page.click('#btnAdd'); await page.waitForSelector('#fLib', { state: 'attached' });
  if (tag === 'pick') await shot('02-capture-pick');
  await page.setInputFiles('#fLib', file); await page.waitForSelector('#rCv', { timeout: 60000 });
  await page.waitForTimeout(200);
  if (tag === 'review') await shot('03-review-outline');
  await page.click('#rUse'); await page.waitForTimeout(300);
}
await capture('tests/synth/wrench_steel_t20_s107.jpg', 'review');
await capture('tests/synth/rect50x30_red_t35_s102.jpg');
await capture('tests/synth/circle40_dark_t15_s104.jpg');
// per-object depth: select object 2 -> set depth 10 via number field; object 1 depth 28 via slider/number
const setNum = async (label, v) => { await page.evaluate(() => document.querySelectorAll('#objPanel details.more').forEach((d) => { d.open = true; localStorage.setItem('gf-more-obj', '1'); })); const row = page.locator('.row', { hasText: label }).first(); await row.locator('input[type=number]').fill(String(v)); await row.locator('input[type=number]').dispatchEvent('change'); await page.waitForTimeout(100); };
await page.locator('.chip').nth(0).click(); await setNum('Depth', 28);
await page.locator('.chip').nth(1).click(); await setNum('Depth', 10); await setNum('Margin', 3);
await page.locator('.chip').nth(2).click(); await setNum('Depth', 18);
// drag object 3 a bit
const box = await page.locator('#plan').boundingBox();
// notch on object 2
await page.locator('.chip').nth(1).click();
await page.click('#aNotch');
const pt = await page.evaluate(() => { const svg = document.querySelector('#plan'); const g = svg.__geoms[1]; const p = g.pocket[0]; const m = svg.getScreenCTM(); return [p[0] * m.a + m.e, p[1] * m.d + m.f]; });
const pb = await page.locator('#plan').boundingBox(); await page.touchscreen.tap(pb.x + pt[0] - 0, pb.y + pt[1] - 0 + 0).catch(() => {});
await page.waitForTimeout(200);
// ensure a notch exists (fallback through mouse click on svg coordinates)
let nn = await page.evaluate(() => window.__gf.state.project.objects[1].notches.length);
if (!nn) { await page.click('#aNotch'); await page.mouse.click(pb.x + pt[0], pb.y + pt[1]); await page.waitForTimeout(200); nn = await page.evaluate(() => window.__gf.state.project.objects[1].notches.length); }
console.log('notches on obj2:', nn);
await setNum('Notch size', 14);
// drag object 3 via pointer events on its centroid
const c3 = await page.evaluate(() => { const svg = document.querySelector('#plan'); const o = window.__gf.state.project.objects[2]; const m = svg.getScreenCTM(); return [o.x * m.a + m.e, o.y * m.d + m.f]; });
await page.mouse.move(pb.x + c3[0], pb.y + c3[1]); await page.mouse.down(); await page.mouse.move(pb.x + c3[0] + 25, pb.y + c3[1] + 18, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
await page.locator('.chip').nth(1).click(); await page.waitForTimeout(150);
console.log('AT SHOT', JSON.stringify(await page.evaluate(() => { const a = window.__gf.analyze(); return [a.objects.map((o) => o.issues), window.__gf.state.an.objects.map((o) => o.issues)]; })), JSON.stringify(await page.evaluate(() => window.__gf.state.project.objects.map((o) => [o.x, o.y, o.rot])))); await shot('04-plan-layout');
await page.click('#viewSeg [data-view="3d"]'); await page.waitForFunction(() => window.__gf3dRendered > 0, null, { timeout: 30000 }); await page.waitForTimeout(600);
await shot('05-3d-view');
await page.click('#viewSeg [data-view="plan"]');
await page.click('#btnBin'); await page.waitForTimeout(200); await shot('06-bin-settings'); await page.mouse.click(10, 10); await page.waitForTimeout(100);
// exports
fs.mkdirSync('samples', { recursive: true });
for (const [k, name] of [['stl', 'sample-bin.stl'], ['svg', 'sample-layout.svg'], ['dxf', 'sample-layout.dxf'], ['osvg', 'sample-object2.svg'], ['odxf', 'sample-object2.dxf']]) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate((k) => window.__gf.exportAll(k, window.__gf.state.project.objects[1]), k)]);
  await dl.saveAs('samples/' + name); console.log('saved', name, fs.statSync('samples/' + name).size);
}
const an = await page.evaluate(() => { const a = window.__gf.analyze(); return { nx: a.nx, ny: a.ny, hu: a.hu, H: a.H, objs: a.objects.map((o) => ({ depth: o.eff.depth, issues: o.issues })) }; });
console.log(JSON.stringify(an)); console.log('ERRORS', JSON.stringify(errs));
fs.writeFileSync('samples/project.json', JSON.stringify(await page.evaluate(() => window.__gf.state.project)));
await browser.close();
