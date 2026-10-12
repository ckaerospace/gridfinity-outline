// Gridfinity bin builder (manifold-3d WASM CSG) + layout analysis + binary STL writer.
import Module from '../vendor/manifold.js';
import { bbox, rotPt, pointAtT, ensureCCW } from './geom.js';

export const GF = { pitch: 42, hUnit: 7, clearance: 0.5, topR: 3.75, foot: { chamfer1: 0.8, vert: 1.8, chamfer2: 2.15 }, wall: 1.2, maxUnits: 12 };
GF.minFloorAboveFoot = 0.8;
GF.lip = { c1: 0.7, vert: 1.8, c2: 1.9 }; GF.lipH = 4.4; GF.lipWall = 2.6; // standard stacking lip profile (bottom 45deg 0.7, vertical 1.8, top 45deg 1.9); pockets keep 2.6 mm from the outside
GF.magnet = { d: 6.5, depth: 2.4, offset: 13 }; // holes for 6 x 2 mm magnets, 4 per cell on a 26 mm square
export const outerWall = (project) => (project && project.lip ? GF.lipWall : GF.wall); // min material between foot-groove top (z=4.75) and pocket floor
GF.footH = GF.foot.chamfer1 + GF.foot.vert + GF.foot.chamfer2; // 4.75
let M = null;
export const getM = () => M;
export async function initManifold() { if (M) return M; const w = await Module(); w.setup(); M = w; return M; }

const sn = (v) => Math.fround(Math.round(v * 1e5) / 1e5);
function rrect(x0, y0, w, h, r, seg = 10) {
  const pts = [], cs = [[x0 + w - r, y0 + r, -90], [x0 + w - r, y0 + h - r, 0], [x0 + r, y0 + h - r, 90], [x0 + r, y0 + r, 180]];
  for (const [cx, cy, a0] of cs) for (let k = 0; k <= seg; k++) { const a = (a0 + 90 * k / seg) * Math.PI / 180; pts.push([sn(cx + r * Math.cos(a)), sn(cy + r * Math.sin(a))]); }
  return pts;
}
// foot of one cell: lofted rings of identical topology => exact 45deg / vertical / 45deg Gridfinity base profile
function footSolid(cx, cy) {
  const f = GF.foot, full = GF.pitch - GF.clearance; // 41.5
  const ring = (inset, z) => { const w = full - 2 * inset, r = Math.max(0.05, GF.topR - inset); return rrect(cx - w / 2, cy - w / 2, w, w, r, 12).map(([x, y]) => [x, y, z]); };
  const rings = [ring(f.chamfer1 + f.chamfer2, 0), ring(f.chamfer2, f.chamfer1), ring(f.chamfer2, f.chamfer1 + f.vert), ring(0, GF.footH)];
  const n = rings[0].length, vp = [], tv = [];
  for (const r of rings) for (const p of r) vp.push(...p);
  const bc = rings[0].reduce((a, p) => [a[0] + p[0] / n, a[1] + p[1] / n, 0], [0, 0, 0]), tc = rings[3].reduce((a, p) => [a[0] + p[0] / n, a[1] + p[1] / n, GF.footH], [0, 0, 0]);
  const ib = 4 * n, it = 4 * n + 1; vp.push(...bc, ...tc);
  for (let k = 0; k < 3; k++) for (let i = 0; i < n; i++) { const j = (i + 1) % n, a = k * n + i, a2 = k * n + j, b = (k + 1) * n + i, b2 = (k + 1) * n + j; tv.push(a, a2, b2, a, b2, b); }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; tv.push(ib, j, i); tv.push(it, 3 * n + i, 3 * n + j); }
  return new M.Manifold(new M.Mesh({ numProp: 3, vertProperties: new Float32Array(vp), triVerts: new Uint32Array(tv) }));
}
// stacking lip: ring on top of the bin, inner face = Gridfinity lip profile (mirrors the baseplate socket), small 0.4 mm flat on top instead of a knife edge
function lipSolid(W, D, H) {
  const L = GF.lip, top = 0.4, ring = (inset, z) => rrect(inset, inset, W - 2 * inset, D - 2 * inset, Math.max(0.05, GF.topR - inset), 12).map(([x, y]) => [x, y, z]);
  const loft = (rings) => { const n = rings[0].length, vp = [], tv = [], last = rings.length - 1; for (const r of rings) for (const p of r) vp.push(...p);
    const cen = (r) => r.reduce((a, p) => [a[0] + p[0] / n, a[1] + p[1] / n, p[2]], [0, 0, 0]); const ib = rings.length * n, it = ib + 1; vp.push(...cen(rings[0]), ...cen(rings[last]));
    for (let k = 0; k < last; k++) for (let i = 0; i < n; i++) { const j = (i + 1) % n, a = k * n + i, a2 = k * n + j, b = (k + 1) * n + i, b2 = (k + 1) * n + j; tv.push(a, a2, b2, a, b2, b); }
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; tv.push(ib, j, i); tv.push(it, last * n + i, last * n + j); }
    return new M.Manifold(new M.Mesh({ numProp: 3, vertProperties: new Float32Array(vp), triVerts: new Uint32Array(tv) })); };
  const outer = cs(rrect(0, 0, W, D, GF.topR, 12)).extrude(GF.lipH + 0.01).translate([0, 0, H - 0.01]);
  const z = H - 0.02, inner = loft([ring(L.c1 + L.c2, z), ring(L.c2, H + L.c1), ring(L.c2, H + L.c1 + L.vert), ring(top, H + GF.lipH), ring(top, H + GF.lipH + 1)]);
  return outer.subtract(inner);
}
const cs = (poly) => M.CrossSection.ofPolygons([ensureCCW(poly)], 'Positive');

export function effective(project, o) {
  const d = project.defaults;
  return { margin: o.margin ?? d.margin, notch: o.notch ?? d.notch, depth: o.depth ?? d.depth };
}
function localPocket(o, margin) {
  let x = cs(o.outline);
  return margin > 0 ? x.offset(margin, 'Round', 2, 24) : x;
}
function worldXf(x, o) { return x.rotate(o.rot || 0).translate([o.x, o.y]); }

// Analyse project: effective values, bin size, issues. Returns plain data + CrossSections (caller keeps them only transiently).
export function analyze(project) {
  const wall = outerWall(project), floor = Math.max(project.floor, GF.footH + GF.minFloorAboveFoot); // pocket floor must stay above the foot grooves (z = footH), else the cut opens slots along the cell boundaries
  const items = project.objects.map((o) => {
    const eff = effective(project, o), pk = worldXf(localPocket(o, eff.margin), o), b = pk.bounds();
    return { o, eff, pk, b };
  });
  let maxX = 0, maxY = 0;
  for (const it of items) { maxX = Math.max(maxX, it.b.max[0]); maxY = Math.max(maxY, it.b.max[1]); }
  const needN = (v) => Math.max(1, Math.ceil((v + wall + GF.clearance) / GF.pitch - 1e-9));
  const nx = project.cells.auto ? needN(maxX) : project.cells.nx, ny = project.cells.auto ? needN(maxY) : project.cells.ny;
  const W = nx * GF.pitch - GF.clearance, D = ny * GF.pitch - GF.clearance;
  const reqMax = items.reduce((m, it) => Math.max(m, it.eff.depth), 0);
  const autoU = Math.min(GF.maxUnits, Math.max(2, Math.ceil((reqMax + floor) / GF.hUnit - 1e-9)));
  const hu = project.height.auto ? autoU : project.height.hu;
  const H = hu * GF.hUnit, maxDepth = H - floor;
  const inner = M.CrossSection.square([W - 2 * wall, D - 2 * wall]).translate([wall, wall]);
  const res = items.map((it, i) => {
    const depth = Math.max(1, Math.min(it.eff.depth, maxDepth)), issues = [];
    if (it.eff.depth > maxDepth + 1e-6) issues.push('depth clamped to ' + maxDepth.toFixed(1) + ' mm');
    if (it.pk.subtract(inner).area() > 0.05) issues.push('outside bin');
    for (let j = 0; j < items.length; j++) if (j !== i) {
      const a = it.pk.offset(GF.wall / 2, 'Round', 2, 12), c = items[j].pk.offset(GF.wall / 2, 'Round', 2, 12);
      if (a.intersect(c).area() > 0.05) { issues.push('overlaps ' + (items[j].o.name || 'object ' + (j + 1))); break; }
    }
    const poly = it.pk.toPolygons()[0] || [];
    return { id: it.o.id, eff: { ...it.eff, depth }, requestedDepth: it.eff.depth, poly, issues, bounds: it.b };
  });
  return { nx, ny, W, D, hu, H, maxDepth, wall, Htot: H + (project.lip ? GF.lipH : 0), objects: res, _items: items };
}

export function buildBin(project, an, info) {
  an = an || analyze(project);
  const { W, D, H } = an, feet = [];
  for (let i = 0; i < an.nx; i++) for (let j = 0; j < an.ny; j++) feet.push(footSolid(GF.pitch * i + GF.pitch / 2 - GF.clearance / 2, GF.pitch * j + GF.pitch / 2 - GF.clearance / 2));
  const body = cs(rrect(0, 0, W, D, GF.topR, 12)).extrude(H - GF.footH).translate([0, 0, GF.footH]);
  let bin = M.Manifold.union([...feet, body]);
  if (project.lip) bin = bin.add(lipSolid(W, D, H));
  if (project.magnets) { const holes = [];
    for (let i = 0; i < an.nx; i++) for (let j = 0; j < an.ny; j++) { const cx = GF.pitch * i + GF.pitch / 2 - GF.clearance / 2, cy = GF.pitch * j + GF.pitch / 2 - GF.clearance / 2;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) holes.push(M.Manifold.cylinder(GF.magnet.depth + 0.01, GF.magnet.d / 2, GF.magnet.d / 2, 40).translate([cx + sx * GF.magnet.offset, cy + sy * GF.magnet.offset, -0.01])); }
    bin = bin.subtract(M.Manifold.union(holes)); }
  const cuts = [];
  const flip = (xs) => xs.mirror([0, 1]).translate([0, D]);
  an._items.forEach((it, i) => {
    const depth = an.objects[i].eff.depth, z0 = H - depth;
    cuts.push(flip(it.pk).extrude(depth + 1).translate([0, 0, z0]));
    const r = it.eff.notch / 2, zc = z0 + r - 0.2;
    const raw = ensureCCW(it.o.outline);
    for (const t of it.o.notches || []) {
      const { pt, nx, ny } = pointAtT(raw, t);
      const [lx, ly] = rotPt([pt[0] + nx * it.eff.margin, pt[1] + ny * it.eff.margin], it.o.rot || 0);
      const wx = lx + it.o.x, wy = D - (ly + it.o.y);
      const sph = M.Manifold.sphere(r, 32).translate([wx, wy, zc]);
      const parts = [sph];
      if (H + 6 > zc) parts.push(M.Manifold.cylinder(H + 6 - zc, r, r, 32).translate([wx, wy, zc]));
      cuts.push(M.Manifold.union(parts));
    }
  });
  if (cuts.length) bin = bin.subtract(M.Manifold.union(cuts));
  const sv = project.save;
  if (sv && sv.on && an.objects.length) { // optional 'Save material': sealed hexagonal voids in the webs (see saveParams / hollowVoids)
    const vd = hollowVoids(project, an), solidV = info ? bin.volume() : 0;
    if (vd) { const red = bin.subtract(vd); bin.delete && bin.delete(); bin = red; vd.delete && vd.delete(); }
    if (info) { info.solidVol = solidV; info.redVol = bin.volume(); info.pct = solidV > 0 ? 100 * (1 - info.redVol / solidV) : 0; info.params = saveParams(project); }
  }
  return bin;
}

// ---- optional: Save material (sealed hexagonal voids). Off by default; with it off nothing here runs. ----
// Voids start above the foot (z = footH + wall) so the Gridfinity base profile and baseplate fit are untouched, end `wall` below the top surface (closed, clean top) and
// below each pocket floor, keep `wall` (>= 1.2 mm) to the outer walls, pockets and notches, and a rib (>= wall) between voids. Hexagons have vertical walls (no overhang)
// and a flat roof whose span is at most about 14 mm (bridging). The voids are sealed (closed cavities inside the print).
export function saveParams(project) {
  const sv = project.save || {}, wall = Math.max(1.2, sv.wall ?? 1.6), t = Math.max(0, Math.min(100, sv.saving ?? 60)) / 100;
  return { wall, rib: Math.max(wall, 2.4 - 1.2 * t), flat: 7 + 5.5 * t, z0: GF.footH + wall, minH: 2 };
}
function hexGrid(W, D, flat, rib) {
  const R = flat / Math.sqrt(3), p = flat + rib, dx = 1.5 * p / Math.sqrt(3), polys = [];
  for (let c = -1; c * dx < W + p; c++) for (let y = ((c & 1) ? -p / 2 : 0) - p, x = c * dx; y < D + p; y += p) polys.push(Array.from({ length: 6 }, (_, k) => [x + R * Math.cos(k * Math.PI / 3), y + R * Math.sin(k * Math.PI / 3)]));
  return M.CrossSection.ofPolygons(polys, 'Positive');
}
function pieces(region, grid, r) { // region ∩ hex grid, rounded (opening by 0.8 mm removes slivers), tiny pieces dropped
  let x = grid.intersect(region).offset(-0.8, 'Round', 2, 12).offset(0.8, 'Round', 2, 12);
  const keep = x.toPolygons().filter((pl) => { let a = 0; for (let i = 0; i < pl.length; i++) { const u = pl[i], v = pl[(i + 1) % pl.length]; a += u[0] * v[1] - v[0] * u[1]; } return a / 2 > 12; });
  return keep.length ? M.CrossSection.ofPolygons(keep, 'Positive') : null;
}
function hollowVoids(project, an) {
  const sp = saveParams(project), { W, D, H } = an, flip = (xs) => xs.mirror([0, 1]).translate([0, D]), out = [];
  const shapes = [], discsAll = [];
  an._items.forEach((it) => { let x = flip(it.pk); const raw = ensureCCW(it.o.outline);
    for (const t of it.o.notches || []) { const { pt, nx, ny } = pointAtT(raw, t); const [lx, ly] = rotPt([pt[0] + nx * it.eff.margin, pt[1] + ny * it.eff.margin], it.o.rot || 0);
      const dsc = M.CrossSection.circle(it.eff.notch / 2, 32).translate([lx + it.o.x, D - (ly + it.o.y)]); x = x.add(dsc); discsAll.push(dsc); }
    shapes.push(x); });
  const grid = hexGrid(W, D, sp.flat, sp.rib);
  // A: web areas, from above the foot up to `wall` below the top
  const footprint = cs(rrect(0, 0, W, D, GF.topR, 12)).offset(-sp.wall, 'Round', 2, 16);
  let web = footprint; for (const sh of shapes) web = web.subtract(sh.offset(sp.wall, 'Round', 2, 16));
  const hA = H - sp.wall - sp.z0, pa = hA >= sp.minH ? pieces(web, grid) : null;
  if (pa) out.push(pa.extrude(hA).translate([0, 0, sp.z0]));
  // B: below each pocket floor (roof `wall` under the floor); shrunk slightly when pockets are closer than the wall
  const inset = Math.max(0, (sp.wall - GF.wall) / 2), notchU = discsAll.length ? discsAll.reduce((a, d) => a.add(d)) : null;
  an._items.forEach((it, i) => { const depth = an.objects[i].eff.depth, top = H - depth - sp.wall, h = top - sp.z0; if (h < sp.minH) return;
    let reg = flip(it.pk); if (inset > 0) reg = reg.offset(-inset, 'Round', 2, 16); if (notchU) reg = reg.subtract(notchU.offset(sp.wall / 2, 'Round', 2, 12));
    const pb = pieces(reg, grid); if (pb) out.push(pb.extrude(h).translate([0, 0, sp.z0])); });
  return out.length ? M.Manifold.union(out) : null;
}

export function meshOf(man) { const m = man.getMesh(); return { pos: m.vertProperties, np: m.numProp, tri: m.triVerts }; }
export function toSTL(man, name = 'gridfinity-outline') {
  // weld vertices on a 0.1 micron grid and drop collapsed (sliver) triangles so the STL stays closed after float32 rounding
  const { pos, np, tri } = meshOf(man), map = new Map(), vid = new Int32Array(pos.length / np), V = [];
  const q = (v) => Math.round(v * 1e4) / 1e4;
  for (let i = 0; i < vid.length; i++) { const x = q(pos[i * np]), y = q(pos[i * np + 1]), z = q(pos[i * np + 2]), key = x + ',' + y + ',' + z; let id = map.get(key); if (id === undefined) { id = V.length / 3; map.set(key, id); V.push(x, y, z); } vid[i] = id; }
  const T = []; for (let t = 0; t < tri.length; t += 3) { const a = vid[tri[t]], b = vid[tri[t + 1]], c = vid[tri[t + 2]]; if (a !== b && b !== c && a !== c) T.push(a, b, c); }
  const nt = T.length / 3, buf = new ArrayBuffer(84 + nt * 50), dv = new DataView(buf);
  const hdr = ('binary STL ' + name).slice(0, 79); for (let i = 0; i < hdr.length; i++) dv.setUint8(i, hdr.charCodeAt(i));
  dv.setUint32(80, nt, true); let o = 84;
  for (let t = 0; t < nt; t++) {
    const i = T[3 * t] * 3, j = T[3 * t + 1] * 3, k = T[3 * t + 2] * 3;
    const ux = V[j] - V[i], uy = V[j + 1] - V[i + 1], uz = V[j + 2] - V[i + 2], vx = V[k] - V[i], vy = V[k + 1] - V[i + 1], vz = V[k + 2] - V[i + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const v of [nx, ny, nz, V[i], V[i + 1], V[i + 2], V[j], V[j + 1], V[j + 2], V[k], V[k + 1], V[k + 2]]) { dv.setFloat32(o, v, true); o += 4; }
    dv.setUint16(o, 0, true); o += 2;
  }
  return new Blob([buf], { type: 'model/stl' });
}

// ---- auto placement ----
function candidateOk(project, an, cand, nxy, ignoreIdx = -1) {
  const wall = outerWall(project), W = nxy[0] * GF.pitch - GF.clearance, D = nxy[1] * GF.pitch - GF.clearance;
  const b = cand.bounds();
  if (b.min[0] < wall || b.min[1] < wall || b.max[0] > W - wall || b.max[1] > D - wall) return false;
  const ex = cand.offset(GF.wall / 2, 'Round', 2, 8), eb = ex.bounds();
  for (let j = 0; j < an._items.length; j++) { if (j === ignoreIdx) continue;
    const o = an._items[j], ob = o.b;
    if (ob.min[0] - GF.wall > eb.max[0] || ob.max[0] + GF.wall < eb.min[0] || ob.min[1] - GF.wall > eb.max[1] || ob.max[1] + GF.wall < eb.min[1]) continue;
    if (ex.intersect(o.pk.offset(GF.wall / 2, 'Round', 2, 8)).area() > 0.05) return false; }
  return true;
}
// Find a free position for object `o` (outline local, centred) near (px,py) (or scanning when null). Returns {x,y,rot} or null.
export function findSpot(project, o, near, ignoreId = null) {
  const proj = { ...project, objects: project.objects.filter((q) => q.id !== ignoreId && q.id !== o.id) };
  const an = analyze(proj), eff = effective(project, o);
  const base = localPocket(o, eff.margin);
  const rots = near ? [o.rot || 0] : [0, 90];
  let sizes = [[an.nx, an.ny]];
  if (!project.cells.auto) sizes = [[project.cells.nx, project.cells.ny]];
  else { let a = an.nx, b = an.ny; for (let k = 0; k < 14; k++) { if (a <= b) a++; else b++; sizes.push([a, b]); } }
  for (const nxy of sizes) {
    const W = nxy[0] * GF.pitch - GF.clearance, D = nxy[1] * GF.pitch - GF.clearance;
    const cands = [];
    if (near) { for (let r = 0; r <= 60; r += 1) for (let a = 0; a < (r ? 16 : 1); a++) { const ang = a / 16 * 2 * Math.PI; cands.push([near[0] + r * Math.cos(ang), near[1] + r * Math.sin(ang), rots[0]]); } }
    else for (const rot of rots) for (let y = outerWall(project); y < D; y += 2) for (let x = outerWall(project); x < W; x += 2) cands.push([x, y, rot]);
    for (const [cxm, cym, rot] of cands) {
      const rb = base.rotate(rot), bb = rb.bounds();
      const tx = near ? cxm : cxm - bb.min[0], ty = near ? cym : cym - bb.min[1];
      if (!near && (tx + bb.max[0] > W || ty + bb.max[1] > D)) continue;
      const cand = rb.translate([tx, ty]);
      if (candidateOk(project, an, cand, nxy)) return { x: tx, y: ty, rot };
    }
  }
  return null;
}
