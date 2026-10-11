// Headless UI: Save material toggle, estimate in Bin dialog, 3D view and cutaway at 390x844 (screenshots save-*.png)
import { chromium } from 'playwright';
import { SETS } from './arrange_lib.mjs';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark' });
const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(process.env.URL || 'http://localhost:8123/'); await page.waitForFunction(() => window.__gfReady); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.__gfReady);
await page.evaluate((o) => { for (const p of o) window.__gf.addOutline(p); window.__gf.state.project.objects.forEach((x) => { x.depth = 12; }); window.__gf.refresh(); }, SETS.s5());
await page.click('#btnArr'); await page.waitForFunction(() => !document.querySelector('#btnArr').disabled && /cells|need|Could/.test(document.querySelector('#arrMsg').textContent), null, { timeout: 30000 });
await page.click('#btnBin'); await page.locator('#svOn').click(); await page.waitForFunction(() => /Estimated material saving/.test(document.querySelector('#svEst')?.textContent || ''), null, { timeout: 30000 });
console.log(await page.textContent('#svEst')); await page.screenshot({ path: 'screenshots/save-1-bin-dialog.png' }); await page.click('#dClose');
await page.click('#viewSeg [data-view="3d"]'); await page.waitForFunction(() => window.__gf3dRendered > 0, null, { timeout: 30000 }); await page.waitForTimeout(500); await page.screenshot({ path: 'screenshots/save-2-3d.png' });
await page.click('#btnCut'); await page.waitForTimeout(900); await page.screenshot({ path: 'screenshots/save-3-3d-cutaway.png' });
// export STL with the toggle on
await page.click('#viewSeg [data-view="plan"]'); const sz = await page.evaluate(() => { window.__gf.exportAll('stl'); return window.__gfLastExport && window.__gfLastExport.size; }); console.log('stl bytes', sz);
console.log('errors', errs); await browser.close(); process.exit(errs.length ? 1 : 0);
