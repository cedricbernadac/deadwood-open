import assert from 'node:assert/strict';
import { RoomSimulation, navigationObstacles } from '../../simulation.mjs';
import { LEVEL, IS_SUPERMARKET } from '../../public/level-config.js';
import { SPACE, spaceCanOccupy, spaceInRect } from '../../public/level-space.js';
import { SPAWN_ENTRIES, FAR_SPAWN_ENTRIES, FUEL_CACHES, SUPPLY_CACHES, hasRainShelter } from '../../public/expedition.js';
import { RAID_ENTRIES } from '../../public/raids.js';
import { enemyProfile } from '../../public/enemies.js';
import { movementMethods, createPhysicsContext, clonePredictedPlayer, stepPredictedPlayer } from '../../public/online/physics.js';
import { createCompanionBody } from '../../companions/body.mjs';
import { seededRandom } from '../../validation/balance-report.mjs';
const DT=1/30, flat=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z), HOST='0123456789abcdef';
const json=value=>JSON.parse(JSON.stringify(value));
const gap=(point,prop)=>Math.hypot(Math.max(0,Math.max(prop.minX-point.x,point.x-prop.maxX)),Math.max(0,Math.max(prop.minZ-point.z,point.z-prop.maxZ)));
const insideProp=(point,radius=0)=>SPACE.props.some(prop=>spaceInRect(point.x,point.z,prop,radius));
const doorstep=door=>({x:door.x+door.outX*.75,z:door.z+door.outZ*.75});
assert.equal(IS_SUPERMARKET,true,'fixture runs the supermarket level');
assert.equal(SPACE.props.length,10,'ten parking props');

// The supermarket exterior graph knows the building and every prop.
const exterior=navigationObstacles(0,true);
assert.equal(exterior.length,1+SPACE.props.length,'exterior obstacles: building plus every prop');
assert.ok(SPACE.props.every(prop=>exterior.includes(prop)),'every prop is an exterior obstacle');

// Every scripted point keeps at least 2 m from every prop.
const scripted=[
 ...SPAWN_ENTRIES.map(e=>({name:`spawn entry ${e.id}`,...e})),
 ...RAID_ENTRIES.map(e=>({name:`raid entry ${e.id}`,...e})),
 ...FAR_SPAWN_ENTRIES.map(e=>({name:`far spawn entry ${e.id}`,...e})),
 ...SUPPLY_CACHES.map((c,i)=>({name:`supply cache ${i}`,...c})),
 ...FUEL_CACHES.map((c,i)=>({name:`fuel cache ${i}`,...c})),
];
function setup(code='PROPS1'){
 const room=new RoomSimulation(code,{random:()=>.5,raids:false});
 const p=room.addPlayer(HOST,'Jules');room.start(HOST);
 Object.assign(room,{phase:'wave',wave:1,toSpawn:100,spawnTimer:1e9});
 for(const d of room.doors){d.boards.fill(0);d.sealed=false;d.sealPending=false;}
 return {room,p};
}
{
 const {room}=setup();
 for(const door of room.doors)scripted.push({name:`doorstep ${door.id}`,...doorstep(door)});
 for(const point of scripted)for(const prop of SPACE.props)
  assert.ok(gap(point,prop)>=2,`${point.name} is ${gap(point,prop).toFixed(2)} m from ${prop.id}`);
 // Raider staging points (door + out x 7.5, squad offsets -3/0/+3) stay legal.
 for(const door of room.doors)for(const offset of [-3,0,3]){
  const point={x:door.x+door.outX*7.5+(door.outZ?offset:0),z:door.z+door.outZ*7.5+(door.outX?offset:0)};
  assert.ok(spaceCanOccupy(point.x,point.z,0,enemyProfile({kind:'raider'}).height,.29),`staging ${door.id}/${offset} clear of props`);
 }
 // The whole createZombie/safeSpawnPosition jitter grid stays clear of props.
 for(const entry of SPAWN_ENTRIES){
  const door=room.doors.find(d=>d.id===entry.doorId);
  for(const depth of [0,.8,1.6,2.4,3.2,4])for(const lateral of [0,.75,-.75,1.5,-1.5,2.25,-2.25]){
   const point={x:entry.x+door.outX*depth+Math.abs(door.outZ)*lateral,z:entry.z+door.outZ*depth+Math.abs(door.outX)*lateral};
   assert.ok(spaceCanOccupy(point.x,point.z,0,1.82,.29),`spawn jitter ${entry.id} ${depth}/${lateral} clear of props`);
  }
 }
}

// From every entry, each profile reaches its door's doorstep: no prop
// overlap, never more than 3 simulated seconds without progress.
for(const entry of [...SPAWN_ENTRIES,...RAID_ENTRIES,...FAR_SPAWN_ENTRIES])for(const profile of [
 {name:'walker',kind:'walker',boss:false,scale:1},
 {name:'crawler',kind:'crawler',boss:false,scale:1},
 {name:'colossus',kind:'brute',boss:true,scale:1.32},
]){
 const {room,p}=setup('PROPSR');Object.assign(p,{x:2,y:0,z:0});
 const door=room.doors.find(d=>d.id===entry.doorId),step=doorstep(door);
 const e=room.spawnZombie();
 Object.assign(e,{x:entry.x,z:entry.z,y:0,kind:profile.kind,boss:profile.boss,scale:profile.scale,speed:2.2,entered:false,doorId:entry.doorId,navigation:null,portalRoute:null});
 const height=enemyProfile(e).height*e.scale,radius=.29*e.scale;
 let best=Infinity,improvedAt=0,arrived=false;
 for(let tick=0;tick<30*200;tick++){
  room.time+=DT;room.updateZombie(e,DT,[p]);
  assert.ok(spaceCanOccupy(e.x,e.z,e.y,height,radius),`${profile.name} from ${entry.id} never inside a prop (${e.x.toFixed(2)},${e.z.toFixed(2)})`);
  const d=flat(e,step);
  if(d<best-.02){best=d;improvedAt=tick;}
  assert.ok(tick-improvedAt<=90,`${profile.name} from ${entry.id} stuck ${((tick-improvedAt)/30).toFixed(1)} s without progress at (${e.x.toFixed(2)},${e.z.toFixed(2)})`);
  if(d<.9||e.entered){arrived=true;break;}
 }
 assert.ok(arrived,`${profile.name} from ${entry.id} reaches the ${door.id} doorstep (best ${best.toFixed(2)} m)`);
}

// A raider walks outside around the west car without touching a prop, and its
// strafe never ends inside one.
{
 const {room}=setup('PROPSR2');
 const south=room.doors.find(d=>d.id==='south'),plan={index:1,damageScale:1},raidEntry=RAID_ENTRIES.find(e=>e.doorId==='south');
 const raider=room.createRaider(1,raidEntry,plan,{door:south,point:{x:-4,z:26}});
 room.zombies.set(raider.id,raider);
 const target={x:-16,z:15.2};let arrived=false;
 for(let tick=0;tick<30*40;tick++){
  room.time+=DT;room.moveZombieTowards(raider,target,DT);
  assert.ok(spaceCanOccupy(raider.x,raider.z,raider.y,enemyProfile(raider).height,.29),`raider never inside a prop (${raider.x.toFixed(2)},${raider.z.toFixed(2)})`);
  if(flat(raider,target)<.3){arrived=true;break;}
 }
 assert.ok(arrived,`raider rounds the car to (${target.x},${target.z})`);
 // First choice +1.5 m along the facade lands inside prop-car-east: skipped.
 const strafing=room.createRaider(3,raidEntry,plan,{door:south,point:{x:10,z:18.9}});
 assert.equal(room.raiderStartStrafe(strafing),true,'a strafe is available');
 assert.ok(Math.abs(strafing.ai.strafeX-8.5)<1e-9&&Math.abs(strafing.ai.strafeZ-18.9)<1e-9,`strafe skips the point inside prop-car-east: ${strafing.ai.strafeX},${strafing.ai.strafeZ}`);
 assert.ok(!insideProp({x:strafing.ai.strafeX,z:strafing.ai.strafeZ},.29),'strafe target outside every prop');
}

// A companion sent for ammo beyond the trolley corral detours around the
// props, never overlaps one and comes back with it.
{
 const events=[],sim=new RoomSimulation('PROPSBOT',{random:seededRandom(18),raids:false,onEvent:e=>events.push(e)});
 const papa=sim.addPlayer('papa','Papa'),bot=sim.addPlayer('bot','Max',undefined,{companion:true});
 sim.start(papa.id);Object.assign(sim,{phase:'wave',wave:8,toSpawn:1,spawnTimer:1e9});
 for(const d of sim.doors){d.boards.fill(0);d.sealed=false;d.sealPending=false;}
 Object.assign(papa,{x:-12,y:0,z:-5,grounded:true,vy:0});
 Object.assign(bot,{x:1,y:0,z:0,grounded:true,vy:0});
 const body=createCompanionBody(sim,bot.id,{random:seededRandom(88)});
 const pickup={id:'lot-ammo',kind:'ammo',x:-11.5,y:0,z:14.8,amount:1,special:false,expiresAt:sim.time+120,charge:780};
 assert.ok(!insideProp(pickup,.25)&&spaceCanOccupy(pickup.x,pickup.z,0,.5,.25),'the pickup itself is clear of props');
 bot.inventory.pistol.reserve=0;sim.pickups.set(pickup.id,pickup);
 body.setOrder({kind:'collect',pickupId:pickup.id});
 let outside=false,collected=false;
 for(let tick=0;tick<30*40;tick++){
  sim.setInput(papa.id,{forward:0,strafe:0,yaw:0,pitch:0});
  body.tick(DT);sim.tick(DT);
  assert.ok(spaceCanOccupy(bot.x,bot.z,bot.y,1.75,.25),`companion never inside a prop (${bot.x.toFixed(2)},${bot.z.toFixed(2)})`);
  if(Math.abs(bot.x)>14||Math.abs(bot.z)>11)outside=true;
  if(!sim.pickups.has(pickup.id)){collected=true;break;}
 }
 assert.ok(outside,'companion went outside onto the parking');
 assert.ok(collected,`companion collects the ammo beyond the corral (${bot.x.toFixed(2)},${bot.z.toFixed(2)})`);
}

// A player pushed into the west car is blocked identically by the server and
// by client prediction.
{
 const {room,p}=setup('PROPSP');
 for(const [name,method]of Object.entries(movementMethods))assert.equal(method.toString(),RoomSimulation.prototype[name].toString(),name);
 Object.assign(p,{x:-11,y:0,z:16.5,vy:0,grounded:true,crouched:false,fallStartY:null,jumpRequested:false,jumpHeld:false,input:{forward:0,strafe:0,sprint:false,crouch:false}});
 const context=createPhysicsContext({time:room.time,phase:room.phase,players:[p],zombies:[],doors:room.doors}),pred=clonePredictedPlayer(p);
 for(let tick=0;tick<300;tick++){
  const command={forward:1,strafe:0,yaw:Math.PI,pitch:0,sprint:true};
  room.setInput(HOST,command);room.time+=DT;room.movePlayer(p,DT);stepPredictedPlayer(pred,command,DT,context);
  for(const key of ['x','y','z','vy'])assert.ok(Math.abs(p[key]-pred[key])<1e-10,`prediction ${key} matches the server`);
  assert.ok(spaceCanOccupy(p.x,p.z,p.y,1.75,.25),'player body stays legal against the car');
 }
 const car=SPACE.props.find(prop=>prop.id==='prop-car-west');
 assert.ok(p.z<=car.minZ-.25+1e-6&&p.z>17,`player stopped against the car at z=${p.z.toFixed(3)}`);
}

// A bullet fired through the west car stops on it; a grenade never enters it.
{
 const {room}=setup('PROPSG');
 const car=SPACE.props.find(prop=>prop.id==='prop-car-west');
 const shot=room.bulletWorldCollision({x:-16,y:1,z:20.2},{x:10,y:0,z:0});
 assert.ok(Math.abs(shot.fraction-(car.minX+16)/10)<.02,`bullet stops on the car flank (fraction ${shot.fraction})`);
 const high=room.bulletWorldCollision({x:-16,y:2,z:20.2},{x:10,y:0,z:0});
 assert.ok(high.fraction>1,'a bullet above the car sails on');
 const grenade=room.grenadeCollision({x:-16,y:1,z:20.2},{x:8,y:0,z:0},.1);
 assert.ok(grenade&&-16+8*grenade.fraction<=car.minX-.1+1e-6,`grenade stops outside the car at x=${(-16+8*grenade.fraction).toFixed(3)}`);
}

// Loot from a body dying against a car lands outside the prop.
{
 const {room}=setup('PROPSL');
 room.pickups.clear();room.lootKills=0;
 room.dropZombieLoot({id:'z-loot',kind:'walker',x:-11,y:0,z:20.2},18);
 assert.ok(room.pickups.size>0,'loot dropped');
 for(const item of room.pickups.values())assert.ok(!insideProp(item,.05)&&spaceCanOccupy(item.x,item.z,0,.5,.25),`loot ${item.id} rests outside every prop`);
}

// A save holding a player, a zombie and an item inside props restores them to
// free spots.
{
 const saved=setup('PROPSS');const {room:from,p}=saved;
 Object.assign(from,{wave:3,paused:true,pauseById:HOST});
 Object.assign(p,{x:-11,y:0,z:20.2});
 const zombie=from.spawnZombie();Object.assign(zombie,{x:11,y:0,z:-15.6});
 from.pickups.set('p7',{id:'p7',kind:'ammo',x:11.2,y:0,z:19.6,amount:1,special:false,expiresAt:1e9,charge:780});
 const file=json(from.exportSave());
 const lobby=new RoomSimulation('PROPSL2',{random:()=>.5,raids:false});lobby.addPlayer(HOST,'Jules');
 const result=lobby.importSave(file,HOST);
 assert.equal(result.ok,true,`import refused: ${result.reason}`);
 const restored=lobby.players.get(HOST);
 assert.ok(!insideProp(restored,.25)&&spaceCanOccupy(restored.x,restored.z,restored.y,1.75,.25),`player restored outside props (${restored.x.toFixed(2)},${restored.z.toFixed(2)})`);
 const item=lobby.pickups.get('p7');
 assert.ok(item&&!insideProp(item,.25)&&spaceCanOccupy(item.x,item.z,0,.5,.25),`item restored outside props (${item?.x.toFixed(2)},${item?.z.toFixed(2)})`);
 const body=lobby.zombies.get(zombie.id);
 assert.ok(body&&!insideProp(body,.29)&&spaceCanOccupy(body.x,body.z,body.y,enemyProfile(body).height*(body.scale??1),.29*(body.scale??1)),`zombie restored outside props (${body?.x.toFixed(2)},${body?.z.toFixed(2)})`);
}

// Props are not roofs: the parking stays exposed to the rain.
assert.equal(hasRainShelter({x:-11,y:0,z:20.2},1.75),false,'no shelter inside the west car');
assert.equal(hasRainShelter({x:11,y:2.4,z:-15.6},1.75),false,'no shelter on the van roof');
assert.equal(hasRainShelter({x:0,y:0,z:0},1.75),true,'the sales roof still shelters');
console.log('supermarket parking props verified: clearances, 54 entry routes, raider and companion detours, prediction parity, bullet and grenade, loot, save restore, rain');
