import fs from 'fs';
import { initManifold, buildBin, toSTL, analyze } from '../dist/js/bin.js';
await initManifold();
const rr=(w,h,r=6,n=8)=>{const p=[];const c=[[w/2-r,h/2-r],[-w/2+r,h/2-r],[-w/2+r,-h/2+r],[w/2-r,-h/2+r]];c.forEach((q,k)=>{for(let i=0;i<=n;i++){const a=k*Math.PI/2+i/n*Math.PI/2;p.push([q[0]+r*Math.cos(a),q[1]+r*Math.sin(a)]);}});return p;};
const [depth,nn,out]=[+process.argv[2],+process.argv[3],process.argv[4]];
const project={cells:{auto:true},height:{auto:true},floor:2,defaults:{margin:2,notch:16,depth},objects:[{id:1,name:'A',outline:rr(84.2,40.2),x:62.7,y:41.7,rot:0,notches:[0.05,0.5,0.75].slice(0,nn),depth:null}]};
const an=analyze(project); const b=buildBin(project,an);
console.log(an.nx,an.ny,an.H,an.objects[0].eff.depth,an.objects[0].issues);
fs.writeFileSync(out,Buffer.from(await toSTL(b).arrayBuffer()));
