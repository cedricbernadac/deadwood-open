import assert from 'node:assert/strict';
import { SPACE, spaceFloor, spaceFlightAt } from '../../public/level-space.js';
import { LEVEL, IS_SUPERMARKET } from '../../public/level-config.js';
import { RoomSimulation, WORLD } from '../../simulation.mjs';
import { WORLD as PREDICTED_WORLD, movementMethods, createPhysicsContext, clonePredictedPlayer, stepPredictedPlayer } from '../../public/online/physics.js';
import { ARMORY, ARMORY_REACH, LOFT, BARRICADE_BOARDS, defendedDoorIds, waveBalance } from '../../public/rules.js';
import { GENERATOR, SPAWN_ENTRIES, FAR_SPAWN_ENTRIES, SUPPLY_CACHES, hasRainShelter, rainRoofHeight } from '../../public/expedition.js';
import { RAID_ENTRIES } from '../../public/raids.js';
import { STAIR_WELL, STAIRS } from '../../public/stairs.js';
import { SIGHT_COVERS, sightBoxes, sightDoors, sightClear } from '../../public/melee-reach.js';
import { COVERS, restingSurface } from '../../public/frisson/blood-floor.js';
import { wayOut, outdoors } from '../../companions/outdoors.mjs';
import { createCompanionBody } from '../../companions/body.mjs';
import { LOFT_RAIL } from '../../public/movement.js';
import { GUIDE } from '../../companion-brain/guide.mjs';
import { seededRandom } from '../../validation/balance-report.mjs';

const DT=1/30, flat=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z), inRect=(p,b)=>p.x>=b.minX&&p.x<=b.maxX&&p.z>=b.minZ&&p.z<=b.maxZ;
assert.equal(LEVEL.id, process.env.DEADWOOD_LEVEL);
assert.deepEqual(WORLD,PREDICTED_WORLD);
assert.deepEqual(WORLD.covers,SIGHT_COVERS);
assert.deepEqual(WORLD.covers,COVERS);
for(const [name,method] of Object.entries(movementMethods)) assert.equal(method.toString(),RoomSimulation.prototype[name].toString(),name);
assert.equal(WORLD.width,IS_SUPERMARKET?28:16);
assert.equal(WORLD.depth,IS_SUPERMARKET?22:12);
assert.deepEqual(BARRICADE_BOARDS.map(board=>board.maxHp),[60,60,60,60,60]);
assert.deepEqual(defendedDoorIds(1),['west','east']);
assert.deepEqual(defendedDoorIds(2),['west','east','north']);
assert.equal(waveBalance(1,1).total,8);
assert.equal(ARMORY.length,14);
assert.equal(ARMORY.find(rack=>rack.id==='minigun').price,2800);
assert.match(GUIDE,IS_SUPERMARKET?/abandoned supermarket/:/wooden cabin/);

// Stairwell parapets keep even the fastest jump below the 2.5m gondoles.
if(IS_SUPERMARKET){
 assert.equal(LOFT_RAIL.height,0);
 for(const vitamins of [0,8]){
  const room=new RoomSimulation('PARAPET',{random:()=>.5,raids:false}),p=room.addPlayer('jump');room.start(p.id);room.phase='wave';
  Object.assign(p,{x:5.9,y:0,z:-4,grounded:true,vy:0,bonus:vitamins?{vitamins}:null});
  const predicted=clonePredictedPlayer(p),context=createPhysicsContext({time:room.time,phase:room.phase,players:[p],zombies:[],doors:room.doors});
  let tookOff=false,maxY=0;
  for(let tick=0;tick<75;tick++){
   const command={forward:0,strafe:-1,yaw:0,pitch:0,sprint:true,jump:tick===0};
   room.setInput(p.id,command);room.time+=DT;room.movePlayer(p,DT);stepPredictedPlayer(predicted,command,DT,context);
   for(const key of ['x','y','z','vy'])assert.ok(Math.abs(p[key]-predicted[key])<1e-10,'stair parapet prediction '+key);
   tookOff ||= !p.grounded;maxY=Math.max(maxY,p.y);
   assert.ok(p.x>=5.85-1e-6,'parapet blocks lateral stairwell leap');
  }
  assert.ok(tookOff);assert.ok(maxY<1.05);assert.equal(p.y,0);
 }
}else assert.equal(LOFT_RAIL.height,.72);

const sim=new RoomSimulation('LEVEL',{random:seededRandom(97),raids:false});
const player=sim.addPlayer('human','Human');sim.start(player.id);
sim.phase='wave';sim.wave=1;sim.toSpawn=1;sim.spawnTimer=1e9;
for(const door of sim.doors){door.boards.fill(0);door.sealed=false;door.sealPending=false;}
assert.deepEqual(sim.doors.map(({id,x,z,outX,outZ})=>({id,x,z,outX,outZ})),LEVEL.doors);
assert.deepEqual(sightBoxes(sightDoors(sim.snapshot().doors)),sim.solidBoxes());
assert.equal(sim.snapshot().mapId,IS_SUPERMARKET?'supermarket':undefined);
assert.equal(hasRainShelter({x:LEVEL.halfWidth-.5,y:0,z:LEVEL.halfDepth-.5},1.75),!IS_SUPERMARKET);
assert.equal(hasRainShelter({x:LEVEL.roof.bounds.maxX+.1,y:0,z:0},1.75),false);
assert.equal(hasRainShelter({x:LEVEL.halfWidth-.5,y:LOFT.y,z:LEVEL.halfDepth-.5},1.75),!IS_SUPERMARKET);
if(IS_SUPERMARKET){assert.equal(hasRainShelter({x:6,y:-3.4,z:-8.9},1.75),true);assert.equal(hasRainShelter({x:11.2,y:-2,z:4.7},1.75),false);}
if(IS_SUPERMARKET)assert.equal(rainRoofHeight(12),6.26);
for(const entry of [...SPAWN_ENTRIES,...FAR_SPAWN_ENTRIES,...RAID_ENTRIES]){
 assert.equal(outdoors(entry),true,entry.id);
 assert.equal(sim.canOccupy({id:'probe',kind:'brute',scale:1.32},entry.x,entry.z,0,.29*1.32),true,entry.id);
}
for(const point of SUPPLY_CACHES)assert.ok(wayOut(sim,point),`companion can reach supply ${JSON.stringify(point)}`);
assert.ok(!inRect(GENERATOR,STAIR_WELL));

// Flood the actual body occupancy on each floor, with a survivor and final boss.
// Every door and rack needs a reachable approach, not just a free point.
function reachable(y,radius){
 const body={id:'flood',kind:'brute',scale:radius/.29,y};
 const step=.4,points=[],keys=new Map();
 for(let ix=0,x=-LEVEL.halfWidth+.6;x<LEVEL.halfWidth-.5;ix++,x=-LEVEL.halfWidth+.6+ix*step)
  for(let iz=0,z=-LEVEL.halfDepth+.6;z<LEVEL.halfDepth-.5;iz++,z=-LEVEL.halfDepth+.6+iz*step){
   const point={x,z};
   if(IS_SUPERMARKET&&Math.abs(spaceFloor(x,z,y)-y)>.05)continue;
   if(!IS_SUPERMARKET&&y>0&&(!inRect(point,LOFT)||inRect(point,STAIR_WELL)||x<LOFT.minX+radius+.05))continue;
   if(!sim.canOccupy(body,x,z,y,radius))continue;
   keys.set(`${ix}:${iz}`,points.length);points.push({x,z,ix,iz});
  }
 const anchor=y?(IS_SUPERMARKET?{x:6,z:-8.9}:{x:3.8,z:-2.7}):{x:0,z:2.8};
 const closest=points.reduce((best,p,i)=>flat(p,anchor)<flat(points[best],anchor)?i:best,0);
 const seen=new Set([closest]),queue=[closest];
 for(let cursor=0;cursor<queue.length;cursor++){
  const p=points[queue[cursor]];
  for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){
   const next=keys.get(`${p.ix+dx}:${p.iz+dz}`);if(next!==undefined&&!seen.has(next)){seen.add(next);queue.push(next);}
  }
 }
 return queue.map(index=>points[index]);
}
for(const radius of [.25,.29*1.32])for(const y of [0,IS_SUPERMARKET?-3.4:3.4]){
 const floor=reachable(y,radius);
 assert.ok(floor.length>100);
 for(const rack of ARMORY.filter(rack=>rack.y===y))assert.ok(floor.some(point=>flat(point,rack)<ARMORY_REACH-.1),`rack ${rack.id}, y${y}, radius${radius}`);
 const landing=IS_SUPERMARKET?(y?SPACE.flights[0].lower:SPACE.flights[0].upper):(y?{x:3.8,z:-2.7}:{x:3.8,z:3.1});
 assert.ok(floor.some(point=>flat(point,landing)<.4),`landing y${y}`);
 if(!y)for(const door of sim.doors){const approach={x:door.x-door.outX*1.1,z:door.z-door.outZ*1.1};assert.ok(floor.some(point=>flat(point,approach)<.4),`door ${door.id}`);}
}

// Actual server movement: every entrance, crawler and boss, then the stairs.
for(const targetLoft of [false,true])for(const door of sim.doors)for(const kind of ['crawler','brute']){
 sim.zombies.clear();Object.assign(player,targetLoft?(IS_SUPERMARKET?{x:6,y:-3.4,z:-8.9}:{x:12>LEVEL.halfWidth?6:LEVEL.halfWidth-2,y:3.4,z:LEVEL.halfDepth-2}):{x:-LEVEL.halfWidth+1.5,y:0,z:-1.7});
 const enemy=sim.spawnZombie();assert.ok(enemy);Object.assign(enemy,{x:door.x+door.outX*3,z:door.z+door.outZ*3,y:0,kind,scale:kind==='brute'?1.32:1,boss:kind==='brute',speed:2.2,doorId:door.id,entered:false,navigation:null,portalRoute:null,stairState:null});
 let arrived=false;
 for(let tick=0;tick<3000&&!arrived;tick++){sim.time+=DT;sim.updateZombie(enemy,DT,[player]);arrived=flat(enemy,player)<1.5&&Math.abs(enemy.y-player.y)<.3;}
 assert.ok(arrived,`${kind} from ${door.id} to ${targetLoft?'loft':'ground'} stuck ${JSON.stringify({x:enemy.x,y:enemy.y,z:enemy.z,stairState:enemy.stairState})}`);
}
sim.zombies.clear();Object.assign(player,{x:-2.8,y:0,z:1.7,hp:100});

// Server blast and client melee sight agree throughout the expanded building.
const random=seededRandom(321),between=(a,b)=>a+(b-a)*random();
for(let sample=0;sample<5000;sample++){
 const a={x:between(-LEVEL.halfWidth-3,LEVEL.halfWidth+3),y:between(IS_SUPERMARKET?-4:0,8),z:between(-LEVEL.halfDepth-3,LEVEL.halfDepth+3)};
 const b={x:between(-LEVEL.halfWidth-3,LEVEL.halfWidth+3),y:between(0,8),z:between(-LEVEL.halfDepth-3,LEVEL.halfDepth+3)};
 assert.equal(sightClear(a,b,sightDoors(sim.snapshot().doors)),sim.grenadeBlastVisible(a,b),`sight parity ${JSON.stringify({a,b})}`);
}
if(IS_SUPERMARKET){
 assert.equal(sim.grenadeBlastVisible({x:-11.5,y:1.55,z:-5},{x:-9,y:1.55,z:-5}),false,'shelves stop shots');
 assert.equal(sim.grenadeBlastVisible({x:-11,y:5.5,z:0},{x:-11,y:7,z:0}),false,'flat roof stops shots');
 for(const cover of WORLD.covers)for(const piece of cover.parts??[cover]){const top=(cover.baseY??0)+piece.height;assert.equal(restingSurface((piece.minX+piece.maxX)/2,(piece.minZ+piece.maxZ)/2,top),top,cover.id);}
}

// Human-command companion body crosses the enlarged hall, buys at new racks,
// repairs the moved entrance and reaches the unchanged stair flight.
const bot=sim.addPlayer('bot','Bot',undefined,{companion:true});
const body=createCompanionBody(sim,bot.id,{random:seededRandom(123)});
function run(seconds,until){for(let tick=0;tick<seconds*30;tick++){sim.setInput(player.id,{forward:0,strafe:0,yaw:0,pitch:0});body.tick(DT);sim.tick(DT);if(until())return true;}return false;}
Object.assign(player,{x:-LEVEL.halfWidth+2,y:0,z:-LEVEL.halfDepth+3.3});
body.setOrder({kind:'follow',playerId:player.id});
assert.ok(run(45,()=>flat(bot,player)<4.1),'companion crosses aisles');
Object.assign(bot,{x:-2.8,y:0,z:1.7});Object.assign(player,{x:0,y:0,z:4});
const west=sim.doors.find(door=>door.id==='west');west.hp=west.maxHp-30;
body.setOrder({kind:'repair',doorId:'west'});
assert.ok(run(45,()=>west.hp>=west.maxHp),'companion repairs moved doorway');west.boards.fill(0);
Object.assign(player,IS_SUPERMARKET?{x:6,y:-3.4,z:-8.9}:{x:LEVEL.halfWidth-2,y:3.4,z:LEVEL.halfDepth-2});
body.setOrder({kind:'follow',playerId:player.id});
assert.ok(run(65,()=>Math.abs(bot.y-(IS_SUPERMARKET?-3.4:3.4))<.1&&flat(bot,player)<4.1),'companion reaches expanded mezzanine');
console.log(`${LEVEL.id}: level core verified (5000 sight pairs, all door-to-floor zombie routes, boss/survivor flood, companion routes)`);
