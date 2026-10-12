import { chromium } from 'playwright';
const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage(); await page.addInitScript(() => { localStorage.setItem('gf-intro-done', '1'); localStorage.setItem('gf-more-review', '1'); localStorage.setItem('gf-more-obj', '1'); });
await page.goto('http://localhost:8123/'); await page.waitForFunction(() => window.__gfReady);
for (const f of process.argv.slice(2)) {
  await page.click('#btnAdd'); await page.setInputFiles('#fLib', `tests/real/${f}.jpg`); await page.waitForSelector('#rCv', { timeout: 90000 });
  console.log(f, JSON.stringify(await page.evaluate(() => { const s = window.__gfDebug.seg, o = {}; const pts = {}; for (const t of [8,12,16,20,25,30,40,50,60]) { let a = 0; for (let i = 0; i < s.dist.length; i++) if (s.dist[i] > t) a++; o[t] = Math.round(a / 16); } return { auto: s.autoTol, areaMM2_by_tol: o }; })));
  await page.click('[data-x]');
}
await browser.close();
