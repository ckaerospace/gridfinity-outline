const V = 'gf-outline-v8', SMART = 'gf-smart-v2'; // SMART: Smart select model + onnxruntime, cached on first use (about 60 MB)
const FILES = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'sheet.html', 'sheet.svg', 'sheet.pdf', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/bin.js', 'js/capture.js', 'js/export2d.js', 'js/geom.js', 'js/sheetdef.js', 'js/view3d.js', 'js/vision.js', 'js/smart.js', 'js/pack.js', 'js/pack-worker.js',
  'vendor/manifold.js', 'vendor/manifold.wasm', 'vendor/three.module.js', 'vendor/three.core.js', 'vendor/OrbitControls.js', 'vendor/opencv.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== V && x !== SMART).map((x) => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => { if (e.request.method !== 'GET') return; const big = /\/vendor\/(models|ort)\//.test(e.request.url);
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request).then((res) => { if (big && res.ok) { const c = res.clone(); caches.open(SMART).then((ch) => ch.put(e.request, c)); } return res; }))); });
