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

// Minimum-area bounding rectangle (rotating calipers over the convex hull). -> {w (short), l (long), angle (deg of the long side), cx, cy}
export function minRect(p) {
  const pts = p.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (pts.length < 3) return { w: 0, l: 0, angle: 0, cx: 0, cy: 0 };
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const q of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...pts].reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  const h = lo.slice(0, -1).concat(up.slice(0, -1)); let best = null;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length], d = Math.hypot(b[0] - a[0], b[1] - a[1]); if (d < 1e-9) continue;
    const ux = (b[0] - a[0]) / d, uy = (b[1] - a[1]) / d; let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (const q of h) { const u = q[0] * ux + q[1] * uy, v = -q[0] * uy + q[1] * ux; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const A = (u1 - u0) * (v1 - v0); if (!best || A < best.A) best = { A, w: u1 - u0, l: v1 - v0, ang: Math.atan2(uy, ux), u0, u1, v0, v1, ux, uy };
  }
  if (!best) return { w: 0, l: 0, angle: 0, cx: 0, cy: 0 };
  const um = (best.u0 + best.u1) / 2, vm = (best.v0 + best.v1) / 2;
  let L = best.w, S = best.l, ang = best.ang; if (S > L) { [L, S] = [S, L]; ang += Math.PI / 2; }
  return { w: S, l: L, angle: ang * 180 / Math.PI, cx: um * best.ux - vm * best.uy, cy: um * best.uy + vm * best.ux };
}
// Pinhole camera pose from a sheet(mm) -> image(px) homography. Focal length is NOT known (no EXIF in the browser): fr * long side, default 0.78 (typical phone main camera).
// -> { x, y, z }: the camera's foot point on the sheet plane (mm) and its height above the sheet (mm). Uncertain by roughly +-30 percent in z (z scales with the focal length).
export function cameraFromH(H, imgW, imgH, fr = 0.78) {
  const f = fr * Math.max(imgW, imgH), cx = imgW / 2, cy = imgH / 2;
  const col = (j) => [(H[j] - cx * H[6 + j]) / f, (H[3 + j] - cy * H[6 + j]) / f, H[6 + j]];
  const a = col(0), b = col(1), t = col(2); let s = 1 / Math.hypot(...a); if (t[2] < 0) s = -s;
  const r1 = a.map((v) => v * s), r2 = b.map((v) => v * s), tt = t.map((v) => v * s);
  const r3 = [r1[1] * r2[2] - r1[2] * r2[1], r1[2] * r2[0] - r1[0] * r2[2], r1[0] * r2[1] - r1[1] * r2[0]];
  const C = [-(r1[0] * tt[0] + r1[1] * tt[1] + r1[2] * tt[2]), -(r2[0] * tt[0] + r2[1] * tt[1] + r2[2] * tt[2]), -(r3[0] * tt[0] + r3[1] * tt[1] + r3[2] * tt[2])];
  return { x: C[0], y: C[1], z: Math.abs(C[2]) };
}
// Footprint estimate of an object of height h: the visible silhouette is dominated by the top face, which is the base scaled by z/(z-h) about the camera foot point.
export function correctForHeight(outline, cam, h) {
  if (!(h > 0) || !cam || h >= cam.z * 0.6) return outline; const k = (cam.z - h) / cam.z;
  const sc = outline.map(([x, y]) => [cam.x + (x - cam.x) * k, cam.y + (y - cam.y) * k]);
  // The footprint also lies inside the silhouette itself (base is part of it): clip the shrunken copy by the silhouette's convex hull, removing the part that slid out on the camera side.
  const hull = convexHull(outline); let sub = sc;
  const n = hull.length;
  for (let i = 0; i < n && sub.length; i++) { // Sutherland-Hodgman, hull is CCW (cross > 0 inside)
    const A = hull[i], B = hull[(i + 1) % n], inside = (q) => (B[0] - A[0]) * (q[1] - A[1]) - (B[1] - A[1]) * (q[0] - A[0]) >= 0, out = [];
    for (let j = 0; j < sub.length; j++) { const P = sub[j], Q = sub[(j + 1) % sub.length], ip = inside(P), iq = inside(Q);
      if (ip) out.push(P);
      if (ip !== iq) { const d1 = (B[0] - A[0]) * (P[1] - A[1]) - (B[1] - A[1]) * (P[0] - A[0]), d2 = (B[0] - A[0]) * (Q[1] - A[1]) - (B[1] - A[1]) * (Q[0] - A[0]), t = d1 / (d1 - d2); out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]); } }
    sub = out; }
  return sub.length >= 3 ? sub : sc;
}
export function convexHull(p) { // CCW in math orientation (y up)
  const pts = p.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const q of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...pts].reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

// Corner-preserving contour smoothing. p: closed polyline resampled at `step` mm. sigmaMM: Gaussian sigma along the arc length.
// Corners (turning angle over +-1.5 mm above ~40 degrees, local maximum) are pinned; each stretch between corners is Gaussian-smoothed with its end points fixed
// (odd reflection at the ends), so straight edges stay straight and corners stay sharp. Without corners the whole loop is smoothed circularly.
export function smoothKeepCorners(p, sigmaMM, step) {
  const n = p.length, sg = sigmaMM / step; if (sg < 0.3 || n < 12) return p;
  const pre = smooth(p, Math.max(1.5, sg * 0.5)), k = Math.max(3, Math.round(1.5 / step)), ang = new Array(n);
  for (let i = 0; i < n; i++) { const a = pre[(i - k + n) % n], b = pre[i], c = pre[(i + k) % n]; const v1x = b[0] - a[0], v1y = b[1] - a[1], v2x = c[0] - b[0], v2y = c[1] - b[1];
    ang[i] = Math.abs(Math.atan2(v1x * v2y - v1y * v2x, v1x * v2x + v1y * v2y)) * 180 / Math.PI; }
  const corners = []; for (let i = 0; i < n; i++) { if (ang[i] < 25) continue; let mx = true; for (let j = -k; j <= k; j++) if (ang[(i + j + n) % n] > ang[i] || (ang[(i + j + n) % n] === ang[i] && j < 0)) { mx = false; break; } if (mx) corners.push(i); }
  if (corners.length < 2) return smooth(p, sg);
  const r = Math.ceil(sg * 3), w = []; let ws = 0; for (let j = -r; j <= r; j++) { const v = Math.exp(-j * j / (2 * sg * sg)); w.push(v); ws += v; }
  const out = new Array(n);
  for (let c = 0; c < corners.length; c++) {
    const s = corners[c], e = corners[(c + 1) % corners.length], len = ((e - s) % n + n) % n || n, seg = []; for (let j = 0; j <= len; j++) seg.push(p[(s + j) % n]);
    const get = (j) => { if (j < 0) return [2 * seg[0][0] - seg[Math.min(-j, len)][0], 2 * seg[0][1] - seg[Math.min(-j, len)][1]]; if (j > len) return [2 * seg[len][0] - seg[Math.max(2 * len - j, 0)][0], 2 * seg[len][1] - seg[Math.max(2 * len - j, 0)][1]]; return seg[j]; };
    for (let j = 0; j < len; j++) { if (j === 0) { out[s] = seg[0]; continue; } let x = 0, y = 0; for (let m = -r; m <= r; m++) { const q = get(j + m); x += q[0] * w[m + r]; y += q[1] * w[m + r]; } out[(s + j) % n] = [x / ws, y / ws]; }
  }
  return out;
}
