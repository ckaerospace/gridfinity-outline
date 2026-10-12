// screenshot of the 3D view for a real outline, depth 10, 3 notches. usage: node tests/shot_depth10.mjs out.png
import { chromium } from 'playwright'; import fs from 'fs';
const URL = process.env.URL || 'http://localhost:8123/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark' });
const page = await ctx.newPage(); await page.addInitScript(() => { localStorage.setItem('gf-intro-done', '1'); localStorage.setItem('gf-more-review', '1'); localStorage.setItem('gf-more-obj', '1'); }); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(URL); await page.waitForFunction(() => window.__gfReady); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.__gfReady);
const outline = JSON.parse(fs.readFileSync('tests/real/real-floss-blue-hard-shadow-final.outline.json'));
const info = await page.evaluate((o) => { window.__gf.addOutline(o); const p = window.__gf.state.project; const ob = p.objects[0]; ob.depth = 10; ob.notches = [0.05, 0.4, 0.75]; window.__gf.refresh(); const a = window.__gf.analyze(); return { nx: a.nx, ny: a.ny, H: a.H, d: a.objects[0].eff.depth }; }, outline);
console.log(JSON.stringify(info));
await page.click('#viewSeg [data-view="3d"]'); await page.waitForFunction(() => window.__gf3dRendered > 0, null, { timeout: 30000 }); await page.waitForTimeout(800);
await page.screenshot({ path: process.argv[2] || 'screenshots/depth10-3d.png' }); console.log('errors', JSON.stringify(errs)); await browser.close();
