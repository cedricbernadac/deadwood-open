import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WORLD } from '../simulation.mjs';
import { EXTERIOR } from '../public/rules.js';
import { completeRevive } from './helpers/revive.mjs';

function setup(position={}) {
  const events=[];
  const simulation=new RoomSimulation('OUT123',{random:()=>.5,onEvent:event=>events.push(event)});
  const player=simulation.addPlayer('a');
  simulation.start('a');simulation.phase='intermission';simulation.timeLeft=1000;
  Object.assign(player,{x:0,y:0,z:0,...position});
  return {simulation,player,events};
}
function advance(simulation,ticks,input={}) {
  for(let i=0;i<ticks;i++) {
    simulation.setInput('a',{forward:0,strafe:0,yaw:0,pitch:0,...input});simulation.tick(1/30);
  }
}
function zombieAt(simulation,position) {
  const zombie=simulation.spawnZombie();Object.assign(zombie,{entered:true,entryTarget:null,...position});return zombie;
}

test('players can leave north, walk around the cabin and return through east',()=>{
  const {simulation,player}=setup({z:-5,hp:1000});
  for(const door of simulation.doors.filter(item=>['north','east'].includes(item.id)))door.hp=0;
  advance(simulation,36,{forward:1});assert.ok(player.z<-8);assert.equal(player.y,0);
  advance(simulation,86,{strafe:1});assert.ok(player.x>9.5);
  advance(simulation,76,{forward:-1});assert.ok(Math.abs(player.z)<.2);
  advance(simulation,29,{strafe:-1});assert.ok(player.x<7.5);
  assert.equal(simulation.snapshot().players[0].outside,false);assert.equal(player.y,0);assert.ok(player.hp<1000);
});

test('walls and windows cannot be crossed on foot or in a jump',()=>{
  // The four windows that stay open: the boarded ones are plain wall anyway.
  const cases=[{x:-4.8,z:-5.3,forward:1},{x:4.8,z:5.3,forward:-1},{x:7.3,z:-3.5,strafe:1},{x:-7.3,z:3.5,strafe:-1}];
  for(const fixture of cases){
    const {simulation,player}=setup(fixture);advance(simulation,35,{forward:fixture.forward??0,strafe:fixture.strafe??0,jump:true});
    assert.equal(simulation.snapshot().players[0].outside,false);
    assert.ok(Math.abs(player.x)<8&&Math.abs(player.z)<6);
  }
});

test('barricade passage requires all four lower boards removed and respects head clearance',()=>{
  const {simulation,player}=setup({z:-5});const door=simulation.doors[0];
  door.boards=[0,0,0,24,24];advance(simulation,20,{forward:1});assert.ok(player.z>-6);
  door.boards=[0,0,0,0,24];advance(simulation,20,{forward:1});assert.ok(player.z<-6);
  assert.equal(simulation.canOccupy(player,0,-6,0,.25),true);
  assert.equal(simulation.canOccupy(player,0,-6,.5,.25),false);
  assert.equal(simulation.canOccupy(player,1.2,-6,0,.25),false);
  const brute={id:'brute-fixture',scale:1.22};
  assert.equal(simulation.doorPassable(door,0,1.82),true);
  assert.equal(simulation.canOccupy(brute,0,-6,0,.29),false);
  door.boards[4]=0;assert.equal(simulation.canOccupy(brute,0,-6,0,.29),true);
});

test('loft exterior walls stay solid and exterior player bounds clamp independently of the cabin',()=>{
  const {simulation,player}=setup({x:7.3,y:WORLD.loftY,z:0});
  simulation.doors.find(door=>door.id==='east').hp=0;
  advance(simulation,35,{strafe:1,jump:true});assert.ok(player.x<8);assert.equal(player.y,WORLD.loftY);
  Object.assign(player,{x:EXTERIOR.bounds.maxX,y:0,z:0,vy:0,grounded:true});
  advance(simulation,35,{strafe:1});assert.equal(player.x,EXTERIOR.bounds.maxX);
});

test('outside damage uses server elapsed time, ignores forged input and coalesces one event per second',()=>{
  const {simulation,player,events}=setup({x:10,z:0});
  advance(simulation,29,{hp:999,outside:false,outsideDamageActive:false});assert.equal(player.hp,100);
  simulation.tick(1/30);assert.equal(player.hp,97);
  for(let i=0;i<30;i++)simulation.tick(1/30);assert.equal(player.hp,94);
  const hits=events.filter(event=>event.event==='hit'&&event.source==='outside');assert.equal(hits.length,2);
  const state=simulation.snapshot();assert.equal(state.outsideDamagePerSecond,3);assert.equal(state.players[0].outside,true);assert.equal(state.players[0].outsideDamageActive,true);
});

test('short excursions accumulate exposure without damage or accumulation while indoors',()=>{
  const {simulation,player,events}=setup({x:10,z:0});advance(simulation,18);assert.equal(player.hp,100);
  player.x=0;advance(simulation,60);assert.equal(player.hp,100);
  player.x=10;advance(simulation,18);assert.equal(player.hp,97);
  assert.equal(events.filter(event=>event.event==='hit'&&event.source==='outside').length,1);
});

test('hazard is inactive during lobby and frozen phases and incapacity clears exposure',()=>{
  for(const phase of ['lobby','extraction','victory','gameover']) {
    const {simulation,player}=setup({x:10});simulation.phase=phase;simulation.timeLeft=1000;
    advance(simulation,45);assert.equal(player.hp,100);assert.equal(simulation.snapshot().players[0].outsideDamageActive,false);
  }
  const {simulation,player,events}=setup({x:10,hp:2});advance(simulation,30);
  assert.equal(player.downed,true);assert.equal(player.outsideDamageAccumulator,0);
  assert.ok(events.some(event=>event.event==='down'&&event.source==='outside'));
  advance(simulation,30);assert.equal(player.hp,0);
  simulation.phase='gameover';simulation.start('a');assert.equal(player.outsideDamageAccumulator,0);assert.equal(simulation.snapshot().players[0].outside,false);
});

test('a zombie can attack an outside player before breaching its assigned door',()=>{
  const {simulation,player}=setup({x:10,z:0});const zombie=zombieAt(simulation,{x:10.4,z:0,y:0,entered:false,doorId:'west'});
  simulation.updateZombie(zombie,1/30,[player]);assert.ok(player.hp<100);assert.equal(simulation.doors[2].hp,simulation.doors[2].maxHp);
});

test('a zombie cannot melee a nearby survivor through an unbroken wall or barricade',()=>{
  for(const x of [0,-4.8,4.8]){
    const {simulation,player}=setup({x,z:-5.65});
    const zombie=zombieAt(simulation,{x,z:-6.35,y:0});
    simulation.updateZombie(zombie,1/30,[player]);assert.equal(player.hp,100);
  }
});

test('resupply and revive clear old exposure but outside damage resumes after a new full second',()=>{
  const {simulation,player}=setup({x:10,hp:50});advance(simulation,18);
  simulation.finishWave();assert.equal(player.hp,100);assert.equal(player.outsideDamageAccumulator,0);
  advance(simulation,18);assert.equal(player.hp,100);
  const teammate=simulation.addPlayer('b');Object.assign(teammate,{x:10,z:0,y:0,downed:true,hp:0,outsideDamageAccumulator:.8});
  completeRevive(simulation,'a');assert.equal(teammate.downed,false);assert.equal(teammate.outsideDamageAccumulator,0);
});

test('outside zombies pursue a nearby survivor around a corner without crossing walls or windows',()=>{
  const {simulation,player}=setup({x:8.8,z:-4.5,hp:1000});const zombie=zombieAt(simulation,{x:6.5,z:-6.8,y:0,speed:4});
  for(let i=0;i<450;i++) {simulation.time+=1/30;simulation.updateZombie(zombie,1/30,[player]);assert.equal(Math.abs(zombie.x)<8&&Math.abs(zombie.z)<6,false);}
  assert.ok(player.hp<1000);
});

test('inside and outside zombies use an open door instead of their closed assigned door',()=>{
  for(const leave of [true,false]){
    const {simulation,player}=setup(leave?{x:0,z:-8,hp:1000}:{x:0,z:1,hp:1000});
    simulation.doors[0].hp=0;
    const zombie=zombieAt(simulation,leave?{x:0,z:1,y:0,speed:4,doorId:'east'}:{x:10,z:0,y:0,speed:4,doorId:'east',entered:false});
    for(let i=0;i<450;i++){simulation.time+=1/30;simulation.updateZombie(zombie,1/30,[player]);}
    assert.ok(player.hp<1000,`zombie must ${leave?'leave':'enter'} through north`);
    const east=simulation.doors.find(door=>door.id==='east');assert.equal(east.hp,east.maxHp);
  }
});

test('a distant outside survivor does not pull a zombie around the cabin past an available entrance',()=>{
  const {simulation,player}=setup({x:10,z:0,hp:1000});
  const west=simulation.doors.find(door=>door.id==='west');west.hp=0;
  const zombie=zombieAt(simulation,{x:-10,z:0,y:0,speed:4});
  let entered=false;
  for(let tick=0;tick<240;tick++) {
    simulation.time+=1/30;simulation.updateZombie(zombie,1/30,[player]);
    entered ||= zombie.x>-7.5&&Math.abs(zombie.z)<5.5;
  }
  assert.ok(entered,'the exterior zombie enters through nearby west before considering the distant outdoor player');
  assert.ok(Math.abs(zombie.x)<8&&Math.abs(zombie.z)<6,'it does not oscillate through the same entrance while the survivor remains distant');
  assert.equal(player.hp,1000);
  for(const door of simulation.doors.filter(door=>door.id!=='west'))assert.equal(door.hp,door.maxHp);
});

test('exterior entrance choices prefer a passable nearby door without a distant interior target bias',()=>{
  for(const closestOpen of [true,false]) {
    const {simulation,player}=setup({x:-5,z:4.5,hp:1000});
    for(const door of simulation.doors)door.hp=closestOpen?0:door.id==='north'?0:door.maxHp;
    const zombie=zombieAt(simulation,{x:10,z:5,y:0,speed:1.5});
    simulation.updateZombie(zombie,1/30,[player]);
    assert.equal(zombie.portalRoute.doorId,closestOpen?'east':'north');
  }
});

test('exterior pursuit is limited to nearby survivors even when an interior survivor is also alive',()=>{
  for(const separation of [5,5.1]) {
    const {simulation,player}=setup({x:10,z:separation,hp:1000});
    const indoors=simulation.addPlayer('b');Object.assign(indoors,{x:-5,z:1,hp:1000});
    simulation.doors.find(door=>door.id==='east').hp=0;
    const zombie=zombieAt(simulation,{x:10,z:0,y:0,speed:1.5});
    simulation.updateZombie(zombie,1/30,[indoors,player]);
    if(separation===5) {
      assert.ok(zombie.z>0,'a survivor within five metres is pursued directly outside');
      assert.equal(zombie.portalRoute,null);
    } else {
      assert.ok(zombie.x<10,'a more distant survivor leaves entry as the priority');
      assert.equal(zombie.portalRoute.doorId,'east');
    }
  }
});

test('a zombie at the east jamb aligns and enters after a crowd sidestep instead of retrying a blocked diagonal',()=>{
  for(const side of [-1,1]) {
    const {simulation,player}=setup({x:-5,z:1,hp:1000});
    simulation.doors.find(door=>door.id==='east').hp=0;
    const zombie=zombieAt(simulation,{x:8.44,z:side*1.1,y:0,speed:1.5,portalRoute:{doorId:'east',fromOutside:true,toOutside:false,stage:'cross'}});
    assert.equal(simulation.canOccupy(zombie,zombie.x,zombie.z,0,.29),true,'the jam begins in legal space beside the open jamb');
    for(let tick=0;tick<450;tick++) {
      simulation.time+=1/30;simulation.updateZombie(zombie,1/30,[player]);
      assert.equal(simulation.canOccupy(zombie,zombie.x,zombie.z,zombie.y,.29),true,'recovery never moves the body through a wall or board');
    }
    assert.ok(zombie.x<7.5);
    assert.ok(player.hp<1000,'the recovered zombie still reaches its distant indoor target');
  }
});

test('entry priority still lets a zombie attack a survivor physically blocking an open door',()=>{
  const {simulation,player}=setup({x:7.7,z:0,hp:1000});
  simulation.doors.find(door=>door.id==='east').hp=0;
  const zombie=zombieAt(simulation,{x:8.4,z:0,y:0});
  simulation.updateZombie(zombie,1/30,[player]);
  assert.ok(player.hp<1000,'doorway camping cannot make the survivor immune to melee');
});

test('without any nearby human an exterior zombie completes an available entrance',()=>{
  const {simulation}=setup();
  simulation.doors.find(door=>door.id==='east').hp=0;
  const zombie=zombieAt(simulation,{x:10,z:0,y:0,speed:1.5});
  for(let tick=0;tick<120;tick++) {simulation.time+=1/30;simulation.updateZombie(zombie,1/30,[]);}
  assert.ok(zombie.x<7.5,'the entry completes even without a local pursuit target');
  assert.equal(zombie.portalRoute,null);
});
