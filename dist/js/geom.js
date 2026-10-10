// Small geometry helpers: 3x3 homographies, polygons.
export function solveLinear(A, b) { // gaussian elimination, A n x n
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}
// DLT from 4+ point pairs (least squares via normal equations); returns 9-array row-major
export function homography(src, dst) {
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0)), Atb = new Array(8).fill(0);
  const add = (row, v) => { for (let i = 0; i < 8; i++) { Atb[i] += row[i] * v; for (let j = 0; j < 8; j++) AtA[i][j] += row[i] * row[j]; } };
  for (let k = 0; k < src.length; k++) {
    const [x, y] = src[k], [u, v] = dst[k];
    add([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    add([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  const h = solveLinear(AtA, Atb); return [...h, 1];
}
export function applyH(H, x, y) { const w = H[6] * x + H[7] * y + H[8]; return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w]; }
export function mul3(A, B) { const C = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[3 * i + j] += A[3 * i + k] * B[3 * k + j]; return C; }
export function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// Camera tilt (deg) from a plane->image homography H (plane mm -> px), assuming a typical phone focal length.
export function tiltFromH(H, imgW, imgH) {
  const f = 0.78 * Math.max(imgW, imgH), cx = imgW / 2, cy = imgH / 2;
  const Ki = (v) => [(v[0] - cx * v[2]) / f, (v[1] - cy * v[2]) / f, v[2]];
  const r1 = Ki([H[0], H[3], H[6]]), r2 = Ki([H[1], H[4], H[7]]);
  const n = cross(r1, r2), l = Math.hypot(...n);
  return Math.acos(Math.min(1, Math.abs(n[2]) / l)) * 180 / Math.PI;
}
// Zhang & He: aspect ratio (w/h) of a rectangle seen in perspective. pts = TL,TR,BR,BL in pixels.
export function rectAspect(pts, imgW, imgH) {
  const cx = imgW / 2, cy = imgH / 2;
  const m1 = [pts[0][0] - cx, pts[0][1] - cy, 1], m2 = [pts[1][0] - cx, pts[1][1] - cy, 1];
  const m4 = [pts[2][0] - cx, pts[2][1] - cy, 1], m3 = [pts[3][0] - cx, pts[3][1] - cy, 1];
  const k2 = dot(cross(m1, m4), m3) / dot(cross(m2, m4), m3), k3 = dot(cross(m1, m4), m2) / dot(cross(m3, m4), m2);
  const n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 * m2[2] - m1[2]], n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 * m3[2] - m1[2]];
  let f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]);
  if (!(f2 > 1) || !isFinite(f2)) f2 = 1e12; // near fronto-parallel: ratio from plain lengths
  const q = (n) => (n[0] * n[0] + n[1] * n[1]) / f2 + n[2] * n[2];
  return Math.sqrt(q(n2) / q(n3));
}
// ---- polygons (arrays of [x,y]) ----
export const area = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
export const bbox = (p) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of p) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }; };
export function centroid(p) { let a = 0, cx = 0, cy = 0; for (let i = 0; i < p.length; i++) { const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length], c = x0 * y1 - x1 * y0; a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c; } a *= 3; return [cx / a, cy / a]; }
export const perimeter = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += Math.hypot(a[0] - b[0], a[1] - b[1]); } return s; };
export function resample(p, step) {
  const L = perimeter(p), n = Math.max(8, Math.round(L / step)), out = [], d = L / n;
  let seg = 0, acc = 0, a = p[0], b = p[1 % p.length], sl = Math.hypot(b[0] - a[0], b[1] - a[1]);
  for (let k = 0; k < n; k++) {
    const t = k * d;
    while (acc + sl < t && seg < p.length * 2) { acc += sl; seg++; a = p[seg % p.length]; b = p[(seg + 1) % p.length]; sl = Math.hypot(b[0] - a[0], b[1] - a[1]); }
    const f = sl > 0 ? (t - acc) / sl : 0; out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}
export function smooth(p, sigma) { // circular gaussian over samples
  const n = p.length, r = Math.ceil(sigma * 3), w = []; let s = 0;
  for (let k = -r; k <= r; k++) { const v = Math.exp(-k * k / (2 * sigma * sigma)); w.push(v); s += v; }
  return p.map((_, i) => { let x = 0, y = 0; for (let k = -r; k <= r; k++) { const q = p[((i + k) % n + n) % n]; x += q[0] * w[k + r]; y += q[1] * w[k + r]; } return [x / s, y / s]; });
}
export function rdp(p, eps) { // closed polygon: split at farthest pair
  if (p.length < 8) return p;
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  let ia = 0, ib = 0, best = -1; for (let i = 0; i < p.length; i++) { const d = d2(p[0], p[i]); if (d > best) { best = d; ia = i; } }
  best = -1; for (let i = 0; i < p.length; i++) { const d = d2(p[ia], p[i]); if (d > best) { best = d; ib = i; } }
  const [s, e] = ia < ib ? [ia, ib] : [ib, ia];
  const A = p.slice(s, e + 1), B = [...p.slice(e), ...p.slice(0, s + 1)];
  const run = (pts) => { const keep = new Array(pts.length).fill(false); keep[0] = keep[pts.length - 1] = true; const st = [[0, pts.length - 1]];
    while (st.length) { const [i, j] = st.pop(); const a = pts[i], b = pts[j]; let md = 0, mi = -1; const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-9;
      for (let k = i + 1; k < j; k++) { const d = Math.abs((pts[k][0] - a[0]) * dy - (pts[k][1] - a[1]) * dx) / L; if (d > md) { md = d; mi = k; } }
      if (md > eps) { keep[mi] = true; st.push([i, mi], [mi, j]); } }
    return pts.filter((_, i) => keep[i]); };
  const ra = run(A), rb = run(B); return [...ra.slice(0, -1), ...rb.slice(0, -1)];
}
export function ensureCCW(p) { return area(p) < 0 ? [...p].reverse() : p; } // math orientation (y up). 
export function offsetOutward(p, d) { // p CCW in y-up sense i.e. area>0; move each vertex along outward normal
  const n = p.length; return p.map((q, i) => { const a = p[(i - 1 + n) % n], b = p[(i + 1) % n]; let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty) || 1; return [q[0] + ty / l * d, q[1] - tx / l * d]; });
}
export function nearestOnPolygon(p, q) { // -> {t (0..1 arc fraction), pt, nx, ny (outward normal for CCW area>0)}
  const L = perimeter(p); let best = { d: 1e18 }, acc = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], dx = b[0] - a[0], dy = b[1] - a[1], sl = Math.hypot(dx, dy) || 1e-9;
    let f = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (sl * sl); f = Math.max(0, Math.min(1, f));
    const x = a[0] + dx * f, y = a[1] + dy * f, d = Math.hypot(q[0] - x, q[1] - y);
    if (d < best.d) best = { d, pt: [x, y], t: (acc + sl * f) / L, nx: dy / sl, ny: -dx / sl };
    acc += sl;
  }
  return best;
}
export function pointAtT(p, t) {
  const L = perimeter(p); let target = ((t % 1) + 1) % 1 * L, acc = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length], sl = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc + sl >= target) { const f = sl ? (target - acc) / sl : 0; return { pt: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], nx: (b[1] - a[1]) / (sl || 1), ny: -(b[0] - a[0]) / (sl || 1) }; }
    acc += sl; }
  return { pt: p[0], nx: 0, ny: 0 };
}
export const rotPt = (p, deg) => { const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]; };
