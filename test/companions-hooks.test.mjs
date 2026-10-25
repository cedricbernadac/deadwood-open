import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation } from '../simulation.mjs';
import { NEXT_WAVE_CALL } from '../public/rules.js';

// AI companions are ordinary players with player.companion = true
// (companions/DESIGN.md): never host, never voters, coins like anyone.
function room() {
  const events = [];
  const simulation = new RoomSimulation('COMPAN', { random: () => .5, onEvent: event => events.push(event) });
  simulation.addPlayer('papa', 'Papa');
  simulation.addPlayer('jules', 'Jules');
  const max = simulation.addPlayer('max', 'Max', undefined, { companion: true });
  return { simulation, events, max };
}

test('a companion is flagged in the snapshot and never becomes host', () => {
  const { simulation, max } = room();
  assert.equal(max.companion, true); assert.equal(max.ready, true);
  const state = simulation.snapshot();
  assert.equal(state.players.find(player => player.id === 'max').companion, true);
  assert.equal(state.players.find(player => player.id === 'papa').companion, undefined);
  assert.equal(state.companionsAvailable, false);
  simulation.companionsAvailable = true; assert.equal(simulation.snapshot().companionsAvailable, true);
  simulation.removePlayer('papa');
  assert.equal(simulation.hostId, 'jules', 'the host passes to a human');
  const alone = new RoomSimulation('ALONE');
  alone.addPlayer('bot', 'Max', undefined, { companion: true });
  assert.equal(alone.hostId, null, 'a companion alone is not host');
});

test('humans alone call the next wave early', () => {
  const { simulation, events } = room();
  simulation.start('papa'); simulation.phase = 'intermission'; simulation.timeLeft = 30;
  simulation.voteNextWave('papa'); simulation.voteNextWave('jules');
  const vote = events.filter(event => event.event === 'next-wave-vote').at(-1);
  assert.equal(vote.total, 2);
  assert.ok(simulation.timeLeft <= NEXT_WAVE_CALL + 1e-9, 'the break is cut short');
});

test('a companion kill pays the companion directly: no pile on the floor', () => {
  const { simulation, max } = room();
  simulation.start('papa');
  const pile = () => [...simulation.pickups.values()].filter(pickup => pickup.kind === 'points').length;
  simulation.dropZombieLoot({ kind: 'walker', x: 0, y: 0, z: 0 }, 18, max);
  assert.equal(max.points, 18); assert.equal(pile(), 0);
  simulation.dropZombieLoot({ kind: 'walker', x: 0, y: 0, z: 0 }, 18, simulation.players.get('papa'));
  assert.equal(pile(), 1);
});

// Owner, 13 October: "ils ont le droit de ramasser de l'argent".
test('a companion collects coins like anyone, and other pickups only when its order targets them', () => {
  const { simulation, max } = room();
  simulation.start('papa'); simulation.phase = 'wave';
  for (const id of ['papa', 'jules']) Object.assign(simulation.players.get(id), { x: 6, z: 4 });
  Object.assign(max, { x: -3, y: 0, z: 2 });
  const add = (id, kind, extra = {}) => simulation.pickups.set(id, { id, kind, x: -3, y: 0, z: 2, amount: kind === 'points' ? 50 : 1, special: false, expiresAt: simulation.time + 90, ...extra });
  max.inventory.pistol.reserve = 0;
  add('coins', 'points'); add('box', 'ammo'); add('kit', 'revive');
  simulation.attractCoins(1 / 30); simulation.collectPickups();
  assert.equal(max.points, 50, 'the coins, without any order');
  assert.equal(max.reviveKit, false); assert.equal(max.inventory.pistol.reserve, 0);
  assert.deepEqual([...simulation.pickups.keys()], ['box', 'kit'], 'nothing else without an order');
  max.collectTargetId = 'box'; simulation.collectPickups();
  assert.ok(max.inventory.pistol.reserve > 0); assert.equal(simulation.pickups.has('box'), false);
  assert.equal(simulation.pickups.has('kit'), true);
});

test('the coin magnet pulls coins to a companion, the nearest survivor, never a gift back to its dropper', () => {
  const { simulation, max } = room();
  simulation.start('papa'); simulation.phase = 'wave';
  const papa = simulation.players.get('papa'), jules = simulation.players.get('jules');
  Object.assign(papa, { x: 6, z: 4 }); Object.assign(jules, { x: 6, z: -4 });
  Object.assign(max, { x: -3, y: 0, z: 2 });
  simulation.pickups.set('coins', { id: 'coins', kind: 'points', x: -1, y: 0, z: 2, amount: 18, special: false, expiresAt: simulation.time + 90 });
  for (let step = 0; step < 30 && simulation.pickups.has('coins'); step++) { simulation.attractCoins(1 / 30); simulation.collectPickups(); }
  assert.equal(simulation.pickups.has('coins'), false); assert.equal(max.points, 18, 'pulled 2 m to Max, and his');
  // A human nearer than the companion gets them.
  Object.assign(papa, { x: -1.6, z: 2 });
  simulation.pickups.set('near', { id: 'near', kind: 'points', x: -1, y: 0, z: 2, amount: 18, special: false, expiresAt: simulation.time + 90 });
  for (let step = 0; step < 30 && simulation.pickups.has('near'); step++) { simulation.attractCoins(1 / 30); simulation.collectPickups(); }
  assert.equal(papa.points, 18); assert.equal(max.points, 18);
  // A gift is never pulled back to the companion that dropped it, nor taken before 3 s.
  Object.assign(papa, { x: 6, z: 4 });
  max.points = 300; max.coinDropAfter = 0;
  assert.equal(simulation.dropCoins('max'), true);
  const gift = [...simulation.pickups.values()].find(pickup => pickup.droppedBy === 'max');
  const at = { x: gift.x, z: gift.z };
  for (let step = 0; step < 60; step++) { simulation.time += 1 / 30; simulation.attractCoins(1 / 30); simulation.collectPickups(); }
  assert.equal(simulation.pickups.has(gift.id), true, 'still on the floor two seconds later');
  assert.deepEqual({ x: gift.x, z: gift.z }, at, 'never pulled toward its dropper');
  assert.equal(max.points, 200);
  // Jules walks over it: his.
  Object.assign(jules, { x: gift.x, y: gift.y, z: gift.z });
  simulation.collectPickups();
  assert.equal(simulation.pickups.has(gift.id), false); assert.equal(jules.points, 100);
});

test('repairDoor repairs the named door and never buys at a rack next to it', () => {
  const { simulation, events } = room();
  simulation.start('papa'); simulation.phase = 'wave'; simulation.wave = 4;
  const papa = simulation.players.get('papa'); Object.assign(papa, { x: -7.5, y: 0, z: -2, points: 1000 });
  const west = simulation.doors.find(door => door.id === 'west');
  west.boards = west.boards.map(() => 0); const before = west.hp;
  assert.equal(simulation.repairDoor('papa', 'west'), true);
  assert.ok(west.hp > before); assert.equal(papa.points, 1000);
  assert.equal(events.some(event => event.event === 'purchase'), false);
  assert.equal(simulation.repairDoor('papa', 'west'), false, '0.55 s between two repairs');
  simulation.time += .6;
  assert.equal(simulation.repairDoor('papa', 'east'), false, 'too far from the east door');
  // The same spot with interact() buys the bat: that is why companions use repairDoor.
  assert.equal(simulation.interact('papa'), true); assert.ok(papa.points < 1000);
});

// Integration review (13 October): the host never passes to a companion.
test('a human still waiting to join takes the host over a companion, and a pause nobody can lift is lifted', () => {
  const { simulation, max } = room();
  simulation.removePlayer('jules');
  simulation.start('papa'); simulation.phase = 'wave';
  const jules = simulation.addPlayer('jules', 'Jules', undefined, { defer: true });
  assert.equal(jules.waiting, true);
  simulation.setPause('papa', true);
  simulation.removePlayer('papa');
  assert.equal(simulation.hostId, 'jules');
  assert.notEqual(simulation.hostId, max.id);
  assert.equal(simulation.paused, false, 'a waiting host cannot resume, so nobody stays frozen');
});
