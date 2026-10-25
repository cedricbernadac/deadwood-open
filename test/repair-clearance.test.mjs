import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation } from '../simulation.mjs';
import { ARMORY, ARMORY_REACH } from '../public/rules.js';

function fixture(doorIndex) {
  const events=[],simulation=new RoomSimulation('CLEAR1',{random:()=>.5,onEvent:event=>events.push(event)});
  const player=simulation.addPlayer('a');simulation.start('a');
  const door=simulation.doors[doorIndex];door.hp=0;
  const position=(normal,tangent=0)=>({x:door.x+door.outX*normal+(door.outZ?tangent:0),y:0,z:door.z+door.outZ*normal+(door.outX?tangent:0)});
  Object.assign(player,position(-.8));
  return {simulation,player,door,events,position};
}

for(const [doorIndex,name] of ['north','south','west','east'].entries()) {
  test(`repair refuses to build boards around self or a teammate in the ${name} passage`,()=>{
    for(const occupantType of ['self','teammate','downed']) {
      const {simulation,player,door,events,position}=fixture(doorIndex);
      let occupant=player;
      if(occupantType!=='self') {
        occupant=simulation.addPlayer('b');
        if(occupantType==='downed')Object.assign(player,position(-.35,-1.6));
        Object.assign(occupant,position(0,occupantType==='downed'?.9:0),{downed:occupantType==='downed'});
      } else Object.assign(player,position(0));
      const originalBoards=[...door.boards],originalPoints=player.points,originalCredit=door.repairCredit;
      assert.equal(simulation.interact('a'),false);
      assert.deepEqual(door.boards,originalBoards);assert.equal(door.hp,0);
      assert.equal(player.points,originalPoints);assert.equal(door.repairCredit,originalCredit);
      assert.equal(events.at(-1).event,'repair-blocked');assert.equal(events.at(-1).message,'Dégage le passage avant de réparer.');
      assert.equal(simulation.interact('a'),false);assert.equal(events.filter(event=>event.event==='repair-blocked').length,1);
      assert.equal(simulation.canOccupy(occupant,occupant.x+door.outX*.2,occupant.z+door.outZ*.2,0,.25),true);
      Object.assign(occupant,position(3));Object.assign(player,position(-.8));simulation.time+=.56;
      assert.equal(simulation.interact('a'),true);assert.equal(door.hp,25);
    }
  });
}

test('repair refuses a live zombie in the doorway, then succeeds after it clears',()=>{
  const {simulation,player,door,events,position}=fixture(0);
  const zombie=simulation.spawnZombie();Object.assign(zombie,position(.25));
  assert.equal(simulation.interact('a'),false);assert.equal(door.hp,0);assert.equal(player.points,0);
  assert.equal(events.at(-1).event,'repair-blocked');
  Object.assign(zombie,position(1));simulation.time+=.56;
  assert.equal(simulation.interact('a'),true);assert.equal(door.hp,25);
});

test('a dead survivor and an upstairs survivor do not occupy the ground-floor doorway',()=>{
  for(const occupantState of [{alive:false,y:0},{alive:true,y:3.4}]){
    const {simulation,door,position}=fixture(0);const occupant=simulation.addPlayer('b');
    Object.assign(occupant,position(0),occupantState);
    assert.equal(simulation.interact('a'),true);assert.equal(door.hp,25);
  }
});

test('the relocated pistol rack does not intercept a north-door repair from either corner',()=>{
  const pistol = ARMORY.find(item => item.weapon === 'pistol');
  for (const tangent of [-1.6, 1.6]) {
    const {simulation,player,door,position,events}=fixture(0);
    Object.assign(player,position(-.35,tangent));
    assert.ok(Math.hypot(player.x-pistol.x,player.z-pistol.z)>ARMORY_REACH);
    assert.equal(simulation.interact(player.id),true);
    assert.equal(door.hp,25);
    assert.equal(events.at(-1).event,'repair');
  }
});

test('the bat rack leaves both west-door repair corners clear of purchase interactions', () => {
  const bat = ARMORY.find(item => item.weapon === 'bat');
  for (const tangent of [-1.6, 1.6]) {
    const { simulation, player, door, position, events } = fixture(2);
    Object.assign(player, position(-.35, tangent));
    assert.ok(Math.hypot(player.x - bat.x, player.z - bat.z) > ARMORY_REACH);
    assert.equal(simulation.interact(player.id), true); assert.equal(door.hp, 25);
    assert.equal(events.at(-1).event, 'repair');
  }
});

test('the fire axe rack leaves both north and south repair corners clear for repair and blocked-passage feedback', () => {
  const axe = ARMORY.find(item => item.weapon === 'fireaxe');
  for (const doorIndex of [0, 1]) for (const tangent of [-1.6, 1.6]) for (const occupied of [false, true]) {
    const { simulation, player, door, position, events } = fixture(doorIndex);
    Object.assign(player, position(-.35, tangent));
    assert.ok(Math.hypot(player.x - axe.x, player.z - axe.z) > ARMORY_REACH);
    if (occupied) {
      const teammate = simulation.addPlayer('b');
      Object.assign(teammate, position(0, -Math.sign(tangent) * .9), { downed: true });
    }
    assert.equal(simulation.interact(player.id), !occupied);
    assert.equal(door.hp, occupied ? 0 : 25);
    assert.equal(events.at(-1).event, occupied ? 'repair-blocked' : 'repair');
    assert.ok(!events.some(event => event.event === 'purchase-denied'));
  }
});
