import fs from 'fs';
import { initManifold, buildBin, toSTL, analyze } from '../dist/js/bin.js';
await initManifold();
const rect=(w,h)=>[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]];
const circ=(r)=>Array.from({length:64},(_,i)=>[r*Math.cos(i/64*6.283),r*Math.sin(i/64*6.283)]);
const project={cells:{auto:true},height:{auto:true},floor:2,defaults:{margin:2,notch:16,depth:20},objects:[
 {id:1,name:'A',outline:rect(50,30),x:30,y:20,rot:0,notches:[0.1],depth:null},
 {id:2,name:'B',outline:circ(12),x:30,y:60,rot:0,depth:8,notches:[0.5]},
 {id:3,name:'C',outline:rect(40,12),x:80,y:60,rot:30,depth:30,margin:1,notches:[]}]};
const an=analyze(project); console.log(an.nx,an.ny,an.hu,an.H,an.objects.map(o=>[o.eff.depth,o.issues]));
const t=Date.now(); const b=buildBin(project,an); console.log('build ms',Date.now()-t, b.volume(), b.genus());
fs.writeFileSync(process.argv[2]||'/tmp/t.stl',Buffer.from(await toSTL(b).arrayBuffer()));
