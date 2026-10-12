// Auto arrange: true-polygon nesting on a raster occupancy grid (pure JS, no DOM, no manifold; runs in a Web Worker or on the main thread, and in node for tests).
// Shape of an object = outline offset by its margin (the pocket) united with its notch discs (a notch is a disc of radius notch/2 centred on the pocket edge, it also cuts the wall).
// Search: raster 1 mm, candidate rotations, bottom-left style placement with 4 scoring modes, area-descending order plus random restarts, smallest bin (cells) first.
// Walls between shapes come from a distance-transform dilation of the placed shapes; an exact polygon check (verifyLayout) is the final gate, and the raster is re-run with extra slack if it fails.
import { pointAtT, ensureCCW, area, minRect, rotPt } from './geom.js';

export const PITCH = 42, CLEAR = 0.5, MAX_CELLS = 8;
export let OUTER_WALL = 1.2; // 2.6 with a stacking lip (set per run from params.outerWall)
export const binSize = (n) => n * PITCH - CLEAR;
const INF = 1e12, BIAS = 0.5; // raster sampling bias: shapes are grown by 0.5 mm so cell sampling rarely under-covers

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// squared euclidean distance transform: d[i] = squared distance (cells) to nearest cell with src=1
function edt2(src, w, h) {
  const f = new Float64Array(Math.max(w, h)), d = new Float64Array(Math.max(w, h)), v = new Int32Array(Math.max(w, h)), z = new Float64Array(Math.max(w, h) + 1);
  const out = new Float64Array(w * h);
  const one = (n) => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0; for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
  };
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = src[y * w + x] ? 0 : INF; one(h); for (let y = 0; y < h; y++) out[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = out[y * w + x]; one(w); for (let x = 0; x < w; x++) out[y * w + x] = d[x]; }
  return out;
}

// local shape description of an object: outline (raw, centred), margin, notch discs in local coordinates (before rotation)
export function shapeOf(o) {
  const raw = ensureCCW(o.outline), margin = o.margin, discs = [];
  for (const t of o.notches || []) { const { pt, nx, ny } = pointAtT(raw, t); discs.push({ x: pt[0] + nx * margin, y: pt[1] + ny * margin, r: o.notchR }); }
  return { outline: o.outline, margin, discs };
}
export function worldShape(o, rot, x, y) { // exact geometry in bin coordinates
  const tf = (p) => { const r = rotPt(p, rot); return [r[0] + x, r[1] + y]; }, s = shapeOf(o);
  return { poly: s.outline.map(tf), margin: s.margin, discs: s.discs.map((d) => { const c = tf([d.x, d.y]); return { x: c[0], y: c[1], r: d.r }; }) };
}

// Rasterise a shape (rotated by rot, shifted by fx, fy) into the cell mask S (cell centre inside the pocket: outline + margin, or inside a notch disc, both grown by BIAS).
// The margin ring is measured exactly (distance to the outline segments through a bucket grid), only the final sampling is per cell. Cell k covers [ox+k, ox+k+1).
function rasterS(o, rot, fx, fy) {
  const s = shapeOf(o), P = s.outline.map((p) => { const r = rotPt(p, rot); return [r[0] + fx, r[1] + fy]; });
  const D = s.discs.map((d) => { const c = rotPt([d.x, d.y], rot); return { x: c[0] + fx, y: c[1] + fy, r: d.r }; });
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of P) { x0 = Math.min(x0, p[0] - s.margin); y0 = Math.min(y0, p[1] - s.margin); x1 = Math.max(x1, p[0] + s.margin); y1 = Math.max(y1, p[1] + s.margin); }
  for (const d of D) { x0 = Math.min(x0, d.x - d.r); y0 = Math.min(y0, d.y - d.r); x1 = Math.max(x1, d.x + d.r); y1 = Math.max(y1, d.y + d.r); }
  const bbx = [x0, y0, x1, y1], pad = 2, ox = Math.floor(x0) - pad, oy = Math.floor(y0) - pad, w = Math.ceil(x1) + pad - ox + 1, h = Math.ceil(y1) + pad - oy + 1;
  const S = new Uint8Array(w * h), n = P.length, rad = s.margin + BIAS;
  for (let j = 0; j < h; j++) { // inside by scanline
    const yc = oy + j + 0.5, xs = [];
    for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; if ((a[1] <= yc) !== (b[1] <= yc)) xs.push(a[0] + (yc - a[1]) / (b[1] - a[1]) * (b[0] - a[0])); }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) { const i0 = Math.max(0, Math.ceil(xs[k] - ox - 0.5)), i1 = Math.min(w - 1, Math.floor(xs[k + 1] - ox - 0.5)); for (let i = i0; i <= i1; i++) S[j * w + i] = 1; }
  }
  { // margin ring: exact distance to the nearest segments
    const bs = Math.max(6, rad + 1.5), bw = Math.ceil(w / bs) + 2, bh = Math.ceil(h / bs) + 2, bk = Array.from({ length: bw * bh }, () => []);
    for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; const ia = Math.floor((Math.min(a[0], b[0]) - ox) / bs), ib = Math.floor((Math.max(a[0], b[0]) - ox) / bs), ja = Math.floor((Math.min(a[1], b[1]) - oy) / bs), jb = Math.floor((Math.max(a[1], b[1]) - oy) / bs);
      for (let jj = ja; jj <= jb; jj++) for (let ii = ia; ii <= ib; ii++) bk[(jj + 1) * bw + ii + 1].push(i); }
    const r2 = rad * rad;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { if (S[j * w + i]) continue;
      const px = ox + i + 0.5, py = oy + j + 0.5, bi = Math.floor((px - ox) / bs), bj = Math.floor((py - oy) / bs); let hit = false;
      for (let dj = -1; dj <= 1 && !hit; dj++) for (let di = -1; di <= 1 && !hit; di++) { const lst = bk[(bj + dj + 1) * bw + bi + di + 1]; if (!lst) continue;
        for (const e of lst) { const a = P[e], b = P[(e + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy; let t = L ? ((px - a[0]) * dx + (py - a[1]) * dy) / L : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = px - a[0] - t * dx, ey = py - a[1] - t * dy; if (ex * ex + ey * ey <= r2) { hit = true; break; } } }
      if (hit) S[j * w + i] = 1; }
  }
  for (const d of D) { const r2 = (d.r + BIAS) * (d.r + BIAS); const j0 = Math.max(0, Math.floor(d.y - d.r - oy) - 1), j1 = Math.min(h - 1, Math.ceil(d.y + d.r - oy) + 1), i0 = Math.max(0, Math.floor(d.x - d.r - ox) - 1), i1 = Math.min(w - 1, Math.ceil(d.x + d.r - ox) + 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const dx = ox + i + 0.5 - d.x, dy = oy + j + 0.5 - d.y; if (dx * dx + dy * dy <= r2) S[j * w + i] = 1; } }
  return { ox, oy, w, h, S, rot, bbx };
}
// Add the run tables of S and of its dilation by wallR (distance transform), plus the bounding box and cell count.
function withWall(B, wallR) {
  const { w, h, S } = B, pad = Math.ceil(wallR) + 1;
  // grow the grid by pad so the dilation fits
  const W = w + 2 * pad, H = h + 2 * pad, S2 = new Uint8Array(W * H); for (let j = 0; j < h; j++) S2.set(S.subarray(j * w, j * w + w), (j + pad) * W + pad);
  const d2 = edt2(S2, W, H), W2 = wallR * wallR, Dm = new Uint8Array(W * H); for (let k = 0; k < W * H; k++) Dm[k] = d2[k] <= W2 ? 1 : 0;
  const runs = (m) => { const rows = []; for (let j = 0; j < H; j++) { const r = []; let i = 0; while (i < W) { if (m[j * W + i]) { let e = i; while (e < W && m[j * W + e]) e++; r.push(i, e); i = e; } else i++; } rows.push(r); } return rows; };
  const sr = runs(S2), dr = runs(Dm); let sx0 = W, sx1 = 0, sy0 = H, sy1 = 0, cells = 0;
  for (let j = 0; j < H; j++) if (sr[j].length) { sy0 = Math.min(sy0, j); sy1 = Math.max(sy1, j + 1); for (let k = 0; k < sr[j].length; k += 2) { sx0 = Math.min(sx0, sr[j][k]); sx1 = Math.max(sx1, sr[j][k + 1]); cells += sr[j][k + 1] - sr[j][k]; } }
  return { ox: B.ox - pad, oy: B.oy - pad, w: W, h: H, sr, dr, sx0, sx1, sy0, sy1, cells, rot: B.rot, bbx: B.bbx };
}

function candidateRots(o, allow) {
  const cur = o.rot || 0; if (!allow) return [cur];
  const out = [], add = (a) => { a = ((a % 360) + 540) % 360 - 180; if (!out.some((b) => Math.abs(((a - b) % 360 + 540) % 360 - 180) < 1)) out.push(Math.round(a * 10) / 10); };
  for (let a = 0; a < 360; a += 15) add(a);
  const mr = minRect(o.outline); for (const k of [0, 90, 180, 270]) add(-mr.angle + k);
  add(cur); return out;
}

// exact polygon helpers -------------------------------------------------
const segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy; let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
const inPoly = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const ccw = (a, b, c) => (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0]);
const segX = (a, b, c, d) => ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
function polyDist(A, B) { // distance between two closed polygons (0 if they touch/overlap)
  if (inPoly(A[0], B) || inPoly(B[0], A)) return 0;
  let m = 1e9;
  for (let i = 0; i < A.length; i++) { const a = A[i], a2 = A[(i + 1) % A.length]; for (let j = 0; j < B.length; j++) { const b = B[j], b2 = B[(j + 1) % B.length]; if (segX(a, a2, b, b2)) return 0; } }
  for (const p of A) for (let j = 0; j < B.length; j++) m = Math.min(m, segD(p, B[j], B[(j + 1) % B.length]));
  for (const p of B) for (let j = 0; j < A.length; j++) m = Math.min(m, segD(p, A[j], A[(j + 1) % A.length]));
  return m;
}
const discPoly = (c, poly) => { const d = inPoly([c.x, c.y], poly) ? 0 : 1e9; if (d === 0) return -1; let m = 1e9; for (let j = 0; j < poly.length; j++) m = Math.min(m, segD([c.x, c.y], poly[j], poly[(j + 1) % poly.length])); return m; };
const bb = (poly, m) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of poly) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); } return [x0 - m, y0 - m, x1 + m, y1 + m]; };

// Exact check of a layout. items: [{o (with margin, notchR, notches, outline), rot, x, y}] -> {minGap, minOuter, bounds, worst}
export function verifyLayout(items, W, D) {
  const ws = items.map((it) => { const s = worldShape(it.o, it.rot, it.x, it.y); let b = bb(s.poly, s.margin); for (const d of s.discs) b = [Math.min(b[0], d.x - d.r), Math.min(b[1], d.y - d.r), Math.max(b[2], d.x + d.r), Math.max(b[3], d.y + d.r)]; return { ...s, b }; });
  let minGap = 1e9, minOuter = 1e9, maxX = 0, maxY = 0;
  for (const s of ws) { minOuter = Math.min(minOuter, s.b[0], s.b[1], W == null ? 1e9 : W - s.b[2], D == null ? 1e9 : D - s.b[3]); maxX = Math.max(maxX, s.b[2]); maxY = Math.max(maxY, s.b[3]); }
  for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) {
    const A = ws[i], B = ws[j];
    const reach = minGap; if (A.b[0] - B.b[2] > reach || B.b[0] - A.b[2] > reach || A.b[1] - B.b[3] > reach || B.b[1] - A.b[3] > reach) continue;
    let g = polyDist(A.poly, B.poly) - A.margin - B.margin;
    for (const d of A.discs) { g = Math.min(g, discPoly(d, B.poly) - B.margin - d.r); for (const e of B.discs) g = Math.min(g, Math.hypot(d.x - e.x, d.y - e.y) - d.r - e.r); }
    for (const e of B.discs) g = Math.min(g, discPoly(e, A.poly) - A.margin - e.r);
    minGap = Math.min(minGap, g);
  }
  return { minGap, minOuter, maxX, maxY, ws };
}
export const cellsFor = (maxX, maxY) => [Math.max(1, Math.ceil((maxX + OUTER_WALL + CLEAR) / PITCH - 1e-9)), Math.max(1, Math.ceil((maxY + OUTER_WALL + CLEAR) / PITCH - 1e-9))];

// ---------------------------------------------------------------------
// objects: [{id, outline, rot, x, y, margin, notchR, notches, locked}]
// params: {wall, allowRot, budgetMs, seed, maxCells (upper bound of cells to try), baselineCells}
export function arrange(objects, params = {}) {
  OUTER_WALL = Math.max(1.2, params.outerWall ?? 1.2); const P = { wall: 3, allowRot: true, budgetMs: 2200, seed: 7, res: 1, ...params }, t0 = Date.now(), now = () => Date.now() - t0, rand = rng(P.seed);
  const stats = { trials: 0, placements: 0, slack: 0, runs: 0 };
  const n = objects.length; if (!n) return { ok: false, reason: 'No objects', stats };
  const locked = objects.map((o) => !!o.locked), free = objects.map((_, i) => i).filter((i) => !locked[i]);
  // rough lower bound of the packed area (polygon + margin ring, per object) to skip hopeless bin sizes
  const areaOf = (o) => Math.abs(area(o.outline)) + o.margin * (perim(o.outline)) + Math.PI * o.margin * o.margin;
  const totalArea = objects.reduce((s, o) => s + areaOf(o), 0);

  const rawCache = new Map(); // S masks do not depend on the wall, so they survive re-runs with more slack
  if (locked.some(Boolean)) { // locked objects stay where they are: they must already respect the outer wall and the wall between each other
    const li = objects.map((o, i) => i).filter((i) => locked[i]), lv = verifyLayout(li.map((i) => ({ o: objects[i], rot: objects[i].rot || 0, x: objects[i].x, y: objects[i].y })), null, null);
    if (lv.ws.some((w) => w.b[0] < OUTER_WALL - 0.005 || w.b[1] < OUTER_WALL - 0.005)) return { ok: false, reason: 'A locked object sits closer than ' + OUTER_WALL + ' mm to the top or left edge of the bin. Move it, or unlock it.', stats };
    if (lv.minGap < P.wall - 0.005) return { ok: false, reason: 'Two locked objects are closer than the ' + P.wall + ' mm wall between pockets. Move or unlock one of them.', stats };
  }
  function search(slack, budget) {
    stats.runs++; const rs = Date.now(), nowR = () => Date.now() - rs; const wallR = P.wall + slack, cacheR = objects.map((o) => candidateRots(o, P.allowRot).map(() => null));
    const rots = objects.map((o) => candidateRots(o, P.allowRot));
    const rawS = (i, k) => { const key = i + ':' + k; let r = rawCache.get(key); if (!r) { r = rasterS(objects[i], rots[i][k], 0, 0); rawCache.set(key, r); } return r; };
    const bm = (i, k) => cacheR[i][k] || (cacheR[i][k] = withWall(rawS(i, k), wallR));
    // locked objects: exact stamp at their position (fractional shift kept)
    const lockedBm = objects.map((o, i) => locked[i] ? withWall(rasterS(o, o.rot || 0, o.x - Math.floor(o.x), o.y - Math.floor(o.y)), wallR) : null);
    let lockMaxX = 0, lockMaxY = 0; objects.forEach((o, i) => { if (!locked[i]) return; const v = verifyLayout([{ o, rot: o.rot || 0, x: o.x, y: o.y }], null, null); lockMaxX = Math.max(lockMaxX, v.maxX); lockMaxY = Math.max(lockMaxY, v.maxY); });
    const sizes = []; for (let a = 1; a <= MAX_CELLS; a++) for (let b = 1; b <= MAX_CELLS; b++) {
      const W = binSize(a), D = binSize(b); if (lockMaxX > W - OUTER_WALL + 1e-6 || lockMaxY > D - OUTER_WALL + 1e-6) continue;
      if (totalArea > (W - 2 * OUTER_WALL) * (D - 2 * OUTER_WALL) * 0.96) continue; sizes.push([a, b]); }
    const pref = (z) => P.prefer && z[0] === P.prefer[0] && z[1] === P.prefer[1] ? 1 : 0;
    sizes.sort((p, q) => p[0] * p[1] - q[0] * q[1] || (p[0] + p[1]) - (q[0] + q[1]) || Math.abs(p[0] - p[1]) - Math.abs(q[0] - q[1]) || (pref(q) - pref(p)) || q[0] - p[0]);
    const limit = P.maxCells || 64; const list = sizes.filter((s) => s[0] * s[1] <= limit);

    function base(nx, ny) {
      const W = binSize(nx), D = binSize(ny), Wc = Math.ceil(W), Dc = Math.ceil(D), occ = new Uint8Array(Wc * Dc);
      objects.forEach((o, i) => { if (!locked[i]) return; stamp(occ, Wc, Dc, lockedBm[i], Math.floor(o.x) - 0, Math.floor(o.y) - 0, true); });
      const pre = new Int32Array(Dc * (Wc + 1)); for (let j = 0; j < Dc; j++) rowPre(occ, pre, Wc, j);
      return { Wc, Dc, occ, pre, W, D };
    }
    const rowPre = (occ, pre, Wc, j) => { let s = 0; const b = j * (Wc + 1); pre[b] = 0; for (let i = 0; i < Wc; i++) { s += occ[j * Wc + i]; pre[b + i + 1] = s; } };
    function stamp(occ, Wc, Dc, B, px, py, isLockedAbs) { // px,py: grid offset of bitmap origin (cell coords); locked: bitmap origin world = ox + floor(x)  => offset = floor(x) + ox
      const bx = isLockedAbs ? px + B.ox : px, by = isLockedAbs ? py + B.oy : py;
      for (let j = 0; j < B.h; j++) { const y = by + j; if (y < 0 || y >= Dc) continue; const r = B.dr[j]; for (let k = 0; k < r.length; k += 2) { const a = Math.max(0, bx + r[k]), e = Math.min(Wc, bx + r[k + 1]); for (let i = a; i < e; i++) occ[y * Wc + i] = 1; } }
    }
    function fits(B, px, py, g) { // px,py: grid offset of the bitmap origin
      for (let j = B.sy0; j < B.sy1; j++) { const y = py + j; if (y < 0 || y >= g.Dc) return false; const r = B.sr[j], pb = y * (g.Wc + 1); for (let k = 0; k < r.length; k += 2) { const a = px + r[k], e = px + r[k + 1]; if (a < 0 || e > g.Wc) return false; if (g.pre[pb + e] - g.pre[pb + a] > 0) return false; } }
      return true;
    }
    const K = 4096, STEP = 2;
    const scoreOf = (mode, x1, y1) => mode === 0 ? y1 * K + x1 : mode === 1 ? x1 * K + y1 : mode === 2 ? (x1 + y1) * K + Math.max(x1, y1) : Math.max(x1, y1) * K * 2 + (x1 + y1);
    function place(i, g, mode, rotSubset) {
      let best = null, bestS = Infinity; const ks = rotSubset || rots[i].map((_, k) => k);
      for (const k of ks) {
        const B = bm(i, k), eps = 0.004, minPx = Math.max(-B.sx0, Math.ceil(OUTER_WALL + eps - B.bbx[0] + B.ox)), maxPx = Math.min(g.Wc - B.sx1, Math.floor(g.W - OUTER_WALL - eps - B.bbx[2] + B.ox)), minPy = Math.max(-B.sy0, Math.ceil(OUTER_WALL + eps - B.bbx[1] + B.oy)), maxPy = Math.min(g.Dc - B.sy1, Math.floor(g.D - OUTER_WALL - eps - B.bbx[3] + B.oy)); if (maxPx < minPx || maxPy < minPy) continue;
        const sw = B.sx1 - B.sx0, sh = B.sy1 - B.sy0;
        for (let py = minPy; py <= maxPy; py += STEP) {
          if (scoreOf(mode, minPx + B.sx0 + sw, py + B.sy0 + sh) >= bestS) break;
          for (let px = minPx; px <= maxPx; px += STEP) {
            const s = scoreOf(mode, px + B.sx0 + sw, py + B.sy0 + sh); if (s >= bestS) break;
            if (fits(B, px, py, g)) { let qx = px, qy = py; for (let it = 0; it < 6; it++) { let mv = false; if (qx - 1 >= minPx && fits(B, qx - 1, qy, g)) { qx--; mv = true; } if (qy - 1 >= minPy && fits(B, qx, qy - 1, g)) { qy--; mv = true; } if (!mv) break; }
              const s2 = scoreOf(mode, qx + B.sx1, qy + B.sy1); if (s2 < bestS) { best = { i, k, px: qx, py: qy, B }; bestS = s2; } break; }
          }
        }
      }
      return best;
    }
    function commit(g, p) { stamp(g.occ, g.Wc, g.Dc, p.B, p.px, p.py, false); const by = p.py; for (let j = Math.max(0, by); j < Math.min(g.Dc, by + p.B.h); j++) rowPre(g.occ, g.pre, g.Wc, j); }
    function tryPack(size, order, mode, rotFrac) {
      stats.trials++; const g = base(size[0], size[1]), res = [];
      for (const i of order) {
        let sub = null; if (rotFrac < 1 && rots[i].length > 4) { sub = []; rots[i].forEach((_, k) => { if (rand() < rotFrac) sub.push(k); }); if (!sub.length) sub = [0]; }
        let p = place(i, g, mode, sub); if (!p && sub) p = place(i, g, mode, null); if (!p) return null; commit(g, p); stats.placements++; res.push(p);
      }
      return { res, size };
    }
    const byArea = [...free].sort((a, b) => areaOf(objects[b]) - areaOf(objects[a]));
    const orderFor = (r) => { if (r === 0) return byArea; if (r === 1) return [...free].sort((a, b) => Math.max(...extent(objects[b])) - Math.max(...extent(objects[a])));
      return [...free].map((i) => [i, areaOf(objects[i]) * (0.55 + 0.9 * rand())]).sort((a, b) => b[1] - a[1]).map((a) => a[0]); };
    function attempt(size, maxTry, deadline) {
      for (let r = 0; r < maxTry; r++) { if (r > 3 && nowR() > deadline) break; const mode = r % 4, ord = orderFor(r < 2 ? r : r), out = tryPack(size, ord, mode, r < 4 ? 1 : 0.45); if (out) return out; }
      return null;
    }
    if (!list.length) return null;
    // pass 1: ascending, quick (one try per scoring mode); first success = upper bound
    let k1 = -1, found = null;
    for (let s = 0; s < list.length; s++) { if (nowR() > budget * 1.6) break; const out = attempt(list[s], 4, 1e18); if (out) { k1 = s; found = out; break; } }
    if (k1 < 0) return { fail: true, list };
    // pass 2: smaller (or equally large but more compact) sizes with random restarts, nearest first, each gets a share of the remaining time; hopeless sizes (density above 80 percent of the polygon areas) are skipped
    const cap = (sz) => totalArea <= 0.8 * (binSize(sz[0]) - 2 * OUTER_WALL) * (binSize(sz[1]) - 2 * OUTER_WALL);
    for (let s = k1 - 1; s >= 0; s--) {
      if (!cap(list[s])) continue; const left = budget - nowR(); if (left <= 0) break;
      const out = attempt(list[s], 400, nowR() + left / 3); if (out) { found = out; k1 = s; }
    }
    const placed = found.res.map((p) => ({ i: p.i, x: p.px - p.B.ox, y: p.py - p.B.oy, rot: rots[p.i][p.k] }));
    return { size: found.size, placed, wallR };
  }
  function perim(p) { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += Math.hypot(a[0] - b[0], a[1] - b[1]); } return s; }
  function extent(o) { const mr = minRect(o.outline); return [mr.l, mr.w]; }

  let out = null, res = null, budgetNow = P.budgetMs;
  for (let slack = 0; slack <= 2.5; slack += 0.3) {
    stats.slack = slack; res = search(slack, budgetNow);
    if (!res) return { ok: false, reason: 'Nothing to arrange', stats: { ...stats, ms: now() } };
    if (res.fail) return { ok: false, reason: 'The objects do not fit into any bin up to ' + MAX_CELLS + ' x ' + MAX_CELLS + ' cells with a ' + P.wall + ' mm wall. Lower the wall between pockets, or allow rotation.', stats: { ...stats, ms: now() } };
    const items = objects.map((o, i) => { const q = res.placed.find((p) => p.i === i); return q ? { o, rot: q.rot, x: q.x, y: q.y, id: o.id } : { o, rot: o.rot || 0, x: o.x, y: o.y, id: o.id }; });
    const v = verifyLayout(items, binSize(res.size[0]), binSize(res.size[1]));
    if (v.minGap >= P.wall - 0.005 && v.minOuter >= OUTER_WALL - 0.005) { const [cx, cy] = cellsFor(v.maxX, v.maxY); out = { ok: true, nx: cx, ny: cy, items, v }; break; }
    if (P.debug) console.log("reject slack", slack, "size", res.size, "gap", v.minGap.toFixed(2), "outer", v.minOuter.toFixed(2));
    stats.rejected = (stats.rejected || 0) + 1; out = null; budgetNow = Math.max(budgetNow * 0.35, 450);
  }
  if (!out) return { ok: false, reason: 'The packing could not be verified with a ' + P.wall + ' mm wall (the raster search kept missing the wall by a small amount). Try a slightly smaller wall.', stats: { ...stats, ms: now() } };
  const used = objects.reduce((s, o) => s + areaOf(o), 0), binA = binSize(out.nx) * binSize(out.ny);
  return { ok: true, nx: out.nx, ny: out.ny, placements: out.items.map((it) => ({ id: it.id, x: it.x, y: it.y, rot: it.rot })), minGap: out.v.minGap, minOuter: out.v.minOuter,
    density: used / binA, stats: { ...stats, ms: now() } };
}
