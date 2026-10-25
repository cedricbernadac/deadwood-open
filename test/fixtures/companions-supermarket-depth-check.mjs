import assert from 'node:assert/strict';
import { RoomSimulation } from '../../simulation.mjs';
import { createCompanionBody, LOFT_POST } from '../../companions/body.mjs';
import { describeSituation } from '../../companions/situation.mjs';
import { walk, coinPiles } from '../../companions/coins.mjs';
import { GUIDE, TACTICAL_GUIDE } from '../../companion-brain/guide.mjs';
import { SPACE, spaceFloorId, spaceFlightAt } from '../../public/level-space.js';
import { ARMORY } from '../../public/rules.js';
import { seededRandom } from '../../validation/balance-report.mjs';
const verified=[];
const DT=1/30, flat=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
function room() {
  const events=[], sim=new RoomSimulation('DEPTHBOT',{random:seededRandom(18),raids:false,onEvent:e=>events.push(e)});
  const papa=sim.addPlayer('papa','Papa'), bot=sim.addPlayer('bot','Max',undefined,{companion:true});
  sim.start(papa.id);Object.assign(sim,{phase:'wave',wave:8,toSpawn:1,spawnTimer:1e9});
  Object.assign(papa,{x:-12,y:0,z:-5,grounded:true,vy:0});
  Object.assign(bot,{x:1,y:0,z:0,grounded:true,vy:0});
  const body=createCompanionBody(sim,bot.id,{random:seededRandom(88)}), trace=[];
  const run=(seconds,until=()=>false)=>{
    for(let tick=0;tick<seconds*30;tick++){
      sim.setInput(papa.id,{forward:0,strafe:0,yaw:0,pitch:0});body.tick(DT);sim.tick(DT);
      trace.push({x:bot.x,y:bot.y,z:bot.z,flight:spaceFlightAt(bot.x,bot.z,bot.y)?.id,umbrella:bot.umbrella?.open});
      assert.equal(bot.input?.jump===true,false,'body never jumps into the cellar');
      assert.ok(bot.y>=SPACE.minY-.01,'no falling through cellar floor');
      if(until())return true;
    }return false;
  };
  return {sim,papa,bot,body,events,trace,run};
}
{
 const {sim,papa,bot,body,trace,run}=room();
 body.setOrder({kind:'loft'});
 assert.ok(run(25,()=>flat(bot,LOFT_POST)<.45&&Math.abs(bot.y-SPACE.minY)<.05),'reaches cellar reserve post: '+JSON.stringify(bot));
 assert.ok(trace.some(p=>p.flight==='stock-stair'),'descends the interior flight');
 // The reserve post stands at the interior stair foot: the terrace is now a
 // shorter walk back up that same flight. Walk to the exterior stair foot
 // first so this leg still proves the exterior flight.
 Object.assign(papa,{x:9,y:SPACE.minY,z:6,grounded:true,vy:0});
 body.setOrder({kind:'follow',playerId:papa.id});
 assert.ok(run(25,()=>Math.abs(bot.y-SPACE.minY)<.05&&flat(bot,papa)<4),'crosses the cellar to the exterior stair foot: '+JSON.stringify(bot));
 // Out of the roofed passage's sight (behind the partition), so the bot
 // really climbs onto the rainy terrace instead of covering from the roof.
 Object.assign(papa,{x:9.2,y:0,z:9.8,grounded:true,vy:0});
 body.setOrder({kind:'follow',playerId:papa.id});
 assert.ok(run(25,()=>Math.abs(bot.y)<.05&&flat(bot,papa)<4),'returns by exterior stairs: '+JSON.stringify(bot));
 assert.ok(trace.some(p=>p.flight==='garden-stair'),'climbs the exterior flight');
 assert.ok(trace.some(p=>p.x>8&&p.y>-.1&&p.umbrella),'umbrella opens on the exposed terrace');
 Object.assign(papa,{x:6.6,y:SPACE.minY,z:8.4,grounded:true,vy:0});
 body.setOrder({kind:'follow',playerId:papa.id});
 assert.ok(run(25,()=>Math.abs(bot.y-SPACE.minY)<.05&&flat(bot,papa)<4),'follows back into cellar via exterior stair');
 assert.equal(sim.rainExposed(bot),false,'cellar sheltered');
 run(.2);assert.equal(bot.umbrella.open,false,'umbrella folds in cellar');
 Object.assign(papa,{x:1,y:0,z:0,grounded:true,vy:0});
 body.setOrder({kind:'follow',playerId:papa.id});
 const start=trace.length;assert.ok(run(25,()=>Math.abs(bot.y)<.05&&flat(bot,papa)<4),'returns to sales floor');
 assert.ok(trace.slice(start).some(p=>p.flight==='stock-stair'),'climbs interior stairs');
 verified.push({check:'Both stair flights traversed in both directions with authoritative survivor physics',pass:true,interiorSamples:trace.filter(p=>p.flight==='stock-stair').length,exteriorSamples:trace.filter(p=>p.flight==='garden-stair').length});
 verified.push({check:'Umbrella opens on exposed terrace and folds under cellar shelter',pass:true});
}
{
 const {sim,papa,bot,body,events,run}=room();
 Object.assign(bot,{x:4.2,y:0,z:0,grounded:true,vy:0});
 Object.assign(papa,{x:6.5,y:SPACE.minY,z:-8.8,grounded:true,vy:0});
 sim.damagePlayer(papa,1000,{id:'test'});
 body.setOrder({kind:'revive',playerId:papa.id});
 assert.ok(run(24,()=>!papa.downed),'descends and revives the downed human: '+JSON.stringify({bot:{x:bot.x,y:bot.y,z:bot.z},status:body.status,papa:papa.downed}));
 assert.ok(events.some(e=>e.event==='revive'),'real revive event');
 verified.push({check:'Companion descends from sales floor and revives a downed human in cellar',pass:true});
}
{
 const {sim,papa,bot,body,run}=room();
 Object.assign(bot,{x:6.4,y:SPACE.minY,z:-8.7,grounded:true,vy:0});
 const pickup={id:'cellar-ammo',kind:'ammo',x:7,y:SPACE.minY,z:-7.2,amount:1,special:false,expiresAt:sim.time+90,charge:780};
 bot.inventory.pistol.reserve=0;sim.pickups.set(pickup.id,pickup);
 const view=describeSituation(sim,bot.id);
 assert.match(view.text,/cellar reserve/);assert.ok(view.actions.some(a=>a.value==='collect:cellar-ammo'),'cellar ammo offered');
 body.setOrder({kind:'collect',pickupId:pickup.id});
 assert.ok(run(8,()=>!sim.pickups.has(pickup.id)),'collects basement ammo');
 assert.ok(bot.inventory.pistol.reserve>0);
 const coins={id:'cellar-coins',kind:'points',x:6.6,y:SPACE.minY,z:-8.7,amount:100,expiresAt:sim.time+60};sim.pickups.set(coins.id,coins);
 assert.ok(coinPiles(sim,bot).some(p=>p.pickup.id===coins.id),'cellar coins are reachable');
 assert.ok(walk(bot,{x:4.2,y:0,z:0})>4,'cross-floor walk includes a stair');
 const rack=ARMORY.find(r=>r.y===SPACE.minY&&r.weapon==='assault');assert.ok(rack,'cellar rack');bot.points=5000;
 Object.assign(bot,{x:4.2,y:0,z:0,grounded:true,vy:0});
 body.setOrder({kind:'buy',rackId:rack.id});
 assert.ok(run(25,()=>body.status!=='running'),'purchase finishes');assert.equal(body.status,'done');assert.ok(Object.hasOwn(bot.inventory,'assault'),'buys at real basement rack');
 verified.push({check:'Cellar ammunition and coins offered and reachable; purchase descends to basement rack',pass:true});
}
{
 const {sim,papa,bot,body,events,run}=room();
 Object.assign(bot,{x:6.5,y:SPACE.minY,z:-8.7,grounded:true,vy:0});
 const enemy=sim.spawnZombie();Object.assign(enemy,{x:6.6,y:SPACE.minY,z:-4.8,hp:30,maxHp:30,speed:0,attackAfter:Infinity,entered:true});
 body.setOrder({kind:'shoot',zombieId:enemy.id});
 assert.ok(run(10,()=>!sim.zombies.has(enemy.id)),'shoots a visible basement target');
 assert.ok(events.some(e=>e.event==='shot'&&e.id===bot.id),'fires using human command path');
 const hidden=sim.spawnZombie();Object.assign(hidden,{x:bot.x,y:0,z:bot.z,hp:30,maxHp:30,speed:0,attackAfter:Infinity,entered:true});
 const view=describeSituation(sim,bot.id);assert.equal(view.actions.some(a=>a.value==='shoot:'+hidden.id),false,'concrete slab hides ground-floor target');
 verified.push({check:'Actual basement shots hit visible enemy; ground floor target hidden by slab',pass:true});
}
{
 const {sim,papa,bot,body,run}=room();
 body.setOrder({kind:'loft'});
 assert.ok(run(12,()=>bot.y<-.7&&bot.y>-2.8),'starts descending');
 body.setOrder({kind:'hold'});
 assert.ok(run(12,()=>Math.abs(bot.y-SPACE.minY)<.05),'new hold order completes committed flight');
 run(1);assert.equal(spaceFloorId(bot),'cellar');
 verified.push({check:'Order changed to hold during descent completes flight and clears last tread',pass:true});
}
assert.match(GUIDE,/interior staircase and an exterior staircase/);assert.match(TACTICAL_GUIDE,/two staircases/);assert.doesNotMatch(GUIDE,/loft over the east half/);
assert.equal(spaceFloorId(LOFT_POST),'cellar');
{
 const {sim,bot,body,run}=room();
 body.setOrder({kind:'loft'});
 assert.ok(run(12,()=>bot.y<-.7&&bot.y>-2.8),'starts second descent');
 bot.inventory.pistol.ammo=1;
 body.setOrder({kind:'reload'});
 assert.ok(run(12,()=>Math.abs(bot.y-SPACE.minY)<.05),'reload order finishes on a landing');
 assert.equal(bot.inventory.pistol.ammo,12,'reload still performed');
 verified.push({check:'Nonmovement order on flight reloads while continuing to a landing',pass:true});
}
{
 const {sim,papa,bot,body,run}=room();
 Object.assign(bot,{x:6.1,y:0,z:-8.5,grounded:true,vy:0});Object.assign(papa,{x:9.5,y:0,z:-8.5,grounded:true,vy:0});
 assert.equal(sim.raiderLineClear({x:bot.x,y:1.55,z:bot.z},{x:papa.x,y:1.55,z:papa.z}),false,'partition hides nearby human');
 body.setOrder({kind:'follow',playerId:papa.id});
 assert.ok(run(25,()=>bot.x>8.2&&flat(bot,papa)<4),'follows through terrace passage instead of stopping against partition');
 verified.push({check:'Following a nearby human behind terrace partition takes the actual connecting passage',pass:true});
}
verified.push({check:'Legacy and tactical brain guides describe cellar, terrace and two stairs',pass:true});
const report={date:'2026-10-18',scope:'Deterministic real simulation, human command body paths; no model API, server, browser or human play session',mapId:'supermarket',geometryId:SPACE.id,checks:verified,passed:verified.length,failed:0};
if(process.argv.includes('--receipt')) {const {writeFileSync}=await import('node:fs');writeFileSync(new URL('../../validation/supermarket-depth-companions-2026-10-18.json',import.meta.url),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report));
console.log('complex supermarket companions verified');
