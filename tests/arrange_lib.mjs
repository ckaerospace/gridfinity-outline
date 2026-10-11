// shared helpers for the Auto arrange tests: synthetic shapes, real outlines, old placement, exact validation with manifold
import fs from 'fs';
import { initManifold, analyze, findSpot, effective } from '../dist/js/bin.js';
import { centroid, area, ensureCCW } from '../dist/js/geom.js';
export const circle = (r, n = 48) => Array.from({ length: n }, (_, i) => [r * Math.cos(i / n * 2 * Math.PI), r * Math.sin(i / n * 2 * Math.PI)]);
export const rrect = (w, h, r = 2, n = 6) => { const p = [], c = [[w / 2 - r, h / 2 - r], [-w / 2 + r, h / 2 - r], [-w / 2 + r, -h / 2 + r], [w / 2 - r, -h / 2 + r]]; c.forEach((q, k) => { for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + k * Math.PI / 2 + i / n * Math.PI / 2; p.push([q[0] + r * Math.cos(a), q[1] + r * Math.sin(a)]); } }); return p; };
export const poly = (pts) => { const c = centroid(pts); return pts.map(([x, y]) => [x - c[0], y - c[1]]); };
export const lshape = (a, b, t) => poly([[0, 0], [a, 0], [a, t], [t, t], [t, b], [0, b]]);
// open-end wrench: handle + ring head (circle with a slot)
export function wrench(len, hw, hr) {
  const pts = []; const n = 24; // head: circle radius hr at x=0 with slot opening toward -x; handle width hw to +x
  for (let i = 0; i <= n; i++) { const a = (-150 + 300 * i / n) * Math.PI / 180; pts.push([hr * Math.cos(a), hr * Math.sin(a)]); }
  const e = hr * Math.cos(30 * Math.PI / 180); // approx join
  pts.push([hr * 0.9, hw / 2]); pts.push([len - hw / 2, hw / 2]);
  for (let i = 0; i <= 8; i++) { const a = (90 - 180 * i / 8) * Math.PI / 180; pts.push([len - hw / 2 + hw / 2 * Math.cos(a), hw / 2 * Math.sin(a)]); }
  pts.push([hr * 0.9, -hw / 2]);
  return poly(pts.slice(0, n + 1).concat(pts.slice(n + 1)));
}
export const SETS = {
  s5: () => [wrench(110, 14, 14), rrect(60, 30), circle(20), lshape(50, 40, 14), rrect(40, 25)],
  s7: () => [wrench(130, 16, 16), wrench(95, 12, 12), rrect(70, 35), rrect(35, 35), circle(18), circle(14), lshape(55, 45, 15)],
  s9: () => [wrench(140, 16, 16), wrench(110, 14, 13), wrench(80, 11, 11), rrect(65, 40), rrect(45, 20), circle(22), circle(12), lshape(50, 50, 16), lshape(40, 30, 12)],
  s12: () => [wrench(150, 18, 17), wrench(125, 15, 14), wrench(100, 12, 12), wrench(85, 10, 10), rrect(60, 38), rrect(50, 25), rrect(30, 30), circle(20), circle(15), circle(10), lshape(55, 45, 15), lshape(40, 28, 10)],
};
const R = (n) => JSON.parse(fs.readFileSync(new URL('./real/' + n, import.meta.url)));
export function realOutlines() {
  return ['real-floss-blue-hard-shadow-final2.outline.json', 'real-white-part-soft-shadow-final2.outline.json', 'real-white-part-far-hard-shadow-final2.outline.json'].map((n) => poly(R(n)));
}
export const REALSETS = { real3: () => realOutlines(), real6: () => [...realOutlines(), ...realOutlines()] };
export function newProject(outlines, { margin = 2, notch = 16, depth = 20, notchEvery = 3 } = {}) {
  const objs = outlines.map((outline, i) => ({ id: i + 1, name: 'Object ' + (i + 1), outline: ensureCCW(outline), x: 0, y: 0, rot: 0, margin: null, notch: null, depth: null, notches: i % notchEvery === 0 ? [0.25] : [] }));
  return { cells: { auto: true, nx: 1, ny: 1 }, height: { auto: true, hu: 3 }, floor: 2, defaults: { margin, notch, depth }, objects: objs };
}
// old behaviour: objects added one after another with findSpot (rotations 0/90, 2 mm scan, wall 1.2)
export async function oldPlacement(outlines, opts) {
  await initManifold(); const p = newProject(outlines, opts), objs = p.objects; p.objects = [];
  for (const o of objs) { const spot = findSpot(p, o, null); if (spot) Object.assign(o, spot); else { o.x = 30; o.y = 30; } p.objects.push(o); }
  return p;
}
export function toPackObjects(project) { return project.objects.map((o) => { const e = effective(project, o); return { id: o.id, outline: o.outline, rot: o.rot || 0, x: o.x, y: o.y, margin: e.margin, notchR: e.notch / 2, notches: o.notches || [], locked: !!o.locked }; }); }
// independent exact validation with manifold: pocket (outline+margin, from analyze) united with notch discs, pairwise offset(wall/2) intersection must be empty, all inside the bin minus outer wall
import { getM } from '../dist/js/bin.js';
import { pointAtT, rotPt } from '../dist/js/geom.js';
export async function validateManifold(project, wall) {
  await initManifold(); const M = getM(), a = analyze(project), sh = [];
  a._items.forEach((it) => { let x = it.pk; const raw = ensureCCW(it.o.outline);
    for (const t of it.o.notches || []) { const { pt, nx, ny } = pointAtT(raw, t); const [lx, ly] = rotPt([pt[0] + nx * it.eff.margin, pt[1] + ny * it.eff.margin], it.o.rot || 0); x = x.add(M.CrossSection.circle(it.eff.notch / 2, 48).translate([lx + it.o.x, ly + it.o.y])); }
    sh.push(x); });
  let worstOverlap = 0, minOuter = 1e9;
  for (let i = 0; i < sh.length; i++) { const b = sh[i].bounds(); minOuter = Math.min(minOuter, b.min[0], b.min[1], a.W - b.max[0], a.D - b.max[1]);
    for (let j = i + 1; j < sh.length; j++) { const A = sh[i].offset(wall / 2 - 0.01, 'Round', 2, 16), B = sh[j].offset(wall / 2 - 0.01, 'Round', 2, 16); worstOverlap = Math.max(worstOverlap, A.intersect(B).area()); } }
  return { an: a, overlapArea: worstOverlap, minOuter, issues: a.objects.flatMap((o) => o.issues.filter((s) => !s.startsWith('depth'))) };
}
export function projectCells(project) { const a = analyze(project); return { nx: a.nx, ny: a.ny, cells: a.nx * a.ny, an: a }; }
