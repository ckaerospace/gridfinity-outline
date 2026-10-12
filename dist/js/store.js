// Local project storage (IndexedDB). Everything stays on this device.
const DB = 'gf-outline', ST = 'projects';
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(ST, { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return dbp;
}
const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(ST, mode), s = t.objectStore(ST), out = fn(s); t.oncomplete = () => res(out && 'result' in out ? out.result : undefined); t.onerror = () => rej(t.error); }); };
export const newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const putProject = (rec) => tx('readwrite', (s) => s.put(rec));
export const getProject = (id) => tx('readonly', (s) => s.get(id));
export const deleteProject = (id) => tx('readwrite', (s) => s.delete(id));
export async function listProjects() { const all = (await tx('readonly', (s) => s.getAll())) || []; return all.sort((a, b) => b.updated - a.updated); }
