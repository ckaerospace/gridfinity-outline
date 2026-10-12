import { chromium } from 'playwright';
const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage(); await page.addInitScript(() => { localStorage.setItem('gf-intro-done', '1'); localStorage.setItem('gf-more-review', '1'); localStorage.setItem('gf-more-obj', '1'); });
await page.goto('http://localhost:8123/'); await page.waitForFunction(() => window.__gfReady);
await page.click('#btnAdd'); await page.setInputFiles('#fLib', 'tests/real/real-white-part-soft-shadow.jpg'); await page.waitForSelector('#rCv', { timeout: 90000 });
console.log(JSON.stringify(await page.evaluate(() => { const s = window.__gfDebug.seg, o = {}; for (const [k,x,y] of [['shadow',312,450],['shadow2',310,350],['rim',327,450],['body',380,400],['body2',400,470],['paper',250,450]]) { const i = y*s.w+x; o[k] = [+s.M[i].toFixed(3), +s.C[i].toFixed(3), +s.dist[i].toFixed(1)]; } o.tol = window.__gfDebug.last.tol; o.row = []; for (let x = 295; x < 345; x += 3) { const i = 450*s.w+x; o.row.push([x, +s.M[i].toFixed(2), +s.C[i].toFixed(3), +s.dist[i].toFixed(0)].join(':')); } return o; })));
await browser.close();
