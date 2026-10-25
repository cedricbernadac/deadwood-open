import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WORLD, WEAPONS } from '../simulation.mjs';
import { EXPEDITION, EXTERIOR, RAIN, UMBRELLA, GENERATOR, GENERATOR_BOUNDS, FUEL_CACHES, SPAWN_WARNING, MAX_WAVES, waveBalance, hasRainShelter, rainRoofHeight } from '../public/rules.js';
import { completeRevive } from './helpers/revive.mjs';

function room(ids = ['a'], practice = false) {
  const events = [];
  const simulation = new RoomSimulation('EXP123', { random: () => .5, practice, onEvent: event => events.push(event) });
  for (const id of ids) simulation.addPlayer(id);
  if (!practice) { simulation.start(ids[0]); simulation.phase = 'intermission'; simulation.timeLeft = 100000; }
  return { simulation, events, player: simulation.players.get(ids[0]) };
}
function advance(simulation, seconds, hz = 30) {
  let left = seconds;
  while (left > 1e-8) { const delta = Math.min(left, 1 / hz); simulation.tick(delta); left -= delta; }
}
function mission(simulation, wave = 5) {
  simulation.wave = wave - 1; simulation.beginWave(); simulation.spawnTimer = 100000;
}
function atGenerator(player) { Object.assign(player, { x: GENERATOR.x + 1.2, y: GENERATOR.y, z: GENERATOR.z, grounded: true }); }
function takeFuel(simulation, id = 'a') {
  Object.assign(simulation.players.get(id), { x: simulation.fuel.x + .5, y: simulation.fuel.y, z: simulation.fuel.z, grounded: true });
  assert.equal(simulation.expeditionAction(id), 'take-fuel');
  assert.equal(simulation.interact(id), true);
}
function equip(player, weapon) {
  player.weapon = weapon; player.inventory[weapon] = { ammo: WEAPONS[weapon].magazine, reserve: WEAPONS[weapon].reserve };
}

test('expedition dimensions and generator collision use the exported geometry', () => {
  assert.deepEqual(EXTERIOR.bounds, { minX: -140, maxX: 140, minZ: -64, maxZ: 64 });
  assert.equal(EXTERIOR.bounds, EXPEDITION.bounds);
  assert.equal(WORLD.covers.find(cover => cover.id === 'generator'), GENERATOR_BOUNDS);
  const { simulation, player } = room();
  assert.equal(simulation.canOccupy(player, GENERATOR.x, GENERATOR.z, 0, .25), false);
  for (const cache of FUEL_CACHES) assert.equal(simulation.canOccupy(player, cache.x, cache.z, cache.y, .25), true);
});

test('only the real pitched roof shelters ground, loft and overhang; being above it is exposed', () => {
  for (const point of [{ x: 0, y: 0, z: 0 }, { x: 7, y: 3.4, z: 5 }, { x: 0, y: 0, z: 6.45 }]) {
    assert.equal(hasRainShelter(point, 1.75), true);
  }
  assert.equal(hasRainShelter({ x: 0, y: 0, z: 6.51 }, 1.75), false);
  assert.equal(hasRainShelter({ x: 8.39, y: 0, z: 0 }, 1.75), false);
  assert.equal(hasRainShelter({ x: 0, y: rainRoofHeight(0) + .01, z: 0 }), false);
  assert.equal(hasRainShelter({ x: NaN, y: 0, z: 0 }), false);
});

test('rain damages health at exactly 3 HP/s at 10 and 30 Hz and bypasses armor', () => {
  for (const hz of [10, 30]) {
    const { simulation, player, events } = room();
    Object.assign(player, { x: 10, y: 0, z: 0, armor: 100 });
    advance(simulation, 3, hz);
    assert.deepEqual([player.hp, player.armor], [91, 100]);
    assert.equal(events.filter(event => event.event === 'hit' && event.source === 'outside').length, 3);
    assert.equal(simulation.snapshot().players[0].rainExposed, true);
    assert.equal(simulation.snapshot().players[0].outsideDamageActive, true);
    assert.equal(RAIN.damagePerSecond, 3);
  }
});

test('the north overhang protects a survivor outside the cabin without a universal outside penalty', () => {
  const { simulation, player } = room();
  Object.assign(player, { x: 0, y: 0, z: 6.45 });
  advance(simulation, 2);
  const state = simulation.snapshot().players[0];
  assert.equal(state.outside, true); assert.equal(state.rainExposed, false); assert.equal(player.hp, 100);
});

test('umbrella has 100 cumulative exposed seconds, does not wear under a roof and ignores forged input', () => {
  const { simulation, player } = room();
  assert.equal(simulation.setUmbrella('a', true), true);
  Object.assign(player, { x: 10, z: 0 });
  simulation.setInput('a', { forward: 0, strafe: 0, yaw: 0, pitch: 0, umbrella: { remaining: 999 }, hp: 999 });
  advance(simulation, 12);
  assert.ok(Math.abs(player.umbrella.remaining - 88) < 1e-8); assert.equal(player.hp, 100);
  player.x = 0; advance(simulation, 8);
  assert.ok(Math.abs(player.umbrella.remaining - 88) < 1e-8);
  assert.equal(simulation.snapshot().players[0].outsideDamageActive, false);
  assert.equal(simulation.setUmbrella('a', 'true'), false);
  assert.equal(simulation.setUmbrella('missing', true), false);
});

test('expired input or a neutral pause input keeps the umbrella open while protection wears normally', () => {
  const { simulation, player } = room();
  Object.assign(player, { x: 10, z: 0 }); simulation.setUmbrella('a', true);
  advance(simulation, 2);
  simulation.setInput('a', { forward: 0, strafe: 0, yaw: 0, pitch: 0 });
  advance(simulation, 1);
  assert.equal(player.umbrella.open, true); assert.ok(Math.abs(player.umbrella.remaining - 97) < 1e-8);
  assert.equal(player.hp, 100);
});

test('protection ending within a tick charges only the unprotected remainder, at 10 and 30 Hz', () => {
  for (const hz of [10, 30]) {
    const { simulation, player, events } = room();
    Object.assign(player, { x: 10, z: 0 }); player.umbrella.remaining = .05; simulation.setUmbrella('a', true);
    advance(simulation, 1.05, hz);
    assert.deepEqual(player.umbrella, { open: false, remaining: 0 }); assert.equal(player.hp, 97);
    assert.equal(events.filter(event => event.event === 'umbrella-broken').length, 1);
    assert.equal(simulation.setUmbrella('a', true), false);
  }
});

test('all weapons and grenades are refused under the open umbrella without consuming ammunition', () => {
  for (const weapon of Object.keys(WEAPONS)) {
    const { simulation, player } = room(); equip(player, weapon); player.grenades = 2;
    assert.equal(simulation.setUmbrella('a', true), true);
    const stock = { ...player.inventory[weapon] };
    assert.equal(simulation.shoot('a', 0, weapon === 'katana' ? 'heavy' : undefined), false, weapon);
    assert.equal(simulation.throwGrenade('a'), false, weapon);
    assert.deepEqual(player.inventory[weapon], stock); assert.equal(player.grenades, 2);
    assert.equal(player.pendingMelee, null); assert.equal(simulation.grenades.size, 0);
    if (weapon === 'minigun') assert.equal(simulation.setMinigunSpin('a', true), false);
  }
});

test('opening the umbrella cancels a prepared heavy slash and minigun spin, preserving recovery', () => {
  const { simulation, player } = room(); equip(player, 'katana');
  assert.equal(simulation.shoot('a', 0, 'heavy'), true);
  const readyAt = player.meleeAfter;
  simulation.setUmbrella('a', true); assert.equal(player.pendingMelee, null);
  simulation.setUmbrella('a', false); assert.equal(player.meleeAfter, readyAt);
  assert.equal(simulation.shoot('a', 0, 'heavy'), false);
  advance(simulation, 2); equip(player, 'minigun');
  assert.equal(simulation.setMinigunSpin('a', true), true);
  simulation.setUmbrella('a', true); assert.equal(player.minigunSpinning, false);
  simulation.setUmbrella('a', false); assert.equal(simulation.shoot('a'), false);
});

test('fold-shot-reopen in one tick cannot combine normal firearm cadence with permanent rain protection', () => {
  for (const weapon of Object.keys(WEAPONS).filter(name => !WEAPONS[name].melee)) {
    const { simulation, player } = room(); equip(player, weapon);
    assert.equal(simulation.setUmbrella('a', true), true);
    assert.equal(simulation.setUmbrella('a', false), true);
    if (weapon === 'minigun') {
      assert.equal(simulation.setMinigunSpin('a', true), true);
      advance(simulation, simulation.snapshot().minigunSpinDuration + .001);
    }
    assert.equal(simulation.shoot('a'), true, weapon);
    const recovery = player.shotAfter;
    assert.equal(simulation.setUmbrella('a', true), false, `${weapon} must recover before shielding`);
    assert.equal(player.shotAfter, recovery, `${weapon} cadence is unchanged`);
    assert.equal(player.umbrella.open, false);
    advance(simulation, WEAPONS[weapon].interval + .001);
    assert.equal(simulation.setUmbrella('a', true), true, weapon);
  }
  const { simulation, player } = room(); Object.assign(player, { x: 10, z: 0 });
  for (let index = 0; index < 10; index++) {
    simulation.setUmbrella('a', false);
    assert.equal(simulation.shoot('a'), true);
    assert.equal(simulation.setUmbrella('a', true), false);
    advance(simulation, .25);
  }
  assert.equal(player.inventory.pistol.ammo, 2);
  assert.equal(player.hp, 94, 'ten accepted shots expose the survivor to the same authoritative 2.5 seconds of rain');
});

test('grenade recovery and a completed katana impact also prevent immediate umbrella protection', () => {
  const grenadeRoom = room(), swordRoom = room();
  grenadeRoom.player.grenades = 1;
  assert.equal(grenadeRoom.simulation.throwGrenade('a'), true);
  assert.equal(grenadeRoom.simulation.setUmbrella('a', true), false);
  advance(grenadeRoom.simulation, .701);
  assert.equal(grenadeRoom.simulation.setUmbrella('a', true), true);
  equip(swordRoom.player, 'katana');
  assert.equal(swordRoom.simulation.shoot('a'), true);
  advance(swordRoom.simulation, WEAPONS.katana.attacks.light.windup + .001);
  assert.equal(swordRoom.player.pendingMelee, null);
  assert.equal(swordRoom.simulation.setUmbrella('a', true), false);
  advance(swordRoom.simulation, WEAPONS.katana.attacks.light.duration + .001);
  assert.equal(swordRoom.simulation.setUmbrella('a', true), true);
});

test('closing always works after a down or frozen ending; opening does not', () => {
  for (const phase of ['extraction', 'victory', 'gameover']) {
    const { simulation, player } = room(); simulation.setUmbrella('a', true); simulation.phase = phase;
    assert.equal(simulation.setUmbrella('a', false), true); assert.equal(simulation.setUmbrella('a', true), false);
    assert.equal(player.umbrella.open, false);
  }
  const { simulation, player } = room(); simulation.setUmbrella('a', true); player.downed = true;
  assert.equal(simulation.setUmbrella('a', false), true); assert.equal(simulation.setUmbrella('a', true), false);
});

test('E repairs for free only close to the visible generator and never through a wall', () => {
  const { simulation, player } = room(); player.umbrella.remaining = 12; player.points = 17;
  assert.equal(simulation.expeditionAction('a'), null);
  Object.assign(player, { x: -8.1, z: GENERATOR.z }); assert.equal(simulation.expeditionAction('a'), null);
  atGenerator(player); assert.equal(simulation.snapshot().players[0].expeditionAction, 'repair-umbrella');
  assert.equal(simulation.interact('a'), true);
  assert.deepEqual([player.umbrella.remaining, player.points], [UMBRELLA.max, 17]);
  assert.equal(simulation.expeditionAction('a'), null);
});

test('only waves 5, 10 and 15 offer one shared mission; decline takes 90 seconds and never blacks out', () => {
  const { simulation, player, events } = room();
  for (let wave = 1; wave < 5; wave++) { mission(simulation, wave); assert.equal(simulation.fuel, null); }
  mission(simulation, 5); assert.deepEqual(simulation.fuel, { ...FUEL_CACHES[0], carrierId: null, cacheIndex: 0 });
  advance(simulation, 45); assert.equal(simulation.snapshot().expedition.generator.power, .6);
  advance(simulation, 45); assert.equal(simulation.snapshot().expedition.generator.power, .2);
  advance(simulation, 100); assert.equal(simulation.snapshot().expedition.generator.power, .2);
  assert.equal(player.hp, 100); assert.equal(events.filter(event => event.event === 'fuel-mission').length, 1);
});

test('the generator drains once per room, identically with one and four survivors', () => {
  const powers = [];
  for (const ids of [['a'], ['a', 'b', 'c', 'd']]) {
    const { simulation } = room(ids); mission(simulation, 5); advance(simulation, 37);
    powers.push(simulation.snapshot().expedition.generator.power);
  }
  assert.equal(powers[0], powers[1]);
});

test('an unfinished mission skips wave 10; delivery at 11 does not queue it and wave 15 can start anew', () => {
  const { simulation, player, events } = room(); mission(simulation, 5); advance(simulation, 30);
  const fuel = simulation.fuel, elapsed = simulation.generator.elapsed;
  mission(simulation, 10);
  assert.equal(simulation.fuel, fuel); assert.equal(simulation.generator.elapsed, elapsed);
  assert.equal(simulation.generator.missionWave, 5);
  mission(simulation, 11); takeFuel(simulation); atGenerator(player); advance(simulation, .4);
  assert.equal(simulation.expeditionAction('a'), 'deliver-fuel'); assert.equal(simulation.interact('a'), true);
  assert.equal(simulation.fuel, null); assert.equal(simulation.generator.active, false);
  assert.equal(simulation.snapshot().expedition.generator.power, 1); assert.equal(simulation.generator.completed, 1);
  mission(simulation, 12); assert.equal(simulation.fuel, null);
  mission(simulation, 15); assert.equal(simulation.generator.missionWave, 15);
  assert.deepEqual(simulation.fuel, { ...FUEL_CACHES[2], carrierId: null, cacheIndex: 2 });
  assert.equal(events.filter(event => event.event === 'fuel-mission').length, 2);
});

test('two survivors cannot acquire or deliver the unique can twice; joining does not reset it', () => {
  const { simulation, player } = room(['a', 'b']); mission(simulation); takeFuel(simulation);
  const second = simulation.players.get('b'); Object.assign(second, { x: player.x, y: player.y, z: player.z });
  assert.equal(simulation.expeditionInteraction('b'), false);
  simulation.addPlayer('c'); assert.equal(simulation.fuel.carrierId, 'a');
  const carried = simulation.snapshot(); assert.equal(carried.expedition.fuel.carrierId, 'a');
  assert.equal(carried.players.filter(item => item.carryingFuel).length, 1);
  atGenerator(player); advance(simulation, .4);
  assert.equal(simulation.interact('a'), true); assert.equal(simulation.expeditionInteraction('a'), false);
  assert.equal(simulation.generator.completed, 1);
});

test('fuel cannot be taken through a closed barricade', () => {
  const { simulation, player } = room(); mission(simulation);
  Object.assign(simulation.fuel, { x: -7.6, y: 0, z: 0 }); Object.assign(player, { x: -8.4, y: 0, z: 0 });
  assert.equal(simulation.expeditionAction('a'), null);
  simulation.doors.find(door => door.id === 'west').hp = 0;
  assert.equal(simulation.expeditionAction('a'), 'take-fuel');
});

test('going down folds protection and drops fuel; revive keeps priority over the nearby can', () => {
  const { simulation, player } = room(['a', 'b']); mission(simulation); takeFuel(simulation);
  simulation.setUmbrella('a', true);
  const teammate = simulation.players.get('b'); Object.assign(teammate, { x: player.x + .3, y: player.y, z: player.z });
  simulation.damagePlayer(player, 100);
  assert.equal(player.downed, true); assert.equal(player.umbrella.open, false); assert.equal(simulation.fuel.carrierId, null);
  assert.ok(Math.hypot(simulation.fuel.x - player.x, simulation.fuel.z - player.z) <= 1.15);
  assert.equal(completeRevive(simulation, 'b'), true); assert.equal(player.downed, false); assert.equal(simulation.fuel.carrierId, null);
  advance(simulation, 1.1); assert.equal(simulation.interact('b'), true); assert.equal(simulation.fuel.carrierId, 'b');
});

test('disconnect drops the can before host transfer; an invalid location returns it to the cache', () => {
  for (const invalid of [false, true]) {
    const { simulation, player } = room(['a', 'b']); mission(simulation); takeFuel(simulation);
    if (invalid) Object.assign(player, { x: 999, y: NaN });
    simulation.removePlayer('a');
    assert.equal(simulation.hostId, 'b'); assert.equal(simulation.fuel.carrierId, null);
    if (invalid) assert.deepEqual([simulation.fuel.x, simulation.fuel.y, simulation.fuel.z], [FUEL_CACHES[0].x, 0, FUEL_CACHES[0].z]);
    else assert.ok(Math.hypot(simulation.fuel.x - player.x, simulation.fuel.z - player.z) <= 1.15);
  }
});

test('fuel never expires and resupply preserves mission, decline and umbrella wear', () => {
  const { simulation, player } = room(); mission(simulation); player.umbrella.remaining = 22;
  advance(simulation, 100); const fuel = simulation.fuel, elapsed = simulation.generator.elapsed;
  simulation.finishWave();
  assert.equal(simulation.fuel, fuel); assert.equal(simulation.generator.elapsed, elapsed); assert.equal(player.umbrella.remaining, 22);
  advance(simulation, 2); assert.equal(simulation.fuel, fuel);
});

test('an ignored mission never prevents final extraction; restart clears all expedition state', () => {
  const { simulation, player } = room(); mission(simulation); player.umbrella.remaining = 23;
  simulation.wave = MAX_WAVES; simulation.toSpawn = 0; simulation.zombies.clear();
  assert.equal(simulation.beginExtraction(), true); assert.ok(simulation.fuel);
  simulation.phase = 'victory'; assert.equal(simulation.start('a'), true);
  assert.equal(simulation.fuel, null); assert.deepEqual(player.umbrella, { open: false, remaining: 100 });
  assert.deepEqual(simulation.generator, { active: false, missionWave: null, completed: 0, elapsed: 0 });
});

test('the practice range exposes a disabled expedition and rejects protection and objectives', () => {
  const { simulation, player } = room(['a'], true);
  assert.equal(simulation.snapshot().expedition.enabled, false);
  assert.equal(simulation.setUmbrella('a', true), false); assert.equal(simulation.expeditionAction('a'), null);
  Object.assign(player, { x: 15, z: 12 }); advance(simulation, 3); assert.equal(player.hp, 100);
});

test('direct spawnZombie stays synchronous while scheduled spawns warn first and remain in the quota', () => {
  const { simulation, events } = room(); mission(simulation, 1);
  const direct = simulation.spawnZombie(); assert.equal(simulation.zombies.has(direct.id), true); assert.equal(simulation.spawnWarnings.size, 0);
  simulation.zombies.clear(); simulation.tick(0);
  // mission() deliberately postpones the scheduler until the fixture permits it.
  simulation.spawnTimer = 0; simulation.tick(0);
  assert.equal(simulation.zombies.size, 0); assert.equal(simulation.spawnWarnings.size, 1);
  assert.equal(simulation.snapshot().remaining, waveBalance(1, 1).total);
  assert.equal(events.filter(event => event.event === 'spawn-warning').length, 1);
  simulation.spawnTimer = 100000; advance(simulation, SPAWN_WARNING.seconds - .1);
  assert.equal(simulation.zombies.size, 0); advance(simulation, .1);
  assert.equal(simulation.spawnWarnings.size, 0); assert.equal(simulation.zombies.size, 1);
});

test('approaching a warned exit forces a new full warning and never materializes within four metres', () => {
  const { simulation, player, events } = room(); mission(simulation, 1); simulation.spawnTimer = 0; simulation.tick(0);
  const warning = [...simulation.spawnWarnings.values()][0];
  Object.assign(player, { x: warning.x, y: 0, z: warning.z, hp: 1000 }); simulation.spawnTimer = 100000;
  const materializations = [], original = simulation.materializeZombie.bind(simulation);
  simulation.materializeZombie = zombie => { materializations.push(Math.hypot(zombie.x - player.x, zombie.z - player.z)); return original(zombie); };
  advance(simulation, SPAWN_WARNING.seconds);
  assert.equal(simulation.zombies.size, 0); assert.equal(events.filter(event => event.event === 'spawn-warning').length, 2);
  assert.ok(warning.readyAt - simulation.time >= SPAWN_WARNING.seconds - 1e-8);
  advance(simulation, SPAWN_WARNING.seconds);
  assert.equal(materializations.length, 1); assert.ok(materializations[0] >= SPAWN_WARNING.minPlayerDistance);
});

test('pending warnings count against the active cap and prevent early wave completion or extraction', () => {
  const { simulation } = room(); mission(simulation, 1);
  const cap = waveBalance(1, 1).maxActive;
  for (let index = 0; index < cap; index++) simulation.reserveZombieSpawn();
  simulation.toSpawn = 1; simulation.spawnTimer = 0; simulation.tick(0);
  assert.equal(simulation.toSpawn, 1); assert.equal(simulation.spawnWarnings.size, cap);
  assert.equal(simulation.snapshot().remaining, cap + 1);
  simulation.toSpawn = 0; assert.equal(simulation.finishWave(), false);
  simulation.wave = MAX_WAVES; assert.equal(simulation.beginExtraction(), false); simulation.tick(0);
  assert.equal(simulation.phase, 'wave');
  simulation.endGame(); assert.equal(simulation.spawnWarnings.size, 0);
});

test('reservations preserve the exact family, brute, health and speed sequence without extra random draws', () => {
  const left = room().simulation, right = room().simulation; mission(left, 8); mission(right, 8);
  const sequence = zombie => [zombie.kind, zombie.boss, zombie.maxHp, zombie.speed, zombie.damage];
  for (let index = 0; index < waveBalance(8, 1).total; index++) {
    assert.deepEqual(sequence(left.spawnZombie()), sequence(right.reserveZombieSpawn().zombie));
  }
  assert.equal(left.waveSpawned, right.waveSpawned); assert.equal(left.brutesToSpawn, right.brutesToSpawn);
});
