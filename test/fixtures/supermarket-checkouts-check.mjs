import assert from 'node:assert/strict';
import { RoomSimulation, navigationObstacles } from '../../simulation.mjs';
import { LEVEL, IS_SUPERMARKET } from '../../public/level-config.js';
import { SPACE } from '../../public/level-space.js';
import { ARMORY, ARMORY_REACH } from '../../public/rules.js';
import { hasRainShelter } from '../../public/expedition.js';
import { restingSurface } from '../../public/frisson/blood-floor.js';
import { movementMethods, createPhysicsContext, clonePredictedPlayer, stepPredictedPlayer } from '../../public/online/physics.js';
import { createCompanionBody } from '../../companions/body.mjs';
import { seededRandom } from '../../validation/balance-report.mjs';
const DT=1/30, flat=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z), HOST='0123456789abcdef';
const json=value=>JSON.parse(JSON.stringify(value));
const gap=(point,box)=>Math.hypot(Math.max(0,Math.max(box.minX-point.x,point.x-box.maxX)),Math.max(0,Math.max(box.minZ-point.z,point.z-box.maxZ)));
const inBox=(point,box,radius=0)=>point.x>=box.minX-radius&&point.x<=box.maxX+radius&&point.z>=box.minZ-radius&&point.z<=box.maxZ+radius;
const centre=box=>({x:(box.minX+box.maxX)/2,z:(box.minZ+box.maxZ)/2});
assert.equal(IS_SUPERMARKET,true,'fixture runs the supermarket level');

// Three parallel checkout counters run along Z, with 1.2 m lanes along X.
const COUNTERS=LEVEL.furniture.filter(f=>f.kind==='checkout');
assert.deepEqual(COUNTERS.map(c=>c.id),['checkout-02','checkout-03'],'two checkout counters');
assert.equal(LEVEL.furniture.at(-2),COUNTERS[0]);assert.equal(LEVEL.furniture.at(-1),COUNTERS[1],'appended at the end');
const ROW=[LEVEL.table,...COUNTERS],inCounter=(point,radius=0)=>ROW.some(c=>inBox(point,c,radius));
for(const c of ROW){
 assert.ok(Math.abs(c.maxX-c.minX-.85)<1e-9&&Math.abs(c.maxZ-c.minZ-1.8)<1e-9,`${c.id} is 0.85 m wide and long along Z`);
 assert.equal(c.minZ,LEVEL.table.minZ);assert.equal(c.maxZ,LEVEL.table.maxZ);
}
for(let i=1;i<ROW.length;i++)assert.ok(Math.abs(ROW[i].minX-ROW[i-1].maxX-1.2)<1e-9,'1.2 m lanes');
const lanes=ROW.slice(1).map((c,i)=>({id:`lane ${ROW[i].id}/${c.id}`,x:(ROW[i].maxX+c.minX)/2,z:(centre(ROW[i]).z+centre(c).z)/2}));
const south=LEVEL.doors.find(d=>d.id==='south'),southWall=10.865;

// Interior navigation sees all three counters among the obstacles.
const interior=navigationObstacles(0);
for(const c of ROW)assert.ok(interior.includes(c),`interior navigation contains ${c.id}`);

function setup(code){
 const room=new RoomSimulation(code,{random:()=>.5,raids:false});
 const p=room.addPlayer(HOST,'Jules');room.start(HOST);
 Object.assign(room,{phase:'wave',wave:1,toSpawn:100,spawnTimer:1e9});
 for(const d of room.doors){d.boards.fill(0);d.sealed=false;d.sealPending=false;}
 return {room,p};
}

// A player pushed along +Z into checkout-02 is blocked identically by the
// server and client prediction; every counter top remains standable.
{
 const {room,p}=setup('CKPHYS'),c=COUNTERS[0],start={...centre(c),z:c.minZ-.6};
 for(const [name,method]of Object.entries(movementMethods))assert.equal(method.toString(),RoomSimulation.prototype[name].toString(),name);
 Object.assign(p,{...start,y:0,vy:0,grounded:true,crouched:false,fallStartY:null,jumpRequested:false,jumpHeld:false,input:{forward:0,strafe:0,sprint:false,crouch:false}});
 const context=createPhysicsContext({time:room.time,phase:room.phase,players:[p],zombies:[],doors:room.doors}),pred=clonePredictedPlayer(p);
 for(let tick=0;tick<300;tick++){
  const command={forward:1,strafe:0,yaw:Math.PI,pitch:0,sprint:true};
  room.setInput(HOST,command);room.time+=DT;room.movePlayer(p,DT);stepPredictedPlayer(pred,command,DT,context);
  for(const key of ['x','y','z','vy'])assert.ok(Math.abs(p[key]-pred[key])<1e-10,`prediction ${key} matches the server`);
  assert.ok(!inCounter(p,.24),'player body never enters a counter');
 }
 assert.ok(Math.abs(p.z-(c.minZ-.25))<.07,`player stopped at checkout-02 north end z=${p.z.toFixed(3)}, expected ${(c.minZ-.25).toFixed(3)} within one movement step`);
 for(const cover of ROW){
  const {x:cx,z:cz}=centre(cover);
  assert.equal(room.canOccupy(p,cx,cz,0,.25),false,`${cover.id} blocks a body at ground level`);
  assert.equal(room.canOccupy(p,cx,cz,cover.height,.25),true,`${cover.id} top is standable like the existing table`);
 }
}

// From the south door, every profile reaches both lanes, both outer sides and
// the south-end gap behind every counter: no overlap or 3 s without progress.
const targets=[
 ...lanes.map(lane=>({name:lane.id,x:lane.x,z:lane.z})),
 {name:'west of the table',x:LEVEL.table.minX-.45,z:centre(LEVEL.table).z},
 {name:'east of checkout-03',x:COUNTERS[1].maxX+.45,z:centre(COUNTERS[1]).z},
 ...ROW.map(c=>({name:`south-end gap behind ${c.id}`,x:centre(c).x,z:(c.maxZ+southWall)/2})),
];
for(const target of targets)for(const profile of [
 {name:'walker',kind:'walker',boss:false,scale:1},
 {name:'crawler',kind:'crawler',boss:false,scale:1},
 {name:'colossus',kind:'brute',boss:true,scale:1.32},
]){
 const {room,p}=setup('CKNAV');Object.assign(p,{x:target.x,y:0,z:target.z});
 const e=room.spawnZombie();
 Object.assign(e,{x:south.x,z:south.z+.75,y:0,kind:profile.kind,boss:profile.boss,scale:profile.scale,speed:2.2,entered:false,doorId:'south',navigation:null,portalRoute:null});
 const radius=.29*e.scale;
 let best=Infinity,improvedAt=0,arrived=false;const hp0=p.hp;let hp=hp0;
 for(let tick=0;tick<30*60;tick++){
  room.time+=DT;room.updateZombie(e,DT,[p]);
  assert.ok(!inCounter(e,radius-.02),`${profile.name} to ${target.name} never inside a counter (${e.x.toFixed(2)},${e.z.toFixed(2)})`);
  const d=flat(e,p);
  if(d<best-.02){best=d;improvedAt=tick;}
  if(p.hp<hp){hp=p.hp;improvedAt=tick;}
  assert.ok(tick-improvedAt<=90,`${profile.name} to ${target.name} stuck ${((tick-improvedAt)/30).toFixed(1)} s without progress at (${e.x.toFixed(2)},${e.z.toFixed(2)})`);
  if(p.hp<hp0||d<.95){arrived=true;break;}
 }
 assert.ok(arrived,`${profile.name} through the south door reaches ${target.name} (best ${best.toFixed(2)} m)`);
}

// A companion walks from the south doorway to the bat rack and to the
// minigun rack and back without touching a counter.
{
 const events=[],sim=new RoomSimulation('CKBOT',{random:seededRandom(18),raids:false,onEvent:e=>events.push(e)});
 const papa=sim.addPlayer('papa','Papa'),bot=sim.addPlayer('bot','Max',undefined,{companion:true});
 sim.start(papa.id);Object.assign(sim,{phase:'wave',wave:12,toSpawn:1,spawnTimer:1e9});
 for(const d of sim.doors){d.boards.fill(0);d.sealed=false;d.sealPending=false;}
 Object.assign(papa,{x:1,y:0,z:0,grounded:true,vy:0});
 Object.assign(bot,{x:south.x,y:0,z:south.z-.7,grounded:true,vy:0});bot.points=20000;
 const body=createCompanionBody(sim,bot.id,{random:seededRandom(88)});
 const run=(seconds,until)=>{
  for(let tick=0;tick<seconds*30;tick++){
   sim.setInput(papa.id,{forward:0,strafe:0,yaw:0,pitch:0});body.tick(DT);sim.tick(DT);
   assert.ok(!inCounter(bot,.2),`companion never inside a counter (${bot.x.toFixed(2)},${bot.z.toFixed(2)})`);
   if(until())return true;
  }return false;
 };
 const bat=ARMORY.find(r=>r.weapon==='bat'),minigun=ARMORY.find(r=>r.weapon==='minigun');
 body.setOrder({kind:'buy',rackId:bat.id});
 assert.ok(run(25,()=>flat(bot,bat)<ARMORY_REACH),'reaches the bat rack: '+JSON.stringify({x:bot.x,z:bot.z,status:body.status}));
 body.setOrder({kind:'buy',rackId:minigun.id});
 assert.ok(run(25,()=>flat(bot,minigun)<ARMORY_REACH),'reaches the minigun rack: '+JSON.stringify({x:bot.x,z:bot.z,status:body.status}));
 Object.assign(papa,{x:south.x,y:0,z:south.z-.7,grounded:true,vy:0});
 body.setOrder({kind:'follow',playerId:papa.id});
 assert.ok(run(25,()=>flat(bot,papa)<3.5),'walks back to the south doorway: '+JSON.stringify({x:bot.x,z:bot.z,status:body.status}));
}

// Every scripted interior point keeps at least 1 m from all three counters,
// and the south doorway stays walkable and repairable from inside.
{
 const scripted=[
  ...ARMORY.flatMap(r=>[{name:`rack ${r.id}`,x:r.x,z:r.z},{name:`rack ${r.id} stand`,x:r.x+Math.sin(r.facing??0)*.95,z:r.z+Math.cos(r.facing??0)*.95}]),
  {name:'late supply post',x:LEVEL.lateSupplyPosition.x,z:LEVEL.lateSupplyPosition.z},
  {name:'generator',x:LEVEL.generator.x,z:LEVEL.generator.z},
  {name:'refuge',x:SPACE.refuge.x,z:SPACE.refuge.z},
  {name:'watch',x:SPACE.watch.x,z:SPACE.watch.z},
  ...LEVEL.doors.map(d=>({name:`doorstep ${d.id}`,x:d.x+d.outX*.75,z:d.z+d.outZ*.75})),
  ...[1.7,2.7,.7,3.7,-.3].flatMap(z=>[-2.8,-1.7,-.6,.5,-3.9,-5,1.6].map(x=>({name:`admit ${x}/${z}`,x,z}))),
 ];
 for(const point of scripted)for(const c of ROW)
  assert.ok(gap(point,c)>=1-1e-9,`${point.name} is ${gap(point,c).toFixed(2)} m from ${c.id}`);
 const {room,p}=setup('CKDOOR');
 Object.assign(p,{x:south.x,y:0,z:south.z-1.4,grounded:true,vy:0});
 for(const offset of [-.8,0,.8])assert.ok(room.canOccupy(p,south.x,south.z+offset,0,.25),`south doorway z=${south.z+offset} stays walkable`);
 const door=room.doors.find(d=>d.id==='south');
 assert.ok(room.repairDoor(HOST,'south'),'the south barricade is repairable from inside next to the counters');
 assert.ok(door.boards.some(hp=>hp>0),'repair restored boards');
}

// Ballistics and blood: a bullet and a grenade stop on a counter, a high
// bullet sails over, blood rests on each top, the shop roof still shelters.
{
 const {room}=setup('CKBAL'),c=COUNTERS[0],start={...centre(c),z:c.minZ-.6},cx=start.x;
 const shot=room.bulletWorldCollision({...start,y:.5},{x:0,y:0,z:5});
 assert.ok(Math.abs(shot.fraction-(c.minZ-start.z)/5)<.02,`bullet stops on checkout-02 (fraction ${shot.fraction})`);
 const high=room.bulletWorldCollision({...start,y:1.2},{x:0,y:0,z:5});
 assert.ok(high.fraction>shot.fraction+.1,'a bullet above the counter sails on');
 const grenade=room.grenadeCollision({...start,y:.5},{x:0,y:0,z:6},.1);
 assert.ok(grenade&&start.z+6*grenade.fraction<=c.minZ-.1+1e-6,`grenade stops outside checkout-02 at z=${(start.z+6*grenade.fraction).toFixed(3)}`);
 for(const cover of ROW){const {x,z}=centre(cover);assert.equal(restingSurface(x,z,1),cover.height,`blood rests on ${cover.id}'s top`);}
 assert.equal(hasRainShelter({x:cx,y:0,z:centre(c).z},1.75),true,'the shop roof still shelters the checkout row');
}

// A save holding a player, a zombie and a pickup inside three different
// counters evicts them inside the shop; a survivor atop a counter is left alone.
{
 const from=new RoomSimulation('CKSAV',{random:()=>.5,raids:false});
 const p=from.addPlayer(HOST,'Jules'),atop=from.addPlayer('fedcba9876543210','Inès');
 from.start(HOST);
 Object.assign(from,{phase:'wave',wave:3,toSpawn:100,spawnTimer:1e9,paused:true,pauseById:HOST});
 for(const d of from.doors){d.boards.fill(0);d.sealed=false;d.sealPending=false;}
 const playerAt=centre(COUNTERS[0]),atopAt=centre(COUNTERS[0]),zombieAt=centre(COUNTERS[1]),pickupAt=centre(LEVEL.table);
 Object.assign(p,{...playerAt,y:0});
 Object.assign(atop,{...atopAt,y:COUNTERS[0].height});
 const zombie=from.spawnZombie();Object.assign(zombie,{...zombieAt,y:0});
 from.pickups.set('p7',{id:'p7',kind:'ammo',...pickupAt,y:0,amount:1,special:false,expiresAt:1e9,charge:780});
 const file=json(from.exportSave());
 const lobby=new RoomSimulation('CKSAV2',{random:()=>.5,raids:false});lobby.addPlayer(HOST,'Jules');
 const result=lobby.importSave(file,HOST);
 assert.equal(result.ok,true,`import refused: ${result.reason}`);
 const insideShop=entity=>Math.abs(entity.x)<=LEVEL.insideBounds.maxX&&Math.abs(entity.z)<=LEVEL.insideBounds.maxZ;
 const restored=lobby.players.get(HOST);
 assert.ok(!inCounter(restored,.25)&&lobby.canOccupy(restored,restored.x,restored.z,restored.y,.25),`player restored to a free spot (${restored.x.toFixed(2)},${restored.z.toFixed(2)})`);
 assert.ok(insideShop(restored),'player eviction never crosses a wall');
 const body=lobby.zombies.get(zombie.id),radius=.29*(body?.scale??1);
 assert.ok(body&&!inCounter(body,radius)&&lobby.canOccupy(body,body.x,body.z,body.y,radius),`zombie restored to a free spot (${body?.x.toFixed(2)},${body?.z.toFixed(2)})`);
 assert.ok(insideShop(body),'zombie eviction never crosses a wall');
 const item=lobby.pickups.get('p7');
 assert.ok(item&&!inCounter(item,.25)&&!lobby.solidBoxes().some(box=>inBox(item,box,.25)&&0<box.maxY&&.5>box.minY),`item restored outside every solid box (${item?.x.toFixed(2)},${item?.z.toFixed(2)})`);
 assert.ok(insideShop(item),'item eviction never crosses a wall');
 const seat=lobby.reservedSeats.get('fedcba9876543210')??lobby.players.get('fedcba9876543210')??[...lobby.reservedSeats.values()].find(s=>s.name==='Inès');
 assert.ok(seat&&seat.x===atopAt.x&&seat.y===COUNTERS[0].height&&seat.z===atopAt.z,'a survivor standing on a counter is not evicted');
}
console.log('supermarket checkout row verified: navigation, prediction parity, 21 zombie routes, companion rack walks, clearances, doorway repair, ballistics and blood, save restore');
