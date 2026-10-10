import { initManifold, analyze, buildBin, toSTL, meshOf, findSpot, effective, GF } from './bin.js';
import { worldGeometry, toSVG, toDXF } from './export2d.js';
import { openCapture } from './capture.js';
import { init3D, setMesh } from './view3d.js';
import { nearestOnPolygon, pointAtT, rotPt, ensureCCW, centroid, minRect } from './geom.js';

const $ = (s) => document.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
const state = { project: null, sel: null, view: 'plan', notchMode: false, an: null, nextId: 1, ready: false };
const KEY = 'gf-outline-project-v1';
const fresh = () => ({ cells: { auto: true, nx: 1, ny: 1 }, height: { auto: true, hu: 3 }, floor: 2, defaults: { margin: 2, notch: 16, depth: 20 }, objects: [] });
try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); state.project = s && s.objects ? s : fresh(); } catch { state.project = fresh(); }
state.nextId = 1 + state.project.objects.reduce((m, o) => Math.max(m, o.id), 0);
state.sel = state.project.objects[0]?.id ?? null;
const P = () => state.project, selObj = () => P().objects.find((o) => o.id === state.sel);
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(P())); } catch {} };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = (v) => Math.round(v * 10) / 10;
function toast(t, ms = 2600) { const e = $('#toast'); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (e.hidden = true), ms); }

// ---------------- recompute + render ----------------
let rafId = 0;
function refresh(opts = {}) { if (!state.ready) return; state.an = analyze(P()); renderAll(opts); }
function renderAll() { renderSummary(); renderPlan(); renderChips(); renderPanel(); if (state.view === '3d') schedule3D(); save(); window.__gfReady = true; }
function renderSummary() {
  const a = state.an; $('#summary').textContent = P().objects.length ? `${a.nx} x ${a.ny} x ${a.hu}u  |  ${a.W.toFixed(1)} x ${a.D.toFixed(1)} x ${a.H} mm` : '';
  $('#empty').hidden = P().objects.length > 0 || state.view !== 'plan'; $('#btnExport').disabled = !P().objects.length;
  $('#notchHint').hidden = !state.notchMode;
}
const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent && parent.appendChild(e); return e; };
const path = (pts) => 'M' + pts.map((p) => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join('L') + 'Z';
function renderPlan() {
  const svg = $('#plan'), a = state.an; svg.innerHTML = ''; svg.style.display = state.view === 'plan' ? '' : 'none';
  const pad = 6, vw = Math.max(a.W, 60) + 2 * pad, vh = Math.max(a.D, 60) + 2 * pad;
  svg.setAttribute('viewBox', `${-pad - (vw - a.W - 2 * pad) / 2} ${-pad - (vh - a.D - 2 * pad) / 2} ${vw} ${vh}`);
  const css = getComputedStyle(document.documentElement), ac = css.getPropertyValue('--ac'), line = css.getPropertyValue('--line'), mu = css.getPropertyValue('--mu'), bad = css.getPropertyValue('--bad'), tx = css.getPropertyValue('--tx');
  el('rect', { x: 0, y: 0, width: a.W, height: a.D, rx: GF.topR, fill: 'none', stroke: mu, 'stroke-width': 0.5 }, svg);
  for (let i = 1; i < a.nx; i++) el('line', { x1: i * 42 - 0.25, y1: 0, x2: i * 42 - 0.25, y2: a.D, stroke: line, 'stroke-width': 0.4, 'stroke-dasharray': '2 2' }, svg);
  for (let j = 1; j < a.ny; j++) el('line', { y1: j * 42 - 0.25, x1: 0, y2: j * 42 - 0.25, x2: a.W, stroke: line, 'stroke-width': 0.4, 'stroke-dasharray': '2 2' }, svg);
  for (let i = 0; i < a.nx; i++) for (let j = 0; j < a.ny; j++) el('rect', { x: i * 42 + 0.25 + 2.95, y: j * 42 + 0.25 + 2.95, width: 35.6 - 0.0, height: 35.6, rx: 0.8, fill: 'none', stroke: line, 'stroke-width': 0.25 }, svg).setAttribute('transform', `translate(-0.25 -0.25)`);
  const geoms = worldGeometry(P(), a), depthMax = Math.max(1, ...a.objects.map((o) => o.eff.depth));
  P().objects.forEach((o, i) => {
    const info = a.objects[i], g = geoms[i], sel = o.id === state.sel, isBad = info.issues.some((s) => !s.startsWith('depth'));
    const grp = el('g', { 'data-id': o.id, style: 'cursor:grab' }, svg);
    const shade = 0.12 + 0.28 * (info.eff.depth / depthMax);
    el('path', { d: path(info.poly), fill: isBad ? bad : ac, 'fill-opacity': shade, stroke: isBad ? bad : sel ? ac : mu, 'stroke-width': sel ? 0.9 : 0.5 }, grp);
    el('path', { d: path(g.outline), fill: 'none', stroke: tx, 'stroke-opacity': 0.55, 'stroke-width': 0.3 }, grp);
    const c = centroid(g.outline), t = el('text', { x: c[0], y: c[1], 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: tx, 'font-size': 5, 'font-family': 'system-ui,sans-serif', 'pointer-events': 'none' }, grp);
    t.textContent = r1(info.eff.depth) + ' mm';
    { const mr = minRect(o.outline), t2 = el('text', { x: c[0], y: c[1] + 5, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: tx, 'fill-opacity': 0.6, 'font-size': 3.2, 'font-family': 'system-ui,sans-serif', 'pointer-events': 'none' }, grp); t2.textContent = r1(mr.l) + ' x ' + r1(mr.w); }
    g.notches.forEach((n, k) => { el('circle', { cx: n.x, cy: n.y, r: n.r, fill: 'none', stroke: tx, 'stroke-width': 0.4, 'stroke-dasharray': '1.5 1.2', 'pointer-events': 'none' }, grp);
      if (sel) el('circle', { cx: n.x, cy: n.y, r: 3.2, fill: tx, stroke: ac, 'stroke-width': 1, 'data-notch': k, style: 'cursor:grab' }, svg); });
    if (sel) { // rotate handle
      const rad = Math.max(...o.outline.map((p) => Math.hypot(p[0], p[1]))) + info.eff.margin + 8, a0 = (o.rot || 0) * Math.PI / 180;
      const hx = o.x + Math.sin(a0) * rad, hy = o.y - Math.cos(a0) * rad;
      el('line', { x1: o.x, y1: o.y, x2: hx, y2: hy, stroke: ac, 'stroke-width': 0.4, 'stroke-dasharray': '1 1', 'pointer-events': 'none' }, svg);
      el('circle', { cx: hx, cy: hy, r: 3.6, fill: ac, 'data-rot': 1, style: 'cursor:grab' }, svg);
    }
  });
  svg.__geoms = geoms;
}

// ---------------- plan interaction ----------------
(function interaction() {
  const svg = $('#plan'); let drag = null;
  const toMM = (e) => { const m = svg.getScreenCTM().inverse(), p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m); return [p.x, p.y]; };
  svg.addEventListener('pointerdown', (e) => {
    const t = e.target, p = toMM(e), o = selObj();
    if (t.dataset.rot && o) { drag = { type: 'rot', o }; svg.setPointerCapture(e.pointerId); return; }
    if (t.dataset.notch !== undefined && o) { drag = { type: 'notch', o, k: +t.dataset.notch }; svg.setPointerCapture(e.pointerId); return; }
    if (state.notchMode && o) { placeNotch(o, p); return; }
    const g = t.closest('[data-id]');
    if (g) { const oo = P().objects.find((q) => q.id === +g.dataset.id); state.sel = oo.id; drag = { type: 'move', o: oo, off: [p[0] - oo.x, p[1] - oo.y], moved: false }; svg.setPointerCapture(e.pointerId); renderChips(); renderPanel(); renderPlan(); }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return; const p = toMM(e), o = drag.o;
    if (drag.type === 'move') { o.x = p[0] - drag.off[0]; o.y = p[1] - drag.off[1]; drag.moved = true; clampWalls(o); }
    else if (drag.type === 'rot') { let a = Math.atan2(p[0] - o.x, -(p[1] - o.y)) * 180 / Math.PI; o.rot = Math.round(a); }
    else if (drag.type === 'notch') { o.notches[drag.k] = notchT(o, p); }
    cancelAnimationFrame(rafId); rafId = requestAnimationFrame(() => refresh());
  });
  const end = () => {
    if (!drag) return; const d = drag; drag = null;
    if (d.type === 'move' || d.type === 'rot') resolveOverlap(d.o);
    refresh();
  };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
})();
function notchT(o, wp) { // world point -> t on raw outline
  const lp = rotPt([wp[0] - o.x, wp[1] - o.y], -(o.rot || 0)); return nearestOnPolygon(ensureCCW(o.outline), lp).t;
}
function placeNotch(o, wp) { o.notches = o.notches || []; o.notches.push(notchT(o, wp)); state.notchMode = false; refresh(); }
function clampWalls(o) { // keep pocket inside min wall at the top/left (bin grows right/down in auto mode)
  const a = analyze(P()), i = P().objects.indexOf(o), b = a.objects[i].bounds;
  if (b.min[0] < GF.wall) o.x += GF.wall - b.min[0]; if (b.min[1] < GF.wall) o.y += GF.wall - b.min[1];
  if (!P().cells.auto) { if (b.max[0] > a.W - GF.wall) o.x -= b.max[0] - (a.W - GF.wall); if (b.max[1] > a.D - GF.wall) o.y -= b.max[1] - (a.D - GF.wall); }
}
function resolveOverlap(o) {
  const a = analyze(P()), i = P().objects.indexOf(o);
  if (!a.objects[i].issues.some((s) => s.startsWith('overlaps') || s === 'outside bin')) return;
  const spot = findSpot(P(), o, [o.x, o.y], o.id);
  if (spot) { o.x = spot.x; o.y = spot.y; toast('Nudged to avoid overlap'); } else toast('No free spot nearby; pockets overlap');
}

// ---------------- chips + panel ----------------
function renderChips() {
  const c = $('#chips'); c.innerHTML = '';
  P().objects.forEach((o, i) => { const b = document.createElement('button'), info = state.an.objects[i]; b.className = 'chip' + (o.id === state.sel ? ' on' : '') + (info.issues.some((s) => !s.startsWith('depth')) ? ' bad' : '');
    b.textContent = `${o.name}  ${r1(info.eff.depth)} mm`; b.onclick = () => { state.sel = o.id; state.notchMode = false; renderAll(); }; c.appendChild(b); });
  $('#panel').style.display = P().objects.length ? '' : 'none';
}
function field(label, { min, max, step = 1, value, over, onSet, onReset, unit = 'mm' }) {
  const row = document.createElement('div'), id = 'f' + Math.random().toString(36).slice(2, 7);
  row.className = 'row'; row.innerHTML = `<div class="lab"><label for="${id}">${label}</label>${over ? '<button class="reset">Reset</button>' : ''}</div><input type="range" min="${min}" max="${max}" step="${step}"><div class="num"><input id="${id}" type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}"><span class="unit">${unit}</span></div>`;
  const [rg, nm] = row.querySelectorAll('input'); rg.value = nm.value = r1(value);
  rg.oninput = () => { nm.value = rg.value; onSet(+rg.value); };
  nm.onchange = () => { const v = clamp(+nm.value || 0, min, max); nm.value = rg.value = v; onSet(v); };
  if (over) row.querySelector('.reset').onclick = onReset; return row;
}
function renderPanel() {
  const box = $('#objPanel'), o = selObj(); box.innerHTML = ''; if (!o) return;
  const i = P().objects.indexOf(o), info = state.an.objects[i], a = state.an, d = P().defaults;
  const mk = (key, label, min, max, step, dv) => field(label, { min, max, step, value: key === 'depth' ? info.eff.depth : info.eff[key], over: o[key] != null,
    onSet: (v) => { o[key] = v; if (key === 'margin') resolveOverlap(o); refresh(); }, onReset: () => { o[key] = null; if (key === 'margin') resolveOverlap(o); refresh(); } });
  box.appendChild(actionsEl(o, i, info));
  { const mr = minRect(o.outline), pr = minRect(info.poly), n = document.createElement('div'); n.className = 'note'; n.style.cssText = 'font-size:12px;opacity:.75;margin:2px 0 6px';
    n.textContent = `Object ${r1(mr.l)} x ${r1(mr.w)} mm, pocket ${r1(pr.l)} x ${r1(pr.w)} mm (with ${r1(info.eff.margin)} mm margin; long x short side)`; box.appendChild(n); }
  box.appendChild(mk('depth', 'Depth', 1, P().height.auto ? GF.maxUnits * 7 - P().floor : a.maxDepth, 0.5));
  box.appendChild(mk('margin', 'Margin', 0, 10, 0.1));
  box.appendChild(mk('notch', 'Notch size', 6, 40, 0.5));
  box.appendChild(field('Rotation', { min: -180, max: 180, step: 1, value: o.rot || 0, unit: 'deg', onSet: (v) => { o.rot = v; resolveOverlap(o); refresh(); } }));
  const issues = info.issues.filter((s) => !s.startsWith('depth')); if (info.issues.some((s) => s.startsWith('depth'))) issues.push('Depth limited by bin height (' + a.maxDepth.toFixed(1) + ' mm max). Raise the bin height.');
  if (issues.length) { const x = document.createElement('div'); x.className = 'issue'; x.textContent = issues.join('. '); box.appendChild(x); }
}

function actionsEl(o, i, info) {
  const act = document.createElement('div'); act.className = 'actions';
  act.innerHTML = `<button id="aNotch" class="${state.notchMode ? 'on' : ''}">${state.notchMode ? 'Tap edge...' : 'Add notch'}</button><button id="aClear">Clear notches (${(o.notches || []).length})</button><button id="a90">Rotate 90</button><button id="aRe">Retake</button><button id="aDel" class="danger">Remove</button>`;
  
  act.querySelector('#aNotch').onclick = () => { state.notchMode = !state.notchMode; if (state.view !== 'plan') setView('plan'); renderSummary(); renderPanel(); };
  act.querySelector('#aClear').onclick = () => { o.notches = []; refresh(); };
  act.querySelector('#a90').onclick = () => { o.rot = ((((o.rot || 0) + 90 + 180) % 360) - 180); resolveOverlap(o); refresh(); };
  act.querySelector('#aDel').onclick = () => { P().objects.splice(i, 1); state.sel = P().objects[0]?.id ?? null; refresh(); };
  act.querySelector('#aRe').onclick = async () => { const r = await openCapture($('#capture'), { depth: info.eff.depth, title: 'Retake ' + o.name }); if (r) { o.outline = r.outline; o.notches = []; resolveOverlap(o); refresh(); } };
  return act;
}

// ---------------- 3D ----------------
let t3 = 0;
function schedule3D() { clearTimeout(t3); t3 = setTimeout(update3D, 30); }
function update3D() {
  if (!P().objects.length) { return; }
  const a = state.an, bin = buildBin(P(), analyze(P())), m = meshOf(bin);
  const labels = P().objects.map((o, i) => { const c = centroid(worldGeometry(P(), a)[i].outline); return { x: c[0], y: a.D - c[1], z: a.H - a.objects[i].eff.depth, text: r1(a.objects[i].eff.depth) + ' mm' }; });
  setMesh({ pos: m.pos, np: m.np, tri: m.tri }, a, labels); window.__gfMesh = { tris: m.tri.length / 3 };
  bin.delete && bin.delete();
}
function setView(v) {
  state.view = v; document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  $('#view3d').hidden = v !== '3d'; $('#plan').style.display = v === 'plan' ? '' : 'none';
  if (v === '3d') { init3D($('#view3d'), $('#labels3d')); schedule3D(); } renderSummary();
}
document.querySelectorAll('#viewSeg button').forEach((b) => (b.onclick = () => setView(b.dataset.view)));

// ---------------- add object ----------------
async function addObject() {
  const r = await openCapture($('#capture'), { depth: P().defaults.depth });
  if (r) addOutline(r.outline);
}
function addOutline(outline) {
  const o = { id: state.nextId++, name: 'Object ' + (P().objects.length + 1), outline, x: 0, y: 0, rot: 0, margin: null, notch: null, depth: null, notches: [] };
  const spot = findSpot(P(), o, null); if (spot) Object.assign(o, spot); else { o.x = 30; o.y = 30; toast('No free space found; adjust the layout'); }
  P().objects.push(o); state.sel = o.id; state.notchMode = false; refresh(); return o;
}
$('#btnAdd').onclick = addObject;

// ---------------- bin dialog ----------------
$('#btnBin').onclick = () => openDlg((box, close) => {
  const p = P(), a = state.an;
  box.innerHTML = `<h3>Bin</h3><p class="note">${a.nx} x ${a.ny} cells (42 mm), ${a.hu} height units (7 mm): ${a.W.toFixed(1)} x ${a.D.toFixed(1)} x ${a.H} mm. Deepest pocket allowed: ${a.maxDepth.toFixed(1)} mm.</p>
  <div class="tog"><span>Size: automatic</span><input class="sw" type="checkbox" id="cAuto" ${p.cells.auto ? 'checked' : ''}></div>
  <div class="tog" ${p.cells.auto ? 'style="opacity:.4;pointer-events:none"' : ''}><span>Cells (x by y)</span><span class="stepper"><button data-s="nx-">-</button><b id="vnx">${p.cells.auto ? a.nx : p.cells.nx}</b><button data-s="nx+">+</button>&nbsp;<button data-s="ny-">-</button><b id="vny">${p.cells.auto ? a.ny : p.cells.ny}</b><button data-s="ny+">+</button></span></div>
  <div class="tog"><span>Height: automatic</span><input class="sw" type="checkbox" id="hAuto" ${p.height.auto ? 'checked' : ''}></div>
  <div class="tog" ${p.height.auto ? 'style="opacity:.4;pointer-events:none"' : ''}><span>Height units</span><span class="stepper"><button data-s="hu-">-</button><b id="vhu">${p.height.auto ? a.hu : p.height.hu}</b><button data-s="hu+">+</button></span></div>
  <h3 style="margin-top:14px">Defaults for new objects</h3><div id="defs"></div>
  <p class="note">Each object can override these in its own panel. Bin height is the deepest pocket plus the floor, rounded up to 7 mm units.</p>
  <button class="big-btn p" id="dClose" style="width:100%;margin-top:8px">Done</button>`;
  const defs = box.querySelector('#defs'), floorRow = field('Floor', { min: 0.8, max: 10, step: 0.2, value: p.floor, onSet: (v) => { p.floor = v; refresh(); } });
  [['depth', 'Depth', 1, 80, 0.5], ['margin', 'Margin', 0, 10, 0.1], ['notch', 'Notch size', 6, 40, 0.5]].forEach(([k, l, mn, mx, st]) => defs.appendChild(field(l, { min: mn, max: mx, step: st, value: p.defaults[k], onSet: (v) => { p.defaults[k] = v; refresh(); } })));
  defs.appendChild(floorRow);
  const sync = () => { p.cells.auto = box.querySelector('#cAuto').checked; p.height.auto = box.querySelector('#hAuto').checked; refresh(); close(); $('#btnBin').click(); };
  box.querySelector('#cAuto').onchange = () => { if (!box.querySelector('#cAuto').checked) { p.cells.nx = a.nx; p.cells.ny = a.ny; } sync(); };
  box.querySelector('#hAuto').onchange = () => { if (!box.querySelector('#hAuto').checked) p.height.hu = a.hu; sync(); };
  box.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { const s = b.dataset.s, k = s.slice(0, -1), d = s.endsWith('+') ? 1 : -1;
    if (k === 'hu') p.height.hu = clamp(p.height.hu + d, 1, GF.maxUnits); else p.cells[k] = clamp(p.cells[k] + d, 1, 8); refresh(); close(); $('#btnBin').click(); });
  box.querySelector('#dClose').onclick = close;
});
function openDlg(build) {
  const d = $('#sheetDlg'), box = document.createElement('div'); d.innerHTML = ''; d.appendChild(box); d.hidden = false;
  const close = () => { d.hidden = true; d.innerHTML = ''; }; d.onclick = (e) => { if (e.target === d) close(); }; build(box, close);
}

// ---------------- export ----------------
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); window.__gfLastExport = { name, size: blob.size, blob }; }
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
export function exportAll(kind, obj) {
  const a = analyze(P()), g = worldGeometry(P(), a), tag = `${a.nx}x${a.ny}x${a.hu}u`;
  if (kind === 'stl') { const b = buildBin(P(), a); download(toSTL(b), `gridfinity-bin-${tag}.stl`); }
  if (kind === 'svg') download(toSVG(g, a), `layout-${tag}.svg`);
  if (kind === 'dxf') download(toDXF(g, a), `layout-${tag}.dxf`);
  if (kind === 'osvg') { const i = P().objects.indexOf(obj); download(toSVG([g[i]], null), `${slug(obj.name)}.svg`); }
  if (kind === 'odxf') { const i = P().objects.indexOf(obj); download(toDXF([g[i]], null), `${slug(obj.name)}.dxf`); }
}
$('#btnExport').onclick = () => openDlg((box, close) => {
  const a = state.an, o = selObj(), bad = a.objects.filter((x) => x.issues.some((s) => !s.startsWith('depth'))).length;
  box.innerHTML = `<h3>Export</h3>${bad ? `<div class="err" style="margin-bottom:8px">${bad} object(s) overlap or sit outside the bin. Fix them before printing.</div>` : ''}
  <p class="note">Millimetres. The STL is a Gridfinity bin ${a.nx} x ${a.ny} x ${a.hu}u (${a.W.toFixed(1)} x ${a.D.toFixed(1)} x ${a.H} mm), no stacking lip. SVG and DXF contain the traced outline (red or OUTLINE layer), the pocket with margin (POCKET) and notches.</p>
  <div class="actions" style="flex-direction:column"><button class="big-btn p" data-k="stl">Bin STL</button><button data-k="svg">Layout SVG</button><button data-k="dxf">Layout DXF</button>
  ${o ? `<button data-k="osvg">${o.name} SVG</button><button data-k="odxf">${o.name} DXF</button>` : ''}</div>`;
  box.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => { exportAll(b.dataset.k, o); close(); toast('Saved ' + b.textContent); });
});

// ---------------- boot ----------------
(async function boot() {
  await initManifold(); state.ready = true; refresh();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
window.__gf = { state, addOutline, refresh, exportAll, setView, analyze: () => analyze(P()), openCapture: () => addObject(), capture: $('#capture') };
