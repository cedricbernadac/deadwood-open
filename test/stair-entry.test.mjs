import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { RoomSimulation, WORLD, WEAPONS } from '../simulation.mjs';
import { STAIRS, STAIR_WELL, STAIR_STRINGERS, stairTreadY, stairCeiling } from '../public/stairs.js';
import { playerHeight } from '../public/movement.js';
import {importPublicModule} from './helpers/public-modules.mjs';

function fixture(x=3.8, weapon='pistol') {
  const simulation=new RoomSimulation('ENTRY1',{random:()=>.5}), player=simulation.addPlayer('a');
  Object.assign(player,{x,y:0,z:3.3,grounded:true,vy:0});
  if(weapon!=='pistol') {player.inventory[weapon]={ammo:WEAPONS[weapon].magazine,reserve:WEAPONS[weapon].reserve};simulation.chooseWeapon('a',weapon);}
  const step=(input={},delta=1/30)=>{simulation.setInput('a',{forward:0,strafe:0,yaw:0,pitch:0,...input});simulation.movePlayer(player,delta);simulation.time+=delta;};
  return {simulation,player,step};
}
function overlapsSlab(player) {
  const insideWell=player.x>=STAIR_WELL.minX+.25 && player.x<=STAIR_WELL.maxX-.25 && player.z>=STAIR_WELL.minZ+.25 && player.z<=STAIR_WELL.maxZ-.25;
  return !insideWell && player.y<3.4-1e-6 && player.y+playerHeight(player)>3.16+1e-6;
}

// Exercise the formerly trapping edge positions, not just the central route.
test('standing survivors climb and descend the full stair width without a slab intersection at30/10Hz',()=>{
  let paths=0;
  for(const delta of [1/30,.1]) for(const sprint of [false,true]) for(const weapon of ['pistol','minigun']) {
    for(const x of [3,3.05,3.2,3.24,3.25,3.3,3.8,4.3,4.35,4.36,4.4,4.55,4.6]) {
      const {simulation,player,step}=fixture(x,weapon);
      for(let i=0;i<Math.ceil(5/delta) && player.z>STAIRS.minZ-.35;i++) {
        step({forward:1,sprint},delta);
        assert.equal(player.crouched,false);
        assert.equal(overlapsSlab(player),false,`up ${weapon} x${x}, y${player.y}, z${player.z}`);
        assert.equal(simulation.canOccupy(player,player.x,player.z,player.y,.25),true);
      }
      assert.equal(player.y,WORLD.loftY,`up ${weapon} x${x}`);
      assert.ok(player.z<STAIRS.minZ-.25);
      for(let i=0;i<Math.ceil(5/delta) && player.z<STAIRS.maxZ+.35;i++) {
        step({forward:-1,sprint},delta);
        assert.equal(player.crouched,false);
        assert.equal(overlapsSlab(player),false,`down ${weapon} x${x}, y${player.y}, z${player.z}`);
      }
      assert.equal(player.y,0,`down ${weapon} x${x}`);
      assert.ok(player.z>STAIRS.maxZ+.25);
      assert.equal(player.grounded,true);
      paths++;
    }
  }
  assert.equal(paths,104);
});

test('survivors can jump out of either open stair side without crouching and land on the loft',()=>{
  for(const delta of [1/30,.1]) for(const direction of [-1,1]) {
    const {simulation,player,step}=fixture();
    for(let i=0;i<100 && player.z>-1.25;i++)step({forward:1},delta);
    assert.equal(player.y,stairTreadY(player.z));
    const initialY=player.y;
    let highest=player.y;
    for(let i=0;i<Math.ceil(2/delta);i++) {
      step({strafe:direction,jump:i===0},delta);
      highest=Math.max(highest,player.y);
      assert.equal(overlapsSlab(player),false);
      assert.equal(simulation.canOccupy(player,player.x,player.z,player.y,.25),true);
    }
    assert.ok(highest>initialY+.5);
    assert.equal(player.y,WORLD.loftY);
    assert.ok(direction<0 ? player.x<STAIR_WELL.minX-.25 : player.x>STAIR_WELL.maxX+.25);
    assert.equal(player.crouched,false);
    assert.equal(player.grounded,true);
  }
});

test('an already trapped survivor can walk toward the clear well without Ctrl or a teleport',()=>{
  for(const [x,direction] of [[2.85,1],[4.75,-1]]) {
    const {simulation,player,step}=fixture();
    Object.assign(player,{x,y:1.4875,z:.78,grounded:true});
    assert.equal(overlapsSlab(player),true);
    assert.equal(simulation.canOccupy(player,x,player.z,player.y,.25),false);
    for(let i=0;i<3;i++) {
      const oldX=player.x;
      step({strafe:direction});
      assert.ok((player.x-oldX)*direction>0);
      assert.ok(Math.abs(player.x-oldX)<.15,'Recovery is an ordinary input step');
    }
    assert.equal(overlapsSlab(player),false);
    assert.equal(player.crouched,false);
  }
});

test('a raised tread checks the new head height before allowing a shoulder under the loft slab',()=>{
  for(const x of [2.8,4.8]) {
    const {simulation,player,step}=fixture();
    Object.assign(player,{x,y:1.275,z:1.02,grounded:true});
    assert.equal(overlapsSlab(player),false);
    assert.equal(stairTreadY(.78),1.4875);
    assert.equal(simulation.playerCandidateY(player,x,.78),null);
    for(let i=0;i<10;i++)step({forward:1});
    assert.equal(player.y,1.275);
    assert.equal(overlapsSlab(player),false);
    const stoppedZ=player.z;
    for(let i=0;i<5;i++)step({forward:-1});
    assert.ok(player.z>stoppedZ,'A blocked upward step still permits backing out while standing');
    assert.equal(player.crouched,false);
  }
});

test('all zombie silhouettes stay on the loft after recoil and resume pursuit beside either well edge',()=>{
  for(const delta of [1/30,.1]) for(const side of [-1,1]) {
    for(const [kind,scale,boss] of [['walker',1,false],['crawler',1,false],['brute',1.22,false],['brute',1.32,true]]) {
      const {simulation,player}=fixture();
      simulation.start(player.id);
      Object.assign(player,{x:side<0?2.3:7,y:WORLD.loftY,z:0});
      const zombie={id:'edge-recoil',x:side<0?2.6:5,y:WORLD.loftY,z:0,
        hp:10000,maxHp:10000,kind,scale,boss,speed:0,yaw:0,attackAfter:Infinity,entered:true};
      simulation.zombies.set(zombie.id,zombie);
      simulation.timeLeft=999;
      simulation.pushZombie(zombie,-side*200,0);
      for(let i=0;i<Math.ceil(.35/delta);i++)simulation.tick(delta);
      const afterRecoil={x:zombie.x,z:zombie.z};
      assert.ok(side<0?zombie.x<STAIR_WELL.minX:zombie.x>STAIR_WELL.maxX);
      assert.ok(zombie.x>=WORLD.loft.minX+.25,'The outer loft edge retains its original boundary');
      assert.equal(zombie.y,WORLD.loftY);
      zombie.speed=1.15;
      simulation.phase='wave';simulation.toSpawn=1;simulation.spawnTimer=999;
      player.z=1.5;
      for(let i=0;i<Math.ceil(4/delta);i++) {
        simulation.tick(delta);
        assert.equal(zombie.y,WORLD.loftY);
        assert.ok(side<0?zombie.x<STAIR_WELL.minX:zombie.x>STAIR_WELL.maxX);
        assert.equal(simulation.canOccupy(zombie,zombie.x,zombie.z,zombie.y,.29*scale),true);
      }
      assert.ok(Math.hypot(zombie.x-player.x,zombie.z-player.z)<1+Math.max(0,.29*scale-.29),`${kind} boss=${boss} side=${side} delta=${delta}`); // melee reach grows with the body
      assert.ok(Math.hypot(zombie.x-afterRecoil.x,zombie.z-afterRecoil.z)>.5,'Actual pursuit resumes after the impulse');
    }
  }
});

test('the current lower landing and high underpass remain solid while side approaches cannot climb through wood',()=>{
  for(const delta of [1/30,.1]) for(const direction of [-1,1]) {
    const {player,step}=fixture();
    Object.assign(player,{x:direction>0?2.3:5.3,y:0,z:1.3});
    for(let i=0;i<60;i++)step({strafe:direction,jump:i===0},delta);
    assert.equal(player.y,0);
    assert.ok(direction>0?player.x<STAIRS.minX:player.x>STAIRS.maxX);
    const under=fixture();Object.assign(under.player,{x:direction>0?2.3:5.3,y:0,z:-.6});
    for(let i=0;i<Math.ceil(2/delta);i++) {
      under.step({strafe:direction},delta);
      assert.equal(under.player.y,0);
      assert.ok(playerHeight(under.player)<=stairCeiling(under.player.x,under.player.z,0)+1e-6);
    }
    assert.ok(direction>0?under.player.x>STAIRS.maxX+.25:under.player.x<STAIRS.minX-.25);
  }
});

const {createWorld}=await importPublicModule('world.js');

test('rendered loft slabs leave the exact wider opening and both real stringers end below the upper landing',()=>{
  assert.ok(Math.abs(STAIR_WELL.minX-2.7)<1e-12 && Math.abs(STAIR_WELL.maxX-4.9)<1e-12);
  const previous=globalThis.document;
  globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>new Proxy({measureText:value=>({width:value.length*20})},{get:(object,key)=>key in object?object[key]:()=>{}})})};
  try {
    const world=createWorld(new THREE.Scene(),{ mergeStatic:false });world.root.updateMatrixWorld(true);
    const meshes=[];world.root.traverse(node=>{if(node.isMesh)meshes.push(node);});
    const slabs=meshes.filter(node=>node.geometry?.parameters?.height===.24 && Math.abs(node.position.y-3.28)<1e-8);
    assert.equal(slabs.length,4);
    const boxes=slabs.map(mesh=>new THREE.Box3().setFromObject(mesh));
    for(const box of boxes)assert.ok(box.max.x<=STAIR_WELL.minX+1e-6 || box.min.x>=STAIR_WELL.maxX-1e-6 || box.max.z<=STAIR_WELL.minZ+1e-6 || box.min.z>=STAIR_WELL.maxZ-1e-6);
    for(const beam of STAIR_STRINGERS) {
      const mesh=meshes.find(node=>Math.abs(node.position.x-beam.x)<1e-8 && Math.abs(node.position.y-beam.centerY)<1e-8 && node.geometry?.parameters?.width===beam.width);
      assert.ok(mesh);
      const box=new THREE.Box3().setFromObject(mesh);
      assert.ok(box.max.y<WORLD.loftY,'The sloping wood never protrudes above the landing');
      assert.ok(Math.abs(mesh.rotation.x-beam.angle)<1e-12);
    }
    assert.equal(meshes.some(node=>Math.abs(node.rotation.x)>0.1 && Math.abs(node.position.y-(STAIRS.topY/2+.85))<1e-8),false,'Sloping handrails no longer visually bar the open exits');
  } finally {globalThis.document=previous;}
});
