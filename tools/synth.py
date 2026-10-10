"""Synthetic test photos: render the sheet, composite a known shape (mm), apply a random camera pose, lighting gradient, noise."""
import numpy as np, cv2, json, sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
from make_sheet import render_sheet, W as SW, H as SH
PPM = 6

def shape_poly(kind, rng):
    t = np.linspace(0, 2 * np.pi, 360, endpoint=False)
    if kind == 'rect50x30': p = np.array([[-25, -15], [25, -15], [25, 15], [-25, 15]], float)
    elif kind == 'circle40': p = np.c_[20 * np.cos(t), 20 * np.sin(t)]
    elif kind == 'Lshape': p = np.array([[-30, -20], [10, -20], [10, 0], [30, 0], [30, 20], [-30, 20]], float)
    elif kind == 'wrench':
        p = np.array([[-45, -6], [20, -6], [28, -16], [42, -16], [48, -6], [48, 6], [42, 16], [28, 16], [20, 6], [-45, 6]], float)
    elif kind == 'ellipse60x25': p = np.c_[30 * np.cos(t), 12.5 * np.sin(t)]
    elif kind == 'rect12x80': p = np.array([[-6, -40], [6, -40], [6, 40], [-6, 40]], float)
    else: raise ValueError(kind)
    return p

COLORS = {'dark': (50, 52, 58), 'red': (40, 40, 190), 'steel': (150, 150, 156), 'yellow': (60, 200, 235), 'green': (70, 140, 60)}

def make_case(seed, kind, color, tilt, W=2400, H=1800, portrait=False, name=None, out='tests/synth', nomarker=False):
    rng = np.random.default_rng(seed)
    poly = shape_poly(kind, rng)
    ang = rng.uniform(0, 180); c, s = math.cos(math.radians(ang)), math.sin(math.radians(ang))
    poly = poly @ np.array([[c, s], [-s, c]])
    r = np.abs(poly).max(0)
    cx = rng.uniform(10 + r[0] + 6, 200 - r[0] - 6); cy = rng.uniform(36 + r[1] + 6, 261 - r[1] - 6)
    poly = poly + [cx, cy]
    sheet = render_sheet(PPM).astype(np.float32)
    # soft shadow + object
    mask = np.zeros(sheet.shape[:2], np.uint8)
    cv2.fillPoly(mask, [np.round(poly * PPM * 16).astype(np.int32)], 255, lineType=cv2.LINE_AA, shift=4)
    sh = cv2.GaussianBlur(np.roll(mask, (int(2 * PPM), int(2 * PPM)), (0, 1)).astype(np.float32) / 255, (0, 0), 2.5 * PPM / 2)
    sheet *= (1 - 0.28 * sh)[..., None]
    m = (mask.astype(np.float32) / 255)[..., None]
    col = np.array(COLORS[color], np.float32)
    tex = 1 + 0.06 * cv2.GaussianBlur(rng.standard_normal(mask.shape).astype(np.float32), (0, 0), 3)[..., None]
    sheet = sheet * (1 - m) + col * tex * m
    if nomarker:
        for i in range(4):
            ox,oy=[(10,10),(180,10),(10,267),(180,267)][i]; sheet[int(oy*PPM)-2:int((oy+20)*PPM)+2, int(ox*PPM)-2:int((ox+20)*PPM)+2]=255
    # camera
    if portrait: W, H = H, W
    f = 0.85 * max(W, H) * 1.0
    yaw = rng.uniform(-180, 180) if tilt > 1 else 0
    def Rx(a): a = math.radians(a); return np.array([[1, 0, 0], [0, math.cos(a), -math.sin(a)], [0, math.sin(a), math.cos(a)]])
    def Rz(a): a = math.radians(a); return np.array([[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1]])
    Rm = Rx(tilt) @ Rz(yaw * 0 + rng.uniform(-15, 15))
    fit = 0.72 * min(H / SH, W / SW)
    d = f / fit  # distance so 1 mm -> fit px
    K = np.array([[f, 0, W / 2], [0, f, H / 2], [0, 0, 1]])
    if portrait is False:  # rotate sheet so long side along image long side
        Rm = Rm @ Rz(90)
        fit = 0.74 * min(H / SW, W / SH); d = f / fit
    t = np.array([rng.uniform(-8, 8), rng.uniform(-8, 8), d])
    Hs = K @ np.c_[Rm[:, 0], Rm[:, 1], t] @ np.array([[1 / PPM, 0, -SW / 2], [0, 1 / PPM, -SH / 2], [0, 0, 1]])
    bg = np.full((H, W, 3), (70, 95, 120), np.float32) * (1 + 0.08 * cv2.GaussianBlur(rng.standard_normal((H, W)).astype(np.float32), (0, 0), 6)[..., None])
    img = cv2.warpPerspective(sheet, Hs, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    cover = cv2.warpPerspective(np.ones(sheet.shape[:2], np.float32), Hs, (W, H), flags=cv2.INTER_LINEAR)[..., None]
    img = img * cover + bg * (1 - cover)
    # lighting gradient + vignette + paper tint
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    g = rng.uniform(0.18, 0.32); a = rng.uniform(0, 2 * np.pi)
    grad = 1 + g * ((xx - W / 2) * math.cos(a) + (yy - H / 2) * math.sin(a)) / max(W, H) * 2
    vig = 1 - 0.18 * (((xx - W / 2) / W) ** 2 + ((yy - H / 2) / H) ** 2) * 4
    img *= (grad * vig)[..., None] * np.array([0.97, 1.0, 1.03], np.float32)
    img = cv2.GaussianBlur(img, (0, 0), 0.9) + rng.normal(0, 3.0, img.shape)
    img = np.clip(img, 0, 255).astype(np.uint8)
    name = name or f'{kind}_{color}_t{int(tilt)}_s{seed}'
    os.makedirs(out, exist_ok=True)
    cv2.imwrite(f'{out}/{name}.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 90])
    from make_sheet import ROI
    rc=[[ROI[0],ROI[1]],[ROI[2],ROI[1]],[ROI[2],ROI[3]],[ROI[0],ROI[3]]]
    roi_px=[(lambda v:[v[0]/v[2],v[1]/v[2]])(Hs@np.array([x*PPM,y*PPM,1.0])) for x,y in rc]
    return {'roi_px_full': roi_px, 'file': f'{name}.jpg', 'kind': kind, 'color': color, 'tilt': tilt, 'size': [W, H], 'polygon': poly.tolist(), 'seed': seed}

if __name__ == '__main__':
    cases = []
    specs = [('rect50x30', 'dark', 0), ('rect50x30', 'dark', 20), ('rect50x30', 'red', 35), ('rect50x30', 'steel', 45),
             ('circle40', 'dark', 15), ('circle40', 'green', 30), ('Lshape', 'red', 25), ('wrench', 'steel', 20), ('wrench', 'dark', 40),
             ('ellipse60x25', 'yellow', 10), ('rect12x80', 'dark', 30), ('rect50x30', 'yellow', 25)]
    for i, (k, c, t) in enumerate(specs):
        cases.append(make_case(100 + i, k, c, t, portrait=(i % 3 == 2)))
    for i, (k, c, t) in enumerate([('wrench', 'dark', 25), ('Lshape', 'steel', 10), ('rect50x30', 'dark', 30)]):
        cases.append(make_case(300 + i, k, c, t, W=4032, H=3024, name=f'big_{k}_{c}_t{t}'))
    json.dump(cases, open('tests/synth/gt.json', 'w'))
    man=[make_case(500+i,k,c,t,name=f'manual_{k}_t{t}',nomarker=True) for i,(k,c,t) in enumerate([('rect50x30','dark',20),('wrench','steel',30)])]
    json.dump(man, open('tests/synth/gt_manual.json','w'))
    print(len(cases), 'cases')
