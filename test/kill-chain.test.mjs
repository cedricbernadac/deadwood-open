import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WEAPONS } from '../simulation.mjs';
import { KILL_CHAIN, killCash } from '../public/rules.js';
import { advanceBallisticFlight } from './helpers/ballistic-flight.mjs';

// Same firing line as combat.test.mjs: inside the cabin, through the western
// partition opening, with a deterministic spread-free aim.
function combat(weapon = 'rifle') {
  const events = [];
  const simulation = new RoomSimulation('CHAIN', { random: () => 0.5, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a', 'Alice', weapon);
  simulation.start('a');
  player.weapon = weapon;
  player.inventory[weapon] = { ammo: WEAPONS[weapon].magazine, reserve: WEAPONS[weapon].reserve };
  Object.assign(player, { x: -4.4, y: 0, z: 4, yaw: 0, pitch: 0 });
  assert.equal(simulation.canOccupy(player, player.x, player.z, player.y, .25), true);
  return { simulation, player, events };
}

function zombie(simulation, id, options = {}) {
  const target = { id, x: -4.4, y: 0.4, z: 1, hp: 1000, maxHp: 1000, kind: 'walker', ...options };
  assert.equal(simulation.canOccupy(target, target.x, target.z, target.y, .29), true, `${id} must occupy clear floor space`);
  simulation.zombies.set(id, target);
  return target;
}

function shoot(simulation, player) {
  simulation.time = Math.max(simulation.time, player.shotAfter);
  assert.equal(simulation.shoot(player.id), true);
  advanceBallisticFlight(simulation, .1);
}

const kills = events => events.filter(event => event.event === 'kill');

function grenadeRoom(wave = 5) {
  const events = [];
  const simulation = new RoomSimulation('CHAIN', { random: () => .5, onEvent: event => events.push(event) });
  simulation.addPlayer('a');
  simulation.start('a');
  simulation.wave = wave - 1;
  simulation.beginWave();
  simulation.spawnTimer = 999;
  const player = simulation.players.get('a');
  Object.assign(player, { x: 0, y: 0, z: 2, yaw: 0, pitch: 0 });
  return { simulation, player, events };
}

function grenadeTarget(simulation, overrides = {}) {
  const target = simulation.spawnZombie();
  Object.assign(target, { x: 10, y: 0, z: -5, hp: 400, maxHp: 400, kind: 'walker', boss: false, scale: 1,
    entered: true, speed: 0, attackAfter: Infinity, ...overrides });
  return target;
}

function planted(simulation, overrides = {}) {
  const id = `g${simulation.nextGrenadeId++}`;
  const grenade = { id, ownerId: 'a', x: 10, y: .935, z: -5, vx: 0, vy: 0, vz: 0, fuseLeft: 1.8, ...overrides };
  simulation.grenades.set(id, grenade);
  return grenade;
}

test('KILL_CHAIN is a frozen score-only rule', () => {
  assert.deepEqual(KILL_CHAIN, { window: 2.5, bonusPerKill: 25, maxBonus: 100, holdMax: 4.5 });
  assert.equal(Object.isFrozen(KILL_CHAIN), true);
});

// The score is the useful damage (owner, 18 October): a kill event's `score`
// is now only what the kill itself adds, its chain bonus.
test('a first body-shot kill starts chain 1 with no bonus and scores only the health it removed', () => {
  const { simulation, player, events } = combat();
  zombie(simulation, 'body', { hp: 19 });
  shoot(simulation, player);
  const [kill] = kills(events);
  assert.equal(kill.chain, 1);
  assert.equal(kill.chainBonus, 0);
  assert.equal(kill.score, 0);
  assert.equal(kill.weapon, 'rifle');
  assert.ok(Number.isFinite(kill.range));
  assert.equal(player.score, 19, 'The 19 HP it had, no fixed hit or kill score');
  assert.equal(events.find(event => event.event === 'shot').headshots, 0);
});

test('a first head-shot kill scores its useful damage without a head bonus and counts in the shot headshots', () => {
  const { simulation, player, events } = combat();
  zombie(simulation, 'head', { y: 0, hp: 50 });
  shoot(simulation, player);
  const [kill] = kills(events);
  assert.equal(kill.headshot, true);
  assert.equal(kill.chain, 1);
  assert.equal(kill.chainBonus, 0);
  assert.equal(kill.score, 0);
  assert.equal(player.score, 50, 'the head pays in time and ammunition, not in score');
  assert.equal(events.filter(event => event.event === 'bullet-impact' && event.headshot).length, 1);
});

test('a second kill one second later chains with a 25 point bonus', () => {
  const { simulation, player, events } = combat();
  zombie(simulation, 'first', { hp: 19 });
  shoot(simulation, player);
  simulation.time += 1;
  zombie(simulation, 'second', { hp: 19 });
  shoot(simulation, player);
  const [first, second] = kills(events);
  assert.equal(second.chain, 2);
  assert.equal(second.chainBonus, 25);
  assert.equal(second.score, 25);
  assert.equal(player.score, 19 + 19 + 25);
  assert.equal(first.chain, 1);
});

test('kills 2.5 seconds apart still chain, 2.6 seconds apart reset', () => {
  for (const [gap, expected] of [[2.5, 2], [2.6, 1]]) {
    const { simulation, player, events } = combat();
    zombie(simulation, 'first', { hp: 19 });
    shoot(simulation, player);
    simulation.time += gap - .1; // Equal shot slots yield equal arrival gaps on this fixed line.
    zombie(simulation, 'second', { hp: 19 });
    shoot(simulation, player);
    const [, second] = kills(events);
    assert.equal(second.chain, expected, `${gap}s gap`);
    assert.equal(second.chainBonus, 25 * (expected - 1));
  }
});

test('the chain bonus caps at 100 from the fifth kill on', () => {
  const { simulation, player, events } = combat();
  for (let index = 0; index < 7; index++) {
    zombie(simulation, `z${index}`, { hp: 19 });
    shoot(simulation, player);
  }
  assert.deepEqual(kills(events).map(event => event.chain), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(kills(events).map(event => event.chainBonus), [0, 25, 50, 75, 100, 100, 100]);
  assert.deepEqual(kills(events).map(event => event.score), [0, 25, 50, 75, 100, 100, 100]);
});

test('several kills from one piercing shot chain in emission order', () => {
  const { simulation, player, events } = combat();
  zombie(simulation, 'head', { y: 0, z: 1, hp: 50 });
  zombie(simulation, 'body', { y: 0.4, z: -1, hp: 19 });
  zombie(simulation, 'rear-head', { y: 0, z: -3, hp: 21 });
  shoot(simulation, player);
  const pierced = kills(events);
  assert.deepEqual(pierced.map(event => event.zombieId), ['head', 'body', 'rear-head']);
  assert.deepEqual(pierced.map(event => event.chain), [1, 2, 3]);
  assert.deepEqual(pierced.map(event => event.chainBonus), [0, 25, 50]);
  assert.deepEqual(pierced.map(event => event.score), [0, 25, 50]);
  assert.equal(events.filter(event => event.event === 'bullet-impact' && event.headshot).length, 2, 'Both pierced heads count');
  assert.equal(player.score, 50 + 19 + 21 + 25 + 50);
});

test('grenade kills carry the grenade weapon, chain and score', () => {
  const { simulation, player, events } = grenadeRoom();
  const victims = [grenadeTarget(simulation), grenadeTarget(simulation, { z: -4.5 }), grenadeTarget(simulation, { z: -5.5 })];
  simulation.explodeGrenade(planted(simulation));
  const blasts = kills(events);
  assert.equal(blasts.length, 3);
  assert.ok(blasts.every(event => event.weapon === 'grenade'));
  assert.deepEqual(blasts.map(event => event.chain), [1, 2, 3]);
  assert.deepEqual(blasts.map(event => event.chainBonus), [0, 25, 50]);
  assert.deepEqual(blasts.map(event => event.score), [0, 25, 50]);
  assert.equal(player.score, 3 * 400 + 25 + 50, 'three bodies of 400 HP, their chain bonuses');
  // Cash and loot are exactly what the same kills gave before chains existed.
  const pickups = [...simulation.pickups.values()];
  assert.deepEqual(pickups.filter(pickup => pickup.kind === 'points').map(pickup => pickup.amount),
    victims.map(target => killCash(target, false)));
  assert.equal(player.points, 0, 'Money remains a world pickup until somebody collects it');
});

test('a grenade whose owner left scores nothing and does not throw', () => {
  const { simulation, events } = grenadeRoom();
  grenadeTarget(simulation);
  const grenade = planted(simulation);
  simulation.removePlayer('a');
  assert.doesNotThrow(() => simulation.explodeGrenade(grenade));
  const [kill] = kills(events);
  assert.equal(kill.weapon, 'grenade');
  assert.equal(kill.chain, 0);
  assert.equal(kill.chainBonus, 0);
  assert.equal(kill.score, 0);
});

test('melee and rocket kills keep their weapon on the kill event', () => {
  // Bat in practice mode, like bat.test.mjs.
  const events = [];
  const sim = new RoomSimulation('CHAIN', { practice: true, random: () => .5, onEvent: event => events.push(event) });
  const a = sim.addPlayer('a');
  sim.zombies.clear();
  Object.assign(a, { x: 12, y: 0, z: 8, yaw: 0, pitch: 0, weapon: 'bat',
    inventory: { bat: { ammo: 0, reserve: 0 }, pistol: { ammo: 7, reserve: 11 } } });
  sim.zombies.set('melee', { id: 'melee', x: 12, y: 0, z: 6.65, yaw: 0, hp: 100, maxHp: 100,
    kind: 'walker', scale: 1, speed: 0, attackAfter: Infinity, entered: true });
  assert.equal(sim.shoot('a', 0, 'light'), true);
  let remaining = .13;
  while (remaining > 1e-8) {
    const step = Math.min(1 / 30, remaining);
    for (const player of sim.players.values()) player.lastInputAt = sim.time;
    sim.tick(step);
    remaining -= step;
  }
  const [melee] = kills(events);
  assert.equal(melee.weapon, 'bat');
  assert.equal(melee.chain, 1);
  assert.equal(melee.score, 0);
  assert.equal(a.score, 100, 'the practice stand keeps its running score: the bat removed 100 HP');

  const { simulation, player, events: rocketEvents } = combat('rocket');
  zombie(simulation, 'blasted', { y: 0, hp: 100 });
  shoot(simulation, player);
  const [rocket] = kills(rocketEvents);
  assert.equal(rocket.weapon, 'rocket');
  assert.equal(rocket.chain, 1);
  assert.equal(rocket.chainBonus, 0);
  assert.equal(rocket.score, 0);
  assert.equal(player.score, 100, 'the rocket scores the 100 HP it removed, not its 700 power');
  assert.equal(rocketEvents.find(event => event.event === 'shot').headshots, 0);
});

test('flamethrower shot events report zero headshots', () => {
  const { simulation, player, events } = combat('flamethrower');
  zombie(simulation, 'burning', { y: 0 });
  shoot(simulation, player);
  const shot = events.find(event => event.event === 'shot');
  assert.equal(shot.weapon, 'flamethrower');
  assert.equal(shot.headshots, 0);
});

test('chained hitscan kills drop exactly the ordinary cash', () => {
  const { simulation, player, events } = combat();
  zombie(simulation, 'first', { hp: 19 });
  shoot(simulation, player);
  simulation.time += 1;
  zombie(simulation, 'second', { hp: 19 });
  shoot(simulation, player);
  const [, second] = kills(events);
  assert.equal(second.chainBonus, 25);
  const amounts = [...simulation.pickups.values()].filter(pickup => pickup.kind === 'points').map(pickup => pickup.amount);
  assert.deepEqual(amounts, [killCash({ kind: 'walker' }, false), killCash({ kind: 'walker' }, false)]);
  assert.equal(player.points, 0);
});

test('chain bookkeeping never leaks into snapshots and a restarted night rechains from one', () => {
  const { simulation, player, events } = combat();
  zombie(simulation, 'first', { hp: 19 });
  shoot(simulation, player);
  simulation.time += 1;
  zombie(simulation, 'second', { hp: 19 });
  shoot(simulation, player);
  assert.equal(kills(events).at(-1).chain, 2);
  const snapshotPlayer = simulation.snapshot().players.find(item => item.id === 'a');
  assert.equal('killChain' in snapshotPlayer, false);
  assert.equal('lastKillAt' in snapshotPlayer, false);
  // End the night like simulation.test.mjs and start the next one.
  for (let index = 0; index < Math.ceil(5.1 * 30); index++) simulation.tick(1 / 30);
  assert.equal(simulation.phase, 'wave');
  simulation.damagePlayer(player, 100, { id: 'fake' });
  simulation.tick();
  assert.equal(simulation.phase, 'gameover');
  assert.equal(simulation.start('a'), true);
  assert.equal(player.killChain, 0, 'start() resets the chain count');
  assert.equal(player.lastKillAt, -Infinity, 'start() forgets the last kill time');
  events.length = 0;
  Object.assign(player, { x: -4.4, y: 0, z: 4, yaw: 0, pitch: 0 });
  player.weapon = 'rifle';
  player.inventory.rifle = { ammo: WEAPONS.rifle.magazine, reserve: WEAPONS.rifle.reserve };
  zombie(simulation, 'restarted', { hp: 19 });
  shoot(simulation, player);
  const [kill] = kills(events);
  assert.equal(kill.chain, 1, 'A new night never continues an old chain');
  assert.equal(kill.chainBonus, 0);
  assert.equal(player.score, 19);
});

test('every chain has its own number, shared by its kills and raised by the next chain', () => {
  const { simulation, player, events } = combat();
  for (const [index, gap] of [0, 1, 1, 3, 1].entries()) {
    simulation.time += gap;
    zombie(simulation, `n${index}`, { hp: 19 });
    shoot(simulation, player);
  }
  assert.deepEqual(kills(events).map(event => [event.chain, event.chainId]), [[1, 1], [2, 1], [3, 1], [1, 2], [2, 2]]);
});

// Spec rule 1: practice rooms keep their score behaviour, chain bonus included.
test('a practice stand chains its kills with their bonus, as it always did', () => {
  const events = [];
  const sim = new RoomSimulation('CHAIN', { practice: true, random: () => .5, onEvent: event => events.push(event) });
  const a = sim.addPlayer('a');
  sim.zombies.clear();
  Object.assign(a, { x: -4.4, y: 0, z: 4, yaw: 0, pitch: 0 });
  for (const id of ['p1', 'p2']) {
    sim.zombies.set(id, { id, x: -4.4, y: .4, z: 1, hp: 5, maxHp: 5, kind: 'walker', scale: 1, speed: 0, attackAfter: Infinity, entered: true });
    shoot(sim, a);
  }
  assert.deepEqual(kills(events).map(event => [event.chain, event.chainBonus, event.score]), [[1, 0, 0], [2, 25, 25]]);
  assert.equal(a.score, 5 + 5 + 25, 'their damage and the chain bonus, never coins');
  assert.equal(a.points, 0);
});
