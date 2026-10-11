// Smart select: MobileSAM (ONNX, onnxruntime-web WASM) on the straightened top-down image. Lazy-loaded, fully client-side.
const MODEL_DIR = new URL('../vendor/models/', import.meta.url).href, ORT_DIR = new URL('../vendor/ort/', import.meta.url).href, SIDE = 1024;
let ortP = null, encS = null, decS = null;
const get = async (n) => { const r = await fetch(MODEL_DIR + n); if (!r.ok) throw new Error('Could not download ' + n + ' (' + r.status + ')'); return new Uint8Array(await r.arrayBuffer()); };
const SESS = () => ({ executionProviders: ['wasm'], graphOptimizationLevel: 'disabled', enableCpuMemArena: false, enableMemPattern: false, executionMode: 'sequential', intraOpNumThreads: 1 });
// Memory notes (iOS Safari): the wasm heap needs about 350 MB while the encoder runs, the shared WebAssembly.Memory maximum is capped at 512 MB in vendor/ort (the stock 4 GB reservation fails on iOS with
// "RangeError: Out of memory"), the two models are fetched and created one after the other, their download buffers are dropped right after session creation, and the encoder session is released once the image is analysed.
async function loadOrt(onStatus) {
  if (!ortP) ortP = (async () => {
    onStatus && onStatus('Loading Smart select engine');
    globalThis.__gfWasmMaxPages = globalThis.__gfWasmMaxPages || 8192;
    const ort = await import(ORT_DIR + 'ort.wasm.min.mjs'); ort.env.wasm.wasmPaths = ORT_DIR; ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
    return ort;
  })().catch((e) => { ortP = null; throw e; });
  return ortP;
}
async function loadDecoder(ort, onStatus) {
  if (decS) return decS; onStatus && onStatus('Loading model (about 17 MB, first time only)');
  let d = await get('sam_mask_decoder_multi.onnx'); try { decS = await ort.InferenceSession.create(d, SESS()); } finally { d = null; } return decS;
}
async function loadEncoder(ort, onStatus) {
  onStatus && onStatus('Loading model (about 28 MB, first time only)');
  let e = await get('mobile_sam_image_encoder.onnx'); onStatus && onStatus('Starting model'); try { return await ort.InferenceSession.create(e, SESS()); } finally { e = null; }
}
// Turn a raw failure into a short message for the user (the raw text is kept in .details).
export function describeSmartError(e) {
  const raw = String((e && (e.message || e)) || e), mem = /out of memory|allocation|Invalid (typed )?array length|RangeError|backend|memory/i.test(raw + (e && e.name));
  const err = new Error(mem ? 'Smart select needs more memory than this device allows. Use the classic Select instead.' : 'Smart select did not work here. The classic Select still works.');
  err.details = (e && e.name ? e.name + ': ' : '') + raw; err.memory = mem; return err;
}
// canvas: the rectified image (any size). Returns a session object {decode(points) -> Uint8Array mask w*h (1 = object)}.
export async function smartPrepare(canvas, onStatus) {
  const W = canvas.width, H = canvas.height; if (!(W > 0 && H > 0 && W * H < 4e7)) throw new Error('Invalid image size ' + W + 'x' + H); const ort = await loadOrt(onStatus), k = SIDE / Math.max(W, H), w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(canvas, 0, 0, w, h);
  const px0 = ctx.getImageData(0, 0, w, h), px = px0.data, f = new Float32Array(w * h * 3); for (let i = 0, j = 0; i < w * h; i++) { f[j++] = px[4 * i]; f[j++] = px[4 * i + 1]; f[j++] = px[4 * i + 2]; }
  c.width = c.height = 0;
  await loadDecoder(ort, onStatus); const enc = await loadEncoder(ort, onStatus); let emb, tEnc;
  try { onStatus && onStatus('Analysing the image (a few seconds)');
    const t0 = performance.now(); const out = await enc.run({ input_image: new ort.Tensor('float32', f, [h, w, 3]) }); emb = out.image_embeddings; tEnc = performance.now() - t0;
    emb = new ort.Tensor('float32', Float32Array.from(emb.data), emb.dims); // own copy, then give the wasm heap back
  } finally { try { await enc.release(); } catch (_) {} }
    return { tEnc, w, h, async decode(points) { // points: [{x,y,label}] in canvas px, label 1 = object, 0 = not object
    const n = points.length + 1, pc = new Float32Array(n * 2), pl = new Float32Array(n);
    points.forEach((p, i) => { pc[2 * i] = Math.min(w - 1, Math.max(0, (p.x * k) || 0)); pc[2 * i + 1] = Math.min(h - 1, Math.max(0, (p.y * k) || 0)); pl[i] = p.label ? 1 : 0; }); pl[n - 1] = -1; // padding point as in the SAM ONNX export
    const t1 = performance.now();
    const r = await decS.run({ image_embeddings: emb, point_coords: new ort.Tensor('float32', pc, [1, n, 2]), point_labels: new ort.Tensor('float32', pl, [1, n]),
      mask_input: new ort.Tensor('float32', new Float32Array(256 * 256), [1, 1, 256, 256]), has_mask_input: new ort.Tensor('float32', [0], [1]), orig_im_size: new ort.Tensor('float32', [h, w], [2]) });
    const nm = r.masks.dims[1], mh = r.masks.dims[2], mw = r.masks.dims[3], iou = r.iou_predictions.data; let pick = 0;
    if (points.length === 1 && nm > 1) { // single tap is ambiguous (part / whole / group): of the plausible candidates (iou >= 0.85 x best, ignoring the tiny sub-part mask) take the largest that is not huge
      const area = []; for (let q = 0; q < nm; q++) { let a = 0; const o = q * mh * mw; for (let i = 0; i < mh * mw; i++) a += r.masks.data[o + i] > 0 ? 1 : 0; area.push(a / (mh * mw)); }
      const best = Math.max(...iou); let bestA = -1; for (let q = 1; q < nm; q++) if (iou[q] >= 0.85 * best && area[q] < 0.5 && area[q] > bestA) { bestA = area[q]; pick = q; } this.areas = area;
    }
    const m = r.masks.data, off = pick * mh * mw, mask = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) { const sy = Math.min(mh - 1, Math.floor(y * k)); for (let x = 0; x < W; x++) { const sx = Math.min(mw - 1, Math.floor(x * k)); mask[y * W + x] = m[off + sy * mw + sx] > 0 ? 1 : 0; } }
    this.tDec = performance.now() - t1; this.iou = iou[pick]; this.pick = pick; this.ious = Array.from(iou); return mask; } };
}
