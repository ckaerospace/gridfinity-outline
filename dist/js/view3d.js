// Lightweight orbitable 3D preview of the finished bin (same mesh that is exported).
import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';

let renderer, scene, camera, controls, mesh, edges, host, labelsEl, labels = [], inited = false, fitted = false, raf = 0;
export function init3D(el, labelHost) {
  if (inited) return; inited = true; host = el; labelsEl = labelHost;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); host.prepend(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, 1, 1, 2000); camera.up.set(0, 0, 1);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x555560, 1.1));
  const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(-80, -120, 200); scene.add(dl);
  controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = false; controls.addEventListener('change', draw);
  controls.maxPolarAngle = Math.PI * 0.62;
  new ResizeObserver(resize).observe(host); resize();
}
function resize() { const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); draw(); }
export function draw() {
  if (!inited) return; cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    renderer.render(scene, camera);
    const w = host.clientWidth, h = host.clientHeight, v = new THREE.Vector3();
    labelsEl.innerHTML = '';
    for (const l of labels) { v.set(...l.p).project(camera); if (v.z > 1) continue; const s = document.createElement('span'); s.textContent = l.text; s.style.left = (v.x * 0.5 + 0.5) * w + 'px'; s.style.top = (-v.y * 0.5 + 0.5) * h + 'px'; labelsEl.appendChild(s); }
    window.__gf3dRendered = (window.__gf3dRendered || 0) + 1;
  });
}
// mesh: {pos, np, tri}; info: {W,D,H}; labelData: [{x,y,z,text}] in STL coords
export function setMesh(m, info, labelData) {
  if (!inited) return;
  if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); scene.remove(edges); edges.geometry.dispose(); }
  const n = m.pos.length / m.np, pos = new Float32Array(n * 3); for (let i = 0; i < n; i++) { pos[3 * i] = m.pos[i * m.np]; pos[3 * i + 1] = m.pos[i * m.np + 1]; pos[3 * i + 2] = m.pos[i * m.np + 2]; }
  let g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(m.tri, 1));
  g = g.toNonIndexed(); g.computeVertexNormals();
  mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xb9bec6, roughness: 0.75, metalness: 0.05, flatShading: true }));
  edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 35), new THREE.LineBasicMaterial({ color: 0x20242a, transparent: true, opacity: 0.55 }));
  scene.add(mesh, edges); labels = labelData.map((l) => ({ p: [l.x, l.y, l.z], text: l.text }));
  const key = [info.W, info.D, info.H].join();
  if (key !== fitted) { fitted = key; const c = new THREE.Vector3(info.W / 2, info.D / 2, info.H / 2), r = Math.hypot(info.W, info.D, info.H);
    controls.target.copy(c); camera.position.set(c.x - r * 0.35, c.y - r * 1.1, c.z + r * 0.95); camera.far = r * 12; camera.updateProjectionMatrix(); controls.update(); }
  draw();
}
