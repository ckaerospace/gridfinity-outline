import sys, trimesh, numpy as np, cv2
m = trimesh.load(sys.argv[1]); print('file', sys.argv[1])
print('watertight', m.is_watertight, '| winding consistent', m.is_winding_consistent, '| is_volume', m.is_volume, '| tris', len(m.faces), '| volume mm3', round(m.volume), '| bounds', np.round(m.bounds, 2).tolist())
print('degenerate faces', int((m.area_faces < 1e-9).sum()), '| euler', m.euler_number)
H = m.bounds[1][2]
def section_dims(z):
    s = m.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
    if s is None: return None
    res = []
    for d in s.discrete:
        pts = np.array(d[:, :2], np.float32); r = cv2.minAreaRect(pts)
        res.append((round(float(abs(cv2.contourArea(pts))), 1), sorted([round(r[1][0], 2), round(r[1][1], 2)])))
    return sorted(res, reverse=True)
for z in [0.05, 0.7, 1.5, 2.55, 4.0, 4.7]:
    print('z=%.2f' % z, section_dims(z))
print('z=H-1', section_dims(H - 1))
