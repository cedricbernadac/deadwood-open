import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation } from '../simulation.mjs';
import { ARMOR, PICKUPS } from '../public/rules.js';
import { completeRevive } from './helpers/revive.mjs';

// A vest found on the ground from wave 10: 100 armor taken before health by
// zombie blows and falls, never by exposure outside, kept between waves,
// lost when its wearer goes down and reset on restart.
function room(players = ['a']) {
  const events = [];
  const simulation = new RoomSimulation('ARMOR', { random: () => .5, onEvent: event => events.push(event) });
  for (const id of players) simulation.addPlayer(id, id);
  simulation.start(players[0]);
  simulation.phase = 'wave';
  return { simulation, events, player: simulation.players.get(players[0]) };
}
const lastHit = events => events.filter(event => event.event === 'hit').at(-1);

test('the vest absorbs blows first, then health takes the remainder', () => {
  const { simulation, events, player } = room();
  assert.equal(player.armor, 0);
  player.armor = ARMOR.max;
  simulation.damagePlayer(player, 32, { id: 'brute' });
  assert.deepEqual([player.armor, player.hp], [68, 100]);
  assert.deepEqual([lastHit(events).damage, lastHit(events).absorbed, lastHit(events).armor], [32, 32, 68], 'the hit still reports the full blow');
  player.armor = 10;
  simulation.damagePlayer(player, 32, { id: 'brute' });
  assert.deepEqual([player.armor, player.hp], [0, 78]);
  assert.equal(lastHit(events).absorbed, 10);
  simulation.damagePlayer(player, 11, { id: 'walker' });
  assert.deepEqual([player.armor, player.hp], [0, 67]);
  assert.equal(lastHit(events).absorbed, 0);
});

test('falls hit the vest but the danger outside goes straight to health', () => {
  const { simulation, player } = room();
  player.armor = 50;
  simulation.damagePlayer(player, 15, { source: 'fall' });
  assert.deepEqual([player.armor, player.hp], [35, 100]);
  simulation.damagePlayer(player, 3, { source: 'outside' });
  assert.deepEqual([player.armor, player.hp], [35, 97]);
  Object.assign(player, { x: 11, z: 0, outsideDamageAccumulator: 0 });
  for (let tick = 0; tick < 31; tick++) simulation.updateOutsideDamage(player, 1 / 30);
  assert.deepEqual([player.armor, player.hp], [35, 94], 'one real second outside');
});

test('a survivor who goes down loses the vest; a revive or the next wave does not give it back', () => {
  const { simulation, events, player } = room(['a', 'b']);
  Object.assign(player, { armor: 40, hp: 2 });
  simulation.damagePlayer(player, 3, { source: 'outside' });
  assert.equal(player.downed, true);
  assert.equal(player.armor, 0);
  assert.deepEqual([lastHit(events).absorbed, lastHit(events).armor], [0, 0], 'the hit already reports the lost vest');
  assert.ok(events.some(event => event.event === 'down' && event.id === 'a'));
  const helper = simulation.players.get('b');
  Object.assign(helper, { x: player.x + .5, y: player.y, z: player.z });
  assert.equal(completeRevive(simulation, 'b'), true);
  assert.deepEqual([player.downed, player.armor], [false, 0]);
  player.armor = 70;
  simulation.zombies.clear(); simulation.toSpawn = 0; simulation.tick(1 / 30);
  assert.equal(simulation.phase, 'intermission');
  assert.deepEqual([player.hp, player.armor], [100, 70], 'health is restored between waves, armor is not');
  simulation.phase = 'gameover'; assert.equal(simulation.start('a'), true);
  assert.equal(player.armor, 0, 'a new night starts without armor');
});

test('every blow fully stopped by the vest is still a hit for animations and crowd tracking', () => {
  const { simulation, events, player } = room();
  player.armor = ARMOR.max;
  const zombie = simulation.spawnZombie();
  Object.assign(zombie, { x: player.x, y: 0, z: player.z - .7, entered: true, attackAfter: 0, speed: 0 });
  simulation.toSpawn = 1; simulation.spawnTimer = 999;
  simulation.updateZombie(zombie, 1 / 30, [player]);
  const hit = lastHit(events);
  assert.ok(hit && hit.zombieId === zombie.id, 'the real zombie melee path');
  assert.equal(hit.absorbed, hit.damage);
  assert.equal(player.hp, 100);
  assert.equal(player.armor, ARMOR.max - hit.damage);
  assert.equal(simulation.snapshot().players[0].armor, player.armor);
});

test('vests drop every sixtieth team kill from wave 10, never before', () => {
  assert.deepEqual([PICKUPS.armorFromWave, PICKUPS.armorEveryKills], [10, 60]);
  for (const [wave, expected] of [[9, 0], [10, 1], [14, 1]]) {
    const { simulation } = room();
    simulation.wave = wave;
    simulation.lootKills = PICKUPS.armorEveryKills - 1;
    simulation.dropZombieLoot({ x: 1, y: 0, z: 1, kind: 'walker' }, 18);
    const vests = [...simulation.pickups.values()].filter(pickup => pickup.kind === 'armor');
    assert.equal(vests.length, expected, `wave ${wave}`);
    if (expected) {
      assert.equal(vests[0].amount, ARMOR.max);
      assert.equal(simulation.snapshot().pickups.find(pickup => pickup.kind === 'armor').expiresIn, PICKUPS.lifetime);
    }
    simulation.dropZombieLoot({ x: 1, y: 0, z: 1, kind: 'walker' }, 18);
    assert.equal([...simulation.pickups.values()].filter(pickup => pickup.kind === 'armor').length, expected, 'not on the next kill');
  }
  // Before kill 300 a vest never lands on the same corpse as a medkit.
  for (let kills = PICKUPS.armorEveryKills; kills < 300; kills += PICKUPS.armorEveryKills) assert.notEqual(kills % PICKUPS.healthEveryKills, 0);
});

test('the nearest survivor missing armor takes the vest; a full one leaves it for the next', () => {
  const { simulation, events } = room(['a', 'b']);
  const [full, worn] = ['a', 'b'].map(id => simulation.players.get(id));
  Object.assign(full, { x: 1, y: 0, z: 1, armor: ARMOR.max });
  Object.assign(worn, { x: 1.4, y: 0, z: 1, armor: 30 });
  simulation.pickups.set('v', { id: 'v', kind: 'armor', x: 1, y: 0, z: 1, amount: ARMOR.max, special: false, expiresAt: simulation.time + 90 });
  simulation.collectPickups();
  assert.equal(simulation.pickups.has('v'), false);
  assert.deepEqual([full.armor, worn.armor], [ARMOR.max, ARMOR.max]);
  const pickup = events.find(event => event.event === 'pickup');
  assert.deepEqual([pickup.id, pickup.kind, pickup.armorGained, pickup.armor], ['b', 'armor', 70, ARMOR.max]);

  // Downed survivors and frozen phases cannot take it.
  simulation.pickups.set('w', { id: 'w', kind: 'armor', x: 1, y: 0, z: 1, amount: ARMOR.max, special: false, expiresAt: simulation.time + 90 });
  Object.assign(worn, { armor: 0, downed: true }); full.armor = ARMOR.max;
  simulation.collectPickups();
  assert.equal(simulation.pickups.has('w'), true);
  worn.downed = false; simulation.phase = 'victory';
  simulation.collectPickups();
  assert.equal(simulation.pickups.has('w'), true);
});

test('the practice range never drops a vest and never damages anyone', () => {
  const simulation = new RoomSimulation('PRACTICE', { random: () => .5, practice: true });
  const player = simulation.addPlayer('a', 'a');
  simulation.wave = 12; simulation.lootKills = PICKUPS.armorEveryKills - 1;
  simulation.dropZombieLoot({ x: 1, y: 0, z: 1, kind: 'walker' }, 18);
  assert.equal([...simulation.pickups.values()].some(pickup => pickup.kind === 'armor'), false);
  player.armor = 50; simulation.damagePlayer(player, 40, { id: 'z' });
  assert.deepEqual([player.hp, player.armor], [100, 50]);
});
