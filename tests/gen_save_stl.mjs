// node tests/gen_save_stl.mjs <depth> <layout> <saving> <wall> <out.stl> [off]  -> prints: nx ny H pct solidVol redVol
import fs from 'fs';
import { initManifold, buildBin, toSTL, analyze } from '../dist/js/bin.js';
import { SETS, REALSETS, newProject } from './arrange_lib.mjs';
await initManifold();
const [depth, layout, saving, wall, out, off] = process.argv.slice(2);
const sets = { ...SETS, ...REALSETS }, arr = layout.endsWith(':arr'), lname = layout.replace(':arr', ''), p = newProject(sets[lname](), { depth: +depth });
// spread objects on a simple grid so the layout is valid without arrange
let x = 0, y = 0, rowH = 0; const maxW = 160;
for (const o of p.objects) { const xs = o.outline.map((q) => q[0]), ys = o.outline.map((q) => q[1]); const w = Math.max(...xs) - Math.min(...xs) + 24, h = Math.max(...ys) - Math.min(...ys) + 24; if (x + w > maxW) { x = 0; y += rowH; rowH = 0; } o.x = x + w / 2; o.y = y + h / 2; o.rot = 0; x += w; rowH = Math.max(rowH, h); }
if (arr) { const { arrange } = await import('../dist/js/pack.js'); const { toPackObjects } = await import('./arrange_lib.mjs'); const r = arrange(toPackObjects(p), { wall: 3, budgetMs: 1500 }); for (const q of r.placements) { const o = p.objects.find((z) => z.id === q.id); o.x = q.x; o.y = q.y; o.rot = q.rot; } }
p.save = { on: off !== 'off', saving: +saving, wall: +wall };
const an = analyze(p), info = {}, b = buildBin(p, an, info);
console.log(an.nx, an.ny, an.H, (info.pct ?? 0).toFixed(2), (info.solidVol || 0).toFixed(0), (info.redVol || 0).toFixed(0), JSON.stringify(an.objects.flatMap((o) => o.issues)));
fs.writeFileSync(out, Buffer.from(await toSTL(b).arrayBuffer()));
