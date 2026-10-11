// Auto arrange regression: synthetic sets (5..12 mixed shapes) and real outlines.
// usage: node tests/arrange_test.mjs   (prints a table: cells before (old auto placement) vs after, density, min wall, ms)
import { arrange } from '../dist/js/pack.js';
import { SETS, REALSETS, oldPlacement, toPackObjects, validateManifold, projectCells } from './arrange_lib.mjs';
import { initManifold } from '../dist/js/bin.js';
import { area } from '../dist/js/geom.js'; const areaOf = (p) => area(p);
await initManifold();
const all = { ...SETS, ...REALSETS }; let fails = 0; const rows = [];
const WALLS = (process.env.WALLS || '3,1.2').split(',').map(Number);
for (const [name, mk] of Object.entries(all)) for (const wall of WALLS) {
  const outs = mk(), before = await oldPlacement(outs), b = projectCells(before);
  const objs = toPackObjects(before), r = arrange(objs, { wall, allowRot: true, budgetMs: +process.env.BUDGET || 2200 });
  if (!r.ok) { rows.push([name, outs.length, wall, `${b.nx}x${b.ny}`, 'FAIL', r.reason]); fails++; continue; }
  const after = JSON.parse(JSON.stringify(before)); for (const p of r.placements) { const o = after.objects.find((q) => q.id === p.id); o.x = p.x; o.y = p.y; o.rot = p.rot; }
  const v = await validateManifold(after, wall), a = v.an, ok = v.overlapArea < 1e-3 && v.issues.length === 0 && v.minOuter >= 1.2 - 0.01 && r.minGap >= wall - 0.005 && a.nx === r.nx && a.ny === r.ny;
  const polyA = a._items.reduce((s, it) => s + it.pk.area(), 0);
  // effective density: every pocket grown by half the wall (so neighbouring pockets touch at the wall midline), notch discs ignored
  const effA = after.objects.reduce((s, o, i) => { const m = a.objects[i].eff.margin + wall / 2, pl = o.outline; let per = 0; for (let k = 0; k < pl.length; k++) { const u = pl[k], v = pl[(k + 1) % pl.length]; per += Math.hypot(u[0] - v[0], u[1] - v[1]); } return s + Math.abs(areaOf(pl)) + per * m + Math.PI * m * m; }, 0);
  rows.push([name, outs.length, wall, `${b.nx}x${b.ny}=${b.cells}`, `${a.nx}x${a.ny}=${a.nx * a.ny}`, `gap ${r.minGap.toFixed(2)}`, `outer ${v.minOuter.toFixed(2)}`, `eff.density ${(100 * effA / (a.W * a.D)).toFixed(0)}% | density ${(100 * polyA / (a.W * a.D)).toFixed(0)}% (was ${(100 * b.an._items.reduce((s, it) => s + it.pk.area(), 0) / (b.an.W * b.an.D)).toFixed(0)}%)`, `${r.stats.ms} ms`, `trials ${r.stats.trials}`, ok ? 'OK' : 'FAIL', `manifold overlap ${v.overlapArea.toExponential(1)}`]);
  if (!ok) fails++;
}
// locked object: must not move; everything else packs around it
{ const outs = SETS.s7(), proj = await oldPlacement(outs), objs = toPackObjects(proj); const pre = arrange(objs, { wall: 3, budgetMs: 1200 }); for (const p of pre.placements) { const o = objs.find((z) => z.id === p.id); o.x = p.x; o.y = p.y; o.rot = p.rot; proj.objects.find((z) => z.id === p.id).x = p.x; proj.objects.find((z) => z.id === p.id).y = p.y; proj.objects.find((z) => z.id === p.id).rot = p.rot; }
  objs[0].locked = true; objs[1].x += 7; objs[1].y += 3; const keep = [objs[0].x, objs[0].y, objs[0].rot];
  const r = arrange(objs, { wall: 3, budgetMs: 2200 }); const q = r.ok && r.placements.find((p) => p.id === objs[0].id);
  const after = JSON.parse(JSON.stringify(proj)); if (r.ok) for (const p of r.placements) { const o = after.objects.find((z) => z.id === p.id); o.x = p.x; o.y = p.y; o.rot = p.rot; }
  const v = r.ok ? await validateManifold(after, 3) : null; const ok = r.ok && q.x === keep[0] && q.y === keep[1] && q.rot === keep[2] && v.overlapArea < 1e-3 && v.issues.length === 0;
  console.log('locked s7 | ' + (r.ok ? `${r.nx}x${r.ny} locked obj unchanged=${q.x === keep[0] && q.y === keep[1]} ${r.stats.ms} ms` : r.reason) + ' | ' + (ok ? 'OK' : 'FAIL')); if (!ok) fails++; }
// rotation off keeps every rotation
{ const proj = await oldPlacement(SETS.s5()), objs = toPackObjects(proj); const r = arrange(objs, { wall: 3, allowRot: false, budgetMs: 1500 }); const ok = r.ok && r.placements.every((p, i) => p.rot === objs[i].rot);
  console.log('no-rotation s5 | ' + (r.ok ? `${r.nx}x${r.ny}` : r.reason) + ' | ' + (ok ? 'OK' : 'FAIL')); if (!ok) fails++; }
for (const r of rows) console.log(r.join(' | '));
console.log(fails ? `${fails} FAILED` : 'ALL OK'); process.exit(fails ? 1 : 0);
