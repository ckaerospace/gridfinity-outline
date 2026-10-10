import json, sys, numpy as np, cv2
res = json.load(open(sys.argv[1] if len(sys.argv) > 1 else 'tests/synth_results.json'))
S = 20
def raster(p):
    m = np.zeros((300 * S, 220 * S), np.uint8); cv2.fillPoly(m, [np.round(np.array(p) * S).astype(np.int32)], 1); return m
rows = []
for r in res:
    o = r['result'].get('outline')
    if not o: rows.append((r['file'], 'FAIL', r['result'].get('cal'))); continue
    a, b = raster(r['polygon']), raster(o)
    iou = (a & b).sum() / (a | b).sum()
    # symmetric boundary deviation (Hausdorff-ish, mean + max) in mm
    ca, _ = cv2.findContours(a, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE); cb, _ = cv2.findContours(b, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    da = cv2.distanceTransform(1 - cv2.drawContours(np.zeros_like(a), ca, -1, 1, 1), cv2.DIST_L2, 5)
    pb = cb[0][:, 0, :]; dev = da[pb[:, 1], pb[:, 0]] / S
    ra = cv2.minAreaRect(np.array(r['polygon'], np.float32)); rb = cv2.minAreaRect(np.array(o, np.float32))
    wa = sorted(ra[1]); wb = sorted(rb[1])
    rows.append((r['file'], round(iou, 4), round(float(dev.mean()), 3), round(float(dev.max()), 2), [round(x, 2) for x in wa], [round(x, 2) for x in wb], round(r['result']['cal']['tilt'], 1), r['result']['cal']['found'], round(r['result']['timing']['total'])))
for x in rows: print(x)
ok = [x for x in rows if x[1] != 'FAIL']
print('n', len(rows), 'ok', len(ok), 'mean IoU', np.mean([x[1] for x in ok]).round(4), 'min IoU', min(x[1] for x in ok), 'mean dev', np.mean([x[2] for x in ok]).round(3), 'max dev', max(x[3] for x in ok))
