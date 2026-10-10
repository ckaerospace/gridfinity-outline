// Capture flow: pick photo -> detect sheet (or manual 4-corner) -> rectify -> segment -> review -> outline
import { loadCV, decodePhoto, detectSheet, manualCalibration, rectify, prepareSeg, segment } from './vision.js';
import { bbox, centroid } from './geom.js';

const $ = (h) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstChild; };
export const debug = { last: null };

export function openCapture(root, { depth = 20, title = 'Add object' } = {}) {
  return new Promise((resolve) => {
    let cv = null, photo = null, cal = null, rect = null, seg = null, res = null, edits = [], pick = null, tol = 24, mode = 'pick', closed = false;
    const done = (v) => { if (closed) return; closed = true; if (rect) rect.mat.delete(); root.hidden = true; root.innerHTML = ''; resolve(v); };
    root.hidden = false;
    const head = (t) => `<div class="ov-head"><h2>${t}</h2><button class="ghost" data-x>Cancel</button></div>`;
    const bindX = () => root.querySelector('[data-x]').onclick = () => done(null);

    function stepPick(msg) {
      root.innerHTML = head(title) + `<div class="ov-body">
        ${msg ? `<div class="err">${msg}</div>` : ''}
        <input id="fCam" type="file" accept="image/*" capture="environment" hidden>
        <input id="fLib" type="file" accept="image/*" hidden>
        <button class="big-btn p" id="bCam">Take photo</button>
        <button class="big-btn" id="bLib">Photo library</button>
        <p class="note">Place the object flat on the printed sheet, all four corner markers in view. Any angle works; shooting from above is more accurate, especially for tall objects. The photo stays on this device.</p>
        <a class="link" href="sheet.html">Print the calibration sheet</a></div>`;
      bindX();
      const go = (f) => f && process(f);
      root.querySelector('#fCam').onchange = (e) => go(e.target.files[0]); root.querySelector('#fLib').onchange = (e) => go(e.target.files[0]);
      root.querySelector('#bCam').onclick = () => root.querySelector('#fCam').click(); root.querySelector('#bLib').onclick = () => root.querySelector('#fLib').click();
    }
    const busy = (t) => { root.innerHTML = head(title) + `<div class="ov-body"><div class="spinner"></div><p class="note" style="text-align:center">${t}</p></div>`; bindX(); };

    async function process(file) {
      const t0 = performance.now(); const T = {};
      busy('Reading photo');
      try {
        photo = await decodePhoto(file); T.decode = performance.now() - t0;
        if (!cv) { busy('Preparing engine (first time only)'); cv = await loadCV(); }
        T.engine = performance.now() - t0 - T.decode;
        busy('Finding the sheet'); await new Promise((r) => setTimeout(r, 20));
        const t1 = performance.now(); cal = detectSheet(cv, photo.imageData); T.detect = performance.now() - t1;
        debug.last = { cal: { ...cal, markers: undefined }, photo: { w: photo.w, h: photo.h, origW: photo.origW, origH: photo.origH } };
        if (!cal.ok) { debug.last.timing = T; return stepManual(`Found ${cal.found} of 4 sheet markers.`); }
        await finish(T, t0);
      } catch (e) { console.error(e); stepPick('Could not process this photo: ' + (e.message || e)); }
    }
    async function finish(T, t0) {
      busy('Tracing outline'); await new Promise((r) => setTimeout(r, 20));
      const t2 = performance.now(); if (rect) rect.mat.delete();
      rect = rectify(cv, photo.imageData, cal); T.rectify = performance.now() - t2;
      const t3 = performance.now(); seg = prepareSeg(cv, rect); T.prep = performance.now() - t3;
      tol = Math.round(seg.autoTol); edits = []; pick = null; mode = 'pick';
      const t4 = performance.now(); runSeg(); T.segment = performance.now() - t4; T.total = performance.now() - t0;
      debug.last.timing = T; debug.last.tol = tol; debug.last.outline = res.outline; debug.last.rectSize = [rect.w, rect.h];
      stepReview();
    }
    function runSeg() { if (res && res.mask) res.mask.delete(); res = segment(cv, seg, tol, edits, pick); debug.last && (debug.last.outline = res.outline); }

    // ---------- manual calibration ----------
    function stepManual(msg) {
      const pts = [], names = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
      root.innerHTML = head('Calibrate manually') + `<div class="ov-body">
        ${msg ? `<div class="warn">${msg} Tap four corners of a rectangle with known size (a cutting mat, or the sheet's marker centres), in order, then enter its size. Or <a class="link" href="#" id="aRetry" style="padding:0">retake the photo</a>.</div>` : ''}
        <div class="note" id="mNext"></div>
        <div class="canvaswrap" id="mWrap"><canvas id="mCv"></canvas></div>
        <div class="row" style="grid-template-columns:1fr 1fr"><div><label class="note">Width (mm), top edge</label><input id="mW" type="number" inputmode="decimal" min="1" step="any" placeholder="required"></div>
        <div><label class="note">Height (mm), optional</label><input id="mH" type="number" inputmode="decimal" min="1" step="any" placeholder="estimate"></div></div>
        <div class="actions"><button id="mUndo">Undo</button><button id="mGo" class="on" disabled>Continue</button></div></div>`;
      bindX(); const cvEl = root.querySelector('#mCv'), ctx = cvEl.getContext('2d'); cvEl.width = photo.w; cvEl.height = photo.h;
      root.querySelector('#aRetry').onclick = (e) => { e.preventDefault(); stepPick(); };
      const redraw = () => { ctx.putImageData(photo.imageData, 0, 0); const r = Math.max(10, photo.w / 90); ctx.lineWidth = r / 3; ctx.strokeStyle = '#7db4ff'; ctx.fillStyle = '#7db4ff';
        ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p)); if (pts.length === 4) ctx.closePath(); ctx.stroke();
        pts.forEach((p, i) => { ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = r * 1.6 + 'px sans-serif'; ctx.fillText(i + 1, p[0] + r * 1.3, p[1] - r * 1.3); ctx.fillStyle = '#7db4ff'; });
        root.querySelector('#mNext').textContent = pts.length < 4 ? `Tap the ${names[pts.length]} corner (${pts.length + 1} of 4)` : 'Enter the width (and height if known) of that rectangle.';
        upd(); };
      const upd = () => { root.querySelector('#mGo').disabled = !(pts.length === 4 && +root.querySelector('#mW').value > 0); };
      cvEl.addEventListener('pointerdown', (e) => { if (pts.length >= 4) return; const b = cvEl.getBoundingClientRect(); pts.push([(e.clientX - b.left) / b.width * photo.w, (e.clientY - b.top) / b.height * photo.h]); redraw(); });
      root.querySelector('#mUndo').onclick = () => { pts.pop(); redraw(); }; root.querySelector('#mW').oninput = upd;
      root.querySelector('#mGo').onclick = async () => {
        const w = +root.querySelector('#mW').value, h = +root.querySelector('#mH').value || 0;
        cal = manualCalibration(photo.imageData, pts, w, h); debug.last = { ...(debug.last || {}), cal: { ...cal }, manual: true };
        const T = debug.last.timing || {}; await finish(T, performance.now());
      };
      redraw();
    }

    // ---------- review ----------
    function warnings() {
      const w = []; const t = cal.tilt;
      if (!cal.manual && cal.found < 4) w.push(`Only ${cal.found} of 4 markers were seen; accuracy may be lower.`);
      if (cal.rms > 2.5) w.push(`Calibration fit is loose (${cal.rms.toFixed(1)} px). The sheet may be bent or the lens distorted.`);
      if (t > 50) w.push(`Camera angle is very steep (about ${t.toFixed(0)} degrees). Shoot from higher up.`);
      else if (t > 30) w.push(`Camera angle is about ${t.toFixed(0)} degrees. Shooting closer to straight down is more accurate.`);
      const shift = depth * Math.tan(Math.min(t, 80) * Math.PI / 180);
      if (shift > 1.5) w.push(`At this angle a ${depth} mm tall object's top edge appears about ${shift.toFixed(1)} mm off from its base. Tall objects will trace slightly oversize.`);
      if (cal.manual && cal.heightEstimated) w.push(`Height ${cal.heightMM.toFixed(1)} mm was estimated from perspective; enter it for best accuracy.`);
      if (res && res.touchesEdge) w.push('The object touches the edge of the measured area; it may be cut off.');
      return w;
    }
    function stepReview() {
      const u = res.ok ? res : null;
      root.innerHTML = head('Check outline') + `<div class="ov-body">
        <div id="rWarn"></div>
        <div class="canvaswrap"><canvas id="rCv"></canvas></div>
        <div class="note" id="rInfo"></div>
        <div class="row"><label>Tolerance</label><input id="rTol" type="range" min="4" max="80" step="1"><div class="num"><input id="rTolN" type="number" min="4" max="80" step="1"></div></div>
        <div class="actions" id="rModes"><button data-m="pick">Select</button><button data-m="add">Add area</button><button data-m="remove">Remove area</button><button id="rAuto">Auto</button></div>
        <p class="note">Select: tap the object. Add or Remove: tap a region of similar colour to include or drop it. Raise tolerance if the outline is too small, lower it if it grabs the sheet.</p>
        <div class="actions"><button id="rRetake">Retake</button><button id="rUse" class="on" style="background:var(--tx);color:var(--bg)">Use outline</button></div></div>`;
      bindX(); const c = root.querySelector('#rCv'); c.width = rect.w; c.height = rect.h;
      const tolR = root.querySelector('#rTol'), tolN = root.querySelector('#rTolN');
      const paint = () => {
        const ctx = c.getContext('2d'); const id = new ImageData(new Uint8ClampedArray(rect.mat.data), rect.w, rect.h);
        if (res.ok && res.mask) { const m = res.mask.data, d = id.data; for (let i = 0; i < m.length; i++) if (!m[i]) { d[4 * i] *= 0.45; d[4 * i + 1] *= 0.45; d[4 * i + 2] *= 0.45; } }
        ctx.putImageData(id, 0, 0);
        if (res.ok) { ctx.beginPath(); res.outline.forEach(([x, y], i) => { const px = (x - rect.x0) * rect.s, py = (y - rect.y0) * rect.s; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.closePath(); ctx.lineWidth = Math.max(2, rect.s * 0.5); ctx.strokeStyle = '#7db4ff'; ctx.stroke(); }
        tolR.value = tolN.value = tol;
        root.querySelector('#rInfo').textContent = res.ok ? `${res.bbox.w.toFixed(1)} x ${res.bbox.h.toFixed(1)} mm, ${res.areaMM2.toFixed(0)} mm\u00b2 (before margin)` : 'No object found. Try a different tolerance.';
        root.querySelector('#rUse').disabled = !res.ok;
        root.querySelector('#rWarn').innerHTML = warnings().map((t) => `<div class="warn" style="margin-bottom:6px">${t}</div>`).join('');
        root.querySelectorAll('#rModes [data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
      };
      let timer = 0; const rerun = (fast) => { clearTimeout(timer); timer = setTimeout(() => { runSeg(); paint(); }, fast ? 0 : 60); };
      tolR.oninput = () => { tol = +tolR.value; tolN.value = tol; rerun(); }; tolN.onchange = () => { tol = Math.max(4, Math.min(80, +tolN.value || tol)); rerun(true); };
      root.querySelector('#rAuto').onclick = () => { tol = Math.round(seg.autoTol); edits = []; pick = null; rerun(true); };
      root.querySelectorAll('#rModes [data-m]').forEach((b) => b.onclick = () => { mode = b.dataset.m; paint(); });
      c.addEventListener('pointerdown', (e) => { const b = c.getBoundingClientRect(), x = (e.clientX - b.left) / b.width * rect.w, y = (e.clientY - b.top) / b.height * rect.h;
        if (mode === 'pick') pick = { x, y }; else edits.push({ type: mode, x, y }); runSeg(); paint(); });
      root.querySelector('#rRetake').onclick = () => stepPick();
      root.querySelector('#rUse').onclick = () => {
        const bb = bbox(res.outline), cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
        done({ outline: res.outline.map(([x, y]) => [+(x - cx).toFixed(3), +(y - cy).toFixed(3)]), tilt: cal.tilt, areaMM2: res.areaMM2, size: [bb.w, bb.h] });
      };
      paint();
    }
    // test hook: feed a File directly
    root.__process = process;
    stepPick();
  });
}
window.__gfDebug = debug;
