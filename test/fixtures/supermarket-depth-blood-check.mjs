import assert from 'node:assert/strict';import * as THREE from 'three';import{importPublicModule}from'../helpers/public-modules.mjs';
const {install,BLOOD}=await importPublicModule('frisson/blood.js');const {restingSurface}=await importPublicModule('frisson/blood-floor.js');
let seed=12;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};const scene=new THREE.Scene(),hooks={},record=[];
const handle=await install({THREE,scene,hooks,quality:'high',random,onDroplet:info=>record.push({...info})});
hooks.impact({x:6,y:-2.1,z:0,dirX:0,dirY:0,dirZ:1,headshot:false,kill:false,zombieId:'z1',damage:30,weapon:'pistol',mode:'bullet',shot:1,kind:'walker',boss:false,scale:1,axisX:NaN,axisZ:NaN,local:true,delay:0});
for(let tick=0;tick<90;tick++)hooks.frame({delta:1/60});
assert.ok(record.length>4,'real spray produces droplets');let landed=0;
for(const d of record.filter(d=>!d.stuck&&!d.dropped)){
 const x=d.x+d.vx*d.time,z=d.z+d.vz*d.time,bottom=d.y+d.vy*d.time-BLOOD.gravity*d.time*d.time/2-d.cells*BLOOD.grid/2;
 assert.ok(bottom<-.24,'cave blood does not teleport to floor zero: '+bottom);
 assert.ok(Math.abs(restingSurface(x,z,bottom+1e-4)-bottom)<1e-4,'spray solves a real negative surface');landed++;
}
assert.ok(landed>4,'negative landings verified');
const mesh=scene.getObjectByName('frissonBloodDroplets');let shown=0;
for(let i=0;i<mesh.count;i++){const a=mesh.instanceMatrix.array,at=i*16;if(a[at]>0){assert.ok(a[at+13]<-.24,'rendered droplet remains below the slab');shown++;}}
assert.ok(shown>0,'rendered settled droplets inspected');handle.uninstall();console.log('supermarket blood: '+landed+' negative droplet landings and '+shown+' rendered droplets verified');
