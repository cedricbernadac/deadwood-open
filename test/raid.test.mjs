import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RoomSimulation, WEAPONS, damageFalloff } from '../simulation.mjs';
import { RAIDS, RAID_ENTRIES, RAIDER_LOADOUTS, RAID_COMPOSITIONS, RAIDER_APPEARANCE, ENEMY_APPEARANCES, EXTERIOR, PICKUPS, ECONOMY, ARMORY, GROUND_WEAPON_BOUNDS, SPAWN_ENTRIES,
  raidTotal, raidSquad, raidDamageScale, raiderLoadout, killCash, enemyHitbox, enemyPosture, enemyHeadshot, enemyDamageMultiplier, enemyAppearance, waveBalance, MELEE_WEAPONS } from '../public/rules.js';
import { enemyVariant, ENEMY_PROFILES } from '../public/enemies.js';
import { seededRandom } from '../validation/balance-report.mjs';
import { advanceBallisticFlight } from './helpers/ballistic-flight.mjs';

function raidRoom({ players = 1, wave = 5, random = () => .5, raids, sturdy = true } = {}) {
  const events = [], simulation = new RoomSimulation('RAID01', { random, raids, onEvent: event => events.push(event) });
  for (let index = 0; index < players; index++) simulation.addPlayer(String.fromCharCode(97 + index));
  simulation.start('a');
  simulation.wave = wave - 1;
  simulation.beginWave();
  // Rain or a stray blow must not end a long scripted raid.
  if (sturdy) for (const player of simulation.players.values()) player.hp = 1e6;
  return { simulation, events, player: simulation.players.get('a') };
}
function emptyWave(simulation) {
  simulation.toSpawn = 0; simulation.zombies.clear(); simulation.spawnWarnings.clear();
}
function advance(simulation, seconds, hz = 30) {
  for (let step = 0; step < Math.round(seconds * hz); step++) simulation.tick(1 / hz);
}
const named = (events, name) => events.filter(event => event.event === name);
const raidersOf = simulation => [...simulation.zombies.values()].filter(zombie => zombie.kind === 'raider');
function trigger(simulation) {
  emptyWave(simulation); simulation.tick(1 / 30);
  assert.equal(simulation.raid.triggered, true);
}
function materialize(simulation, limit = 30) {
  for (let step = 0; simulation.raidWarnings.size && step < limit * 30; step++) simulation.tick(1 / 30);
  assert.equal(simulation.raidWarnings.size, 0);
}
function zombieAt(simulation, id, options = {}) {
  const zombie = { id, x: 60, y: 0, z: 40, yaw: 0, hp: 80, maxHp: 80, kind: 'walker', scale: 1, boss: false,
    speed: 0, attackAfter: Infinity, entered: false, doorId: 'west', stairState: null, pushX: 0, pushZ: 0, pushLeft: 0, ...options };
  simulation.zombies.set(id, zombie); return zombie;
}
function outdoor(weapon, wave = 14) {
  const events = [], simulation = new RoomSimulation('RAID02', { random: () => .5, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a'); simulation.start('a');
  simulation.wave = wave - 1; simulation.beginWave(); simulation.spawnTimer = 999;
  Object.assign(player, { x: 12, y: 0, z: 8, yaw: 0, pitch: 0, weapon, hp: 1e6 });
  player.inventory = { [weapon]: { ammo: WEAPONS[weapon].magazine, reserve: WEAPONS[weapon].reserve } };
  return { simulation, player, events };
}
function addRaider(simulation, { index = 1, x = 12, z = 5, damageScale = 1, ...options } = {}) {
  const raider = simulation.createRaider(1, { id: null, doorId: 'east', x, z }, { index, damageScale }, { point: { x, z } });
  Object.assign(raider, options);
  simulation.zombies.set(raider.id, raider);
  return raider;
}

test('raid constants, entries, loadouts and the frozen totals per player count', () => {
  assert.deepEqual(RAIDS.waves, [5, 10, 15]);
  assert.deepEqual([1, 2, 3, 4].map(players => [1, 2, 3].map(index => raidTotal(index, players))), [[2, 4, 6], [3, 6, 9], [4, 8, 12], [5, 10, 15]]);
  assert.deepEqual([1, 2, 3, 4].map(raidSquad), [2, 2, 3, 3]);
  assert.deepEqual([1, 2, 3, 4].map(raidDamageScale), RAIDS.damageScale);
  assert.equal(raidTotal(1, 9), 5, 'players clamp to four'); assert.equal(raidTotal(4, 1), 0);
  assert.equal(RAID_ENTRIES.length, 8);
  for (const door of ['north', 'south', 'west', 'east']) assert.equal(RAID_ENTRIES.filter(entry => entry.doorId === door).length, 2);
  for (const entry of RAID_ENTRIES) {
    assert.ok(entry.x >= EXTERIOR.bounds.minX && entry.x <= EXTERIOR.bounds.maxX && entry.z >= EXTERIOR.bounds.minZ && entry.z <= EXTERIOR.bounds.maxZ, entry.id);
    assert.ok(Math.abs(entry.x) > 8 || Math.abs(entry.z) > 6, `${entry.id} lies outside the cabin`);
    assert.ok(Math.abs(entry.x) === 30 || Math.abs(entry.z) === 28, `${entry.id} is 22 m beyond its facade`);
    assert.equal(SPAWN_ENTRIES.some(spawn => spawn.id === entry.id), false);
  }
  // Raider guns never join the player arsenal or the ground-weapon table: every
  // player weapon keeps exactly one rack, one ground model and one ammo share
  // (pinned by key rather than by count, so a new player weapon still passes).
  const playerWeapons = Object.keys(WEAPONS).sort();
  assert.ok(playerWeapons.length >= 13);
  assert.deepEqual(ARMORY.map(item => item.weapon).sort(), playerWeapons);
  assert.deepEqual(Object.keys(GROUND_WEAPON_BOUNDS).sort(), playerWeapons);
  assert.deepEqual(Object.keys(PICKUPS.ammo).sort(), playerWeapons);
  assert.equal(SPAWN_ENTRIES.length, 8);
  for (const [key, gun] of Object.entries(RAIDER_LOADOUTS)) {
    assert.equal(gun.key, key); assert.ok(WEAPONS[gun.ref] && WEAPONS[gun.model], key);
    assert.ok(gun.burst[0] <= gun.burst[1] && gun.pause[0] <= gun.pause[1] && gun.engageRange < gun.range, key);
  }
  // Pressure is tuned through accuracy, pauses and movement, without extra
  // damage per bullet, larger magazines, faster reloads or different guns.
  const fixed = { pistol: [10, 1, [2, 3], 12, 1.8, 30], smg: [7, 1, [4, 7], 30, 2.3, 26],
    shotgun: [5, 8, [1, 1], 6, 3.2, 15], assault: [11, 1, [3, 4], 24, 2.4, 42], rifle: [9, 1, [6, 9], 40, 3, 46] };
  for (const [key, [damage, pellets, burst, magazine, reload, range]] of Object.entries(fixed)) {
    const gun = RAIDER_LOADOUTS[key];
    assert.deepEqual([gun.damage, gun.pellets, gun.burst, gun.magazine, gun.reload, gun.range], [damage, pellets, burst, magazine, reload, range], key);
    assert.ok(gun.spread >= .02 && gun.spread <= .10, `${key} retains a real cone`);
    assert.ok(gun.interval >= .1 && gun.interval <= 1.15 && gun.pause[1] <= 1, `${key} bounded automatic cadence`);
  }
  assert.deepEqual(RAID_COMPOSITIONS.map(list => list.length), [5, 6, 6]);
  assert.deepEqual([1, 2, 3, 6].map(ordinal => raiderLoadout(1, ordinal)), ['smg', 'pistol', 'shotgun', 'smg']);
  assert.equal(raiderLoadout(3, 7), 'rifle');
  for (const players of [1, 2, 3, 4]) {
    const { simulation, events } = raidRoom({ players, wave: 15 });
    assert.deepEqual([simulation.raid.players, simulation.raid.total, simulation.raid.squad, simulation.raid.damageScale],
      [players, raidTotal(3, players), raidSquad(players), raidDamageScale(players)]);
    assert.equal(named(events, 'wave').at(-1).raid, 3);
    if (players < 4) simulation.addPlayer('late');
    simulation.removePlayer('a');
    assert.deepEqual([simulation.raid.players, simulation.raid.total, simulation.raid.squad], [players, raidTotal(3, players), raidSquad(players)], 'joins and leaves never change a plan');
  }
});

test('raids are planned only at waves 5, 10 and 15, never in practice, never when disabled, and a direct beginWave replaces the plan', () => {
  const { simulation, events } = raidRoom({ wave: 1 });
  for (let wave = 1; wave <= 20; wave++) {
    simulation.wave = wave - 1; simulation.beginWave();
    assert.equal(simulation.raid?.index ?? 0, RAIDS.waves.indexOf(wave) + 1, `wave ${wave}`);
    assert.equal(named(events, 'wave').at(-1).raid, RAIDS.waves.includes(wave) ? RAIDS.waves.indexOf(wave) + 1 : undefined);
    assert.equal(simulation.raid?.triggered ?? false, false, 'planning never triggers');
  }
  const practice = new RoomSimulation('RAIDPR', { practice: true }); practice.addPlayer('a');
  practice.wave = 4; assert.equal(practice.beginWave(), false); assert.equal(practice.raid, null);
  assert.equal(practice.snapshot().raid, null); assert.equal(practice.snapshot().nextRaidWave, null);

  const disabled = raidRoom({ raids: false });
  assert.equal(disabled.simulation.raid, null); assert.equal(disabled.simulation.raidsEnabled, false);
  emptyWave(disabled.simulation); disabled.simulation.tick(1 / 30);
  assert.equal(disabled.simulation.phase, 'intermission', 'a disabled room ends wave 5 as before');

  // The intermission before a raid wave carries only a hint, never a plan.
  const before = raidRoom({ wave: 4 });
  emptyWave(before.simulation); before.simulation.tick(1 / 30);
  assert.equal(before.simulation.phase, 'intermission');
  assert.deepEqual([before.simulation.snapshot().raid, before.simulation.snapshot().nextRaidWave], [null, 5]);
  advance(before.simulation, 12.1);
  assert.equal(before.simulation.wave, 5); assert.equal(before.simulation.raid.index, 1); assert.equal(before.simulation.snapshot().nextRaidWave, null);

  // A direct beginWave mid-raid removes every raider, warning and raid loot id.
  const { simulation: live } = raidRoom({ wave: 10 });
  trigger(live); advance(live, 3);
  live.raidLootIds.add('p999');
  assert.ok(raidersOf(live).length && live.raidWarnings.size);
  live.beginWave();
  assert.equal(live.wave, 11); assert.equal(live.raid, null);
  assert.deepEqual([raidersOf(live).length, live.raidWarnings.size, live.raidLootIds.size], [0, 0, 0]);
  live.wave = 14; live.beginWave();
  assert.deepEqual([live.raid.index, live.raid.triggered, live.raid.spawned], [3, false, 0]);
});

test('no random number is drawn before the trigger: zombie spawns match with raids on and off, then the trigger draws twice', () => {
  const counted = seed => { const next = seededRandom(seed); const random = () => (random.calls++, next()); random.calls = 0; return random; };
  const rooms = [true, false].map(raids => {
    const random = counted(42), room = raidRoom({ raids, random });
    return { ...room, random };
  });
  const fingerprint = ({ simulation }) => JSON.stringify([[...simulation.zombies.values()].map(zombie => [zombie.id, zombie.kind, zombie.hp, zombie.x, zombie.z]),
    [...simulation.spawnWarnings.values()].map(warning => [warning.id, warning.x, warning.z])]);
  let ticks = 0;
  while ((rooms[0].simulation.toSpawn || rooms[0].simulation.spawnWarnings.size) && ticks++ < 30 * 120) {
    for (const room of rooms) {
      // The same scripted cull in both rooms keeps the horde under maxActive.
      if (room.simulation.zombies.size >= 12) room.simulation.zombies.delete(room.simulation.zombies.keys().next().value);
      room.simulation.tick(1 / 30);
    }
    assert.equal(rooms[0].random.calls, rooms[1].random.calls);
    assert.equal(fingerprint(rooms[0]), fingerprint(rooms[1]));
    assert.equal(rooms[0].simulation.raid.triggered, false);
  }
  assert.ok(rooms[0].random.calls > 20, 'the wave really drew its spawns');
  assert.ok(rooms[0].simulation.zombies.size > RAIDS.triggerBase + RAIDS.triggerPerPlayer, 'the horde keeps the raid waiting');
  for (const room of rooms) room.simulation.zombies.clear();
  const calls = rooms.map(room => room.random.calls);
  for (const room of rooms) room.simulation.tick(1 / 30);
  assert.equal(rooms[0].simulation.raid.triggered, true); assert.equal(rooms[1].simulation.phase, 'intermission');
  assert.deepEqual(rooms.map((room, index) => room.random.calls - calls[index]), [2, 0]);
});

test('the trigger weighs brutes four times, falls back only within twice the threshold and holds for fuel at most 45 s', () => {
  const triggered = setup => {
    const { simulation } = raidRoom(); emptyWave(simulation); setup(simulation);
    return simulation;
  };
  // Solo threshold: triggerBase + triggerPerPlayer weighted live zombies (0 + 1 = 1).
  const threshold = RAIDS.triggerBase + RAIDS.triggerPerPlayer;
  assert.equal(threshold, 1);
  let simulation = triggered(room => zombieAt(room, 'z1', { z: 30 }));
  simulation.tick(1 / 30); assert.equal(simulation.raid.triggered, true, 'one walker = 1');
  simulation = triggered(room => {
    zombieAt(room, 'z1', { z: 30 });
    room.spawnWarnings.set('zw', { id: 'zw', zombie: { id: 'zw', scale: 1 }, x: 60, z: -40, readyAt: Infinity });
  });
  simulation.tick(1 / 30); assert.equal(simulation.raid.triggered, false, 'a pending zombie warning counts as one');
  // Two walkers (2 <= 2 x 1) fall back after 35 s; a lone brute weighs 4 and never does.
  simulation = triggered(room => { zombieAt(room, 'z1', { z: 30 }); zombieAt(room, 'z2', { z: 35 }); });
  simulation.tick(1 / 30); assert.equal(simulation.raid.triggered, false, 'two walkers > 1');
  const doneAt = simulation.raid.zombiesDoneAt;
  assert.ok(Number.isFinite(doneAt));
  advance(simulation, RAIDS.fallbackAfter - .2);
  assert.equal(simulation.raid.triggered, false);
  advance(simulation, .3);
  assert.equal(simulation.raid.triggered, true, '2 <= 2 x 1 after the 35 s fallback');
  assert.ok(Math.abs(simulation.raid.triggeredAt - doneAt - RAIDS.fallbackAfter) < .05);
  simulation = triggered(room => zombieAt(room, 'zb', { kind: 'brute', scale: 1.22 }));
  advance(simulation, RAIDS.fallbackAfter + 5);
  assert.equal(simulation.raid.triggered, false, 'a brute weighs 4 and never falls back');
  assert.equal(simulation.phase, 'wave');

  // A fuel carrier holds the trigger, at most 45 s, and the wave cannot end meanwhile.
  simulation = triggered(room => { room.fuel.carrierId = 'a'; });
  advance(simulation, RAIDS.holdForFuel - .2);
  assert.equal(simulation.raid.triggered, false); assert.equal(simulation.phase, 'wave');
  assert.ok(Number.isFinite(simulation.raid.holdSince));
  advance(simulation, .3);
  assert.equal(simulation.raid.triggered, true);
  // A far survivor holds it too, until coming back within 30 m of the cabin centre.
  simulation = triggered(room => Object.assign(room.players.get('a'), { x: 31, z: 0 }));
  advance(simulation, 10);
  assert.equal(simulation.raid.triggered, false);
  Object.assign(simulation.players.get('a'), { x: 29.5, z: 0 }); simulation.tick(1 / 30);
  assert.equal(simulation.raid.triggered, true);
  // A downed far survivor is not living, so it no longer holds the raid.
  simulation = triggered(room => { Object.assign(room.players.get('a'), { x: 40 }); room.addPlayer('b'); Object.assign(room.players.get('a'), { downed: true, bleedOutAt: Infinity }); });
  simulation.tick(1 / 30); assert.equal(simulation.raid.triggered, true);
});

test('squads rotate over active doors from a seeded start; solo uses west and east only and staggers its second raider', () => {
  const scripted = draws => () => draws.length ? draws.shift() : .5;
  // Four players: every door is active; start south (.3 x 4), rotate backwards (.9).
  const { simulation, events } = raidRoom({ players: 4, wave: 15, random: scripted([.3, .9]) });
  emptyWave(simulation);
  const sides = [];
  for (let squad = 0; squad < 5; squad++) {
    simulation.tick(1 / 30);
    const announced = [...simulation.raidWarnings.values()];
    assert.equal(announced.length, 3, 'squads of three');
    const entries = RAID_ENTRIES.filter(entry => entry.doorId === announced[0].raider.doorId);
    const axis = entries[0].x === entries[1].x ? 'z' : 'x';
    assert.deepEqual(announced.map(warning => [warning.x, warning.z]), [[entries[0].x, entries[0].z], [entries[1].x, entries[1].z],
      [entries[0].x + (axis === 'x' ? -1.2 : 0), entries[0].z + (axis === 'z' ? -1.2 : 0)]], 'A, B, then A shifted 1.2 m outward');
    assert.ok(announced.every(warning => warning.readyAt - simulation.time > RAIDS.warning - .05), 'groups announce every raider together');
    simulation.raidWarnings.clear();
  }
  sides.push(named(events, 'raid')[0].side, ...named(events, 'raid-squad').map(event => event.side));
  assert.deepEqual(sides, ['south', 'north', 'east', 'west', 'south']);
  assert.equal(simulation.raid.spawned, 15); assert.deepEqual(named(events, 'raid-squad').map(event => event.count), [3, 3, 3, 3]);
  const raid = named(events, 'raid')[0];
  assert.deepEqual([raid.index, raid.wave, raid.total, raid.squad, raid.damageScale], [3, 15, 15, 3, 1]);
  assert.deepEqual(raid.entries, RAID_ENTRIES.filter(entry => entry.doorId === 'south').map(({ x, z }) => ({ x, z })));

  // Solo: west/east only, whatever the draws.
  for (const [start, step, expected] of [[0, 0, ['west', 'east', 'west']], [.99, .99, ['east', 'west', 'east']]]) {
    const solo = raidRoom({ wave: 15, random: scripted([start, step]) });
    emptyWave(solo.simulation);
    for (let squad = 0; squad < 3; squad++) { solo.simulation.tick(1 / 30); solo.simulation.raidWarnings.clear(); }
    assert.deepEqual([named(solo.events, 'raid')[0].side, ...named(solo.events, 'raid-squad').map(event => event.side)], expected);
  }

  // The second solo raider is announced 4 s after the first and appears 4 s later.
  const solo = raidRoom({ wave: 5 });
  trigger(solo.simulation);
  const start = solo.simulation.raid.triggeredAt;
  const shown = () => solo.simulation.snapshot().spawnWarnings.filter(warning => warning.kind === 'raider').map(warning => warning.id);
  assert.deepEqual(shown(), ['r1']); assert.equal(solo.simulation.raidWarnings.size, 2);
  advance(solo.simulation, RAIDS.warning - .1); assert.equal(raidersOf(solo.simulation).length, 0);
  advance(solo.simulation, .15); assert.deepEqual(raidersOf(solo.simulation).map(raider => raider.id), ['r1']);
  advance(solo.simulation, RAIDS.soloStagger - RAIDS.warning - .1 - .05); assert.deepEqual(shown(), []);
  advance(solo.simulation, .15); assert.deepEqual(shown(), ['r2']);
  advance(solo.simulation, RAIDS.warning);
  assert.deepEqual(raidersOf(solo.simulation).map(raider => raider.id), ['r1', 'r2']);
  assert.ok(Math.abs(solo.simulation.raidWarnings.size) === 0 && solo.simulation.time - start < RAIDS.soloStagger + RAIDS.warning + .1);
  assert.deepEqual(raidersOf(solo.simulation).map(raider => [raider.ai.homeX, raider.ai.homeZ, raider.spawnEntryId, raider.loadout]),
    [[30, -5, 'raid-east-a', 'smg'], [30, 5, 'raid-east-b', 'pistol']]);
});

test('later squads follow the release rules and never exceed squad + floor(squad / 2) raiders up', () => {
  const { simulation, events } = raidRoom({ wave: 15 });
  trigger(simulation);
  const up = () => raidersOf(simulation).length + simulation.raidWarnings.size;
  let most = 0;
  const watch = seconds => { for (let step = 0; step < Math.round(seconds * 30); step++) { simulation.tick(1 / 30); most = Math.max(most, up()); } };
  watch(7);
  assert.equal(up(), 2); assert.equal(named(events, 'raid-squad').length, 0);
  // Fast branch: down to floor(2 / 2) = 1 up, a full squad of two comes.
  simulation.damageSpecialZombie(raidersOf(simulation)[0], 1e4, 'a', { x: 0, z: 1 }, 'pistol');
  simulation.tick(1 / 30);
  assert.deepEqual(named(events, 'raid-squad').map(event => [event.side, event.count]), [['west', 2]]);
  assert.equal(up(), 3);
  // Timer branch: 30 s later with two up, only one fits under the cap of three.
  watch(9);
  simulation.damageSpecialZombie(raidersOf(simulation)[0], 1e4, 'a', { x: 0, z: 1 }, 'pistol');
  watch(RAIDS.nextSquadAfter[0] - 9 - .2);
  assert.equal(named(events, 'raid-squad').length, 1);
  watch(.3);
  assert.deepEqual(named(events, 'raid-squad').at(-1).count, 1);
  assert.equal(up(), 3); assert.equal(simulation.raid.spawned, 5); assert.equal(simulation.raid.squads, 3);
  watch(1);
  assert.ok(most <= 3, `at most three up, saw ${most}`);
});

test('raider warnings keep clear of survivors, bodies and other warnings, try the alternate entry, then retry every 0.5 s', () => {
  // Three players: squads of three; random .5 starts on the west door.
  const { simulation } = raidRoom({ players: 3, wave: 5 });
  // Within 3 m of A and A', yet within 30 m of the centre (no trigger hold).
  const blocker = simulation.players.get('b');
  Object.assign(blocker, { x: -28.5, z: -4.5 });
  trigger(simulation);
  const [first, second, third] = [...simulation.raidWarnings.values()];
  assert.deepEqual([first, second, third].map(warning => [warning.x, warning.z]), [[-30, -5], [-30, 5], [-30, -6.2]]);
  assert.deepEqual(simulation.snapshot().spawnWarnings.filter(warning => warning.kind === 'raider').map(warning => warning.id), [first.id, second.id, third.id]);
  const readyAt = first.readyAt;
  while (simulation.time + 1e-8 < readyAt) simulation.tick(1 / 30);
  // The survivor blocks A and A'; B is still reserved by the second warning.
  assert.equal(simulation.zombies.has(first.id), false);
  assert.deepEqual([second.raider.ai.homeX, second.raider.ai.homeZ, second.raider.spawnEntryId], [-30, 5, 'raid-west-b']);
  assert.deepEqual([third.raider.ai.homeX, third.raider.ai.homeZ, third.raider.spawnEntryId], [-30, 6.2, 'raid-west-b'], 'the alternate B is shifted the same way');
  const retryAt = simulation.raidWarnings.get(first.id).readyAt;
  assert.ok(Math.abs(retryAt - simulation.time - .5) < 1e-9, 'a bounded retry, half a second later');
  Object.assign(blocker, { x: -2, z: 1 });
  advance(simulation, .4);
  assert.equal(simulation.zombies.has(first.id), false, 'no early retry');
  advance(simulation, .15);
  assert.deepEqual([first.raider.ai.homeX, first.raider.ai.homeZ, first.raider.spawnEntryId], [-30, -5, 'raid-west-a']);
  assert.equal(simulation.raidWarnings.size, 0);
  // The individual rules.
  const probe = simulation.queueRaider(simulation.createRaider(9, RAID_ENTRIES[0], simulation.raid), RAID_ENTRIES[0]);
  assert.equal(simulation.raidEntryClear(probe, { x: -5, z: -28 }), true);
  zombieAt(simulation, 'zbody', { x: -5.4, z: -28 });
  assert.equal(simulation.raidEntryClear(probe, { x: -5, z: -28 }), false, 'live body');
  simulation.zombies.get('zbody').hp = 0;
  assert.equal(simulation.raidEntryClear(probe, { x: -5, z: -28 }), true, 'a dead body never blocks');
  simulation.zombies.delete('zbody');
  Object.assign(blocker, { x: -5, z: -25.1 });
  assert.equal(simulation.raidEntryClear(probe, { x: -5, z: -28 }), false, 'survivor within 3 m');
  blocker.alive = false;
  assert.equal(simulation.raidEntryClear(probe, { x: -5, z: -28 }), true);
  simulation.spawnWarnings.set('zw', { id: 'zw', x: -5.5, z: -28 });
  assert.equal(simulation.raidEntryClear(probe, { x: -5, z: -28 }), false, 'zombie warning within .58 m');
  assert.equal(simulation.raidEntryClear(probe, { x: -2, z: -6.1 }), false, 'static geometry');
});

test('counts are derived from state: remaining, zombiesRemaining and raid.remaining', () => {
  const { simulation } = raidRoom({ wave: 10 });
  emptyWave(simulation);
  const zombie = zombieAt(simulation, 'z1');
  let state = simulation.snapshot();
  assert.deepEqual([state.remaining, state.zombiesRemaining, state.raid.remaining], [1, 1, 0], 'raiders count only from the trigger');
  simulation.tick(1 / 30);
  state = simulation.snapshot();
  assert.deepEqual([state.remaining, state.zombiesRemaining, state.raid.remaining], [5, 1, 4]);
  simulation.zombies.delete(zombie.id);
  const check = () => {
    const snapshot = simulation.snapshot();
    assert.equal(snapshot.remaining, snapshot.zombiesRemaining + snapshot.raid.remaining);
    assert.equal(snapshot.raid.remaining, simulation.raid.total - simulation.raid.spawned + simulation.raidWarnings.size + raidersOf(simulation).length);
    return snapshot;
  };
  for (let step = 0; step < 30 * 7; step++) { simulation.tick(1 / 30); check(); }
  state = check();
  assert.deepEqual([raidersOf(simulation).length, state.remaining, state.zombiesRemaining], [2, 4, 0]);
  assert.equal(state.zombies.length, 2);
  simulation.damageSpecialZombie(raidersOf(simulation)[0], 1e4, 'a', { x: 0, z: 1 }, 'pistol');
  assert.equal(check().remaining, 3, 'one kill removes exactly one threat');
  simulation.tick(1 / 30); materialize(simulation);
  for (const raider of raidersOf(simulation).slice(1)) simulation.zombies.delete(raider.id);
  state = check();
  assert.equal(simulation.raid.spawned, 4);
  assert.deepEqual([state.remaining, state.zombies.length, state.raid.remaining], [1, 1, 1], 'once all have materialized, remaining === zombies.size');
  // Two live raiders and no zombies.
  const solo = raidRoom({ wave: 5 });
  trigger(solo.simulation); materialize(solo.simulation);
  const snapshot = solo.simulation.snapshot();
  assert.deepEqual([snapshot.remaining, snapshot.zombiesRemaining, snapshot.raid.remaining, snapshot.zombies.length], [2, 0, 2, 2]);
});

test('the wave waits for the raid, ends once it is cleared and pays a single clear bonus', () => {
  const { simulation, events, player } = raidRoom({ wave: 5 });
  trigger(simulation);
  advance(simulation, 3);
  assert.equal(simulation.phase, 'wave', 'no zombies left, but a raider is pending');
  materialize(simulation); advance(simulation, 5);
  assert.equal(simulation.phase, 'wave');
  const [first, second] = raidersOf(simulation);
  const pointsBefore = player.points, scoreBefore = player.score, health = first.hp + second.hp;
  simulation.damageSpecialZombie(first, 1e4, 'a', { x: 1, z: 0 }, 'pistol');
  simulation.tick(1 / 30);
  assert.equal(simulation.phase, 'wave');
  simulation.damageSpecialZombie(second, 1e4, 'a', { x: 1, z: 0 }, 'pistol');
  assert.equal(simulation.phase, 'wave');
  simulation.tick(1 / 30);
  assert.equal(simulation.phase, 'intermission');
  assert.deepEqual(named(events, 'raid-cleared').map(({ index, wave, killed, retreated, bonus }) => ({ index, wave, killed, retreated, bonus })),
    [{ index: 1, wave: 5, killed: 2, retreated: 0, bonus: 50 }]);
  assert.equal(player.points - pointsBefore, 50, 'kill cash stays physical; only the bonus is credited');
  assert.equal(player.score - scoreBefore, health + 50 + 25, 'The raiders\' health (no overkill), the clear bonus and the second kill\'s chain bonus');
  assert.deepEqual(simulation.snapshot().raid, { index: 1, wave: 5, total: 2, squad: 2, triggered: true, cleared: true, remaining: 0, killed: 2, retreated: 0, bonus: 50 });
  advance(simulation, 6);
  assert.equal(named(events, 'raid-cleared').length, 1);
  assert.equal(simulation.snapshot().raid.cleared, true, 'the result stays visible during the intermission');
  advance(simulation, 6.1);
  assert.equal(simulation.wave, 6); assert.equal(simulation.raid, null);
  // Every living survivor (downed included) receives the bonus; the eliminated do not.
  // It pays for the raiders killed: 3 of 8 earns round(100 x 3 / 8) = 38 each.
  const group = raidRoom({ players: 3, wave: 10 });
  trigger(group.simulation);
  const [, downed, gone] = [...group.simulation.players.values()];
  Object.assign(downed, { downed: true, bleedOutAt: Infinity }); Object.assign(gone, { alive: false });
  group.simulation.raidWarnings.clear();
  Object.assign(group.simulation.raid, { spawned: group.simulation.raid.total, killed: 3, retreated: group.simulation.raid.total - 3 });
  group.simulation.tick(1 / 30);
  assert.equal(group.simulation.raid.total, 8);
  assert.deepEqual([...group.simulation.players.values()].map(survivor => survivor.points), [38, 38, 0]);
  assert.equal(named(group.events, 'raid-cleared')[0].bonus, 38);
});

test('with the real AI, a solo raid fights back and the wave ends once a scripted defender shoots both raiders', () => {
  const { simulation, events, player } = raidRoom({ wave: 5, random: seededRandom(8) });
  Object.assign(player, { x: 0, z: 3, weapon: 'assault' });
  player.inventory = { assault: { ammo: 1e4, reserve: 0 } };
  trigger(simulation);
  const eye = () => ({ x: player.x, y: player.y + 1.55, z: player.z });
  for (let step = 0; step < 30 * 150 && simulation.phase === 'wave'; step++) {
    const target = raidersOf(simulation).map(raider => ({ raider, point: { x: raider.x, y: raider.y + enemyPosture(raider).height * .55, z: raider.z } }))
      .filter(({ point }) => simulation.raiderLineClear(eye(), point))
      .sort((a, b) => Math.hypot(a.point.x - player.x, a.point.z - player.z) - Math.hypot(b.point.x - player.x, b.point.z - player.z))[0];
    const look = target ? { yaw: Math.atan2(-(target.point.x - player.x), -(target.point.z - player.z)),
      pitch: Math.atan2(target.point.y - eye().y, Math.hypot(target.point.x - player.x, target.point.z - player.z)) } : { yaw: 0, pitch: 0 };
    simulation.setInput('a', { forward: 0, strafe: 0, ...look });
    // Hold fire until raiders close in (they no longer shoot while running in from the treeline).
    if (target && Math.hypot(target.point.x - player.x, target.point.z - player.z) < 13) simulation.shoot('a');
    simulation.tick(1 / 30);
  }
  assert.equal(simulation.phase, 'intermission');
  assert.deepEqual(named(events, 'raid-cleared').map(({ killed, retreated }) => [killed, retreated]), [[2, 0]]);
  assert.ok(named(events, 'raider-shot').length > 0 && named(events, 'hit').some(hit => hit.source === 'raider'), 'the raiders shot back');
  assert.equal(named(events, 'kill').filter(kill => kill.raider).length, 2);
});

test('the raid cap sends every raider home; retreating raiders leave unseen beyond 18 m or after 12 s', () => {
  const { simulation, events } = raidRoom({ wave: 10 });
  trigger(simulation); materialize(simulation);
  assert.equal(raidersOf(simulation).length, 2);
  // Back on their entries, 22 m out and unseen from inside the cabin.
  for (const raider of raidersOf(simulation)) Object.assign(raider, { x: raider.ai.homeX, z: raider.ai.homeZ });
  simulation.raid.lastSquadAt = simulation.time - RAIDS.capAfterLastSquad;
  simulation.tick(1 / 30);
  assert.deepEqual(named(events, 'raid-retreat').map(({ index, ids }) => ({ index, ids })), [{ index: 2, ids: ['r1', 'r2'] }]);
  assert.deepEqual([simulation.raid.spawned, simulation.raidWarnings.size, simulation.raid.retreated >= 2], [4, 0, true]);
  // Both already stand on their unseen entries: they leave at once, without loot.
  assert.deepEqual(named(events, 'raider-left').map(event => event.id), ['r1', 'r2']);
  assert.equal(simulation.pickups.size, 0);
  simulation.tick(1 / 30);
  assert.equal(simulation.phase, 'intermission');
  assert.deepEqual(named(events, 'raid-cleared').map(({ killed, retreated }) => [killed, retreated]), [[0, 4]]);
  assert.equal(named(events, 'raid-retreat').length, 1);

  // A survivor in the open keeps a retreating raider in sight until 12 s.
  const seen = raidRoom({ wave: 5 });
  trigger(seen.simulation); materialize(seen.simulation);
  Object.assign(seen.player, { x: 24, z: 0 });
  seen.simulation.raid.lastSquadAt = seen.simulation.time - RAIDS.capAfterLastSquad;
  seen.simulation.tick(1 / 30);
  const [watched] = raidersOf(seen.simulation);
  assert.equal(watched.ai.state, 'retreat'); assert.equal(seen.simulation.raiderSeen(watched), true);
  advance(seen.simulation, RAIDS.retreatMaxSeconds - .2);
  assert.equal(seen.simulation.zombies.has(watched.id), true, 'still killable while it retreats');
  advance(seen.simulation, .25);
  assert.equal(seen.simulation.zombies.has(watched.id), false);

  // Unseen but still close: it runs at 3 m/s and leaves only beyond 18 m.
  const close = outdoor('pistol');
  Object.assign(close.player, { x: -2.8, z: 1.7 });
  const runner = addRaider(close.simulation, { x: 17, z: 3 });
  Object.assign(runner.ai, { homeX: 30, homeZ: 5 });
  assert.equal(close.simulation.raiderSeen(runner), false);
  close.simulation.beginRaiderRetreat(runner);
  advance(close.simulation, 1);
  assert.equal(close.simulation.zombies.has(runner.id), true);
  assert.ok(Math.abs(runner.x - 17 - 3) < .2, 'retreat speed');
  advance(close.simulation, 3);
  assert.equal(close.simulation.zombies.has(runner.id), false);
  assert.ok(runner.x - 8 >= RAIDS.retreatDespawnDistance - 1e-6);
  assert.deepEqual(named(close.events, 'raider-left').map(event => event.id), [runner.id]);

  // From inside the cabin, a retreat crosses an open door back out.
  const inside = outdoor('pistol');
  Object.assign(inside.player, { x: 5, z: 4 });
  inside.simulation.doors.find(door => door.id === 'west').boards.fill(0);
  const indoor = addRaider(inside.simulation, { x: -5, z: -1, doorId: 'west' });
  Object.assign(indoor.ai, { homeX: -30, homeZ: 5 });
  inside.simulation.beginRaiderRetreat(indoor);
  advance(inside.simulation, 3);
  assert.ok(indoor.x < -9, 'out through the west door');
  advance(inside.simulation, RAIDS.retreatMaxSeconds - 3 + .1);
  assert.equal(inside.simulation.zombies.has(indoor.id), false);
});

test('the clear bonus pays for the raiders killed: nothing after a pure cap retreat, a share after a partial one', () => {
  for (const [kills, bonus] of [[0, 0], [1, 25], [2, 50]]) {
    const { simulation, events, player } = raidRoom({ wave: 5 });
    trigger(simulation); materialize(simulation);
    const raiders = raidersOf(simulation);
    assert.equal(raiders.length, 2);
    for (const raider of raiders.slice(0, kills)) simulation.damageSpecialZombie(raider, 1e4, 'a', { x: 1, z: 0 }, 'pistol');
    // Kill cash stays a physical purse: only the bonus is credited at the clear.
    const points = player.points;
    if (kills < raiders.length) {
      // The rest wait on their unseen entries, so the cap sends them straight home.
      for (const raider of raidersOf(simulation)) Object.assign(raider, { x: raider.ai.homeX, z: raider.ai.homeZ });
      simulation.raid.lastSquadAt = simulation.time - RAIDS.capAfterLastSquad;
    }
    advance(simulation, .2);
    assert.equal(simulation.phase, 'intermission', `${kills} killed`);
    assert.deepEqual(named(events, 'raid-cleared').map(({ killed, retreated, bonus }) => ({ killed, retreated, bonus })),
      [{ killed: kills, retreated: 2 - kills, bonus }]);
    assert.equal(named(events, 'raid-retreat').length, kills < 2 ? 1 : 0);
    assert.equal(player.points - points, bonus, `${kills} killed`);
    assert.equal(simulation.snapshot().raid.bonus, bonus);
  }
});

test('the trigger cap bounds a raid at 300 s even while slow kills keep releasing squads', () => {
  assert.deepEqual([RAIDS.capAfterLastSquad, RAIDS.capAfterTrigger], [150, 300]);
  const { simulation, events } = raidRoom({ players: 4, wave: 15 });
  trigger(simulation);
  const raid = simulation.raid, start = raid.triggeredAt;
  // A kill every 25 s frees a slot; the 20 s timer then releases one raider and refreshes lastSquadAt.
  let nextKill = start + 12.5;
  while (raid.retreatAt === null && simulation.time < start + RAIDS.capAfterTrigger + 30) {
    if (simulation.time >= nextKill) {
      const [oldest] = raidersOf(simulation);
      if (oldest) simulation.damageSpecialZombie(oldest, 1e5, 'a', { x: 1, z: 0 }, 'pistol');
      nextKill += 25;
    }
    simulation.tick(1 / 30);
  }
  assert.ok(named(events, 'raid-squad').length >= 10, `squads kept coming: ${named(events, 'raid-squad').length}`);
  assert.ok(raid.retreatAt !== null, 'the raid was capped');
  assert.ok(Math.abs(raid.retreatAt - start - RAIDS.capAfterTrigger) < .05, `capped ${raid.retreatAt - start} s after the trigger`);
  assert.ok(raid.retreatAt - raid.lastSquadAt < RAIDS.capAfterLastSquad, 'only the trigger cap could have fired');
  assert.equal(named(events, 'raid-retreat').length, 1);
  assert.deepEqual([raid.spawned, simulation.raidWarnings.size], [raid.total, 0]);
  // The exact boundary, with a squad released this very tick.
  const edge = raidRoom({ players: 4, wave: 15 });
  trigger(edge.simulation);
  Object.assign(edge.simulation.raid, { lastSquadAt: edge.simulation.time, triggeredAt: edge.simulation.time - RAIDS.capAfterTrigger + 2 / 30 });
  edge.simulation.tick(1 / 30);
  assert.equal(named(edge.events, 'raid-retreat').length, 0, 'one tick early');
  edge.simulation.tick(1 / 30);
  assert.equal(named(edge.events, 'raid-retreat').length, 1);
  assert.equal(edge.simulation.raid.retreatAt, edge.simulation.time);
});

test('the solo and duo damage scales reach raider bullets and blows on the real raid path', () => {
  assert.deepEqual([...RAIDS.damageScale], [.5, .85, 1, 1]);
  for (const [players, scale] of [[1, .5], [2, .85]]) {
    const { simulation, events, player } = raidRoom({ players, wave: 5 });
    trigger(simulation); materialize(simulation);
    const raiders = raidersOf(simulation);
    assert.ok(raiders.length >= 2);
    for (const raider of raiders) {
      assert.equal(raider.damageScale, scale, `${players} player(s)`);
      assert.ok(Math.abs(raider.damage - ENEMY_PROFILES.raider.damage * scale) < 1e-9, 'the bash is scaled too');
    }
    // One exact pistol bullet at a survivor 3 m in front of the first raider, toward the cabin.
    const [shooter] = raiders, gap = Math.hypot(shooter.x, shooter.z);
    shooter.loadout = 'pistol';
    Object.assign(player, { x: shooter.x * (1 - 3 / gap), y: 0, z: shooter.z * (1 - 3 / gap), crouched: false, hp: 100, armor: 0 });
    const point = { x: player.x, y: 1.085, z: player.z }, before = events.length;
    const shot = simulation.traceRaiderShot(shooter, simulation.raiderMuzzle(shooter, point), point, { sigma: 0 });
    assert.equal(shot.pellets[0].stop, 'player');
    const hit = named(events.slice(before), 'hit').find(event => event.id === 'a');
    const unscaled = RAIDER_LOADOUTS.pistol.damage * Math.min(1.15, damageFalloff(WEAPONS.pistol, shot.pellets[0].distance));
    assert.equal(hit.damage, Math.round(unscaled * scale * 1000) / 1000, `${players} player(s)`);
    assert.equal(hit.raiderId, shooter.id);
  }
});

test('the raid QA hook refuses to load without an isolated PORT, never on 3000 or 3002', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const load = port => {
    const env = { ...process.env };
    for (const key of ['PORT', 'RAID_QA_WAVE', 'RAID_QA_HORDE']) delete env[key];
    if (port !== undefined) env.PORT = port;
    return spawnSync(process.execPath, ['--import', './validation/raid-qa-hook.mjs', '--input-type=module', '-e', 'console.log("loaded")'], { cwd: root, env, encoding: 'utf8' });
  };
  for (const port of [undefined, '', '3000', '3002', ' 3002', '03002', 'abc']) {
    const run = load(port);
    assert.notEqual(run.status, 0, `PORT=${JSON.stringify(port)}`);
    assert.match(run.stderr, /raid-qa-hook: PORT must name an isolated port \(PORT=0 picks a free one/);
    assert.doesNotMatch(run.stdout, /loaded/);
  }
  const run = load('0');
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /\[raid-qa-hook\] campaign starts at wave 5 .*\nloaded/);
});

test('the stuck guard re-plans once after 20 s still, then sends that raider alone home 20 s later', () => {
  const { simulation } = outdoor('pistol');
  const raider = addRaider(simulation, { x: 20, z: 0 }), other = addRaider(simulation, { x: 22, z: 4 });
  const start = simulation.time, guard = (body, seconds) => { simulation.time = start + seconds; return simulation.raiderStuckGuard(body); };
  guard(raider, 12); guard(other, 12);
  // Moving one metre restarts the clock; holding still does not.
  raider.x -= 1.1;
  assert.equal(guard(raider, 12.5), false); assert.equal(raider.ai.movedAt, start + 12.5);
  raider.navigation = { target: { x: 0, z: 0 }, path: [], direct: false }; raider.portalRoute = { doorId: 'east', stage: 'approach' };
  guard(raider, 32.4);
  assert.equal(raider.ai.replanned, false); assert.ok(raider.navigation);
  guard(raider, 32.5);
  assert.equal(raider.ai.replanned, true); assert.equal(raider.navigation, null); assert.equal(raider.portalRoute, null);
  assert.equal(guard(raider, 32.5 + RAIDS.stuckRetreatAfter - .1), false);
  assert.equal(raider.ai.state, 'advance');
  assert.equal(guard(raider, 32.5 + RAIDS.stuckRetreatAfter), true);
  assert.deepEqual([raider.ai.state, raider.ai.retreatStartedAt, raider.speed], ['retreat', start + 52.5, RAIDS.retreatSpeed]);
  assert.equal(other.ai.replanned, false, 'only the stuck raider is affected');
  // A freed raider re-plans again on a later jam; engage and retreat never count.
  guard(other, 20); assert.equal(other.ai.replanned, true);
  other.x += 2; guard(other, 21); assert.equal(other.ai.replanned, false);
  other.ai.state = 'engage'; guard(other, 60); assert.equal(other.ai.movedAt, start + 60);
  assert.equal(simulation.raid, null, 'no raid cap involved');
});

test('start, endGame and beginExtraction reset raid state', () => {
  const { simulation } = raidRoom({ wave: 5 });
  trigger(simulation); advance(simulation, 3);
  simulation.raidLootIds.add('p1');
  assert.ok(simulation.raidWarnings.size);
  simulation.endGame();
  assert.equal(simulation.phase, 'gameover'); assert.equal(simulation.raidWarnings.size, 0); assert.equal(simulation.raid.over, true);
  const frozen = structuredClone(simulation.raid);
  advance(simulation, 3); assert.deepEqual(simulation.raid, frozen);
  assert.equal(simulation.raidSettled(), true);
  simulation.start('a');
  assert.deepEqual([simulation.raid, simulation.raidWarnings.size, simulation.nextRaiderId, simulation.raidLootIds.size, raidersOf(simulation).length], [null, 0, 1, 0, 0]);

  const end = raidRoom({ wave: 20 });
  emptyWave(end.simulation);
  end.simulation.raidWarnings.set('r9', { id: 'r9', x: 0, z: 0, announceAt: 0, readyAt: Infinity });
  assert.equal(end.simulation.beginExtraction(), true);
  assert.equal(end.simulation.raidWarnings.size, 0);
});

test('pause freezes raiders, warnings and raid timers; raid state survives structuredClone and JSON', () => {
  const { simulation } = raidRoom({ players: 2, wave: 10 });
  trigger(simulation); advance(simulation, 2.6);
  assert.ok(raidersOf(simulation).length);
  simulation.tick(1 / 30);
  assert.equal(simulation.setPause('a', true), true);
  const frozen = structuredClone({ raid: simulation.raid, raiders: raidersOf(simulation), warnings: [...simulation.raidWarnings.values()], time: simulation.time });
  advance(simulation, 10);
  assert.deepEqual({ raid: simulation.raid, raiders: raidersOf(simulation), warnings: [...simulation.raidWarnings.values()], time: simulation.time }, frozen);
  simulation.setPause('a', false); advance(simulation, 1);
  assert.ok(simulation.time > frozen.time);
  const state = simulation.snapshot();
  for (const value of [state.raid, state.spawnWarnings, state.zombies, state.remaining, state.zombiesRemaining, state.nextRaidWave]) {
    assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
  }
  const raider = state.zombies.find(zombie => zombie.kind === 'raider');
  assert.deepEqual([raider.faction, raider.family], ['raider', 'raider']);
  assert.ok(['advance', 'engage', 'breach', 'assault', 'retreat'].includes(raider.state));
  assert.ok(typeof raider.crouched === 'boolean' && typeof raider.reloading === 'boolean' && Number.isFinite(raider.pitch));
  assert.ok(raider.aimingAt === null || simulation.players.has(raider.aimingAt));
  assert.equal(raider.weapon, RAIDER_LOADOUTS[raiderLoadout(2, 1)].model);
  assert.match(raider.id, /^r\d+$/);
  assert.equal(simulation.players.has(raider.id), false);
});

test('every player weapon damages and kills a raider', () => {
  const kill = ({ simulation, events }, raider) => {
    assert.equal(simulation.zombies.has(raider.id), false, raider.id);
    const event = named(events, 'kill').find(item => item.zombieId === raider.id);
    assert.equal(event.raider, true);
    assert.ok([RAIDS.cash, RAIDS.headshotCash].includes([...simulation.pickups.values()].find(pickup => pickup.kind === 'points').amount));
  };
  for (const weapon of ['pistol', 'smg', 'rifle', 'assault', 'minigun']) {
    const room = outdoor(weapon), raider = addRaider(room.simulation, { y: .4 });
    if (weapon === 'minigun') Object.assign(room.player, { minigunSpinning: true, minigunSpinUntil: 0 });
    assert.equal(room.simulation.shoot('a'), true, weapon);
    advanceBallisticFlight(room.simulation, .1);
    assert.ok(raider.hp < raider.maxHp && raider.hp > 0, weapon);
    raider.hp = 1; room.simulation.time += 2; room.player.reloadUntil = 0;
    assert.equal(room.simulation.shoot('a'), true); advanceBallisticFlight(room.simulation, .1); kill(room, raider);
  }
  {
    const room = outdoor('shotgun'), raider = addRaider(room.simulation, { index: 3, y: .4 });
    assert.equal(room.simulation.shoot('a'), true);
    advanceBallisticFlight(room.simulation, .1);
    assert.equal(named(room.events, 'bullet-impact').filter(event => event.stop === 'zombie').length, WEAPONS.shotgun.pellets, 'every pellet lands');
    assert.ok(raider.hp < 300 - 9 * 10);
    room.simulation.time += 2; room.simulation.shoot('a'); advanceBallisticFlight(room.simulation, .1); kill(room, raider);
  }
  {
    const room = outdoor('sniper'), front = addRaider(room.simulation, { index: 2, y: .4 }), rear = addRaider(room.simulation, { index: 2, y: .4, z: 2 });
    assert.equal(room.simulation.shoot('a'), true);
    advanceBallisticFlight(room.simulation, .1);
    kill(room, front); kill(room, rear);
    assert.equal(named(room.events, 'bullet-impact').filter(event => event.stop === 'zombie').length, 2, 'penetration');
  }
  {
    const room = outdoor('magnum'), raider = addRaider(room.simulation, { index: 3, y: .4 });
    room.simulation.shoot('a'); advanceBallisticFlight(room.simulation, .1); kill(room, raider);
  }
  // Any melee weapon added later is swung at a raider too.
  const laterMelee = Object.keys(MELEE_WEAPONS).filter(weapon => !['katana', 'hammer', 'bat'].includes(weapon)).map(weapon => [weapon, 'heavy']);
  for (const [weapon, attack] of [['katana', 'light'], ['hammer', 'light'], ['bat', 'light'], ['bat', 'heavy'], ...laterMelee]) {
    const room = outdoor(weapon), raider = addRaider(room.simulation, { z: 6.65 });
    if (weapon === 'bat') raider.hp = attack === 'light' ? 121 : 120;
    assert.equal(room.simulation.shoot('a', 0, attack), true);
    room.simulation.time += 1; room.simulation.updateMelee();
    if (weapon === 'bat' && attack === 'light') { assert.equal(raider.hp, 1); continue; }
    kill(room, raider);
  }
  {
    const room = outdoor('rocket'), raider = addRaider(room.simulation, { index: 3 });
    room.simulation.shoot('a'); kill(room, raider);
    assert.equal(named(room.events, 'explosion').length, 1);
  }
  {
    const room = outdoor('pistol'), raider = addRaider(room.simulation, { index: 3 });
    const grenade = { id: 'g1', ownerId: 'a', x: 12, y: .3, z: 5.6, vx: 0, vy: 0, vz: 0, fuseLeft: 0 };
    room.simulation.grenades.set(grenade.id, grenade);
    assert.equal(room.simulation.explodeGrenade(grenade), true); kill(room, raider);
  }
  {
    const room = outdoor('flamethrower'), raider = addRaider(room.simulation);
    assert.equal(room.simulation.shoot('a'), true);
    assert.ok(raider.burnUntil > room.simulation.time && raider.hp < raider.maxHp);
    for (let step = 0; step < 30 && room.simulation.zombies.has(raider.id); step++) { room.simulation.time += 1 / 30; room.simulation.updateBurns(1 / 30); }
    kill(room, raider);
    assert.equal(named(room.events, 'kill')[0].weapon, 'flamethrower');
  }
});

test('raider hitboxes: head versus body, a lower crouched box and the raid-3 vest', () => {
  const room = outdoor('pistol'), standing = addRaider(room.simulation);
  assert.equal(enemyHitbox(standing).maxY, 1.78);
  assert.equal(enemyHeadshot(standing, 1.5), true); assert.equal(enemyHeadshot(standing, 1.4), false);
  standing.crouched = true;
  assert.equal(enemyHitbox(standing).maxY, 1.12);
  assert.equal(enemyHeadshot(standing, .9), true); assert.equal(enemyHeadshot(standing, .8), false);
  const snapshot = room.simulation.snapshot().zombies[0];
  assert.deepEqual([snapshot.height, snapshot.headHeight, snapshot.crouched], [1.12, 1.03, true]);
  standing.crouched = false;
  assert.deepEqual([room.simulation.snapshot().zombies[0].height, room.simulation.snapshot().zombies[0].headHeight], [1.78, 1.67]);
  // Same 2.68 m line: head x2.2, body x1, a raid-3 body x0.8.
  const damage = (options, pitch = 0) => {
    const shot = outdoor('pistol'), raider = addRaider(shot.simulation, options);
    shot.player.pitch = pitch; shot.simulation.shoot('a');
    advanceBallisticFlight(shot.simulation, .1);
    return { taken: raider.maxHp - raider.hp, headshot: shot.events.some(event => event.event === 'bullet-impact' && event.headshot) };
  };
  const head = damage({ index: 2 }).taken, body = damage({ index: 2, y: .4 }).taken, vest = damage({ index: 3, y: .4 }).taken;
  assert.ok(Math.abs(head / body - waveBalance(14).headshotMultiplier) < 1e-9);
  assert.ok(Math.abs(vest / body - .8) < 1e-9);
  assert.equal(damage({ index: 3 }).taken, head, 'the vest leaves the head unprotected');
  assert.equal(damage({ index: 2, crouched: true }).taken, 0, 'a level shot passes over a crouched raider');
  const low = Math.atan2(.95 - 1.55, 8 - 5.32), lower = Math.atan2(.7 - 1.55, 8 - 5.32);
  assert.ok(Math.abs(damage({ index: 2, crouched: true }, low).taken - head) < .01, 'crouched head, with slightly longer slanted travel');
  assert.ok(Math.abs(damage({ index: 2, crouched: true }, lower).taken - body) < .01, 'crouched body, with slightly longer slanted travel');
  assert.deepEqual([1, 2, 3].map(index => enemyDamageMultiplier(addRaider(room.simulation, { index }), false)), [1, 1, .8]);
  assert.equal(enemyDamageMultiplier(addRaider(room.simulation, { index: 3 }), true), 1);
  assert.equal(enemyDamageMultiplier({ kind: 'armored' }, false), .65);
  // Identity: never a zombie family, never a zombie variant.
  assert.equal(enemyAppearance(standing), RAIDER_APPEARANCE);
  assert.deepEqual([RAIDER_APPEARANCE.id, RAIDER_APPEARANCE.label.fr, RAIDER_APPEARANCE.label.en, RAIDER_APPEARANCE.color], ['raider', 'Pillard', 'Raider', 0xd8453b]);
  assert.equal(ENEMY_APPEARANCES.includes(RAIDER_APPEARANCE), false);
  for (let wave = 1; wave <= 20; wave++) for (let ordinal = 1; ordinal <= 200; ordinal++) {
    for (const fast of [false, true]) assert.notEqual(enemyVariant(wave, ordinal, fast), 'raider');
  }
  // Knockback resistance .6 against a walker's 1.
  const walker = zombieAt(room.simulation, 'zw', { x: 12, z: 3 });
  room.simulation.pushZombie(walker, 50, 0); room.simulation.pushZombie(standing, 50, 0);
  assert.ok(Math.abs(standing.pushX / walker.pushX - .6) < 1e-9);
});

test('raider rewards: score, cash purse, a full ammo box, the special box for the last raider and longer lifetimes', () => {
  const { simulation, events, player } = raidRoom({ wave: 5 });
  trigger(simulation); materialize(simulation);
  const counters = () => [simulation.lootKills, simulation.ammoDrops, simulation.waveKills, simulation.waveGrenadeDrops];
  const before = counters();
  const [first, second] = raidersOf(simulation);
  // A real headshot from the pistol, at point blank in the open.
  Object.assign(player, { x: first.x - 3, y: 0, z: first.z, yaw: -Math.PI / 2, pitch: 0, weapon: 'pistol', hp: 100 });
  player.inventory = { pistol: { ammo: 12, reserve: 36 } };
  first.hp = 1;
  const score = player.score;
  assert.equal(simulation.shoot('a'), true);
  advanceBallisticFlight(simulation, .025);
  assert.equal(named(events, 'kill')[0].headshot, true);
  assert.equal(player.score - score, 1, 'its last health point, no fixed raider score');
  let loot = [...simulation.pickups.values()];
  assert.deepEqual(loot.map(pickup => [pickup.kind, pickup.amount, pickup.special, pickup.charge]), [['points', 60, false, undefined], ['ammo', 1, false, PICKUPS.ammoCharge]]);
  assert.ok(loot.every(pickup => Math.abs(pickup.expiresAt - named(events, 'kill')[0].time - RAIDS.lootLifetime) < .001 && simulation.raidLootIds.has(pickup.id)));
  assert.equal(simulation.raid.killed, 1);
  simulation.damageSpecialZombie(second, 1e4, 'a', { x: 1, z: 0 }, 'pistol');
  loot = [...simulation.pickups.values()].slice(2);
  assert.deepEqual(loot.map(pickup => [pickup.kind, pickup.amount, pickup.special]), [['points', 40, false], ['ammo', 1, true]], 'the last raider drops the special box');
  assert.deepEqual(counters(), before, 'zombie loot cadences and grenade quotas are untouched');
  assert.equal(killCash({ kind: 'raider' }, false), 40); assert.equal(killCash({ kind: 'raider' }, true), 60);
  assert.deepEqual(ECONOMY, { kill: 18, headshot: 24, brute: 60, bruteHeadshot: 90, boss: 100, bossHeadshot: 150, repair: 1, revive: 25 });
  // Clearing extends short-lived raid loot to at least 60 s.
  const short = [...simulation.pickups.values()][0];
  short.expiresAt = simulation.time + 5;
  simulation.tick(1 / 30);
  assert.equal(simulation.raid.cleared, true);
  assert.ok(Math.abs(short.expiresAt - simulation.time - 60) < 1e-9);
  assert.ok([...simulation.pickups.values()].slice(1).every(pickup => pickup.expiresAt - simulation.time > 200));
  // The score is the damage dealt (owner, 18 October): no fixed kill score
  // is left for zombies or raiders; their cash stays.
  assert.equal(simulation.killScore, undefined);
  assert.equal(Object.hasOwn(RAIDS, 'score') || Object.hasOwn(RAIDS, 'headshotScore'), false);
});

test('raider hits on survivors carry their origin and no zombie id; armour absorbs them; damageScale scales the bash', () => {
  const { simulation, events, player } = raidRoom({ wave: 5, sturdy: false });
  const raider = addRaider(simulation, { x: 20.0004, z: -3, damageScale: .7 });
  assert.ok(Math.abs(raider.damage - 14 * .7) < 1e-9);
  player.armor = 5;
  simulation.damagePlayer(player, 20, raider);
  let hit = named(events, 'hit').at(-1);
  assert.deepEqual(hit, { ...hit, id: 'a', damage: 20, absorbed: 5, armor: 0, source: 'raider', raiderId: raider.id, fromX: 20, fromZ: -3 });
  assert.equal(Object.hasOwn(hit, 'zombieId'), false);
  assert.equal(player.hp, 85);
  simulation.damagePlayer(player, 100, raider);
  const down = named(events, 'down').at(-1);
  assert.deepEqual([down.source, down.raiderId, down.fromX, down.fromZ, Object.hasOwn(down, 'zombieId')], ['raider', raider.id, 20, -3, false]);
  // Zombie and fall hits keep their exact fields.
  const other = raidRoom({ wave: 5, sturdy: false });
  other.simulation.damagePlayer(other.player, 5, { id: 'z7' });
  other.simulation.damagePlayer(other.player, 5, { source: 'fall' });
  const [zombieHit, fallHit] = named(other.events, 'hit').map(({ type, event, eventId, time, ...rest }) => rest);
  assert.deepEqual(zombieHit, { id: 'a', damage: 5, absorbed: 0, armor: 0, zombieId: 'z7' });
  assert.deepEqual(fallHit, { id: 'a', damage: 5, absorbed: 0, armor: 0, zombieId: undefined, source: 'fall' });
  assert.equal(named(events, 'drill-hit').length, 0, 'campaign rooms never emit drill hits');
});

test('raiders.mjs imports only public modules and loads before simulation.mjs without a cycle', () => {
  const source = readFileSync(new URL('../raiders.mjs', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map(match => match[1]);
  assert.ok(imports.length && imports.every(path => path.startsWith('./public/') && path.endsWith('.js')), imports.join());
  const root = fileURLToPath(new URL('..', import.meta.url));
  const raiders = pathToFileURL(fileURLToPath(new URL('../raiders.mjs', import.meta.url))).href;
  const simulation = pathToFileURL(fileURLToPath(new URL('../simulation.mjs', import.meta.url))).href;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
    const raiders = await import(${JSON.stringify(raiders)});
    const { RoomSimulation } = await import(${JSON.stringify(simulation)});
    const room = new RoomSimulation('ORDER1'); room.addPlayer('a'); room.start('a'); room.wave = 4; room.beginWave();
    console.log(Object.keys(raiders).join(','), typeof room.updateRaid, room.raid.index);
  `], { cwd: root, encoding: 'utf8' });
  assert.equal(output.trim(), 'createRaiderMethods function 1');
});
