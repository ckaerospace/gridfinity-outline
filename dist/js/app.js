import { arrange } from './pack.js';
import { initManifold, analyze, buildBin, saveParams, toSTL, meshOf, findSpot, effective, GF, outerWall } from './bin.js';
import { putProject, getProject, listProjects, deleteProject, newId } from './store.js';
import { worldGeometry, toSVG, toDXF } from './export2d.js';
import { openCapture } from './capture.js';
import { init3D, setMesh } from './view3d.js';
import { nearestOnPolygon, pointAtT, rotPt, ensureCCW, centroid, minRect } from './geom.js';

const $ = (s) => document.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
const state = { project: null, sel: null, view: 'plan', notchMode: false, an: null, nextId: 1, ready: false };
const KEY = 'gf-outline-project-v1';
const fresh = () => ({ lip: false, magnets: false, arrange: { wall: 3, rotate: true }, save: { on: false, saving: 60, wall: 1.6 }, cells: { auto: true, nx: 1, ny: 1 }, height: { auto: true, hu: 3 }, floor: 2, defaults: { margin: 2, notch: 16, depth: 20 }, objects: [] });
try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); state.project = s && s.objects ? s : fresh(); } catch { state.project = fresh(); }
if (!state.project.arrange) state.project.arrange = { wall: 3, rotate: true };
if (!state.project.save) state.project.save = { on: false, saving: 60, wall: 1.6 };
state.nextId = 1 + state.project.objects.reduce((m, o) => Math.max(m, o.id), 0);
state.sel = state.project.objects[0]?.id ?? null;
const P = () => state.project, selObj = () => P().objects.find((o) => o.id === state.sel);
const CUR = 'gf-outline-current';
try { const c = JSON.parse(localStorage.getItem(CUR) || 'null'); state.pid = c?.id || newId(); state.pname = c?.name || 'Untitled'; } catch { state.pid = newId(); state.pname = 'Untitled'; }
const strip = (p) => ({ ...p, objects: p.objects.map(({ photo, ...o }) => o) });
let idbT = 0;
const save = () => {
  try { localStorage.setItem(KEY, JSON.stringify(strip(P()))); localStorage.setItem(CUR, JSON.stringify({ id: state.pid, name: state.pname })); } catch {}
  clearTimeout(idbT); idbT = setTimeout(persist, 500); scheduleCommit();
};
async function persist() {
  if (!P().objects.length && !state.persisted) return; // don't litter the list with empty projects
  const a = state.an || analyze(P());
  try { await putProject({ id: state.pid, name: state.pname, updated: Date.now(), n: P().objects.length, size: `${a.nx}x${a.ny}x${a.hu}u`, thumb: P().objects.find((o) => o.photo)?.photo || null, data: JSON.parse(JSON.stringify(P())) }); state.persisted = true; window.__gfSaved = (window.__gfSaved || 0) + 1; } catch (e) { console.warn('save failed', e); }
}
// ---------------- undo / redo (whole-project snapshots, committed when edits settle) ----------------
const H = { stack: [], i: -1, t: 0 };
function scheduleCommit() { clearTimeout(H.t); H.t = setTimeout(commit, 350); }
function commit() { if (state.dragging) return scheduleCommit(); const j = JSON.stringify(P()); if (H.stack[H.i] === j) return; H.stack = H.stack.slice(0, H.i + 1); H.stack.push(j); if (H.stack.length > 80) H.stack.shift(); H.i = H.stack.length - 1; histUI(); }
function histUI() { $('#btnUndo').disabled = H.i <= 0; $('#btnRedo').disabled = H.i >= H.stack.length - 1; }
function travel(d) { commit(); const k = H.i + d; if (k < 0 || k >= H.stack.length) return; H.i = k; state.project = JSON.parse(H.stack[k]);
  if (!P().objects.some((o) => o.id === state.sel)) state.sel = P().objects[0]?.id ?? null; state.notchMode = false; state.nextId = Math.max(state.nextId, 1 + P().objects.reduce((m, o) => Math.max(m, o.id), 0)); refresh(); histUI(); toast(d < 0 ? 'Undone' : 'Redone', 1000); }
function resetHistory() { H.stack = [JSON.stringify(P())]; H.i = 0; histUI(); }
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = (v) => Math.round(v * 10) / 10;
function toast(t, ms = 2600) { const e = $('#toast'); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (e.hidden = true), ms); }

// ---------------- recompute + render ----------------
let rafId = 0;
function refresh(opts = {}) { if (!state.ready) return; state.an = analyze(P()); renderAll(opts); }
function renderAll() { renderSummary(); renderPlan(); renderChips(); renderPanel(); if (state.view === '3d') schedule3D(); save(); window.__gfReady = true; }
function renderSummary() {
  const a = state.an, n = P().objects.length;
  $('#stats').innerHTML = n ? `<b>${a.nx}×${a.ny}×${a.hu}u</b><span>${a.W.toFixed(0)}×${a.D.toFixed(0)}×${r1(a.Htot)} mm</span><span id="estT">${state.est ? state.est : '…'}</span>` : ''; $('#stats').hidden = !n;
  $('#empty').hidden = n > 0 || state.view !== 'plan';
  $('#btnExport').hidden = !n; $('#btnAdd').className = n ? 'secondary addbtn' : 'primary'; $('#btnAdd').textContent = n ? '+ Add' : 'Take a photo';
  $('#notchHint').hidden = !state.notchMode; $('#projName').textContent = state.pname;
  const arr = n >= 2 && state.view === 'plan'; $('#btnArr').hidden = $('#btnArrOpt').hidden = !arr; if (!arr) { $('#arrMsg').hidden = true; $('#btnArrUndo').hidden = true; }
  scheduleEstimate();
}
// rough print estimate from the solid volume: typical slicer settings (0.2 mm layers, 2 walls, 15% infill) print ~45% of a bin's solid volume, at ~8 mm3/s effective
let estT = 0;
function scheduleEstimate() { clearTimeout(estT); if (!P().objects.length) return; estT = setTimeout(() => { try { const b = buildBin(P(), analyze(P())), v = b.volume(); b.delete && b.delete();
  const pv = v * 0.45, min = Math.round(pv / 8 / 60 + 6), g = Math.round(pv / 1000 * 1.24);
  state.est = `≈ ${min >= 60 ? Math.floor(min / 60) + ' h ' + String(min % 60).padStart(2, '0') : min} min · ${g} g`; state.estData = { min, g, vol: v };
  const e = $('#estT'); if (e) e.textContent = state.est; } catch (_) {} }, 450); }
const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent && parent.appendChild(e); return e; };
const path = (pts) => 'M' + pts.map((p) => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join('L') + 'Z';
function renderPlan() {
  const svg = $('#plan'), a = state.an; svg.innerHTML = ''; svg.style.display = state.view === 'plan' ? '' : 'none'; if (!P().objects.length) return;
  const pad = 6, pb = Math.max(a.W, a.D, 60) * 0.11, vw = Math.max(a.W, 60) + 2 * pad, vh = Math.max(a.D, 60) + 2 * pad + pb;
  svg.setAttribute('viewBox', `${-pad - (vw - a.W - 2 * pad) / 2} ${-pad - (vh - pb - a.D - 2 * pad) / 2} ${vw} ${vh}`);
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
  const svg = $('#plan'); let drag = null, lp = 0;
  const toMM = (e) => { const m = svg.getScreenCTM().inverse(), p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m); return [p.x, p.y]; };
  svg.addEventListener('pointerdown', (e) => {
    const t = e.target, p = toMM(e), o = selObj();
    if (t.dataset.rot && o) { drag = { type: 'rot', o }; svg.setPointerCapture(e.pointerId); return; }
    if (t.dataset.notch !== undefined && o) { drag = { type: 'notch', o, k: +t.dataset.notch }; svg.setPointerCapture(e.pointerId); return; }
    if (state.notchMode && o) { placeNotch(o, p); return; }
    const g = t.closest('[data-id]');
    if (g) { const oo = P().objects.find((q) => q.id === +g.dataset.id); state.sel = oo.id; drag = { type: 'move', o: oo, off: [p[0] - oo.x, p[1] - oo.y], moved: false, p0: p, x0: oo.x, y0: oo.y }; svg.setPointerCapture(e.pointerId); renderChips(); renderPanel(); renderPlan();
      clearTimeout(lp); lp = setTimeout(() => { if (drag && drag.o === oo && !drag.moved) { drag = null; state.dragging = false; objSheet(oo); } }, 550); }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return; const p = toMM(e), o = drag.o;
    if (drag.type === 'move') { if (!drag.moved && Math.hypot(p[0] - drag.p0[0], p[1] - drag.p0[1]) < 2) return; if (o.locked) { if (!drag.warned) toast('Locked. Long-press to edit, or unlock it under More.'); drag.warned = true; return; } clearTimeout(lp); o.x = p[0] - drag.off[0]; o.y = p[1] - drag.off[1]; drag.moved = true; state.dragging = true; clampWalls(o); }
    else if (drag.type === 'rot') { let a = Math.atan2(p[0] - o.x, -(p[1] - o.y)) * 180 / Math.PI; o.rot = Math.round(a); }
    else if (drag.type === 'notch') { o.notches[drag.k] = notchT(o, p); }
    cancelAnimationFrame(rafId); rafId = requestAnimationFrame(() => refresh());
  });
  const end = () => {
    clearTimeout(lp); if (!drag) return; const d = drag; drag = null; state.dragging = false;
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
  const ow = outerWall(P()); if (b.min[0] < ow) o.x += ow - b.min[0]; if (b.min[1] < ow) o.y += ow - b.min[1];
  if (!P().cells.auto) { if (b.max[0] > a.W - ow) o.x -= b.max[0] - (a.W - ow); if (b.max[1] > a.D - ow) o.y -= b.max[1] - (a.D - ow); }
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
    b.innerHTML = `${o.locked ? '<span class="lk" aria-label="locked"></span>' : ''}${esc(o.name)} <small>${r1(info.eff.depth)} mm</small>`; let t = 0, fired = false;
    b.onpointerdown = () => { fired = false; t = setTimeout(() => { fired = true; objSheet(o); }, 550); }; b.onpointerup = b.onpointerleave = b.onpointercancel = () => clearTimeout(t);
    b.oncontextmenu = (e) => e.preventDefault();
    b.onclick = () => { if (fired) return; state.sel = o.id; state.notchMode = false; renderAll(); }; c.appendChild(b); });
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
  const i = P().objects.indexOf(o), info = state.an.objects[i], a = state.an;
  const mk = (key, label, min, max, step) => field(label, { min, max, step, value: key === 'depth' ? info.eff.depth : info.eff[key], over: o[key] != null,
    onSet: (v) => { o[key] = v; if (key === 'margin') resolveOverlap(o); refresh(); }, onReset: () => { o[key] = null; if (key === 'margin') resolveOverlap(o); refresh(); } });
  const issues = info.issues.filter((s) => !s.startsWith('depth')).map((s) => s === 'outside bin' ? 'Pocket is too close to the bin edge' : s.replace(/^overlaps/, 'Pocket overlaps'));
  if (info.issues.some((s) => s.startsWith('depth'))) issues.push('Too deep for this bin height (' + a.maxDepth.toFixed(1) + ' mm max). Set Height to automatic in Bin.');
  if (issues.length) { const x = document.createElement('div'); x.className = 'issue'; x.textContent = issues.join('. ') + '.'; box.appendChild(x); }
  box.appendChild(mk('depth', 'Depth', 1, P().height.auto ? GF.maxUnits * 7 - Math.max(P().floor, GF.footH + GF.minFloorAboveFoot) : a.maxDepth, 0.5));
  box.appendChild(mk('margin', 'Margin', 0, 10, 0.1));
  const act = document.createElement('div'); act.className = 'actions';
  act.innerHTML = `<button id="aNotch" class="${state.notchMode ? 'on' : ''}">${state.notchMode ? 'Tap the edge…' : 'Finger notch'}</button><button id="a90">Rotate 90°</button>`;
  act.querySelector('#aNotch').onclick = () => { state.notchMode = !state.notchMode; if (state.view !== 'plan') setView('plan'); renderSummary(); renderPanel(); };
  act.querySelector('#a90').onclick = () => { o.rot = ((((o.rot || 0) + 90 + 180) % 360) - 180); resolveOverlap(o); refresh(); };
  box.appendChild(act);
  const more = document.createElement('details'); more.className = 'more'; more.open = localStorage.getItem('gf-more-obj') === '1'; more.ontoggle = () => localStorage.setItem('gf-more-obj', more.open ? '1' : '0');
  more.innerHTML = '<summary>More</summary>'; box.appendChild(more);
  { const mr = minRect(o.outline), pr = minRect(info.poly), n = document.createElement('p'); n.className = 'note';
    n.textContent = `Object ${r1(mr.l)} × ${r1(mr.w)} mm · pocket ${r1(pr.l)} × ${r1(pr.w)} mm`; more.appendChild(n); }
  more.appendChild(mk('notch', 'Notch size', 6, 40, 0.5));
  more.appendChild(field('Rotation', { min: -180, max: 180, step: 1, value: o.rot || 0, unit: '°', onSet: (v) => { o.rot = v; resolveOverlap(o); refresh(); } }));
  const a2 = document.createElement('div'); a2.className = 'actions';
  a2.innerHTML = `<button id="aRen">Rename</button><button id="aClear" ${(o.notches || []).length ? '' : 'disabled'}>Clear notches (${(o.notches || []).length})</button><button id="aLock" class="${o.locked ? 'on' : ''}">${o.locked ? 'Unlock' : 'Lock position'}</button><button id="aRe">Retake photo</button><button id="aDel" class="danger">Remove</button>`;
  a2.querySelector('#aRen').onclick = () => objSheet(o, true);
  a2.querySelector('#aClear').onclick = () => { o.notches = []; refresh(); };
  a2.querySelector('#aLock').onclick = () => { o.locked = !o.locked; refresh(); };
  a2.querySelector('#aDel').onclick = () => removeObj(o);
  a2.querySelector('#aRe').onclick = async () => { const r = await openCapture($('#capture'), { depth: info.eff.depth, title: 'Retake ' + o.name, onStep }); if (r) { o.outline = r.outline; if (r.photo) o.photo = r.photo; o.notches = []; resolveOverlap(o); refresh(); } };
  more.appendChild(a2);
}
function removeObj(o) { const i = P().objects.indexOf(o); if (i < 0) return; P().objects.splice(i, 1); state.sel = P().objects[0]?.id ?? null; refresh(); toast(`Removed ${o.name}. Tap Undo to bring it back.`); }
// long-press sheet: rename, depth, delete
function objSheet(o, focusName) {
  if (navigator.vibrate) try { navigator.vibrate(12); } catch (_) {}
  state.sel = o.id; renderAll();
  openDlg((box, close) => {
    const info = state.an.objects[P().objects.indexOf(o)];
    box.innerHTML = `<h3>Edit object</h3>${o.photo ? `<img class="objthumb" src="${o.photo}" alt="">` : ''}<label class="fl">Name<input type="text" id="oName" maxlength="40" value="${esc(o.name)}"></label><div id="oDepth"></div>
      <div class="dlgbtns"><button class="secondary danger" id="oDel">Delete</button><button class="primary" id="oDone">Done</button></div>`;
    box.querySelector('#oDepth').appendChild(field('Depth', { min: 1, max: 80, step: 0.5, value: info.eff.depth, onSet: (v) => { o.depth = v; refresh(); } }));
    const nm = box.querySelector('#oName'); nm.oninput = () => { o.name = nm.value.trim() || o.name; renderChips(); save(); };
    box.querySelector('#oDel').onclick = () => { close(); removeObj(o); };
    box.querySelector('#oDone').onclick = () => { close(); refresh(); };
    if (focusName) setTimeout(() => { nm.focus(); nm.select(); }, 50);
  }, 'sheetObj');
}

// ---------------- 3D ----------------
let t3 = 0;
function schedule3D() { clearTimeout(t3); t3 = setTimeout(update3D, 30); }
function update3D() {
  if (!P().objects.length) { return; }
  const a = state.an, bin = buildBin(P(), analyze(P())), m = meshOf(bin);
  const labels = P().objects.map((o, i) => { const c = centroid(worldGeometry(P(), a)[i].outline); return { x: c[0], y: a.D - c[1], z: a.H - a.objects[i].eff.depth, text: r1(a.objects[i].eff.depth) + ' mm' }; });
  const sp = P().save.on ? saveParams(P()) : null; $('#btnCut').hidden = !sp; if (!sp) state.cut = false;
  setMesh({ pos: m.pos, np: m.np, tri: m.tri }, { ...a, H: a.Htot, cutZ: sp && state.cut ? (sp.z0 + a.H - sp.wall) / 2 : null }, labels); window.__gfMesh = { tris: m.tri.length / 3 };
  bin.delete && bin.delete();
}
// ---------------- step bar ----------------
const STEPS = ['photo', 'outline', 'bin', 'export'];
function onStep(st) { const cur = st || (state.exportOpen ? 'export' : 'bin'), k = STEPS.indexOf(cur);
  document.querySelectorAll('#steps [data-step]').forEach((b, i) => { b.classList.toggle('on', b.dataset.step === cur); b.classList.toggle('done', i < k); }); }
document.querySelectorAll('#steps [data-step]').forEach((b) => b.onclick = () => { const st = b.dataset.step;
  if (st === 'photo' || st === 'outline') { if (st === 'outline' && P().objects.length) { toast('Retake an object under More to redo its outline'); return; } addObject(); }
  else if (st === 'export') { if (P().objects.length) $('#btnExport').click(); else toast('Add an object first'); } });
function setView(v) {
  state.view = v; document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  $('#view3d').hidden = v !== '3d'; $('#plan').style.display = v === 'plan' ? '' : 'none';
  if (v === '3d') { init3D($('#view3d'), $('#labels3d')); schedule3D(); } renderSummary();
}
$('#btnCut').onclick = () => { state.cut = !state.cut; $('#btnCut').classList.toggle('on', state.cut); schedule3D(); };
document.querySelectorAll('#viewSeg button').forEach((b) => (b.onclick = () => setView(b.dataset.view)));

// ---------------- add object ----------------
async function addObject() {
  const r = await openCapture($('#capture'), { depth: P().defaults.depth, onStep });
  if (r) { const o = addOutline(r.outline); if (r.photo) { o.photo = r.photo; save(); } }
}
function addOutline(outline) {
  const o = { id: state.nextId++, name: 'Object ' + (P().objects.length + 1), outline, x: 0, y: 0, rot: 0, margin: null, notch: null, depth: null, notches: [] };
  const spot = findSpot(P(), o, null); if (spot) Object.assign(o, spot); else { o.x = 30; o.y = 30; toast('No free space found; adjust the layout'); }
  P().objects.push(o); state.sel = o.id; state.notchMode = false; refresh(); return o;
}
$('#btnAdd').onclick = addObject;

// ---------------- bin dialog ----------------
$('#btnBin').onclick = () => openDlg((box, close) => {
  const p = P(), a = state.an, reopen = () => { refresh(); close(); state.binMore = !!box.querySelector('#binMore')?.open; $('#btnBin').click(); };
  box.innerHTML = `<h3>Bin</h3><p class="note">${a.nx} × ${a.ny} cells · ${a.hu} units high · ${a.W.toFixed(1)} × ${a.D.toFixed(1)} × ${r1(a.Htot)} mm${state.est ? ' · ' + state.est : ''}</p>
  <div class="tog"><span>Stacking lip<small>Bins above sit securely. Adds ${GF.lipH} mm and keeps pockets ${GF.lipWall} mm from the edge.</small></span><input class="sw" type="checkbox" id="cLip" ${p.lip ? 'checked' : ''}></div>
  <div class="tog"><span>Magnet holes<small>6 × 2 mm magnets, 4 per cell, under the feet.</small></span><input class="sw" type="checkbox" id="cMag" ${p.magnets ? 'checked' : ''}></div>
  <div class="tog"><span>Save material<small>Sealed hex voids inside the walls.</small></span><input class="sw" type="checkbox" id="svOn" ${p.save.on ? 'checked' : ''}></div>
  <div id="svBox" ${p.save.on ? '' : 'hidden'}><div id="svf"></div><p class="note" id="svEst">Estimating…</p></div>
  <details class="more" id="binMore" ${state.binMore ? 'open' : ''}><summary>More</summary>
  <div class="tog"><span>Size: automatic</span><input class="sw" type="checkbox" id="cAuto" ${p.cells.auto ? 'checked' : ''}></div>
  <div class="tog" ${p.cells.auto ? 'style="opacity:.4;pointer-events:none"' : ''}><span>Cells (x by y)</span><span class="stepper"><button data-s="nx-">−</button><b id="vnx">${p.cells.auto ? a.nx : p.cells.nx}</b><button data-s="nx+">+</button>&nbsp;<button data-s="ny-">−</button><b id="vny">${p.cells.auto ? a.ny : p.cells.ny}</b><button data-s="ny+">+</button></span></div>
  <div class="tog"><span>Height: automatic</span><input class="sw" type="checkbox" id="hAuto" ${p.height.auto ? 'checked' : ''}></div>
  <div class="tog" ${p.height.auto ? 'style="opacity:.4;pointer-events:none"' : ''}><span>Height units (7 mm)</span><span class="stepper"><button data-s="hu-">−</button><b id="vhu">${p.height.auto ? a.hu : p.height.hu}</b><button data-s="hu+">+</button></span></div>
  <h4>Defaults for new objects</h4><div id="defs"></div>
  <p class="note">Each object can override these. The pocket floor always stays at least ${GF.minFloorAboveFoot} mm above the feet and magnet holes.</p></details>
  <button class="primary wide" id="dClose">Done</button>`;
  const defs = box.querySelector('#defs'), floorRow = field('Floor', { min: 0.8, max: 10, step: 0.2, value: p.floor, onSet: (v) => { p.floor = v; refresh(); } });
  [['depth', 'Depth', 1, 80, 0.5], ['margin', 'Margin', 0, 10, 0.1], ['notch', 'Notch size', 6, 40, 0.5]].forEach(([k, l, mn, mx, st]) => defs.appendChild(field(l, { min: mn, max: mx, step: st, value: p.defaults[k], onSet: (v) => { p.defaults[k] = v; refresh(); } })));
  defs.appendChild(floorRow);
  box.querySelector('#cLip').onchange = (e) => { p.lip = e.target.checked; if (p.lip) P().objects.forEach((o) => { clampWalls(o); }); refresh(); const bad = state.an.objects.filter((x) => x.issues.includes('outside bin')).length; if (bad) toast('Some pockets are now too close to the edge. Try Arrange.'); reopen(); };
  box.querySelector('#cMag').onchange = (e) => { p.magnets = e.target.checked; reopen(); };
  box.querySelector('#cAuto').onchange = () => { if (!box.querySelector('#cAuto').checked) { p.cells.nx = a.nx; p.cells.ny = a.ny; } p.cells.auto = box.querySelector('#cAuto').checked; reopen(); };
  box.querySelector('#hAuto').onchange = () => { if (!box.querySelector('#hAuto').checked) p.height.hu = a.hu; p.height.auto = box.querySelector('#hAuto').checked; reopen(); };
  box.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { const s = b.dataset.s, k = s.slice(0, -1), d = s.endsWith('+') ? 1 : -1;
    if (k === 'hu') p.height.hu = clamp(p.height.hu + d, 1, GF.maxUnits); else p.cells[k] = clamp(p.cells[k] + d, 1, 8); reopen(); });
  box.querySelector('#dClose').onclick = close;
  const svf = box.querySelector('#svf'), est = () => { clearTimeout(est.t); est.t = setTimeout(async () => { const e = box.querySelector('#svEst'); if (!e || !p.save.on) return; const r = await estimateSaving(); if (e.isConnected) e.textContent = r; }, 350); };
  svf.appendChild(field('Saving', { min: 0, max: 100, step: 1, value: p.save.saving, unit: '%', onSet: (v) => { p.save.saving = v; save(); est(); scheduleEstimate(); if (state.view === '3d') schedule3D(); } }));
  svf.appendChild(field('Rib / wall', { min: 1.2, max: 4, step: 0.1, value: p.save.wall, onSet: (v) => { p.save.wall = v; save(); est(); scheduleEstimate(); if (state.view === '3d') schedule3D(); } }));
  box.querySelector('#svOn').onchange = (e) => { p.save.on = e.target.checked; reopen(); };
  if (p.save.on) est();
});
// Estimated material saving: builds the bin with and without the voids (volumes of the two solids)
async function estimateSaving() {
  const pr = P(); if (!pr.objects.length) return 'Add an object first.'; await new Promise((r) => setTimeout(r, 20));
  const info = {}, b = buildBin(pr, analyze(pr), info); b.delete && b.delete(); state.saveInfo = info;
  return `Estimated material saving: about ${info.pct.toFixed(0)} percent (solid ${(info.solidVol / 1000).toFixed(0)} cm3 to ${(info.redVol / 1000).toFixed(0)} cm3). Voids are sealed inside, start above the Gridfinity foot, leave at least ${info.params.wall.toFixed(1)} mm to the outside, pockets and the top, ribs of ${info.params.rib.toFixed(1)} mm, and are at most ${(info.params.flat * 1.155).toFixed(0)} mm across (bridgeable). Feet and baseplate fit are unchanged. Use 3D > Cutaway to look inside.`;
}
function openDlg(build, cls = '') {
  const d = $('#sheetDlg'), box = document.createElement('div'); box.className = cls; d.innerHTML = ''; d.appendChild(box); d.hidden = false;
  const close = () => { d.hidden = true; d.innerHTML = ''; if (state.exportOpen) { state.exportOpen = false; onStep(null); } }; d.onclick = (e) => { if (e.target === d) close(); }; build(box, close);
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
$('#btnExport').onclick = () => { state.exportOpen = true; onStep('export'); openDlg((box, close) => {
  const a = state.an, o = selObj(), bad = a.objects.filter((x) => x.issues.some((s) => !s.startsWith('depth'))).length, p = P();
  const feats = [p.lip && 'stacking lip', p.magnets && 'magnet holes', p.save.on && 'material-saving voids'].filter(Boolean);
  box.innerHTML = `<h3>Export</h3>${bad ? `<div class="err">${bad} pocket${bad > 1 ? 's' : ''} overlap or touch the edge. Fix ${bad > 1 ? 'them' : 'it'} before printing (try Arrange).</div>` : ''}
  <div class="expcard"><b>Gridfinity bin ${a.nx}×${a.ny}×${a.hu}u</b><span>${a.W.toFixed(1)} × ${a.D.toFixed(1)} × ${r1(a.Htot)} mm · ${feats.length ? feats.join(', ') : 'plain top, no magnets'}</span><span>${state.est ? state.est + ' (rough, 0.2 mm layers, 15% infill)' : ''}</span></div>
  <button class="primary wide" data-k="stl">Download STL</button>
  <details class="more"><summary>2D outlines (SVG / DXF)</summary><p class="note">Traced outline, pocket with margin and notches, in millimetres. For laser cutting foam or CAD.</p>
  <div class="actions"><button data-k="svg">Layout SVG</button><button data-k="dxf">Layout DXF</button>${o ? `<button data-k="osvg">${esc(o.name)} SVG</button><button data-k="odxf">${esc(o.name)} DXF</button>` : ''}</div></details>`;
  box.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => { exportAll(b.dataset.k, o); close(); toast('Saved ' + (b.dataset.k === 'stl' ? 'STL' : b.textContent)); });
}); };

// ---------------- auto arrange ----------------
function runPack(objects, params) { // Web Worker (module) with main-thread fallback
  return new Promise((resolve) => {
    let done = false; const fin = (r) => { if (!done) { done = true; resolve(r); } };
    const main = () => setTimeout(() => { try { fin(arrange(objects, params)); } catch (e) { fin({ ok: false, reason: 'Arrange failed: ' + e.message }); } }, 30);
    try {
      const w = new Worker(new URL('./pack-worker.js', import.meta.url), { type: 'module' }), timer = setTimeout(() => { w.terminate(); main(); }, params.budgetMs * 4 + 6000);
      w.onmessage = (e) => { clearTimeout(timer); w.terminate(); if (e.data.ok) fin(e.data.result); else main(); };
      w.onerror = () => { clearTimeout(timer); w.terminate(); main(); };
      w.postMessage({ objects, params });
    } catch { main(); }
  });
}
function arrMsg(text, kind) { const m = $('#arrMsg'); m.textContent = text; m.className = 'arrmsg ' + (kind || ''); m.hidden = !text; }
const snapshot = () => ({ cells: JSON.parse(JSON.stringify(P().cells)), objs: P().objects.map((o) => ({ id: o.id, x: o.x, y: o.y, rot: o.rot || 0 })) });
function restore(sn) { P().cells = sn.cells; for (const q of sn.objs) { const o = P().objects.find((x) => x.id === q.id); if (o) { o.x = q.x; o.y = q.y; o.rot = q.rot; } } }
async function autoArrange() {
  const objs = P().objects; if (!objs.length) return;
  const ar = P().arrange, before = analyze(P()), btn = $('#btnArr'), sn = snapshot();
  const list = objs.map((o) => { const e = effective(P(), o); return { id: o.id, outline: o.outline, rot: o.rot || 0, x: o.x, y: o.y, margin: e.margin, notchR: e.notch / 2, notches: o.notches || [], locked: !!o.locked }; });
  btn.disabled = true; btn.textContent = 'Arranging…'; arrMsg('Packing ' + objs.length + ' object' + (objs.length > 1 ? 's' : '') + '...', '');
  const t0 = performance.now(); const r = await runPack(list, { wall: ar.wall, allowRot: ar.rotate, budgetMs: 1800, seed: 7, prefer: [before.nx, before.ny], outerWall: outerWall(P()) });
  btn.disabled = false; btn.textContent = 'Arrange';
  const cb = before.nx * before.ny;
  if (!r.ok) { arrMsg(r.reason || 'Could not arrange.', 'err'); return; }
  const ca = r.nx * r.ny;
  if (ca > cb && !before.objects.some((x) => x.issues.some((q) => !q.startsWith('depth')))) {
    arrMsg(`With a ${ar.wall} mm wall between pockets the objects need ${r.nx} x ${r.ny} cells (${ca}); the current layout is ${before.nx} x ${before.ny} (${cb}). Kept the current layout. Try a smaller wall.`, 'warn'); return; }
  state.undo = { sn, label: `${before.nx} x ${before.ny}` };
  for (const q of r.placements) { const o = objs.find((x) => x.id === q.id); o.x = q.x; o.y = q.y; o.rot = q.rot; }
  const wasManual = !P().cells.auto; P().cells.auto = true; refresh();
  const a = state.an, bad = a.objects.some((x) => x.issues.some((q) => !q.startsWith('depth')));
  if (bad) { restore(sn); state.undo = null; refresh(); arrMsg('Arrange produced an invalid layout and was reverted (this should not happen).', 'err'); return; }
  $('#btnArrUndo').hidden = false;
  const saved = cb - a.nx * a.ny, pct = cb ? Math.round(100 * saved / cb) : 0;
  let m = `${before.nx} x ${before.ny} to ${a.nx} x ${a.ny} cells` + (saved > 0 ? ` (saved ${saved} of ${cb} cells, ${pct}%)` : saved === 0 ? ' (same size, tidier with wall ' + ar.wall + ' mm)' : '') + `. Wall between pockets at least ${Math.floor(r.minGap * 10) / 10} mm. ${Math.round((performance.now() - t0) / 100) / 10} s.`;
  if (a.hu !== before.hu) m += ` Bin height changes from ${before.hu}u to ${a.hu}u.`;
  if (wasManual) m += ' Bin size set to automatic.';
  arrMsg(m, saved > 0 ? 'ok' : 'warn');
}
$('#btnArr').onclick = autoArrange;
$('#btnArrUndo').onclick = () => { if (!state.undo) return; restore(state.undo.sn); const l = state.undo.label; state.undo = null; $('#btnArrUndo').hidden = true; refresh(); arrMsg('Restored the previous layout (' + l + ' cells).', ''); };
$('#btnArrOpt').onclick = () => openDlg((box, close) => {
  const ar = P().arrange;
  box.innerHTML = `<h3>Auto arrange</h3><p class="note">Packs all pockets (outline + margin + notch clearance) into the smallest bin, using the real shapes. Outer wall is always at least 1.2 mm. Lock an object (object panel) to keep it where it is.</p><div id="arrf"></div>
  <div class="tog"><span>Allow rotation</span><input class="sw" type="checkbox" id="arRot" ${ar.rotate ? 'checked' : ''}></div>
  <button class="big-btn p" id="arClose" style="width:100%;margin-top:8px">Done</button>`;
  box.querySelector('#arrf').appendChild(field('Wall between pockets', { min: 1.2, max: 10, step: 0.1, value: ar.wall, onSet: (v) => { ar.wall = v; save(); } }));
  box.querySelector('#arRot').onchange = (e) => { ar.rotate = e.target.checked; save(); };
  box.querySelector('#arClose').onclick = close;
});

// ---------------- projects ----------------
const fmtDate = (t) => { const d = new Date(t), now = new Date(); return d.toDateString() === now.toDateString() ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }); };
async function openProjects() {
  const root = $('#projects'); await persist(); root.hidden = false;
  const draw = async () => {
    const list = await listProjects().catch(() => []);
    root.innerHTML = `<div class="ov-head"><button class="ghost" id="pjBack">Back</button><h2>Projects</h2><span class="sp"></span></div><div class="ov-body">
      ${list.length ? '' : '<p class="muted center">No saved projects yet. Projects save automatically on this device as you work.</p>'}
      <ul class="projlist">${list.map((r) => `<li data-id="${r.id}" class="${r.id === state.pid ? 'cur' : ''}"><button class="pjopen">${r.thumb ? `<img src="${r.thumb}" alt="">` : '<span class="ph"></span>'}<span class="pjt"><b>${esc(r.name)}</b><small>${r.n} object${r.n === 1 ? '' : 's'} · ${r.size} · ${fmtDate(r.updated)}</small></span></button><button class="icon pjmenu" aria-label="Project options">⋯</button></li>`).join('')}</ul></div>
      <div class="ov-foot"><button class="primary" id="pjNew">New project</button></div>`;
    root.querySelector('#pjBack').onclick = () => (root.hidden = true);
    root.querySelector('#pjNew').onclick = async () => { await persist(); loadProject({ id: newId(), name: 'Untitled', data: fresh() }); root.hidden = true; };
    root.querySelectorAll('.projlist li').forEach((li) => { const r = list.find((x) => x.id === li.dataset.id);
      li.querySelector('.pjopen').onclick = async () => { await persist(); const full = await getProject(r.id); if (full) loadProject(full); root.hidden = true; };
      li.querySelector('.pjmenu').onclick = () => openDlg((box, close) => {
        box.innerHTML = `<h3>${esc(r.name)}</h3><label class="fl">Name<input type="text" id="pjName" maxlength="40" value="${esc(r.name)}"></label><div class="actions"><button id="pjDup">Duplicate</button><button id="pjDel" class="danger">Delete</button></div><button class="primary wide" id="pjOk">Done</button>`;
        box.querySelector('#pjOk').onclick = async () => { const nm = box.querySelector('#pjName').value.trim() || r.name; if (r.id === state.pid) { state.pname = nm; save(); renderSummary(); await persist(); } else { const f = await getProject(r.id); f.name = nm; await putProject(f); } close(); draw(); };
        box.querySelector('#pjDup').onclick = async () => { const f = await getProject(r.id); await putProject({ ...f, id: newId(), name: f.name + ' copy', updated: Date.now() }); close(); draw(); };
        box.querySelector('#pjDel').onclick = async () => { const b = box.querySelector('#pjDel'); if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = 'Tap again to delete'; return; }
          await deleteProject(r.id); if (r.id === state.pid) { state.persisted = false; loadProject({ id: newId(), name: 'Untitled', data: fresh() }); } close(); draw(); };
      });
    });
  };
  await draw();
}
function loadProject(rec) {
  state.project = rec.data; state.pid = rec.id; state.pname = rec.name || 'Untitled'; state.persisted = !!rec.updated;
  const d = fresh(); for (const k of Object.keys(d)) if (state.project[k] == null) state.project[k] = d[k];
  state.nextId = 1 + P().objects.reduce((m, o) => Math.max(m, o.id), 0); state.sel = P().objects[0]?.id ?? null; state.notchMode = false; state.undo = null; state.est = null;
  $('#arrMsg').hidden = true; refresh(); resetHistory();
}
$('#btnProjects').onclick = openProjects;
$('#btnUndo').onclick = () => travel(-1); $('#btnRedo').onclick = () => travel(1);
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) { e.preventDefault(); travel(e.shiftKey ? 1 : -1); } });

// ---------------- first-run intro ----------------
const INTRO = [
  ['Print the sheet', 'Print the calibration sheet at 100% scale. Its corner markers let the app measure in millimetres.', '<rect x="14" y="8" width="36" height="48" rx="3"/><rect x="18" y="12" width="5" height="5" class="f"/><rect x="41" y="12" width="5" height="5" class="f"/><rect x="18" y="47" width="5" height="5" class="f"/><rect x="41" y="47" width="5" height="5" class="f"/>'],
  ['Photograph from above', 'Lay the object on the sheet and shoot from straight above, in soft light. Any angle works; straight is most accurate.', '<rect x="10" y="30" width="44" height="26" rx="3"/><path d="M24 44c3-6 8-7 11-3s6 4 8-1"/><rect x="22" y="6" width="20" height="14" rx="3"/><path d="M32 20v8" stroke-dasharray="2 3"/>'],
  ['Arrange and print', 'Set each pocket’s depth, add finger notches, check the 3D preview, then download the STL for your slicer.', '<rect x="8" y="14" width="48" height="36" rx="5"/><rect x="14" y="20" width="16" height="24" rx="4"/><circle cx="42" cy="32" r="8"/>']];
function showIntro(k = 0) {
  const root = $('#intro'); root.hidden = false; const [t, d, art] = INTRO[k], last = k === INTRO.length - 1;
  root.innerHTML = `<div class="ov-head" style="display:flex;justify-content:flex-end"><button class="ghost" id="inSkip">Skip</button></div>
    <div class="introbody"><svg viewBox="0 0 64 64" class="introart" aria-hidden="true">${art}</svg><h2>${t}</h2><p>${d}</p>
    ${k === 0 ? '<a class="link" href="sheet.html">Open the sheet</a>' : ''}</div>
    <div class="dots">${INTRO.map((_, i) => `<i class="${i === k ? 'on' : ''}"></i>`).join('')}</div>
    <div class="ov-foot">${k ? '<button class="secondary" id="inBack">Back</button>' : ''}<button class="primary" id="inNext">${last ? 'Get started' : 'Next'}</button></div>`;
  const fin = () => { localStorage.setItem('gf-intro-done', '1'); root.hidden = true; root.innerHTML = ''; };
  root.querySelector('#inSkip').onclick = fin; root.querySelector('#inNext').onclick = () => (last ? fin() : showIntro(k + 1));
  if (k) root.querySelector('#inBack').onclick = () => showIntro(k - 1);
}

// ---------------- boot ----------------
(async function boot() {
  try { const rec = await getProject(state.pid); if (rec && rec.data && rec.data.objects) { state.project = rec.data; state.persisted = true; const d = fresh(); for (const k of Object.keys(d)) if (state.project[k] == null) state.project[k] = d[k]; state.nextId = 1 + P().objects.reduce((m, o) => Math.max(m, o.id), 0); state.sel = P().objects[0]?.id ?? null; } } catch (_) {}
  await initManifold(); state.ready = true; refresh(); resetHistory();
  if (!localStorage.getItem('gf-intro-done')) showIntro();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
window.__gf = { travel, openProjects, loadProject, persist, listProjects, showIntro, H, objSheet, autoArrange, state, addOutline, refresh, exportAll, setView, analyze: () => analyze(P()), openCapture: () => addObject(), capture: $('#capture') };
