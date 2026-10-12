// Headless UI test for Auto arrange at 390x844: button flow, undo, lock, options. Screenshots in screenshots/.
import { chromium } from 'playwright';
import { SETS, REALSETS } from './arrange_lib.mjs';
const URL = process.env.URL || 'http://localhost:8123/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark' });
const page = await ctx.newPage(); await page.addInitScript(() => { localStorage.setItem('gf-intro-done', '1'); localStorage.setItem('gf-more-review', '1'); localStorage.setItem('gf-more-obj', '1'); }); const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(URL); await page.waitForFunction(() => window.__gfReady); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.__gfReady);
let fails = 0; const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const outs = SETS.s7();
await page.evaluate((o) => { for (const p of o) window.__gf.addOutline(p); window.__gf.state.project.objects.forEach((x, i) => { if (i % 3 === 0) x.notches = [0.25]; }); window.__gf.refresh(); }, outs);
await page.waitForTimeout(300);
const pos = () => page.evaluate(() => window.__gf.state.project.objects.map((o) => [o.x, o.y, o.rot]));
const cells = () => page.evaluate(() => { const a = window.__gf.analyze(); return [a.nx, a.ny, a.objects.some((x) => x.issues.some((s) => !s.startsWith('depth')))]; });
const before = await pos(), c0 = await cells();
check(await page.locator('#btnArr').isVisible(), 'Auto arrange button visible in plan view'); check(await page.locator('#btnArrUndo').isHidden(), 'Undo hidden before arrange');
await page.screenshot({ path: 'screenshots/arr-1-before.png' });
// Wall = 1.2 mm here so the comparison with the old placement is fair
await page.click('#btnArrOpt'); await page.waitForSelector('#sheetDlg:not([hidden]) input[type=number]');
await page.locator('#sheetDlg input[type=number]').fill('1.2'); await page.locator('#sheetDlg input[type=number]').dispatchEvent('change'); await page.click('#arClose');
const t0 = Date.now(); await page.click('#btnArr'); await page.waitForFunction(() => !document.querySelector('#btnArr').disabled && !/^Packing/.test(document.querySelector('#arrMsg').textContent), null, { timeout: 30000 });
console.log('arrange took', Date.now() - t0, 'ms;', await page.textContent('#arrMsg'));
const c1 = await cells(); check(!c1[2], 'no overlaps / outside issues after arrange'); check(c1[0] * c1[1] <= c0[0] * c0[1], `cells ${c0[0]}x${c0[1]} -> ${c1[0]}x${c1[1]}`);
check(await page.locator('#btnArrUndo').isVisible(), 'Undo visible after arrange');
await page.screenshot({ path: 'screenshots/arr-2-after.png' });
const after = await pos(); check(JSON.stringify(after) !== JSON.stringify(before), 'layout changed');
await page.click('#btnArrUndo'); await page.waitForTimeout(300);
check(JSON.stringify(await pos()) === JSON.stringify(before), 'undo restores positions and rotations'); check((await cells()).join() === c0.join(), 'undo restores cell count');
await page.click('#btnArr'); await page.waitForFunction(() => !document.querySelector('#btnArr').disabled && !/^Packing/.test(document.querySelector('#arrMsg').textContent), null, { timeout: 30000 });
// lock: lock object 1, arrange again, it must not move
await page.locator('.chip').nth(0).click(); await page.click('#aLock'); const locked = (await pos())[0];
await page.click('#btnArr'); await page.waitForFunction(() => !document.querySelector('#btnArr').disabled && !/^Packing/.test(document.querySelector('#arrMsg').textContent), null, { timeout: 30000 });
check(JSON.stringify((await pos())[0]) === JSON.stringify(locked), 'locked object did not move'); check(!(await cells())[2], 'no issues with a locked object');
// too-large wall -> clear message
await page.evaluate(() => { window.__gf.state.project.arrange.wall = 10; });
await page.click('#btnArr'); await page.waitForFunction(() => !document.querySelector('#btnArr').disabled && !/^Packing/.test(document.querySelector('#arrMsg').textContent), null, { timeout: 30000 });
console.log('wall 10:', await page.textContent('#arrMsg'));
check(errs.length === 0, 'no console errors ' + errs.join('|'));
await browser.close(); process.exit(fails ? 1 : 0);
