import assert from 'node:assert/strict';
import { RoomSimulation } from '../../simulation.mjs';
import { LEVEL } from '../../public/level-config.js';
import { SPACE, spaceFloor, spaceFloorId, spaceWaypoint, spaceFlightAt, spaceCeiling } from '../../public/level-space.js';
import { hasRainShelter } from '../../public/expedition.js';
import { movementMethods, createPhysicsContext, clonePredictedPlayer, stepPredictedPlayer } from '../../public/online/physics.js';
import { decodeSave } from '../../save-game.mjs';
const DT=1/30,flat=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z),ID='0123456789abcdef';
const room=new RoomSimulation('DEPTH1',{random:()=>.5,raids:false}),p=room.addPlayer(ID,'Jules');room.start(ID);room.phase='wave';room.wave=1;room.toSpawn=100;room.spawnTimer=1e9;
for(const d of room.doors){d.boards.fill(0);d.sealed=false;d.sealPending=false;}
for(const [name,method]of Object.entries(movementMethods))assert.equal(method.toString(),RoomSimulation.prototype[name].toString(),name);
assert.equal(spaceFloor(6,-8.8,-3.4),-3.4);assert.equal(spaceFloor(4.2,-4,0)<0,true);assert.equal(spaceFloorId({x:11,y:0,z:-2}),'terrace');
assert.equal(spaceCeiling(6,-8.8,-3.4),-.24);
assert.equal(hasRainShelter({x:6,y:-3.4,z:-8.8},1.75),true);
assert.equal(hasRainShelter({x:11.2,y:-2,z:4.7},1.75),false);
assert.equal(hasRainShelter({x:11.2,y:0,z:-2},1.75),false);
for(const f of SPACE.flights)for(const down of [false,true])for(const dt of [DT,.1]){
 Object.assign(p,down?f.upper:f.lower,{vy:0,grounded:true,fallStartY:null,jumpRequested:false,jumpHeld:false,input:{forward:0,strafe:0,sprint:false,crouch:false}});
 const target=down?f.lower:f.upper,context=createPhysicsContext({time:room.time,phase:room.phase,players:[p],zombies:[],doors:room.doors}),pred=clonePredictedPlayer(p);let arrived=false;
 for(let tick=0;tick<400;tick++){
  const command={forward:1,strafe:0,yaw:down?0:Math.PI,pitch:0};room.setInput(ID,command);room.time+=dt;room.movePlayer(p,dt);stepPredictedPlayer(pred,command,dt,context);
  for(const key of ['x','y','z','vy'])assert.ok(Math.abs(p[key]-pred[key])<1e-10,`${f.id} prediction ${key} down${down} dt${dt}`);
  assert.ok(room.canOccupy(p,p.x,p.z,p.y,.25),`${f.id} valid body`);
  if(flat(p,target)<.2&&Math.abs(p.y-target.y)<.1){arrived=true;break;}
 }
 assert.ok(arrived,`${f.id} traversal down${down} dt${dt} ${JSON.stringify({x:p.x,y:p.y,z:p.z})}`);
}
// Solid risers are not overhead ceilings: release crouch midway on either flight.
for(const f of SPACE.flights){Object.assign(p,{x:(f.minX+f.maxX)/2,z:(f.minZ+f.maxZ)/2,y:-1.7,crouched:true,grounded:true,vy:0,input:{forward:0,strafe:0,sprint:false,crouch:false}});room.setInput(ID,{forward:0,strafe:0,yaw:0,pitch:0,crouch:false});room.time+=DT;room.movePlayer(p,DT);assert.equal(p.crouched,false,f.id+' crouch released');}
// A planter used to launch a fast survivor over the parapet, where gravity
// put them inside its solid retaining cheek. Both planter locations now keep
// every landing legal, even when jumping straight at the nearest stair corner.
for(const planter of LEVEL.furniture.filter(f=>f.kind==='planter')){
 const x=(planter.minX+planter.maxX)/2,z=planter.maxZ-.1;
 const target={x:Math.max(10,Math.min(12.4,x)),z:2};const dx=target.x-x,dz=target.z-z;
 Object.assign(p,{x,y:planter.height,z,grounded:true,vy:0,crouched:false,bonus:{vitamins:8},jumpHeld:false,jumpRequested:false,fallStartY:null});
 for(let tick=0;tick<140;tick++){
  room.setInput(ID,{forward:1,strafe:0,yaw:Math.atan2(-dx,-dz),pitch:0,sprint:true,jump:tick===0});room.time+=DT;room.movePlayer(p,DT);
  assert.ok(room.canOccupy(p,p.x,p.z,p.y,.25),planter.id+' jumping body never trapped in stair guard');
  assert.ok(p.y<1.05||!SPACE.rails.some(r=>p.x>=r.minX&&p.x<=r.maxX&&p.z>=r.minZ&&p.z<=r.maxZ),'no crawler-proof parapet perch');
 }
 assert.ok(!SPACE.rails.some(r=>Math.abs(p.y-(r.baseY+r.height))<.01),'no parapet support perch');
}
p.bonus=null;
for(const planter of LEVEL.furniture.filter(f=>f.kind==='planter')){
 room.zombies.clear();Object.assign(p,{x:(planter.minX+planter.maxX)/2,y:planter.height,z:(planter.minZ+planter.maxZ)/2,hp:100,armor:0,downed:false,alive:true,reviveShieldUntil:0});
 const e=room.spawnZombie();Object.assign(e,{x:planter.minX>12?planter.minX-.32:planter.maxX+.32,y:0,z:p.z,kind:'crawler',boss:false,scale:1,speed:2.2,attackAfter:0});
 assert.ok(room.canOccupy(e,e.x,e.z,e.y,.29),'crawler can approach planter');room.updateZombie(e,DT,[p]);assert.ok(p.hp<100,'planter is within crawler bite height');
}
room.zombies.clear();Object.assign(p,{hp:100,downed:false,alive:true});
// Every entrance must route all the way down, including a large final boss.
for(const kind of ['crawler','brute'])for(const door of room.doors){
 room.zombies.clear();Object.assign(p,{x:6,y:-3.4,z:-8.9});const e=room.spawnZombie();Object.assign(e,{x:door.x+door.outX*3,z:door.z+door.outZ*3,y:0,kind,scale:kind==='brute'?1.32:1,boss:kind==='brute',speed:2.2,entered:false,doorId:door.id,navigation:null,portalRoute:null});let arrived=false;
 for(let tick=0;tick<2500;tick++){room.time+=DT;room.updateZombie(e,DT,[p]);if(flat(e,p)<1.5&&Math.abs(e.y-p.y)<.3){arrived=true;break;}}
 assert.ok(arrived,`${kind}/${door.id} basement route ${JSON.stringify({x:e.x,y:e.y,z:e.z})}`);
}
// Each flight is usable upwards by enemies too; the exterior is not an
// unreachable safe terrace. Keep the destination on the same flight axis.
for(const f of SPACE.flights){room.zombies.clear();Object.assign(p,{...f.upper,z:f.upper.z+.3});const e=room.spawnZombie();Object.assign(e,{...f.lower,kind:'brute',scale:1.32,boss:true,speed:2.2,entered:true,navigation:null,portalRoute:null});let arrived=false;for(let tick=0;tick<1000;tick++){room.time+=DT;room.updateZombie(e,DT,[p]);if(flat(e,p)<1.5&&Math.abs(e.y-p.y)<.3){arrived=true;break;}}assert.ok(arrived,`${f.id} boss ascends ${JSON.stringify(e)}`);}
room.zombies.clear();Object.assign(p,{x:6,y:-3.4,z:0,yaw:0,hp:100,grounded:true});
const a={x:6,y:-1.85,z:0},b={x:6,y:1.55,z:0};
assert.equal(room.grenadeBlastVisible(a,b),false,'dalle blocks shots and blast between floors');
assert.equal(room.grenadeBlastVisible({x:6,y:-1.85,z:0},{x:9,y:-1.85,z:0}),true,'basement corridor clear');
assert.equal(room.grenadeBlastVisible({x:6,y:1.55,z:0},{x:9,y:1.55,z:0}),true,'terrace passage clear');
assert.ok(room.bulletWorldCollision(a,{x:0,y:4,z:0}).fraction<1,'bullet hits real ground-floor slab');
const floor=room.grenadeCollision({x:6,y:-2,z:0},{x:0,y:-2,z:0},.1);assert.ok(floor&&Math.abs(floor.fraction-.65)<1e-8,'grenade lands at cellar floor rather than y0');
assert.equal(room.grenadeCollision({x:6,y:-1.7,z:0},{x:.5,y:0,z:0},0),null,'grenade can travel horizontally inside cellar');
const drop=room.groundWeaponPosition(p);assert.ok(drop&&drop.y===-3.4,'weapon drop stays in cave');
room.pickups.clear();room.dropZombieLoot({id:'z999',kind:'walker',x:6,y:-3.4,z:0},18);assert.ok([...room.pickups.values()].every(item=>item.y===-3.4),'loot remains in cave');
const east=room.doors.find(d=>d.id==='east');east.boards[0]=0;Object.assign(p,{x:12.8,y:-3.4,z:0,interactAfter:0});assert.equal(room.repairDoor(ID,'east'),false,'cannot repair through the floor');
Object.assign(p,{x:6,y:-3.4,z:-8.9,fallStartY:-3.4});room.paused=true;const save=room.exportSave();assert.equal(save.spaceId,'supermarket-depth');const decoded=decodeSave(JSON.parse(JSON.stringify(save)));assert.equal(decoded.players[0].record.y,-3.4);assert.equal(decoded.players[0].record.fallStartY,-3.4);
const old=structuredClone(save);delete old.spaceId;assert.throws(()=>decodeSave(old),error=>error.reason==='map'||error.code==='map'||error.message.includes('map'));
console.log('supermarket depth physics verified: 8 player/prediction flights, 8 door-to-cellar routes, 2 boss ascents, projectiles, loot, rain, saves');
