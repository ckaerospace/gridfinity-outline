import json,sys,numpy as np,cv2
S=20
def raster(p):
    m=np.zeros((300*S,220*S),np.uint8); cv2.fillPoly(m,[np.round(np.array(p)*S).astype(np.int32)],1); return m
def score(path):
    out={}
    for r in json.load(open(path)):
        o=r['result'].get('outline')
        if not o: out[r['file']]=(0,99,r['color']); continue
        a,b=raster(r['polygon']),raster(o); iou=(a&b).sum()/(a|b).sum()
        ra=sorted(cv2.minAreaRect(np.array(r['polygon'],np.float32))[1]); rb=sorted(cv2.minAreaRect(np.array(o,np.float32))[1])
        out[r['file']]=(iou,max(abs(ra[0]-rb[0]),abs(ra[1]-rb[1])),r['color'])
    return out
cfg=sys.argv[1:]
res={p:score(p) for p in cfg}
print('%-34s'%'case',*['%16s'%p.split('/')[-1][2:-5] for p in cfg])
for f in res[cfg[0]]: print('%-34s'%f,*['  %.3f / %5.1fmm'%res[p][f][:2] for p in cfg])
print('--- mean IoU / mean size err (max side) / #IoU<0.9')
for p in cfg:
    v=np.array([x[:2] for x in res[p].values()]); print('%-24s'%p.split('/')[-1],'IoU %.3f  sizeErr %.2fmm  fails %d/%d'%(v[:,0].mean(),v[:,1].mean(),(v[:,0]<0.9).sum(),len(v)))
    for grp,cs in [('pale',('white','lightgrey','cream')),('other',('steel','dark','blue'))]:
        v=np.array([x[:2] for x in res[p].values() if x[2] in cs]); print('   ',grp,'n=%d IoU %.3f sizeErr %.2fmm'%(len(v),v[:,0].mean(),v[:,1].mean()))
