import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {MELEE} from '../public/rules.js';
import {importPublicModule} from './helpers/public-modules.mjs';

const world=await importPublicModule('world.js');
const vertex=(blade,index)=>blade.localToWorld(new THREE.Vector3().fromBufferAttribute(blade.geometry.getAttribute('position'),index));
function section(blade,index){
  const indices=blade.userData.sections[index],edge=vertex(blade,indices.edge);
  const spine=vertex(blade,indices.spineTop).add(vertex(blade,indices.spineBottom)).multiplyScalar(.5);
  return{edge,spine,center:edge.clone().add(spine).multiplyScalar(.5)};
}
function rig({remote=false,pitch=0,yaw=0,crouched=false}={}){
  const model=remote?world.createSurvivor():world.createWeapon('katana'),root=new THREE.Group();root.add(model);root.rotation.y=yaw;
  if(remote){world.setSurvivorWeapon(model,'katana');for(let index=0;index<120;index++)world.animateSurvivor(model,{pitch,crouched,delta:1/60});}
  else root.rotation.x=pitch;
  const gun=remote?model.userData.gun:model,blade=gun.getObjectByName('katanaBlade');
  return{gun,blade,sample(attack,elapsed,{unroll=false}={}){
    const profile=MELEE[attack];
    if(remote)world.animateSurvivor(model,{pitch,crouched,delta:0,meleeAttack:attack,meleeElapsed:elapsed,meleeWindup:profile.windup,meleeDuration:profile.duration});
    else world.animateMeleeWeapon(gun,{attack,elapsed,windup:profile.windup,duration:profile.duration});
    if(unroll)gun.userData.bladeFrame.rotation.z=0;
    root.updateMatrixWorld(true);
  }};
}
function alignment(rig,attack,time,index,{unroll=false}={}){
  const epsilon=.00001;
  rig.sample(attack,time-epsilon,{unroll});const before=section(rig.blade,index).edge;
  rig.sample(attack,time+epsilon,{unroll});const after=section(rig.blade,index).edge;
  rig.sample(attack,time,{unroll});const at=section(rig.blade,index);
  const tangent=section(rig.blade,index+1).center.sub(section(rig.blade,index-1).center).normalize();
  const velocity=after.sub(before).divideScalar(2*epsilon),edge=at.edge.sub(at.spine);
  velocity.addScaledVector(tangent,-velocity.dot(tangent));edge.addScaledVector(tangent,-edge.dot(tangent));
  assert.ok(velocity.length()>1,'the measured blade actually moves during contact');
  return velocity.normalize().dot(edge.normalize());
}

test('the production blade has one geometric cutting apex and a thick, separately identified spine',()=>{
  const blade=world.createWeapon('katana').getObjectByName('katanaBlade'),positions=blade.geometry.getAttribute('position');
  assert.equal(blade.userData.cuttingSide,'negative-X');assert.equal(blade.material[1].name,'katanaCuttingEdge');assert.equal(blade.material[2].name,'katanaSpine');
  for(const indices of blade.userData.sections.slice(0,-1)){
    const edge=new THREE.Vector3().fromBufferAttribute(positions,indices.edge),top=new THREE.Vector3().fromBufferAttribute(positions,indices.spineTop),bottom=new THREE.Vector3().fromBufferAttribute(positions,indices.spineBottom);
    assert.ok(edge.x<top.x,'only the outer curved side is the edge');
    assert.ok(Math.abs(edge.z-top.z)<1e-7&&Math.abs(edge.z-bottom.z)<1e-7,'edge and spine are measured at the same real vertex station');
    assert.ok(Math.abs(edge.y-(top.y+bottom.y)/2)<1e-7,'the edge ends in one apex between the two bevels');
    assert.ok(Math.abs(top.y-bottom.y-.007)<1e-7,'the spine retains 7 mm thickness');
  }
});

test('actual light and heavy cutting-edge vertices lead their contact trajectories in FPS and teammate poses',()=>{
  const contexts=[{name:'fps',remote:false},{name:'fps-aimed',remote:false,pitch:.4,yaw:-1.1},{name:'teammate',remote:true},{name:'teammate-crouched',remote:true,pitch:-.4,yaw:1.2,crouched:true},{name:'teammate-up',remote:true,pitch:.5,yaw:-.9}];
  let checked=0,minimum=1;
  for(const context of contexts){const model=rig(context);
    for(const attack of['light','heavy'])for(const offset of[-.02,0,.02])for(const index of[14,20]){
      const dot=alignment(model,attack,MELEE[attack].windup+offset,index);minimum=Math.min(minimum,dot);checked++;
      assert.ok(dot>.98,`${context.name}/${attack}/${offset}s/section${index}: edge must lead velocity, dot=${dot}`);
    }
  }
  assert.equal(checked,60);assert.ok(minimum>.98);
});

test('removing the calculated wrist roll reproduces the heavy flat or spine contact and recovery restores the resting orientation',()=>{
  for(const remote of[false,true]){
    const model=rig({remote,pitch:.3});
    assert.ok(alignment(model,'heavy',MELEE.heavy.windup,20,{unroll:true})<.2,'without correction the heavy cut leads with its flat or spine');
    model.sample('heavy',MELEE.heavy.duration);assert.equal(model.gun.userData.bladeFrame.rotation.z,0);
    model.sample('light',Infinity);assert.equal(model.gun.userData.bladeFrame.rotation.z,0);
    assert.equal(model.gun.userData.meleePose.armX,0);assert.equal(model.gun.userData.meleePose.armZ,0);
  }
});
