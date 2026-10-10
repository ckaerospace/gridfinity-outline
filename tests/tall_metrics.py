import json, numpy as np, cv2
res = json.load(open('tests/tall_results.json')); S = 10
def rast(p):
    m = np.zeros((300*S, 220*S), np.uint8); cv2.fillPoly(m, [np.round(np.array(p)*S).astype(np.int32)], 1); return m
def iou(a, b): A, B = rast(a), rast(b); return (A & B).sum()/max(1, (A | B).sum())
def dims(p): return sorted(cv2.minAreaRect(np.array(p, np.float32))[1], reverse=True)
rows = []
for r in res:
    gt = r['polygon']; raw = r['raw']['o']
    if not raw: print('FAIL', r['file']); continue
    g = dims(gt); a = dims(raw); b = dims(r['corr']) if r['corr'] else a
    rows.append(dict(f=r['file'], h=r['height'], fs=r['fscale'], tilt=r['tilt'], camz=r['raw']['cam']['z'], iou_raw=iou(gt, raw), iou_c=iou(gt, r['corr'] or raw),
        err_raw=np.mean([a[0]-g[0], a[1]-g[1]]), err_c=np.mean([b[0]-g[0], b[1]-g[1]]), err_raw_max=max(abs(a[0]-g[0]), abs(a[1]-g[1])), err_c_max=max(abs(b[0]-g[0]), abs(b[1]-g[1]))))
print('%-42s %4s %4s %5s | IoU raw  corr | err(mean mm) raw  corr | max|err| raw corr' % ('case', 'h', 'fs', 'camZ'))
for x in rows: print('%-42s %4.0f %4.1f %5.0f | %.3f %.3f | %+5.1f %+5.1f | %4.1f %4.1f' % (x['f'][:42], x['h'], x['fs'], x['camz'], x['iou_raw'], x['iou_c'], x['err_raw'], x['err_c'], x['err_raw_max'], x['err_c_max']))
for h in (0, 15, 25, 35):
    for fs in (1.0, 1.3):
        s = [x for x in rows if x['h'] == h and x['fs'] == fs]
        if s: print('h=%2d fs=%.1f n=%2d  IoU %.3f -> %.3f  mean err %+.2f -> %+.2f  max|err| %.2f -> %.2f' % (h, fs, len(s), np.mean([x['iou_raw'] for x in s]), np.mean([x['iou_c'] for x in s]), np.mean([x['err_raw'] for x in s]), np.mean([x['err_c'] for x in s]), np.mean([x['err_raw_max'] for x in s]), np.mean([x['err_c_max'] for x in s])))
