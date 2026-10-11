# Regression for the optional 'Save material' (sealed hexagonal voids). usage: /workspace/venv_tm/bin/python tests/save_material_test.py
# For several layouts/depths/strength settings: watertight + volume, base (z < 4.75+) identical to the solid bin, closed top, voids >= wall from
# pockets/outer walls and >= rib from each other, bridge span of every void <= 15 mm, no new sloped (overhanging) faces, reported saving matches trimesh.
import subprocess, sys, os, numpy as np, trimesh
from shapely.geometry import Polygon, MultiPolygon
from shapely.ops import unary_union
here = os.path.dirname(os.path.abspath(__file__)); fails = 0
CASES = [('s5', 20, 60, 1.6), ('s7', 10, 60, 1.6), ('s7', 10, 100, 1.2), ('s9', 30, 0, 2.5), ('s9', 15, 100, 1.2), ('real3', 15, 60, 1.6), ('s12', 20, 80, 1.6), ('s5', 5, 60, 1.6), ('real6', 25, 40, 2.0), ('s9:arr', 20, 60, 1.6), ('s12:arr', 25, 60, 1.6), ('real3:arr', 15, 60, 1.6), ('s7:arr', 10, 60, 1.6)]
def gen(args, out): return subprocess.run(['node', os.path.join(here, 'gen_save_stl.mjs'), *map(str, args), out], capture_output=True, text=True, check=True).stdout.strip().splitlines()[-1].split(' ', 6)
def section_poly(m, z):
    s = m.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
    if s is None: return Polygon()
    ps, _ = s.to_planar(to_2D=np.eye(4)); return unary_union(ps.polygons_full) if len(ps.polygons_full) else Polygon()
for lay, depth, sav, wall in CASES:
    off, on = f'/tmp/sm_{lay.replace(":","_")}_{depth}_off.stl', f'/tmp/sm_{lay.replace(":","_")}_{depth}_{sav}_{wall}.stl'
    gen([depth, lay, sav, wall], off + '.x.stl') if False else None
    o = subprocess.run(['node', os.path.join(here, 'gen_save_stl.mjs'), str(depth), lay, str(sav), str(wall), off, 'off'], capture_output=True, text=True, check=True).stdout.split()
    n = subprocess.run(['node', os.path.join(here, 'gen_save_stl.mjs'), str(depth), lay, str(sav), str(wall), on], capture_output=True, text=True, check=True).stdout.split()
    nx, ny, H, pct = int(n[0]), int(n[1]), float(n[2]), float(n[3])
    mo, mn = trimesh.load(off), trimesh.load(on); ok = True; msg = []
    c = lambda cond, t: (msg.append(t) if not cond else None)
    c(mn.is_watertight and mn.is_volume and mn.is_winding_consistent, 'not watertight/volume'); c(mo.is_watertight, 'solid not watertight')
    pct_t = 100 * (1 - mn.volume / mo.volume); c(abs(pct_t - pct) < 0.6, f'pct mismatch app {pct} trimesh {pct_t:.2f}')
    zb = 4.75 + wall - 0.05  # base: everything below the voids is identical
    for z in [0.05, 0.7, 1.5, 2.55, 4.0, 4.7, zb]: c(abs(section_poly(mn, z).area - section_poly(mo, z).area) < 0.05, f'base differs at z={z}')
    for z in [H - 0.3, H - wall + 0.1]: c(abs(section_poly(mn, z).area - section_poly(mo, z).area) < 0.05, f'top not closed at z={z}')
    zm = (4.75 + wall + H - wall) / 2; Ao, An = section_poly(mo, zm), section_poly(mn, zm); vd = Ao.difference(An)
    voids = list(vd.geoms) if isinstance(vd, MultiPolygon) else ([vd] if not vd.is_empty else [])
    voids = [v for v in voids if v.area > 1]
    bnd = Ao.boundary; maxspan = 0; minwall = 1e9; minrib = 1e9
    for i, v in enumerate(voids):
        pts = np.array(v.exterior.coords); d = np.sqrt(((pts[:, None] - pts[None]) ** 2).sum(-1)).max(); maxspan = max(maxspan, d); minwall = min(minwall, v.distance(bnd))
        for w in voids[i + 1:]: minrib = min(minrib, v.distance(w))
    if voids:
        c(maxspan <= 15.0, f'bridge span {maxspan:.1f} > 15'); c(minwall >= wall - 0.06, f'void to wall/pocket {minwall:.2f} < {wall}'); c(minrib >= max(wall, 2.4 - 1.2 * sav / 100) - 0.06, f'rib {minrib:.2f}')
    slope = lambda m: int(((m.face_normals[:, 2] < -0.05) & (m.face_normals[:, 2] > -0.95)).sum())
    c(slope(mn) <= slope(mo), f'new sloped (overhang) faces {slope(mn)} vs {slope(mo)}')
    c(abs(mn.bounds - mo.bounds).max() < 1e-3, 'bounds differ')
    ok = not msg; fails += not ok
    print(f'{lay:5s} depth {depth:2d} saving {sav:3d} wall {wall}: {nx}x{ny} H{H:.0f} saved {pct_t:5.1f}% (app {pct:.1f}) vol {mo.volume/1000:.1f}->{mn.volume/1000:.1f} cm3 voids@mid {len(voids)} span<={maxspan:.1f} wall>={minwall if voids else 0:.2f} rib>={minrib if len(voids)>1 else 0:.2f} {"OK" if ok else "FAIL " + "; ".join(msg)}')
sys.exit(1 if fails else 0)
