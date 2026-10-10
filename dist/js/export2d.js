// 2D exports (true millimetres): SVG and DXF, per object or whole layout. Coordinates: x right, y down in SVG; DXF is y up (flipped).
import { rotPt, pointAtT, ensureCCW } from './geom.js';
import { GF } from './bin.js';

const f = (v) => (+v.toFixed(3)).toString();
export function worldGeometry(project, an) {
  return project.objects.map((o, i) => {
    const a = an.objects[i], tf = (p) => { const r = rotPt(p, o.rot || 0); return [r[0] + o.x, r[1] + o.y]; };
    const raw = ensureCCW(o.outline);
    return { name: o.name || 'Object ' + (i + 1), outline: o.outline.map(tf), pocket: a.poly, depth: a.eff.depth, margin: a.eff.margin,
      notches: (o.notches || []).map((t) => { const { pt, nx, ny } = pointAtT(raw, t); const w = tf([pt[0] + nx * a.eff.margin, pt[1] + ny * a.eff.margin]); return { x: w[0], y: w[1], r: a.eff.notch / 2 }; }) };
  });
}
const pathOf = (p) => 'M' + p.map((q) => f(q[0]) + ' ' + f(q[1])).join('L') + 'Z';
// mode 'layout' => bin outline + every object; otherwise single geometry g (translated so its bbox starts at 0,0 plus 5 mm border)
export function toSVG(geoms, bin, opts = {}) {
  let ox = 0, oy = 0, w = bin ? bin.W : 0, h = bin ? bin.D : 0;
  if (!bin) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const g of geoms) for (const p of g.pocket) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); } ox = x0 - 5; oy = y0 - 5; w = x1 - x0 + 10; h = y1 - y0 + 10; }
  const T = (p) => [p[0] - ox, p[1] - oy];
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w)}mm" height="${f(h)}mm" viewBox="0 0 ${f(w)} ${f(h)}">\n`;
  if (bin) s += `<rect id="bin" x="0" y="0" width="${f(w)}" height="${f(h)}" rx="${GF.topR}" fill="none" stroke="#888" stroke-width="0.2"/>\n`;
  for (const g of geoms) {
    s += `<g id="${g.name.replace(/[^\w-]/g, '_')}" fill="none" stroke-width="0.2">\n<path id="outline" stroke="#d00" d="${pathOf(g.outline.map(T))}"/>\n<path id="pocket" stroke="#000" d="${pathOf(g.pocket.map(T))}"/>\n`;
    for (const n of g.notches) { const c = T([n.x, n.y]); s += `<circle id="notch" stroke="#06c" cx="${f(c[0])}" cy="${f(c[1])}" r="${f(n.r)}"/>\n`; }
    s += '</g>\n';
  }
  return new Blob([s + '</svg>\n'], { type: 'image/svg+xml' });
}
export function toDXF(geoms, bin) {
  let ox = 0, oy = 0, H = bin ? bin.D : 0;
  if (!bin) { let x0 = 1e9, y1 = -1e9; for (const g of geoms) for (const p of g.pocket) { x0 = Math.min(x0, p[0]); y1 = Math.max(y1, p[1]); } ox = x0; oy = 0; H = y1; }
  const T = (p) => [p[0] - ox, H - (p[1] - oy)];
  let s = '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n';
  const poly = (pts, layer, closed = true) => { s += `0\nLWPOLYLINE\n8\n${layer}\n90\n${pts.length}\n70\n${closed ? 1 : 0}\n`; for (const p of pts) { const q = T(p); s += `10\n${f(q[0])}\n20\n${f(q[1])}\n`; } };
  if (bin) { const W = bin.W, D = bin.D; poly([[0, 0], [W, 0], [W, D], [0, D]], 'BIN'); }
  for (const g of geoms) {
    poly(g.outline, 'OUTLINE'); poly(g.pocket, 'POCKET');
    for (const n of g.notches) { const c = T([n.x, n.y]); s += `0\nCIRCLE\n8\nNOTCH\n10\n${f(c[0])}\n20\n${f(c[1])}\n40\n${f(n.r)}\n`; }
  }
  s += '0\nENDSEC\n0\nEOF\n';
  return new Blob([s], { type: 'application/dxf' });
}
