// Lip + magnets: build bins with every option combo, write STLs, check volume/genus, pocket floor clearance, bounds.
import fs from 'fs';
import { initManifold, buildBin, toSTL, analyze, GF } from '../dist/js/bin.js';
await initManifold();
const rect=(w,h)=>[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]];
const base=()=>({cells:{auto:true},height:{auto:true},floor:0.8,defaults:{margin:2,notch:16,depth:20},save:{on:false},objects:[
 {id:1,name:'A',outline:rect(50,30),x:30,y:20,rot:0,notches:[0.1],depth:null},
 {id:2,name:'B',outline:rect(20,20),x:30,y:62,rot:0,depth:6,notches:[]}]});
let fail=0; fs.mkdirSync('samples',{recursive:true});
for (const [lip,mag,save] of [[0,0,0],[1,0,0],[0,1,0],[1,1,0],[1,1,1]]) {
  const p=base(); p.lip=!!lip; p.magnets=!!mag; p.save.on=!!save; p.save.saving=60; p.save.wall=1.6;
  const an=analyze(p), b=buildBin(p,an), bb=b.boundingBox(), tag=`lip${lip}-mag${mag}-save${save}`;
  const minPocketFloor=Math.min(...an.objects.map(o=>an.H-o.eff.depth));
  const floorOk=minPocketFloor>=GF.footH+0.8-1e-6 && minPocketFloor>=GF.magnet.depth+0.8;
  const hOk=Math.abs(bb.max[2]-(an.H+(lip?GF.lipH:0)))<0.02;
  const issues=an.objects.flatMap(o=>o.issues.filter(s=>!s.startsWith('depth')));
  const ok=b.status()==='NoError'&&floorOk&&hOk&&!issues.length&&b.volume()>0;
  if(!ok) fail++;
  fs.writeFileSync(`samples/${tag}.stl`,Buffer.from(await toSTL(b).arrayBuffer()));
  console.log(tag,ok?'PASS':'FAIL',{nx:an.nx,ny:an.ny,H:an.H,top:+bb.max[2].toFixed(2),vol:Math.round(b.volume()),genus:b.genus(),minPocketFloor:+minPocketFloor.toFixed(2),wall:an.wall,issues});
}
// lip enforces 2.6 mm outer wall: object at x giving 1.5 mm wall flagged with lip, fine without
const p=base(); p.objects=[{id:1,name:'E',outline:rect(30,30),x:2+15+1.5,y:20,rot:0,notches:[],margin:0}];
p.objects[0].x=15+1.5; const a0=analyze(p).objects[0].issues; p.lip=true; const a1=analyze(p).objects[0].issues;
const wallOk=!a0.includes('outside bin')&&a1.includes('outside bin'); if(!wallOk) fail++;
console.log('lip outer wall check', wallOk?'PASS':'FAIL', a0, a1);
console.log(fail?`FAILED ${fail}`:'ALL PASS'); process.exit(fail?1:0);
