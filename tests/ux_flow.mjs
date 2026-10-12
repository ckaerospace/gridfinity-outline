// v9 UX + features: intro, step bar, ruler, undo/redo, long-press edit, projects (IndexedDB), lip/magnet toggles, estimate. Screenshots at 390x844.
import { chromium } from 'playwright';
import fs from 'fs';
const URL = process.env.URL || 'http://localhost:8123/', SCHEME = process.env.SCHEME || 'dark', D = 'screenshots/v9' + (SCHEME === 'light' ? '-light' : '');
fs.mkdirSync(D, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, acceptDownloads: true, colorScheme: SCHEME, serviceWorkers: 'block' });
const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const shot = (n) => page.screenshot({ path: `${D}/${n}.png` });
let fails = 0; const check = (name, ok, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!ok) fails++; };
const ev = (f, a) => page.evaluate(f, a);
await page.goto(URL); await ev(() => { localStorage.clear(); indexedDB.deleteDatabase('gf-outline'); }); await page.reload(); await page.waitForFunction(() => window.__gfReady);
// intro
check('intro shows on first run', await page.isVisible('#intro'));
await shot('00-intro-1'); await page.click('#inNext'); await shot('00-intro-2'); await page.click('#inNext'); await shot('00-intro-3');
await page.click('#inNext'); check('intro dismissed + remembered', !(await page.isVisible('#intro')) && (await ev(() => localStorage.getItem('gf-intro-done'))) === '1');
await page.reload(); await page.waitForFunction(() => window.__gfReady); check('intro not shown again', !(await page.isVisible('#intro')));
await shot('01-empty');
// photo step
await page.click('#btnAdd'); await page.waitForSelector('#fLib', { state: 'attached' });
check('step bar shows Photo', (await page.textContent('#capture .steps .on')).includes('Photo')); await shot('02-photo');
await page.setInputFiles('#fLib', 'tests/synth/rect50x30_red_t35_s102.jpg'); await page.waitForSelector('#rCv', { timeout: 60000 }); await page.waitForTimeout(300);
check('step bar shows Outline', (await page.textContent('#capture .steps .on')).includes('Outline')); await shot('03-outline');
// ruler: tap the two short-edge midpoints of the traced rect (outline mm -> canvas px)
await page.click('#rModes [data-m="measure"]');
const pts = await ev(() => { const d = window.__gfDebug.last, o = d.outlineCorr || d.outline, xs = o.map((p) => p[0]), ys = o.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), cy = (Math.min(...ys) + Math.max(...ys)) / 2; return { x0, x1, cy, w: x1 - x0 }; });
const tapMM = async (mx, my) => { const xy = await ev(([mx, my]) => { const g = window.__gfDebug.seg, c = document.querySelector('#rCv'), b = c.getBoundingClientRect(), V = window.__gfZoom.V, k = b.width / window.__gfZoom.rectW();
  return [b.left + (mx - g.x0) * g.s * k * V.z + V.tx, b.top + (my - g.y0) * g.s * k * V.z + V.ty]; }, [mx, my]); await page.touchscreen.tap(xy[0], xy[1]); await page.waitForTimeout(700); };
await tapMM(pts.x0, pts.cy); await tapMM(pts.x1, pts.cy);
const ruler = await ev(() => window.__gfDebug.ruler);
check('ruler measures traced width (±1.5 mm of outline bbox)', ruler && Math.abs(ruler - pts.w) < 1.5, `ruler ${ruler && ruler.toFixed(1)} vs outline ${pts.w.toFixed(1)}`);
await shot('04-ruler');
await page.click('#rModes [data-m="pick"]'); await page.click('#rUse'); await page.waitForTimeout(400);
check('photo thumbnail stored', await ev(() => !!window.__gf.state.project.objects[0].photo));
check('step bar back on Bin', (await page.textContent('#steps .on')).includes('Bin'));
const add = async (f) => { await page.click('#btnAdd'); await page.setInputFiles('#fLib', f); await page.waitForSelector('#rCv', { timeout: 60000 }); await page.waitForTimeout(200); await page.click('#rUse'); await page.waitForTimeout(400); };
await add('tests/synth/circle40_dark_t15_s104.jpg'); await add('tests/synth/wrench_steel_t20_s107.jpg');
await page.waitForFunction(() => /min/.test(document.querySelector('#estT')?.textContent || ''), null, { timeout: 15000 });
check('stats show size + print estimate', /u/.test(await page.textContent('#stats')) && /min · \d+ g/.test(await page.textContent('#estT')), await page.textContent('#stats'));
await shot('05-bin');
// undo/redo: change depth, undo restores, redo reapplies
await page.waitForTimeout(500);
const d0 = await ev(() => window.__gf.state.an.objects.find((o) => o.id === window.__gf.state.sel).eff.depth);
const row = page.locator('#objPanel .row', { hasText: 'Depth' }).first(); await row.locator('input[type=number]').fill('33'); await row.locator('input[type=number]').dispatchEvent('change'); await page.waitForTimeout(600);
await page.click('#btnUndo'); await page.waitForTimeout(200);
const d1 = await ev(() => window.__gf.state.an.objects.find((o) => o.id === window.__gf.state.sel).eff.depth);
await page.click('#btnRedo'); await page.waitForTimeout(200);
const d2 = await ev(() => window.__gf.state.an.objects.find((o) => o.id === window.__gf.state.sel).eff.depth);
check('undo/redo depth', d1 === d0 && d2 === 33, `${d0} -> undo ${d1} -> redo ${d2}`);
// remove + undo brings it back
const n0 = await ev(() => window.__gf.state.project.objects.length);
await ev(() => document.querySelectorAll('#objPanel details.more').forEach((d) => (d.open = true))); await page.waitForTimeout(100); await shot('06-more');
await page.click('#aDel'); await page.waitForTimeout(600); const n1 = await ev(() => window.__gf.state.project.objects.length);
await page.click('#btnUndo'); await page.waitForTimeout(200); const n2 = await ev(() => window.__gf.state.project.objects.length);
check('remove + undo', n1 === n0 - 1 && n2 === n0, `${n0} ${n1} ${n2}`);
// long-press object in plan -> edit sheet; rename + depth
const c = await ev(() => { const svg = document.querySelector('#plan'), o = window.__gf.state.project.objects[0], m = svg.getScreenCTM(); return [o.x * m.a + m.e, o.y * m.d + m.f]; });
await page.mouse.move(c[0], c[1]); await page.mouse.down(); await page.waitForTimeout(750); await page.mouse.up(); await page.waitForTimeout(200);
check('long-press opens edit sheet', await page.isVisible('#oName'));
await page.fill('#oName', 'Floss box'); await page.locator('#oDepth input[type=number]').fill('12'); await page.locator('#oDepth input[type=number]').dispatchEvent('change'); await page.waitForTimeout(150);
await shot('07-longpress-edit'); await page.click('#oDone'); await page.waitForTimeout(200);
check('rename + depth via sheet', await ev(() => { const o = window.__gf.state.project.objects[0]; return o.name === 'Floss box' && o.depth === 12; }));
// bin sheet: lip + magnets
await page.click('#btnBin'); await page.waitForTimeout(150); await shot('08-bin-sheet');
await page.click('#cLip + *, #cLip', { force: true }).catch(() => page.check('#cLip', { force: true })); await page.waitForTimeout(300);
await page.check('#cMag', { force: true }); await page.waitForTimeout(300);
const pr = await ev(() => ({ lip: window.__gf.state.project.lip, mag: window.__gf.state.project.magnets, Htot: window.__gf.state.an.Htot, H: window.__gf.state.an.H }));
check('lip + magnets toggled', pr.lip && pr.mag && Math.abs(pr.Htot - pr.H - 4.4) < 1e-6, JSON.stringify(pr));
await page.mouse.click(195, 30); await page.waitForTimeout(150);
const bad = await ev(() => window.__gf.state.an.objects.filter((o) => o.issues.some((s) => !s.startsWith('depth'))).length);
if (bad) { await page.click('#btnArr'); await page.waitForFunction(() => !document.querySelector('#btnArr').disabled, null, { timeout: 20000 }); await page.waitForTimeout(300); }
const bad2 = await ev(() => window.__gf.state.an.objects.filter((o) => o.issues.some((s) => !s.startsWith('depth'))).length);
check('layout valid with lip (after arrange if needed)', bad2 === 0, `before ${bad} after ${bad2}`);
await page.click('#viewSeg [data-view="3d"]'); await page.waitForFunction(() => window.__gf3dRendered > 0, null, { timeout: 30000 }); await page.waitForTimeout(800); await shot('09-3d-lip');
await page.click('#viewSeg [data-view="plan"]');
// export
await page.click('#btnExport'); await page.waitForTimeout(150); check('step bar shows Export', (await page.textContent('#steps .on')).includes('Export')); await shot('10-export');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-k="stl"]')]); fs.mkdirSync('samples', { recursive: true }); await dl.saveAs('samples/ux-lip-magnets.stl');
check('STL downloaded', fs.statSync('samples/ux-lip-magnets.stl').size > 10000);
// projects: saved to IndexedDB, survives reload, new project, switch back
await page.waitForTimeout(900); await ev(() => window.__gf.persist());
await page.reload(); await page.waitForFunction(() => window.__gfReady); await page.waitForTimeout(300);
const after = await ev(() => ({ n: window.__gf.state.project.objects.length, photo: !!window.__gf.state.project.objects[0]?.photo, lip: window.__gf.state.project.lip, name: window.__gf.state.project.objects[0]?.name }));
check('project restored after reload (with photos)', after.n === 3 && after.photo && after.lip && after.name === 'Floss box', JSON.stringify(after));
await page.click('#btnProjects'); await page.waitForSelector('.projlist li'); await page.waitForTimeout(300); await shot('11-projects');
await page.click('#pjNew'); await page.waitForTimeout(300);
check('new project is empty', await ev(() => window.__gf.state.project.objects.length === 0));
await add('tests/synth/circle40_dark_t15_s104.jpg'); await page.waitForTimeout(900);
await page.click('#btnProjects'); await page.waitForFunction(() => document.querySelectorAll('.projlist li').length === 2, null, { timeout: 5000 }).catch(() => {});
const cnt = await page.locator('.projlist li').count(); check('two projects listed', cnt === 2, String(cnt)); await shot('12-projects-2');
await page.locator('.projlist li').nth(1).locator('.pjopen').click(); await page.waitForTimeout(400);
check('switch back to first project', await ev(() => window.__gf.state.project.objects.length === 3 && window.__gf.state.project.lip));
// rename via menu, delete second
await page.click('#btnProjects'); await page.waitForSelector('.projlist li'); await page.locator('.projlist li').first().locator('.pjmenu').click(); await page.fill('#pjName', 'Bathroom drawer'); await page.click('#pjOk'); await page.waitForTimeout(300);
check('rename project', (await page.textContent('.projlist li.cur b')) === 'Bathroom drawer');
await page.locator('.projlist li').nth(1).locator('.pjmenu').click(); await page.click('#pjDel'); await page.click('#pjDel'); await page.waitForTimeout(300);
check('delete project (2-tap confirm)', (await page.locator('.projlist li').count()) === 1); await page.click('#pjBack');
// failure hint: sheet corners not found
const noSheet = 'tests/synth_nosheet.jpg';
if (noSheet) { await page.click('#btnAdd'); await page.setInputFiles('#fLib', noSheet); await page.waitForFunction(() => /Find the sheet/.test(document.querySelector('#capture h2')?.textContent || ''), null, { timeout: 60000 });
  check('sheet-corners hint shown', /Couldn.t find the sheet corners/.test(await page.textContent('#capture'))); await shot('13-hint-corners'); await page.click('[data-x]'); }
console.log('ERRORS', JSON.stringify(errs)); check('no page errors', errs.length === 0);
console.log(fails ? `FAILED ${fails}` : 'ALL PASS'); await browser.close(); process.exit(fails ? 1 : 0);
