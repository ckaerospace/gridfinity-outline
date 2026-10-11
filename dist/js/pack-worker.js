// Web Worker wrapper for Auto arrange (module worker). The app falls back to the main thread if module workers are unavailable.
import { arrange } from './pack.js';
self.onmessage = (e) => { try { self.postMessage({ ok: true, result: arrange(e.data.objects, e.data.params) }); } catch (err) { self.postMessage({ ok: false, error: String((err && err.message) || err) }); } };
