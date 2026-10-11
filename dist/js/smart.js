// Smart select: MobileSAM (ONNX, onnxruntime-web WASM) on the straightened top-down image. Lazy-loaded, fully client-side.
const MODEL_DIR = new URL('../vendor/models/', import.meta.url).href, ORT_DIR = new URL('../vendor/ort/', import.meta.url).href, SIDE = 1024;
let ortP = null, encS = null, decS = null;
async function load(onStatus) {
  if (!ortP) ortP = (async () => {
    onStatus && onStatus('Loading Smart select engine');
    const ort = await import(ORT_DIR + 'ort.wasm.min.mjs'); ort.env.wasm.wasmPaths = ORT_DIR; ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
    onStatus && onStatus('Loading model (about 45 MB, first time only)');
    const get = async (n) => new Uint8Array(await (await fetch(MODEL_DIR + n)).arrayBuffer());
    const [e, d] = await Promise.all([get('mobile_sam_image_encoder.onnx'), get('sam_mask_decoder_multi.onnx')]);
    onStatus && onStatus('Starting model');
    encS = await ort.InferenceSession.create(e, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    decS = await ort.InferenceSession.create(d, { executionProviders: ['wasm'] });
    return ort;
  })().catch((e) => { ortP = null; throw e; });
  return ortP;
}
// canvas: the rectified image (any size). Returns a session object {decode(points) -> Uint8Array mask w*h (1 = object)}.
export async function smartPrepare(canvas, onStatus) {
  const ort = await load(onStatus), W = canvas.width, H = canvas.height, k = SIDE / Math.max(W, H), w = Math.round(W * k), h = Math.round(H * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(canvas, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data, f = new Float32Array(w * h * 3); for (let i = 0, j = 0; i < w * h; i++) { f[j++] = px[4 * i]; f[j++] = px[4 * i + 1]; f[j++] = px[4 * i + 2]; }
  onStatus && onStatus('Analysing the image (a few seconds)');
  const t0 = performance.now(); const out = await encS.run({ input_image: new ort.Tensor('float32', f, [h, w, 3]) }); const emb = out.image_embeddings; const tEnc = performance.now() - t0;
  const lowCanvas = document.createElement('canvas'); lowCanvas.width = W; lowCanvas.height = H;
  return { tEnc, w, h, async decode(points) { // points: [{x,y,label}] in canvas px, label 1 = object, 0 = not object
    const n = points.length + 1, pc = new Float32Array(n * 2), pl = new Float32Array(n);
    points.forEach((p, i) => { pc[2 * i] = p.x * k; pc[2 * i + 1] = p.y * k; pl[i] = p.label; }); pl[n - 1] = -1; // padding point as in the SAM ONNX export
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
