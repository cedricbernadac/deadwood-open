import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation } from '../simulation.mjs';
import { REVIVE, COIN_GIFT, PICKUPS, DIFFICULTY, DIFFICULTY_LEVELS, difficultyOf, supplyCadence, ECONOMY, STARTER_WEAPON } from '../public/rules.js';
import { LATE_SUPPLIES } from '../public/weapon-upgrades.js';
import { RAIDS, RAID_ENTRIES } from '../public/raids.js';

// Getting back up, giving coins, difficulty and robbing raiders (owner,
// 13 October). Open floor: the column x = -4.5 is clear from z = -2.7 to 1.5.
function room(names = ['a', 'b']) {
  const events = [];
  const simulation = new RoomSimulation('REVIVE', { random: () => .5, onEvent: event => events.push(event) });
  const players = names.map(name => simulation.addPlayer(name, name.toUpperCase()));
  simulation.start(names[0]);
  simulation.timeLeft = 999; // a long countdown: nothing spawns
  players.forEach((player, index) => Object.assign(player, { x: -4.5, y: 0, z: 1.5 - index * .9, yaw: 0, pitch: 0 }));
  return { simulation, players, events };
}
const down = (simulation, player) => Object.assign(player, { downed: true, hp: 0, bleedOutAt: simulation.time + REVIVE.bleedOut });
const ticks = (simulation, seconds, every = null) => {
  let since = 0;
  for (let step = 0; step < Math.round(seconds * 30); step++) {
    simulation.tick(1 / 30); since += 1 / 30;
    if (every && since >= .5 - 1e-9) { every(); since = 0; }
  }
};
const named = (events, name) => events.filter(event => event.event === name);

test('a teammate revive takes five seconds of holding E, pauses the bleed-out and pays once', () => {
  const { simulation, players: [a, b], events } = room();
  down(simulation, b);
  const bleedOut = b.bleedOutAt;
  assert.equal(simulation.interact('a'), true);
  assert.deepEqual(named(events, 'revive-start').map(({ id, targetId, duration }) => ({ id, targetId, duration })), [{ id: 'a', targetId: 'b', duration: REVIVE.duration }]);
  ticks(simulation, REVIVE.duration - .2, () => simulation.interact('a'));
  assert.equal(b.downed, true, 'not before five seconds');
  const status = simulation.snapshot().players.find(player => player.id === 'b');
  assert.equal(status.revivedBy, 'a'); assert.ok(status.reviveLeft > 0 && status.reviveLeft < .3);
  assert.ok(b.bleedOutAt - simulation.time > REVIVE.bleedOut - .3, 'the bleed-out waited');
  ticks(simulation, .3, () => simulation.interact('a'));
  assert.equal(b.downed, false); assert.equal(b.hp, REVIVE.teammateHp);
  // The coins at once; the score with the revive credit, at the end of the wave (owner, 18 October).
  assert.equal(a.points, ECONOMY.revive); assert.equal(a.score, 0);
  assert.deepEqual(simulation.reviveCredits.map(({ reviverId, revivedId, open }) => [reviverId, revivedId, open]), [['a', 'b', true]]);
  assert.equal(named(events, 'revive').length, 1);
  assert.ok(bleedOut > 0);
});

test('letting go of E or walking away stops the revive; it starts over', () => {
  const { simulation, players: [a, b], events } = room();
  down(simulation, b);
  simulation.interact('a');
  ticks(simulation, 2, () => simulation.interact('a'));
  ticks(simulation, REVIVE.holdGrace + .2); // E released
  assert.equal(a.reviving, null);
  assert.equal(named(events, 'revive-stop').length, 1);
  assert.equal(b.downed, true);
  simulation.interact('a');
  ticks(simulation, 1, () => simulation.interact('a'));
  a.z += 3; // out of reach
  ticks(simulation, .1, () => simulation.interact('a'));
  assert.equal(a.reviving, null); assert.equal(b.downed, true);
});

test('a revive shields for two seconds, so a zombie over the body cannot knock the survivor straight down', () => {
  const { simulation, players: [, b] } = room();
  down(simulation, b);
  simulation.revivePlayer(b, REVIVE.teammateHp);
  simulation.damagePlayer(b, 40);
  assert.equal(b.hp, REVIVE.teammateHp, 'shielded');
  ticks(simulation, REVIVE.shield + .05);
  simulation.damagePlayer(b, 40);
  assert.equal(b.hp, REVIVE.teammateHp - 40);
});

test('a revive kit gets its owner up in five seconds, pauses the bleed-out and is spent', () => {
  const { simulation, players: [a], events } = room(['a']);
  a.reviveKit = true; down(simulation, a);
  assert.equal(simulation.useReviveKit('a'), true);
  assert.equal(simulation.useReviveKit('a'), true, 'pressing again keeps the same revive');
  ticks(simulation, REVIVE.kitDuration - .2);
  assert.equal(a.downed, true);
  const status = simulation.snapshot().players[0];
  assert.equal(status.revivedBy, 'a'); assert.equal(status.reviveKit, true);
  ticks(simulation, .3);
  assert.equal(a.downed, false); assert.equal(a.hp, REVIVE.kitHp); assert.equal(a.reviveKit, false);
  assert.deepEqual(named(events, 'revive').map(({ id, targetId, kit }) => ({ id, targetId, kit })), [{ id: 'a', targetId: 'a', kit: true }]);
});

test('alone and down, a kit keeps the night going, and is used on its own when the bleed-out runs out', () => {
  const { simulation, players: [a], events } = room(['a']);
  simulation.phase = 'wave'; simulation.toSpawn = 0;
  simulation.zombies.set('far', { id: 'far', x: 30, y: 0, z: 30, hp: 1e6, maxHp: 1e6, kind: 'walker', scale: 1, speed: 0, attackAfter: Infinity });
  a.reviveKit = true; down(simulation, a);
  ticks(simulation, 1);
  assert.equal(simulation.phase, 'wave', 'not game over while a kit remains');
  ticks(simulation, REVIVE.bleedOut);
  assert.equal(a.downed, false); assert.equal(a.alive, true); assert.equal(a.reviveKit, false);
  assert.equal(named(events, 'revive').at(-1).automatic, true);
  const { simulation: other, players: [b] } = room(['b']);
  other.phase = 'wave'; other.toSpawn = 0;
  other.zombies.set('far', { id: 'far', x: 30, y: 0, z: 30, hp: 1e6, maxHp: 1e6, kind: 'walker', scale: 1, speed: 0, attackAfter: Infinity });
  down(other, b);
  ticks(other, .1);
  assert.equal(other.phase, 'gameover', 'without a kit, alone and down is still the end');
});

test('a kit used on a downed teammate revives them at once and pays the helper', () => {
  const { simulation, players: [a, b], events } = room();
  down(simulation, b);
  assert.equal(simulation.useReviveKit('a'), false, 'no kit, no instant revive');
  a.reviveKit = true;
  assert.equal(simulation.useReviveKit('a'), true);
  assert.equal(b.downed, false); assert.equal(b.hp, REVIVE.kitHp); assert.equal(a.reviveKit, false);
  assert.equal(a.points, ECONOMY.revive);
  assert.deepEqual(named(events, 'revive').map(({ id, targetId, kit }) => ({ id, targetId, kit })), [{ id: 'a', targetId: 'b', kit: true }]);
  a.reviveKit = true; down(simulation, b); b.z -= 3;
  assert.equal(simulation.useReviveKit('a'), false, 'out of reach');
  assert.equal(a.reviveKit, true);
});

test('revive kits drop from wave 3 at a difficulty-scaled cadence, one carried at a time', () => {
  assert.equal(supplyCadence(PICKUPS.reviveEveryKills, 'normal'), 90);
  assert.equal(supplyCadence(PICKUPS.healthEveryKills, 'normal'), 25);
  assert.ok(supplyCadence(PICKUPS.reviveEveryKills, 'very-easy') < 40 && supplyCadence(PICKUPS.reviveEveryKills, 'nightmare') > 150);
  const { simulation, players: [a, b] } = room();
  simulation.wave = 3; simulation.lootKills = 89;
  simulation.dropZombieLoot({ id: 'z', x: -4.5, y: 0, z: 1, kind: 'walker', maxHp: 80 }, 18);
  const kit = [...simulation.pickups.values()].find(pickup => pickup.kind === 'revive');
  assert.ok(kit, 'kill 90 drops a kit');
  Object.assign(kit, { x: a.x, z: a.z });
  a.reviveKit = true; Object.assign(b, { x: 5, z: 5 });
  simulation.collectPickups();
  assert.equal(simulation.pickups.has(kit.id), true, 'left for a teammate');
  Object.assign(kit, { x: b.x, z: b.z });
  simulation.collectPickups();
  assert.equal(b.reviveKit, true); assert.equal(simulation.pickups.has(kit.id), false);
  simulation.wave = 2; simulation.lootKills = 89;
  simulation.dropZombieLoot({ id: 'z2', x: -4.5, y: 0, z: 1, kind: 'walker', maxHp: 80 }, 18);
  assert.equal([...simulation.pickups.values()].filter(pickup => pickup.kind === 'revive').length, 0, 'not before wave 3');
});

test('the supply post sells one revive kit from wave 5 for 1200 coins', () => {
  const { simulation, players: [a], events } = room(['a']);
  assert.equal(LATE_SUPPLIES.items.revive.price, 1200); assert.equal(LATE_SUPPLIES.items.revive.unlockWave, 5);
  simulation.phase = 'wave'; simulation.wave = 5;
  Object.assign(a, { x: LATE_SUPPLIES.position.x, y: 0, z: LATE_SUPPLIES.position.z + 1.2, points: 2500 });
  assert.equal(simulation.supplyAction(a), 'station');
  assert.equal(simulation.buySupply('a', 'revive'), true);
  assert.equal(a.reviveKit, true); assert.equal(a.points, 1300);
  a.supplyPurchases = [];
  assert.equal(simulation.buySupply('a', 'revive'), false);
  assert.equal(named(events, 'supply-denied').at(-1).reason, 'carried');
});

test('a pack of 100 coins goes to a teammate, never back to its dropper at once', () => {
  const { simulation, players: [a, b], events } = room();
  a.points = 250; Object.assign(b, { x: 5, z: 5 });
  assert.equal(simulation.dropCoins('a'), true);
  const pack = [...simulation.pickups.values()].find(pickup => pickup.droppedBy === 'a');
  assert.deepEqual([pack.kind, pack.amount, a.points], ['points', COIN_GIFT.amount, 150]);
  ticks(simulation, 1);
  assert.equal(simulation.pickups.has(pack.id), true, 'not collected by its dropper');
  Object.assign(b, { x: pack.x, z: pack.z + .3 });
  ticks(simulation, .2);
  assert.equal(b.points, COIN_GIFT.amount);
  assert.equal(named(events, 'pickup').at(-1).fromId, 'a');
  a.points = 99;
  assert.equal(simulation.dropCoins('a'), false, 'at least 100');
  a.points = 300; simulation.time += 1;
  simulation.dropCoins('a');
  const second = [...simulation.pickups.values()].find(pickup => pickup.droppedBy === 'a');
  Object.assign(b, { x: 5, z: 5 });
  ticks(simulation, COIN_GIFT.dropperDelay + .2);
  assert.equal(simulation.pickups.has(second.id), false, 'after three seconds the dropper can take it back');
});

test('the host picks the difficulty before the night; it scales blows taken, supplies and raiders', () => {
  const events = [], simulation = new RoomSimulation('DIFF', { random: () => .5, onEvent: event => events.push(event) });
  const a = simulation.addPlayer('a', 'A'); simulation.addPlayer('b', 'B');
  assert.deepEqual([...DIFFICULTY_LEVELS], ['very-easy', 'easy', 'normal', 'hard', 'nightmare']);
  assert.equal(simulation.snapshot().difficulty, 'normal');
  assert.equal(simulation.setDifficulty('b', 'easy'), false, 'host only');
  assert.equal(simulation.setDifficulty('a', 'impossible'), false);
  assert.equal(simulation.setDifficulty('a', 'very-easy'), true);
  assert.equal(simulation.snapshot().difficulty, 'very-easy');
  simulation.start('a');
  assert.equal(simulation.setDifficulty('a', 'nightmare'), false, 'not during the night');
  simulation.timeLeft = 999;
  simulation.damagePlayer(a, 40);
  assert.equal(a.hp, 100 - 40 * DIFFICULTY['very-easy'].damageTaken);
  simulation.difficulty = 'nightmare'; a.hp = 100;
  simulation.damagePlayer(a, 40);
  assert.equal(a.hp, 100 - 40 * DIFFICULTY.nightmare.damageTaken);
  assert.equal(difficultyOf('unknown'), DIFFICULTY.normal);
});

test('raiders who down a survivor take half the coins and the weapon in hand; the Magnum falls instead', () => {
  const { simulation, players: [a], events } = room(['a']);
  Object.assign(a, { points: 301, weapon: 'smg', inventory: { pistol: { ammo: 12, reserve: 36 }, smg: { ammo: 30, reserve: 60 } } });
  a.issuedWeapons = new Set(['pistol', 'smg']);
  simulation.damagePlayer(a, 999, { source: 'raider', id: 'r1', x: 0, z: 0 });
  assert.equal(a.downed, true);
  assert.equal(a.points, 151);
  assert.deepEqual(Object.keys(a.inventory), ['pistol']); assert.equal(a.weapon, 'pistol');
  assert.equal(a.issuedWeapons.has('smg'), false, 'the stolen gun can be bought again');
  assert.deepEqual(named(events, 'robbed').map(({ coins, weapon }) => ({ coins, weapon })), [{ coins: 150, weapon: 'smg' }]);
  const lone = room(['b']), b = lone.players[0];
  Object.assign(b, { points: 10, weapon: 'katana', inventory: { katana: { ammo: 0, reserve: 0 } } });
  lone.simulation.damagePlayer(b, 999, { source: 'raider', id: 'r2', x: 0, z: 0 });
  assert.deepEqual(Object.keys(b.inventory), [STARTER_WEAPON], 'never left empty-handed');
  const gold = room(['c']), c = gold.players[0];
  Object.assign(c, { points: 0, weapon: 'magnum', inventory: { magnum: { ammo: 6, reserve: 0 }, rifle: { ammo: 10, reserve: 10 } } });
  gold.simulation.damagePlayer(c, 999, { source: 'raider', id: 'r3', x: 0, z: 0 });
  assert.ok([...gold.simulation.pickups.values()].some(pickup => pickup.kind === 'weapon' && pickup.weapon === 'magnum'), 'the Magnum is on the floor');
  assert.equal(named(gold.events, 'robbed')[0].weapon, null);
  assert.equal(named(gold.events, 'robbed')[0].magnum, true, 'the client can say where it went');
  const zombie = room(['d']), d = zombie.players[0];
  Object.assign(d, { points: 200 });
  zombie.simulation.damagePlayer(d, 999, { id: 'z1' });
  assert.equal(d.points, 200, 'zombies do not rob');
});

test('the difficulty scales the raiders health and firepower, never the practice drills', () => {
  const made = (level, practice = false) => {
    const simulation = new RoomSimulation('RAIDDIFF', { random: () => .5, practice });
    simulation.difficulty = level;
    return simulation.createRaider(1, RAID_ENTRIES[0], { index: 1, damageScale: 1 });
  };
  const normal = made('normal');
  assert.equal(normal.hp, RAIDS.hp[0]);
  for (const level of ['very-easy', 'hard', 'nightmare']) {
    const raider = made(level), strength = DIFFICULTY[level].raiders;
    assert.equal(raider.hp, Math.round(RAIDS.hp[0] * strength), level);
    assert.ok(Math.abs(raider.damageScale - strength) < 1e-9, level);
    assert.ok(Math.abs(raider.damage - normal.damage * strength) < 1e-9, level);
  }
  assert.equal(made('nightmare', true).hp, RAIDS.hp[0], 'drills stay as they are');
});

// Review of 13 October: a held revive press stays a revive.
test('a held revive press never buys: the teammate gets up with their own kit next to a rack', () => {
  const { simulation, players: [a, b], events } = room();
  simulation.wave = 2; a.points = 1000;
  Object.assign(b, { x: 5, y: 0, z: -5.15, reviveKit: true });
  Object.assign(a, { x: 6.95, y: 0, z: -5.15 }); // 1.95 m from B, 0.87 m from the shotgun rack
  down(simulation, b);
  assert.equal(simulation.useReviveKit('b'), true); // B gets up on their own in 5 s
  ticks(simulation, 1);
  assert.equal(simulation.interact('a', { revive: true }), true); assert.equal(a.reviving?.targetId, 'b');
  ticks(simulation, 6, () => simulation.interact('a', { revive: true })); // E still held
  assert.equal(b.downed, false);
  assert.equal(a.points, 1000); assert.equal(a.weapon, STARTER_WEAPON);
  assert.equal(named(events, 'purchase').length, 0);
  // The rack was in reach all along: a fresh, ordinary press buys.
  simulation.time += 1;
  assert.equal(simulation.interact('a'), true); assert.equal(a.weapon, 'shotgun');
});

test('a revive keeps going up to REVIVE.reach while E is held', () => {
  const { simulation, players: [a, b] } = room();
  Object.assign(b, { z: a.z - (REVIVE.startReach - .1) }); down(simulation, b);
  assert.equal(simulation.interact('a', { revive: true }), true);
  b.z = a.z - (REVIVE.startReach + REVIVE.reach) / 2; // drifted back, still within reach
  ticks(simulation, REVIVE.duration + .2, () => simulation.interact('a', { revive: true }));
  assert.equal(b.downed, false, 'revived from between the two reaches');
});

test('a held revive sticks to its teammate when another one falls closer, and the kit goes to that teammate first', () => {
  const { simulation, players: [a, b, c], events } = room(['a', 'b', 'c']);
  down(simulation, c);
  simulation.interact('a', { revive: true });
  ticks(simulation, 3, () => simulation.interact('a', { revive: true }));
  down(simulation, b); // closer to A, and first in the room
  ticks(simulation, REVIVE.duration - 3 + .2, () => simulation.interact('a', { revive: true }));
  assert.equal(c.downed, false, 'C got up after five seconds in total');
  assert.equal(b.downed, true);
  assert.equal(named(events, 'revive-stop').length, 0);
  // With a kit: F goes to the teammate being revived, even past the start reach.
  const second = room(['a', 'b', 'c']), [a2, b2, c2] = second.players;
  a2.reviveKit = true; down(second.simulation, c2);
  second.simulation.interact('a', { revive: true });
  c2.z = a2.z - (REVIVE.startReach + REVIVE.reach) / 2;
  down(second.simulation, b2);
  ticks(second.simulation, .5, () => second.simulation.interact('a', { revive: true }));
  assert.equal(second.simulation.useReviveKit('a'), true);
  assert.equal(c2.downed, false); assert.equal(b2.downed, true); assert.equal(a2.reviving, null);
});

test('a survivor with only the starter pistol keeps it as it is when robbed; the outside rate follows the difficulty', () => {
  const { simulation, players: [a], events } = room(['a']);
  Object.assign(a, { points: 1, weapon: STARTER_WEAPON, inventory: { [STARTER_WEAPON]: { ammo: 0, reserve: 0 } } });
  simulation.damagePlayer(a, 999, { source: 'raider', id: 'r1', x: 0, z: 0 });
  assert.deepEqual(a.inventory, { [STARTER_WEAPON]: { ammo: 0, reserve: 0 } }, 'no free refill');
  assert.deepEqual(named(events, 'robbed').map(({ coins, weapon }) => ({ coins, weapon })), [{ coins: 0, weapon: null }]);
  for (const [level, rate] of [['very-easy', 1.5], ['normal', 3], ['nightmare', 4.8]]) {
    const night = new RoomSimulation('RAIN'); night.difficulty = level;
    assert.equal(night.snapshot().outsideDamagePerSecond, rate, level);
  }
});

test('the snapshot names the teammate a survivor can revive, never one behind a wall', () => {
  const { simulation, players: [a, b] } = room();
  down(simulation, b);
  const target = () => simulation.snapshot().players.find(player => player.id === 'a').reviveTargetId;
  assert.equal(target(), 'b');
  Object.assign(a, { x: 6.95, y: 0, z: -5.15 }); Object.assign(b, { x: 8.9, y: 0, z: -5.15 }); // the east wall between them
  assert.equal(target(), null);
  assert.equal(simulation.interact('a', { revive: true }), false);
});
