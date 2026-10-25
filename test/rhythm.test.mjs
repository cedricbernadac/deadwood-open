import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation } from '../simulation.mjs';
import { PICKUPS, NEXT_WAVE_CALL } from '../public/rules.js';

// A faster rhythm (owner, 12 October): coins slide to the survivor who walks
// near them, and the break between waves ends early once everyone is ready.
// The column x = -4.5 is clear floor from z = -2.7 to z = 1.5.
function room(names = ['a']) {
  const events = [];
  const simulation = new RoomSimulation('RHYTHM', { random: () => .5, onEvent: event => events.push(event) });
  const players = names.map(name => simulation.addPlayer(name, name.toUpperCase()));
  simulation.start(names[0]);
  simulation.timeLeft = 999; // a long countdown: no zombies while coins move
  return { simulation, players, events };
}

function coin(simulation, id, x, z, { y = 0, amount = 24 } = {}) {
  const pickup = { id, kind: 'points', x, y, z, amount, special: false, expiresAt: simulation.time + PICKUPS.lifetime };
  simulation.pickups.set(id, pickup);
  return pickup;
}

const ticks = (simulation, seconds) => { for (let step = 0; step < Math.round(seconds * 30); step++) simulation.tick(1 / 30); };

test('coins within reach slide to the survivor, faster as they come, and are collected', () => {
  const { simulation, players: [player], events } = room();
  Object.assign(player, { x: -4.5, y: 0, z: 1.5 });
  const pickup = coin(simulation, 'c1', -4.5, -.5);
  assert.equal(simulation.canCollectPickup(player, pickup, PICKUPS.magnetReach), true, 'a clear line of floor');
  const start = Math.hypot(pickup.x - player.x, pickup.z - player.z);
  simulation.tick(1 / 30);
  const first = start - Math.hypot(pickup.x - player.x, pickup.z - player.z);
  assert.ok(first > 0 && Math.abs(pickup.x - player.x) < 1e-9, 'straight toward the survivor');
  simulation.tick(1 / 30);
  const gap = Math.hypot(pickup.x - player.x, pickup.z - player.z);
  ticks(simulation, .1);
  assert.ok(gap - Math.hypot(pickup.x - player.x, pickup.z - player.z) > first, 'it speeds up as it comes');
  ticks(simulation, .6);
  assert.equal(simulation.pickups.has('c1'), false, 'collected well under a second');
  assert.equal(player.points, 24);
  assert.ok(events.some(event => event.event === 'pickup' && event.kind === 'points' && event.amount === 24));
});

test('coins stay put out of reach, behind a wall, on another floor, or near a downed survivor', () => {
  const { simulation, players: [player] } = room();
  Object.assign(player, { x: -4.5, y: 0, z: 1.5 });
  const far = coin(simulation, 'far', -4.5, 1.5 - PICKUPS.magnetReach - .1);
  assert.equal(simulation.canCollectPickup(player, far, 3), true, 'only the reach keeps it');
  ticks(simulation, .5);
  assert.deepEqual([far.x, far.z], [-4.5, 1.5 - PICKUPS.magnetReach - .1], 'out of reach');
  simulation.pickups.clear();
  // The rear partition runs along z = -2 from x = -3.3 to 2.1, floor to roof.
  Object.assign(player, { x: 0, z: -.8 });
  const behind = coin(simulation, 'behind', 0, -3.2);
  assert.ok(Math.hypot(behind.x - player.x, behind.z - player.z) < PICKUPS.magnetReach);
  ticks(simulation, .5);
  assert.deepEqual([behind.x, behind.z], [0, -3.2], 'never through a wall');
  simulation.pickups.clear();
  Object.assign(player, { x: -4.5, z: 1.5 });
  const loft = coin(simulation, 'loft', -4.5, -.5, { y: 3.4 });
  ticks(simulation, .5);
  assert.deepEqual([loft.x, loft.z], [-4.5, -.5], 'never from another floor');
  simulation.pickups.clear();
  Object.assign(player, { downed: true, bleedOutAt: simulation.time + 60 });
  const waiting = coin(simulation, 'down', -4.5, -.5);
  ticks(simulation, .5);
  assert.deepEqual([waiting.x, waiting.z], [-4.5, -.5], 'a downed survivor attracts nothing');
  Object.assign(player, { downed: false, alive: true });
  ticks(simulation, .1);
  assert.ok(waiting.z > -.5, 'the same coin comes once the survivor is up');
});

test('the nearest survivor gets the coin; ammo and medkits never move', () => {
  const { simulation, players: [alice, bob] } = room(['a', 'b']);
  Object.assign(alice, { x: -4.5, y: 0, z: 1.5 });
  Object.assign(bob, { x: -4.5, y: 0, z: -2.5 });
  const pickup = coin(simulation, 'shared', -4.5, -.9);
  const box = { id: 'ammo', kind: 'ammo', x: -4.5, y: 0, z: .1, amount: 1, special: false, charge: PICKUPS.ammoCharge, expiresAt: simulation.time + PICKUPS.lifetime };
  simulation.pickups.set('ammo', box);
  simulation.tick(1 / 30);
  assert.ok(pickup.z < -.9, 'toward Bob, 1.6 m away, not Alice, 2.4 m away');
  ticks(simulation, 1);
  assert.equal(bob.points, 24); assert.equal(alice.points, 0);
  assert.deepEqual([box.x, box.z], [-4.5, .1], 'ammo boxes never move');
});

function intermission(names) {
  const fixture = room(names);
  const { simulation } = fixture;
  simulation.phase = 'wave'; simulation.wave = 1; simulation.toSpawn = 0; simulation.zombies.clear();
  assert.notEqual(simulation.finishWave(), false);
  assert.equal(simulation.phase, 'intermission');
  return fixture;
}

test('alone, being ready brings the next wave in three seconds', () => {
  const { simulation, events } = intermission(['a']);
  assert.equal(simulation.timeLeft, 12);
  assert.equal(simulation.voteNextWave('a'), true);
  assert.equal(simulation.timeLeft, NEXT_WAVE_CALL);
  assert.deepEqual(events.filter(event => event.event.startsWith('next-wave')).map(({ event, votes, total, seconds }) => ({ event, votes, total, seconds })),
    [{ event: 'next-wave-vote', votes: 1, total: 1, seconds: undefined }, { event: 'next-wave-called', votes: undefined, total: undefined, seconds: 3 }]);
  assert.equal(simulation.snapshot().players[0].nextWaveVote, true);
  ticks(simulation, NEXT_WAVE_CALL + .1);
  assert.equal(simulation.phase, 'wave'); assert.equal(simulation.wave, 2);
  assert.equal(simulation.snapshot().players[0].nextWaveVote, false, 'votes reset with the new wave');
  assert.equal(simulation.voteNextWave('a'), false, 'no vote during a wave');
});

test('together, the wave is called only when every survivor is ready; a vote can be withdrawn', () => {
  const { simulation, events } = intermission(['a', 'b']);
  simulation.voteNextWave('a');
  assert.equal(simulation.timeLeft, 12);
  const vote = () => { const { event, id, ready, votes, total } = events.at(-1); return { event, id, ready, votes, total }; };
  assert.deepEqual(vote(), { event: 'next-wave-vote', id: 'a', ready: true, votes: 1, total: 2 });
  simulation.voteNextWave('a', false);
  assert.deepEqual(vote(), { event: 'next-wave-vote', id: 'a', ready: false, votes: 0, total: 2 });
  simulation.voteNextWave('b');
  assert.equal(simulation.timeLeft, 12, 'Alice withdrew');
  ticks(simulation, 2);
  simulation.voteNextWave('a');
  assert.equal(simulation.timeLeft, NEXT_WAVE_CALL);
  assert.equal(events.filter(event => event.event === 'next-wave-called').length, 1);
  simulation.voteNextWave('a'); simulation.voteNextWave('b');
  assert.equal(events.filter(event => event.event === 'next-wave-called').length, 1, 'called once');
});

test('a late break keeps its shorter time, a leaving survivor no longer blocks, waiting players do not vote', () => {
  const { simulation, events } = intermission(['a', 'b']);
  ticks(simulation, 10);
  simulation.voteNextWave('a'); simulation.voteNextWave('b');
  assert.ok(simulation.timeLeft < NEXT_WAVE_CALL, 'never lengthens the break');
  const second = intermission(['a', 'b']).simulation;
  second.voteNextWave('a');
  second.removePlayer('b');
  second.tick(1 / 30);
  assert.ok(second.timeLeft <= NEXT_WAVE_CALL, 'the remaining survivor was ready');
  const third = intermission(['a']).simulation;
  const late = third.addPlayer('late', 'LATE');
  late.waiting = true; // waiting for admission at the next break
  assert.equal(third.voteNextWave('late'), false);
  third.voteNextWave('a');
  assert.equal(third.timeLeft, NEXT_WAVE_CALL, 'a waiting player does not hold the team back');
  third.paused = true;
  assert.equal(third.voteNextWave('a', false), false, 'no vote while paused');
  assert.ok(events.length > 0);
});
