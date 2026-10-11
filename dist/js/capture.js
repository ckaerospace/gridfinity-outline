// Capture flow: pick photo -> detect sheet (or manual 4-corner) -> rectify -> segment -> review -> outline
import { loadCV, decodePhoto, detectSheet, manualCalibration, rectify, prepareSeg, computeDist, segment, SHADOW_DEFAULT, SMOOTH_DEFAULT } from './vision.js';
import { bbox, centroid, minRect, cameraFromH, correctForHeight } from './geom.js';

const $ = (h) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstChild; };
export const debug = { last: null };

export function openCapture(root, { depth = 20, title = 'Add object' } = {}) {
  return new Promise((resolve) => {
    let cv = null, photo = null, cal = null, rect = null, seg = null, res = null, edits = [], pick = null, tol = 24, shadow = 85, mode = 'pick', closed = false, objH = 0, cam = null, smoothV = SMOOTH_DEFAULT, smartSess = null, smartPts = [], smartBusy = false;
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
        <p class="note">Place the object flat on the printed sheet, all four corner markers in view. The photo stays on this device.</p>
        <ul class="note" style="margin:6px 0 10px 18px;padding:0"><li>Shoot from far away and zoom in, with the camera straight above the object centre: a tall object looks bigger when the camera is close or off to the side.</li><li>Even, shaded light works best: no direct lamp, avoid hard shadows.</li><li>Shooting from straight above is more accurate than at an angle.</li></ul>
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
      try { cam = cameraFromH(cal.Hmm2img, photo.w, photo.h); } catch (e) { cam = null; } objH = 0; smartSess = null; smartPts = [];
      rect = rectify(cv, photo.imageData, cal); T.rectify = performance.now() - t2;
      const t3 = performance.now(); shadow = SHADOW_DEFAULT; seg = prepareSeg(cv, rect, shadow); T.prep = performance.now() - t3;
      tol = Math.round(seg.autoTol); edits = []; pick = null; mode = 'pick';
      const t4 = performance.now(); runSeg();
      for (const alt of [40, 0]) { if (res.ok) break; shadow = alt; computeDist(seg, shadow); tol = Math.round(seg.autoTol); runSeg(); }
      /* nothing found: shadow removal may have erased a dark object */
      T.segment = performance.now() - t4; T.total = performance.now() - t0;
      debug.last.timing = T; debug.last.tol = tol; debug.last.shadow = shadow; debug.last.outline = res.outline; debug.last.rectSize = [rect.w, rect.h]; debug.last.cam = cam; debug.rectMat = rect.mat; debug.seg = seg;
      stepReview();
    }
    function runSeg() { if (res && res.mask) res.mask.delete(); res = segment(cv, seg, tol, edits, pick, smoothV); debug.last && (debug.last.outline = res.outline); }

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
    const corrOutline = () => correctForHeight(res.outline, cam, objH);
    function sizeText() {
      const r = minRect(res.outline); let t = `Measured ${r.l.toFixed(1)} x ${r.w.toFixed(1)} mm (long x short side, minimum rectangle), ${res.areaMM2.toFixed(0)} mm\u00b2 (before margin). Axis-aligned box ${res.bbox.w.toFixed(1)} x ${res.bbox.h.toFixed(1)} mm.`;
      if (objH > 0 && cam) { const c = minRect(corrOutline()); t += ` Corrected for height: ${c.l.toFixed(1)} x ${c.w.toFixed(1)} mm (dashed orange).`; }
      return t;
    }
    function heightNote() {
      if (!cam) return 'Object height correction is not available for this calibration.';
      const k = objH > 0 ? objH / cam.z : 0;
      return objH > 0 ? `Height correction ON: the silhouette is shrunk about ${(100 * k).toFixed(1)} percent toward the point under the camera (camera estimated about ${Math.round(cam.z)} mm above the sheet, focal length guessed, so this is only about right to within a third). Orange dashed line = corrected outline that will be used.`
        : `Optional. Tall objects look bigger from above (top edge is closer to the camera). Leave at 0 for flat objects. For a tall one, enter its height; the outline is then shrunk to estimate its footprint (a 20 mm object shot from about ${Math.round(cam.z)} mm up would trace about ${(100 * 20 / cam.z).toFixed(0)} percent oversize).`;
    }
    function stepReview() {
      const u = res.ok ? res : null;
      root.innerHTML = head('Check outline') + `<div class="ov-body">
        <div id="rWarn"></div>
        <div class="canvaswrap"><canvas id="rCv"></canvas></div>
        <div class="note" id="rInfo"></div>
        <div class="row"><label>Tolerance</label><input id="rTol" type="range" min="4" max="80" step="1"><div class="num"><input id="rTolN" type="number" min="4" max="80" step="1"></div></div>
        <div class="row"><label>Remove shadow</label><input id="rSh" type="range" min="0" max="100" step="1"><div class="num"><input id="rShN" type="number" min="0" max="100" step="1"></div></div>
        <div class="row"><label>Smoothing</label><input id="rSm" type="range" min="0" max="100" step="1"><div class="num"><input id="rSmN" type="number" min="0" max="100" step="1"></div></div>
        <div class="row"><label>Object height (mm)</label><input id="rH" type="range" min="0" max="80" step="0.5"><div class="num"><input id="rHN" type="number" min="0" max="80" step="0.5"></div></div>
        <p class="note" id="rHNote"></p>
        <div class="actions" id="rModes"><button data-m="pick">Select</button><button data-m="add">Add area</button><button data-m="remove">Remove area</button><button data-m="smart">Smart select</button><button data-m="smartneg">Smart: exclude</button><button id="rAuto">Auto</button></div>
        <p class="note">Select: tap the object. Add or Remove: tap a region of similar colour to include or drop it. Smart select (optional AI model, about 45 MB download the first time, runs on this device): tap the object, then use Smart: exclude and tap anything wrongly included, such as a shadow. Auto goes back to the classic method. Raise tolerance if the outline is too small, lower it if it grabs the sheet. Raise Remove shadow if the outline includes a shadow; lower it if a dark object is cut off.</p>
        <div class="actions"><button id="rRetake">Retake</button><button id="rUse" class="on" style="background:var(--tx);color:var(--bg)">Use outline</button></div></div>`;
      bindX(); const c = root.querySelector('#rCv'); c.width = rect.w; c.height = rect.h;
      const tolR = root.querySelector('#rTol'), tolN = root.querySelector('#rTolN'), shR = root.querySelector('#rSh'), shN = root.querySelector('#rShN'), smR = root.querySelector('#rSm'), smN = root.querySelector('#rSmN'), hR = root.querySelector('#rH'), hN = root.querySelector('#rHN');
      const paint = () => {
        const ctx = c.getContext('2d'); const id = new ImageData(new Uint8ClampedArray(rect.mat.data), rect.w, rect.h);
        if (res.ok && res.mask) { const m = res.mask.data, d = id.data; for (let i = 0; i < m.length; i++) if (!m[i]) { d[4 * i] *= 0.45; d[4 * i + 1] *= 0.45; d[4 * i + 2] *= 0.45; } }
        ctx.putImageData(id, 0, 0);
        if (res.ok) { ctx.beginPath(); res.outline.forEach(([x, y], i) => { const px = (x - rect.x0) * rect.s, py = (y - rect.y0) * rect.s; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.closePath(); ctx.lineWidth = Math.max(2, rect.s * 0.5); ctx.strokeStyle = '#7db4ff'; ctx.stroke(); }
        tolR.value = tolN.value = tol; shR.value = shN.value = shadow;
        if (res.ok && objH > 0 && cam) { const co = corrOutline(); ctx.beginPath(); co.forEach(([x, y], i) => { const px = (x - rect.x0) * rect.s, py = (y - rect.y0) * rect.s; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.closePath(); ctx.setLineDash([rect.s * 2, rect.s * 1.2]); ctx.strokeStyle = '#ffb347'; ctx.stroke(); ctx.setLineDash([]); }
        debug.last && (debug.last.outlineCorr = res.ok ? (objH > 0 && cam ? corrOutline() : res.outline) : null); smR.value = smN.value = smoothV; hR.value = hN.value = objH; root.querySelector('#rHNote').textContent = heightNote();
        root.querySelector('#rInfo').textContent = res.ok ? sizeText() : 'No object found. Try a different tolerance.';
        root.querySelector('#rUse').disabled = !res.ok;
        root.querySelector('#rWarn').innerHTML = warnings().map((t) => `<div class="warn" style="margin-bottom:6px">${t}</div>`).join('');
        root.querySelectorAll('#rModes [data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
      };
      let timer = 0; const rerun = (fast) => { clearTimeout(timer); timer = setTimeout(() => { runSeg(); paint(); }, fast ? 0 : 60); };
      tolR.oninput = () => { tol = +tolR.value; tolN.value = tol; rerun(); }; tolN.onchange = () => { tol = Math.max(4, Math.min(80, +tolN.value || tol)); rerun(true); };
      const setShadow = (v, auto) => { shadow = Math.max(0, Math.min(100, Math.round(v))); computeDist(seg, shadow); if (auto) tol = Math.round(seg.autoTol); rerun(true); };
      shR.oninput = () => { shN.value = shR.value; shadow = +shR.value; computeDist(seg, shadow); rerun(); }; shN.onchange = () => setShadow(+shN.value || 0, false);
      smR.oninput = () => { smoothV = +smR.value; smN.value = smoothV; rerun(); }; smN.onchange = () => { smoothV = Math.max(0, Math.min(100, Math.round(+smN.value || 0))); rerun(true); };
      hR.oninput = () => { objH = +hR.value; hN.value = objH; paint(); }; hN.onchange = () => { objH = Math.max(0, Math.min(80, +hN.value || 0)); paint(); };
      root.querySelector('#rAuto').onclick = () => { if (shadow !== SHADOW_DEFAULT) { shadow = SHADOW_DEFAULT; computeDist(seg, shadow); } tol = Math.round(seg.autoTol); edits = []; pick = null; smartPts = []; seg.smart = null; rerun(true); };
      root.querySelectorAll('#rModes [data-m]').forEach((b) => b.onclick = () => { mode = b.dataset.m; paint(); });
      c.addEventListener('pointerdown', (e) => { const b = c.getBoundingClientRect(), x = (e.clientX - b.left) / b.width * rect.w, y = (e.clientY - b.top) / b.height * rect.h;
        if (mode === 'smart' || mode === 'smartneg') { doSmart(x, y, mode === 'smart' ? 1 : 0); return; }
        if (mode === 'pick') pick = { x, y }; else edits.push({ type: mode, x, y }); runSeg(); paint(); });
      async function doSmart(x, y, label) {
        if (smartBusy) return; smartBusy = true; const info = root.querySelector('#rInfo');
        try {
          if (!smartSess) { const cvs = document.createElement('canvas'); cvs.width = rect.w; cvs.height = rect.h; cvs.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rect.mat.data), rect.w, rect.h), 0, 0);
            const { smartPrepare } = await import('./smart.js'); smartSess = await smartPrepare(cvs, (t) => { info.textContent = t + '...'; }); debug.smartEncMs = smartSess.tEnc; }
          smartPts.push({ x, y, label }); info.textContent = 'Smart select...'; seg.smart = await smartSess.decode(smartPts); debug.smartDecMs = smartSess.tDec; debug.smartIou = smartSess.iou; runSeg(); paint();
        } catch (e) { console.error(e); smartPts.pop(); info.textContent = 'Smart select is not available here: ' + (e.message || e); debug.smartErr = String(e.message || e); }
        smartBusy = false;
      }
      root.querySelector('#rRetake').onclick = () => stepPick();
      root.querySelector('#rUse').onclick = () => {
        const outl = objH > 0 && cam ? corrOutline() : res.outline, bb = bbox(outl), cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
        done({ outline: outl.map(([x, y]) => [+(x - cx).toFixed(3), +(y - cy).toFixed(3)]), tilt: cal.tilt, areaMM2: res.areaMM2, size: [bb.w, bb.h], objectHeight: objH });
      };
      paint();
    }
    // test hook: feed a File directly
    root.__process = process;
    stepPick();
  });
}
window.__gfDebug = debug;
