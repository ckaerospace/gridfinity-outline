// Computer vision pipeline (OpenCV.js): sheet detection, rectification, segmentation, outline tracing. All client-side.
import { SHEET, codeGrid, markerCorners } from './sheetdef.js';
import { homography, applyH, inv3, mul3, tiltFromH, rectAspect, area, resample, smooth, rdp, ensureCCW, offsetOutward, bbox } from './geom.js';

let cvP = null;
export function loadCV() {
  if (cvP) return cvP;
  cvP = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = './vendor/opencv.js';
    s.onload = () => { const c = window.cv; if (typeof c.then === 'function') c.then((m) => res(m)); else if (c.Mat) res(c); else c.onRuntimeInitialized = () => res(c); };
    s.onerror = () => rej(new Error('Could not load OpenCV')); document.head.appendChild(s);
  });
  return cvP;
}
export const MAX_SIDE = 2000;
export async function decodePhoto(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bmp, 0, 0, w, h);
  const origW = bmp.width, origH = bmp.height; bmp.close && bmp.close();
  return { canvas: cv, imageData: ctx.getImageData(0, 0, w, h), w, h, origW, origH };
}
const rotCCW = (g) => g.map((_, i) => g[i].map((__, j) => g[j][2 - i]));
const eq = (a, b) => a.every((r, i) => r.every((v, j) => v === b[i][j]));

function orderCW(q) { // q: 4 points; return clockwise (image coords, y down)
  const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
  q = [...q].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  return q;
}
function fitLine(pts) { // total least squares -> point + dir
  let mx = 0, my = 0; for (const p of pts) { mx += p[0]; my += p[1]; } mx /= pts.length; my /= pts.length;
  let sxx = 0, sxy = 0, syy = 0; for (const p of pts) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy); return { p: [mx, my], d: [Math.cos(th), Math.sin(th)] };
}
function isect(a, b) {
  const det = a.d[0] * -b.d[1] + a.d[1] * b.d[0]; if (Math.abs(det) < 1e-9) return null;
  const rx = b.p[0] - a.p[0], ry = b.p[1] - a.p[1], t = (rx * -b.d[1] + ry * b.d[0]) / det;
  return [a.p[0] + a.d[0] * t, a.p[1] + a.d[1] * t];
}

export function detectSheet(cv, imageData) {
  const w = imageData.width, h = imageData.height, long = Math.max(w, h);
  const rgba = cv.matFromImageData(imageData), gray = new cv.Mat(), bin = new cv.Mat();
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
  let blockSize = Math.round(long / 16) | 1; if (blockSize < 31) blockSize = 31;
  cv.adaptiveThreshold(gray, bin, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, blockSize, 15);
  const contours = new cv.MatVector(), hier = new cv.Mat();
  cv.findContours(bin, contours, hier, cv.RETR_CCOMP, cv.CHAIN_APPROX_NONE);
  const found = [], minArea = Math.pow(long * 0.012, 2);
  for (let i = 0; i < contours.size(); i++) {
    if (hier.intPtr(0, i)[3] !== -1) continue;
    const c = contours.get(i), a = cv.contourArea(c);
    if (a < minArea || a > w * h * 0.2) { c.delete(); continue; }
    const ap = new cv.Mat(); cv.approxPolyDP(c, ap, 0.04 * cv.arcLength(c, true), true);
    if (ap.rows === 4 && cv.isContourConvex(ap)) {
      const aq = cv.contourArea(ap);
      let q = []; for (let k = 0; k < 4; k++) q.push([ap.data32S[2 * k], ap.data32S[2 * k + 1]]);
      q = orderCW(q);
      const sides = q.map((p, k) => Math.hypot(p[0] - q[(k + 1) % 4][0], p[1] - q[(k + 1) % 4][1])), mxs = Math.max(...sides), mns = Math.min(...sides);
      if (a / aq > 0.85 && mxs / mns < 3) {
        // refine: fit lines to contour points between corners
        const pts = []; for (let k = 0; k < c.rows; k++) pts.push([c.data32S[2 * k], c.data32S[2 * k + 1]]);
        const near = q.map((qq) => { let bi = 0, bd = 1e18; pts.forEach((p, k) => { const d = (p[0] - qq[0]) ** 2 + (p[1] - qq[1]) ** 2; if (d < bd) { bd = d; bi = k; } }); return bi; });
        const lines = []; let okL = true;
        for (let k = 0; k < 4; k++) {
          let s = near[k], e = near[(k + 1) % 4]; const seg = []; let n = ((e - s) % pts.length + pts.length) % pts.length;
          if (n < 8) { okL = false; break; }
          for (let m = Math.floor(n * 0.15); m <= n * 0.85; m++) seg.push(pts[(s + m) % pts.length]);
          const L = fitLine(seg), cx = q.reduce((s2, p) => s2 + p[0], 0) / 4, cy = q.reduce((s2, p) => s2 + p[1], 0) / 4;
          // push line outward by 0.5 px (contour runs through boundary pixel centres)
          let nx = -L.d[1], ny = L.d[0]; if ((L.p[0] - cx) * nx + (L.p[1] - cy) * ny < 0) { nx = -nx; ny = -ny; }
          L.p = [L.p[0] + nx * 0.5, L.p[1] + ny * 0.5]; lines.push(L);
        }
        let rq = q;
        if (okL) { const r = [0, 1, 2, 3].map((k) => isect(lines[(k + 3) % 4], lines[k])); if (r.every((p) => p && Math.hypot(p[0] - q[0][0], p[1] - q[0][1]) < 1e9)) { const dmax = Math.max(...r.map((p, k) => Math.hypot(p[0] - q[k][0], p[1] - q[k][1]))); if (dmax < 6) rq = r; } }
        found.push({ q: rq, area: a });
      }
    }
    ap.delete(); c.delete();
  }
  // decode
  const markers = [], patch = new cv.Mat();
  for (const f of found) {
    const src = cv.matFromArray(4, 1, cv.CV_32FC2, f.q.flat()), dst = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, 50, 0, 50, 50, 0, 50]);
    const T = cv.getPerspectiveTransform(src, dst); cv.warpPerspective(gray, patch, T, new cv.Size(50, 50), cv.INTER_LINEAR);
    src.delete(); dst.delete(); T.delete();
    const d = patch.data, cell = []; let lo = 255, hi = 0;
    for (let r = 0; r < 5; r++) { cell.push([]); for (let c = 0; c < 5; c++) { let s = 0; for (let y = r * 10 + 2; y < r * 10 + 8; y++) for (let x = c * 10 + 2; x < c * 10 + 8; x++) s += d[y * 50 + x]; s /= 36; cell[r].push(s); lo = Math.min(lo, s); hi = Math.max(hi, s); } }
    if (hi - lo < 60) continue;
    const thr = (hi + lo) / 2, b = cell.map((r) => r.map((v) => (v < thr ? 1 : 0)));
    let bad = 0; for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) if ((r === 0 || r === 4 || c === 0 || c === 4) && !b[r][c]) bad++;
    if (bad > 1) continue;
    const obs = [0, 1, 2].map((r) => [0, 1, 2].map((c) => b[r + 1][c + 1]));
    let hit = null;
    for (let id = 0; id < 4 && !hit; id++) { let g = codeGrid(id); for (let c0 = 0; c0 < 4; c0++) { if (eq(g, obs)) { hit = { id, c0 }; break; } g = rotCCW(g); } }
    if (!hit) continue;
    const prev = markers.find((m) => m.id === hit.id);
    if (prev) { if (prev.area >= f.area) continue; markers.splice(markers.indexOf(prev), 1); }
    markers.push({ id: hit.id, c0: hit.c0, q: f.q, area: f.area });
  }
  patch.delete(); rgba.delete(); gray.delete(); bin.delete(); contours.delete(); hier.delete();
  if (markers.length < 3) return { ok: false, found: markers.length, ids: markers.map((m) => m.id) };
  const srcMM = [], dstPx = [];
  for (const m of markers) { const pc = markerCorners(m.id); for (let k = 0; k < 4; k++) { srcMM.push(pc[(m.c0 + k) % 4]); dstPx.push(m.q[k]); } }
  const Hm2i = homography(srcMM, dstPx); let se = 0;
  srcMM.forEach((p, k) => { const r = applyH(Hm2i, p[0], p[1]); se += (r[0] - dstPx[k][0]) ** 2 + (r[1] - dstPx[k][1]) ** 2; });
  const rms = Math.sqrt(se / srcMM.length);
  return { ok: true, found: markers.length, ids: markers.map((m) => m.id), rms, Hmm2img: Hm2i, Himg2mm: inv3(Hm2i), tilt: tiltFromH(Hm2i, w, h), roi: SHEET.roi, markers };
}

export function manualCalibration(imageData, pts, wmm, hmm) {
  const w = imageData.width, h = imageData.height;
  let est = false;
  if (!hmm) { hmm = wmm / rectAspect(pts, w, h); est = true; }
  const Himg2mm = homography(pts, [[0, 0], [wmm, 0], [wmm, hmm], [0, hmm]]);
  return { ok: true, manual: true, heightEstimated: est, widthMM: wmm, heightMM: hmm, Himg2mm, Hmm2img: inv3(Himg2mm), tilt: tiltFromH(inv3(Himg2mm), w, h), roi: { x0: 0, y0: 0, x1: wmm, y1: hmm }, rms: 0 };
}

export function rectify(cv, imageData, cal, ppm = 4) {
  const { x0, y0, x1, y1 } = cal.roi, s = Math.min(ppm, 1400 / Math.max(x1 - x0, y1 - y0));
  const wpx = Math.round((x1 - x0) * s), hpx = Math.round((y1 - y0) * s);
  const S = [s, 0, -x0 * s, 0, s, -y0 * s, 0, 0, 1], M = mul3(S, cal.Himg2mm);
  const src = cv.matFromImageData(imageData), dst = new cv.Mat(), Mm = cv.matFromArray(3, 3, cv.CV_64F, M);
  cv.warpPerspective(src, dst, Mm, new cv.Size(wpx, hpx), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar(255, 255, 255, 255));
  src.delete(); Mm.delete();
  return { mat: dst, w: wpx, h: hpx, s, x0, y0 };
}

function blurSmall(cv, ch32, w, h, sigma) { // single-channel float array (small res) gaussian
  const m = cv.matFromArray(h, w, cv.CV_32F, ch32), o = new cv.Mat(); cv.GaussianBlur(m, o, new cv.Size(0, 0), sigma, sigma, cv.BORDER_REPLICATE);
  const r = Float32Array.from(o.data32F); m.delete(); o.delete(); return r;
}
// Build per-pixel "difference from paper" map, robust to grid lines (morphological closing) and lighting gradients.
export function prepareSeg(cv, rect) {
  const { w, h, mat } = rect, rgb = new cv.Mat(), closed = new cv.Mat(), lab = new cv.Mat();
  cv.cvtColor(mat, rgb, cv.COLOR_RGBA2RGB);
  const k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(7, 7)); cv.morphologyEx(rgb, closed, cv.MORPH_CLOSE, k); k.delete();
  cv.cvtColor(closed, lab, cv.COLOR_RGB2Lab);
  const n = w * h, L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n), d = lab.data;
  for (let i = 0; i < n; i++) { L[i] = d[3 * i]; A[i] = d[3 * i + 1]; B[i] = d[3 * i + 2]; }
  rgb.delete(); closed.delete(); lab.delete();
  // low-res illumination estimate with masked (object-excluded) averaging
  const f = 8, sw = Math.ceil(w / f), sh = Math.ceil(h / f), sn = sw * sh, down = (ch) => { const o = new Float32Array(sn), c = new Float32Array(sn); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const j = ((y / f) | 0) * sw + ((x / f) | 0); o[j] += ch[y * w + x]; c[j]++; } for (let j = 0; j < sn; j++) o[j] /= c[j] || 1; return o; };
  const sL = down(L), sA = down(A), sB = down(B);
  let mask = new Float32Array(sn).fill(1), il = [sL, sA, sB];
  for (let pass = 0; pass < 4; pass++) {
    const num = [sL, sA, sB].map((c) => blurSmall(cv, c.map((v, i) => v * mask[i]), sw, sh, 6)), den = blurSmall(cv, mask, sw, sh, 6);
    const base = [sL, sA, sB].map((c) => blurSmall(cv, c, sw, sh, 10));
    il = num.map((nm, c) => nm.map((v, i) => (den[i] > 0.08 ? v / den[i] : base[c][i])));
    mask = new Float32Array(sn); for (let i = 0; i < sn; i++) { const dd = Math.hypot(0.8 * (sL[i] - il[0][i]), sA[i] - il[1][i], sB[i] - il[2][i]); mask[i] = dd < 14 ? 1 : 0; }
  }
  const up = (c) => { const m = cv.matFromArray(sh, sw, cv.CV_32F, c), o = new cv.Mat(); cv.resize(m, o, new cv.Size(w, h), 0, 0, cv.INTER_LINEAR); const r = Float32Array.from(o.data32F); m.delete(); o.delete(); return r; };
  const iL = up(il[0]), iA = up(il[1]), iB = up(il[2]), dist = new Float32Array(n);
  for (let i = 0; i < n; i++) dist[i] = Math.hypot(0.8 * (L[i] - iL[i]), A[i] - iA[i], B[i] - iB[i]);
  // Default tolerance: the iso-level of the distance map whose boundary has the strongest gradient (a crisp object edge,
  // not the soft ramp of a cast shadow). Searched over 6..90.
  const sumG = new Float64Array(96), cnt = new Float64Array(96);
  for (let y = 3; y < h - 3; y++) for (let x = 3; x < w - 3; x++) {
    const i = y * w + x, v = dist[i], gx = Math.abs(dist[i + 1] - dist[i - 1]) * 0.5, gy = Math.abs(dist[i + w] - dist[i - w]) * 0.5, g = Math.hypot(gx, gy);
    if (g < 0.5) continue; const lo = Math.max(4, (v - g) | 0), hi = Math.min(95, (v + g) | 0);
    for (let t = lo; t <= hi; t++) { sumG[t] += g; cnt[t]++; }
  }
  let best = -1, thr = 24;
  for (let t = 6; t <= 90; t++) { if (cnt[t] < 150) continue; const m = sumG[t] / cnt[t] * Math.min(1, cnt[t] / 600); if (m > best * 1.0001) { best = m; thr = t; } }
  return { w, h, s: rect.s, x0: rect.x0, y0: rect.y0, dist, L, A, B, autoTol: Math.max(10, Math.min(80, thr)) };
}

function flood(seg, sx, sy, tol) { // pixels connected to seed with Lab distance to seed <= tol
  const { w, h, L, A, B } = seg, out = new Uint8Array(w * h), si = sy * w + sx, l0 = L[si], a0 = A[si], b0 = B[si], st = [si]; out[si] = 1;
  while (st.length) { const i = st.pop(), x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const j = ny * w + nx; if (out[j]) continue;
      if (Math.hypot(0.8 * (L[j] - l0), A[j] - a0, B[j] - b0) <= tol) { out[j] = 1; st.push(j); } } }
  return out;
}
// tol: distance threshold; edits: [{type:'add'|'remove', x, y}] in rectified px; pick: {x,y}|null
export function segment(cv, seg, tol, edits = [], pick = null) {
  const { w, h, s, x0, y0, dist } = seg, n = w * h, m = new cv.Mat(h, w, cv.CV_8U), d = m.data, inset = Math.round(1.5 * s);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = (dist[y * w + x] > tol && x >= 0 && y >= 0) ? 255 : 0;
  const k3 = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3)), k5 = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
  cv.morphologyEx(m, m, cv.MORPH_OPEN, k3); cv.morphologyEx(m, m, cv.MORPH_CLOSE, k5); k3.delete(); k5.delete();
  for (const e of edits) { const fl = flood(seg, Math.round(e.x), Math.round(e.y), Math.max(10, tol)); for (let i = 0; i < n; i++) if (fl[i]) d[i] = e.type === 'add' ? 255 : 0; }
  const contours = new cv.MatVector(), hier = new cv.Mat(), tmp = m.clone();
  cv.findContours(tmp, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE); tmp.delete();
  let bi = -1, ba = 25 * s * s; // min 25 mm^2
  for (let i = 0; i < contours.size(); i++) { const c = contours.get(i); let a = cv.contourArea(c);
    if (pick) { const inside = cv.pointPolygonTest(c, new cv.Point(pick.x, pick.y), false) >= 0; if (inside) a += 1e12; }
    if (a > ba) { ba = a; bi = i; } c.delete(); }
  const res = { ok: false, tol, mask: null, outline: null, touchesEdge: false };
  if (bi >= 0) {
    const c = contours.get(bi); let pts = []; for (let i = 0; i < c.rows; i++) pts.push([c.data32S[2 * i], c.data32S[2 * i + 1]]);
    res.touchesEdge = pts.some(([x, y]) => x <= inset * 0 + 1 || y <= 1 || x >= w - 2 || y >= h - 2);
    const fill = cv.Mat.zeros(h, w, cv.CV_8U), mv = new cv.MatVector(); mv.push_back(c); cv.drawContours(fill, mv, 0, new cv.Scalar(255), -1); mv.delete();
    res.mask = fill; c.delete();
    let mm = pts.map(([x, y]) => [x0 + x / s, y0 + y / s]); mm = ensureCCW(mm);
    mm = resample(mm, 0.25); mm = smooth(mm, 2); mm = offsetOutward(mm, 0.0 / s); mm = rdp(mm, 0.06);
    const bb = bbox(mm); res.outline = mm; res.ok = true; res.areaMM2 = Math.abs(area(mm)); res.bbox = bb;
  }
  m.delete(); contours.delete(); hier.delete();
  return res;
}
