# Regression: pocket depth / notch combos must stay watertight and must not open slots in the foot grooves
# (bug: depth 10 -> bin 14 mm, floor 4 mm < foot height 4.75, pocket cut through the foot grooves -> black cross in 3D).
# usage: venv with trimesh+shapely; python3 tests/depth_notch_test.py
import subprocess, sys, trimesh, os
here = os.path.dirname(os.path.abspath(__file__)); fails = 0
for depth in [5, 10, 15, 20, 30]:
    for nn in [0, 1, 2, 3]:
        out = f'/tmp/dn_{depth}_{nn}.stl'
        info = subprocess.run(['node', os.path.join(here, 'gen_depth_stl.mjs'), str(depth), str(nn), out], capture_output=True, text=True, check=True).stdout.strip().splitlines()[-1]
        nx, ny, H = [float(v) for v in info.split()[:3]]
        m = trimesh.load(out); cells = int(nx * ny)
        loops = lambda z: len(m.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1]).discrete)
        l_foot, l_above = loops(4.6), loops(5.2)
        ok = m.is_watertight and m.is_volume and l_foot == cells and l_above == 1 and abs(m.bounds[1][2] - H) < 1e-3
        # pocket floor: lowest z of any upward-facing face above the feet must be >= footH + 0.8 - 0.2 (notch sphere tip)
        up = m.triangles_center[(m.face_normals[:, 2] > 0.99) & (m.triangles_center[:, 2] > 4.8)][:, 2]
        floorz = float(up.min()) if len(up) else None
        ok = ok and (floorz is None or floorz >= 4.75 + 0.8 - 0.25)
        print(f'depth {depth:2d} notches {nn} {info}: watertight={m.is_watertight} loops@4.6={l_foot}/{cells} loops@5.2={l_above} lowest upward face z={floorz} {"OK" if ok else "FAIL"}')
        fails += not ok
sys.exit(1 if fails else 0)
