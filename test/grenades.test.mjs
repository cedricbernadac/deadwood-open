import { advanceBallisticFlight } from './helpers/ballistic-flight.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomSimulation, WORLD } from '../simulation.mjs';
import { GRENADES, PICKUPS, MAX_WAVES, difficultyLevel, grenadeDropsForWave, waveBalance, killCash } from '../public/rules.js';
import { enemyHitbox } from '../public/enemies.js';
import { STAIRS, STAIR_STRINGERS } from '../public/stairs.js';

function fixture(wave = 5, playerCount = 1) {
  const events = [];
  const simulation = new RoomSimulation('FRAGS', { random: () => .5, onEvent: event => events.push(event) });
  for (let index = 0; index < playerCount; index++) simulation.addPlayer(String.fromCharCode(97 + index));
  simulation.start('a');
  simulation.wave = wave - 1;
  simulation.beginWave();
  simulation.spawnTimer = 999;
  const player = simulation.players.get('a');
  Object.assign(player, { x: 0, y: 0, z: 2, yaw: 0, pitch: 0 });
  return { simulation, player, events };
}
function loot(simulation, overrides = {}) {
  const id = `fixture-${simulation.nextPickupId++}`;
  const pickup = { id, kind: 'grenade', x: 0, y: 0, z: 2, amount: 1, special: false,
    expiresAt: simulation.time + PICKUPS.lifetime, ...overrides };
  simulation.pickups.set(id, pickup);
  return pickup;
}
function planted(simulation, overrides = {}) {
  const id = `g${simulation.nextGrenadeId++}`;
  const grenade = { id, ownerId: 'a', x: 10, y: .935, z: -5, vx: 0, vy: 0, vz: 0, fuseLeft: 1.8, ...overrides };
  simulation.grenades.set(id, grenade);
  return grenade;
}
function target(simulation, overrides = {}) {
  const zombie = simulation.spawnZombie();
  Object.assign(zombie, { x: 10, y: 0, z: -5, hp: 400, maxHp: 400, kind: 'walker', boss: false, scale: 1,
    entered: true, speed: 0, attackAfter: Infinity, ...overrides });
  return zombie;
}
function advanceGrenades(simulation, seconds, hz = 30, callback = () => {}) {
  for (let tick = 0; tick < Math.round(seconds * hz); tick++) {
    simulation.updateGrenades(1 / hz);
    callback();
  }
}

test('the shared quota rises at compressed difficulty thresholds, independent of team size', () => {
  for (let wave = 1; wave <= MAX_WAVES; wave++) for (let players = 1; players <= 4; players++) {
    const { simulation } = fixture(wave, players);
    const quota = Math.floor(difficultyLevel(wave) / 5), total = waveBalance(wave, players).total;
    assert.equal(grenadeDropsForWave(wave), quota);
    assert.equal(simulation.waveInitialTotal, total);
    assert.equal(simulation.waveGrenadeThresholds.length, quota);
    for (let killed = 1; killed <= total; killed++) {
      simulation.dropZombieLoot({ x: 10, y: 0, z: 0 }, 18);
      const actual = [...simulation.pickups.values()].filter(pickup => pickup.kind === 'grenade').length;
      assert.equal(actual, simulation.waveGrenadeThresholds.filter(threshold => threshold <= killed).length);
    }
    assert.equal(simulation.waveGrenadeDrops, quota);
    assert.ok(simulation.waveGrenadeThresholds.every(threshold => threshold < total), 'Every grenade appears before the last kill');
    assert.equal(simulation.waveKills, total);
  }
});

test('joining mid-wave cannot enlarge the fixed quota or move its kill thresholds', () => {
  const { simulation } = fixture(MAX_WAVES);
  const initial = [...simulation.waveGrenadeThresholds], total = simulation.waveInitialTotal;
  for (let killed = 0; killed < initial[0] - 1; killed++) simulation.dropZombieLoot({ x: 10, y: 0, z: 0 }, 18);
  simulation.addPlayer('b'); simulation.addPlayer('c'); simulation.addPlayer('d');
  assert.deepEqual(simulation.waveGrenadeThresholds, initial);
  assert.equal(simulation.waveInitialTotal, total);
  simulation.dropZombieLoot({ x: 10, y: 0, z: 0 }, 18);
  assert.equal(simulation.waveGrenadeDrops, 1);
  for (let killed = simulation.waveKills; killed < total; killed++) simulation.dropZombieLoot({ x: 10, y: 0, z: 0 }, 18);
  assert.equal(simulation.waveGrenadeDrops, 6);
  simulation.removePlayer('b');
  assert.equal(simulation.waveGrenadeDrops, 6);
});

test('grenade pickups remain shared when the closest survivor carries two and are collected exactly once', () => {
  const { simulation, player, events } = fixture();
  const teammate = simulation.addPlayer('b');
  Object.assign(teammate, { x: .3, y: 0, z: 2 });
  player.grenades = GRENADES.maxCarry;
  const pickup = loot(simulation);
  simulation.collectPickups();
  assert.equal(player.grenades, 2);
  assert.equal(teammate.grenades, 1);
  assert.equal(simulation.pickups.has(pickup.id), false);
  const event = events.filter(item => item.event === 'pickup').at(-1);
  assert.equal(event.id, 'b'); assert.equal(event.kind, 'grenade'); assert.equal(event.grenades, 1);
  simulation.collectPickups();
  assert.equal(teammate.grenades, 1);
  teammate.grenades = 2;
  const left = loot(simulation);
  simulation.collectPickups();
  assert.equal(simulation.pickups.has(left.id), true, 'A full team leaves the physical pickup intact');
});

test('grenade collection respects death, downed state, floor, barricade, occlusion, expiry and terminal phases', () => {
  for (const scenario of ['downed', 'dead', 'floor', 'wall', 'board', 'far', 'expired', 'lobby', 'gameover', 'extraction', 'victory']) {
    const { simulation, player } = fixture();
    const pickup = loot(simulation);
    if (scenario === 'downed') player.downed = true;
    if (scenario === 'dead') player.alive = false;
    if (scenario === 'floor') pickup.y = WORLD.loftY;
    if (scenario === 'wall') { Object.assign(player, { x: 2, z: -5.5 }); Object.assign(pickup, { x: 2, z: -6.5 }); }
    if (scenario === 'board') { player.z = -5.5; pickup.z = -6.5; }
    if (scenario === 'far') pickup.z += 2;
    if (scenario === 'expired') simulation.time = pickup.expiresAt;
    if (['lobby', 'gameover', 'extraction', 'victory'].includes(scenario)) simulation.phase = scenario;
    simulation.collectPickups();
    assert.equal(player.grenades, 0, scenario);
    assert.equal(simulation.pickups.has(pickup.id), scenario !== 'expired', scenario);
  }
});

test('carried grenades persist without free resupply and new games reset both stock and airborne objects', () => {
  const { simulation, player } = fixture();
  player.grenades = 2;
  simulation.finishWave();
  assert.equal(player.grenades, 2);
  player.grenades = 0;
  simulation.beginWave(); simulation.finishWave();
  assert.equal(player.grenades, 0, 'The ordinary between-wave refill never creates a grenade');
  player.grenades = 2;
  simulation.throwGrenade(player.id);
  assert.equal(simulation.grenades.size, 1);
  simulation.endGame();
  assert.equal(simulation.grenades.size, 0);
  simulation.start(player.id);
  assert.equal(player.grenades, 0);
  assert.equal(player.throwAfter, 0);
  assert.equal(simulation.waveKills, 0);
  assert.deepEqual(simulation.waveGrenadeThresholds, []);
});

test('throwing uses the authoritative pose, spends one stock and enforces cooldown without accepting client coordinates', () => {
  const { simulation, player, events } = fixture();
  player.grenades = 2;
  Object.assign(player, { x: 10, y: 0, z: 0, yaw: Math.PI / 2, pitch: .2 });
  assert.equal(simulation.throwGrenade('missing'), false);
  assert.equal(simulation.throwGrenade('a', { x: -999, y: 999, z: -999, yaw: 0, pitch: 0 }), true);
  const grenade = [...simulation.grenades.values()][0];
  assert.equal(grenade.x, 10); assert.equal(grenade.z, 0); assert.equal(grenade.y, 1.55);
  assert.ok(grenade.vx < -7.8); assert.ok(Math.abs(grenade.vz) < 1e-8);
  assert.equal(player.grenades, 1);
  assert.equal(simulation.throwGrenade('a'), false);
  simulation.time += GRENADES.cooldown;
  assert.equal(simulation.throwGrenade('a'), true);
  assert.equal(player.grenades, 0);
  simulation.time += GRENADES.cooldown;
  assert.equal(simulation.throwGrenade('a'), false);
  assert.equal(events.filter(event => event.event === 'grenade-thrown').length, 2);
  const snapshot = simulation.snapshot();
  assert.equal(snapshot.players[0].grenades, 0);
  assert.equal(snapshot.grenades.length, 2);
  assert.deepEqual(Object.keys(snapshot.grenades[0]).sort(), ['fuseLeft', 'id', 'x', 'y', 'z']);
  assert.ok(!('vx' in snapshot.grenades[0]), 'Clients cannot control projectile velocity through the state protocol');
});

test('dead, downed, lobby and terminal players cannot throw or consume a carried grenade', () => {
  for (const state of ['dead', 'downed', 'lobby', 'gameover', 'extraction', 'victory']) {
    const { simulation, player } = fixture();
    player.grenades = 1;
    if (state === 'dead') player.alive = false;
    else if (state === 'downed') player.downed = true;
    else simulation.phase = state;
    assert.equal(simulation.throwGrenade('a'), false, state);
    assert.equal(player.grenades, 1, state);
    assert.equal(simulation.grenades.size, 0, state);
  }
});

test('the fuse follows real simulation time and produces one explosion only', () => {
  for (const hz of [30, 10]) {
    const { simulation, player, events } = fixture();
    Object.assign(player, { x: 10, z: 0, grenades: 1 });
    simulation.throwGrenade('a');
    advanceGrenades(simulation, 1.7, hz);
    assert.equal(simulation.grenades.size, 1);
    assert.equal(events.filter(event => event.event === 'explosion').length, 0);
    advanceGrenades(simulation, .1, hz);
    assert.equal(simulation.grenades.size, 0);
    advanceGrenades(simulation, 1, hz);
    assert.equal(events.filter(event => event.event === 'explosion').length, 1);
  }
});

test('grenade arcs and floor bounces are stable at 30 and 10 Hz without penetrating the ground', () => {
  const finals = [];
  for (const hz of [30, 10]) {
    const { simulation, player } = fixture();
    Object.assign(player, { x: 10, z: 0, grenades: 1 });
    simulation.throwGrenade('a');
    const grenade = [...simulation.grenades.values()][0];
    let maximumY = grenade.y;
    advanceGrenades(simulation, 1.7, hz, () => {
      assert.ok(grenade.y >= GRENADES.radius - 1e-6);
      maximumY = Math.max(maximumY, grenade.y);
    });
    assert.ok(maximumY > 1.65, 'A visible upward arc precedes the fall');
    assert.ok(grenade.z < -2, 'The server really advances the projectile');
    finals.push([grenade.x, grenade.y, grenade.z]);
  }
  for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(finals[0][axis] - finals[1][axis]) < .001);
});

test('thin partition walls stop and reflect a grenade at both supported tick rates', () => {
  for (const hz of [30, 10]) {
    const { simulation, player } = fixture();
    Object.assign(player, { x: 0, z: 0, grenades: 1 });
    simulation.throwGrenade('a');
    const grenade = [...simulation.grenades.values()][0];
    let reflected = false;
    advanceGrenades(simulation, 1.7, hz, () => {
      assert.ok(grenade.z >= -1.88 + GRENADES.radius - .001, 'The .24 m wall cannot be crossed');
      reflected ||= grenade.vz > 0;
    });
    assert.equal(reflected, true);
  }
});

test('individual rotated barricade boards stop grenades, while a destroyed opening admits the same throw', () => {
  for (const hz of [30, 10]) for (const intact of [true, false]) {
    const { simulation, player } = fixture();
    Object.assign(player, { x: 0, z: -5.5, grenades: 1 });
    const north = simulation.doors.find(door => door.id === 'north');
    north.sealed = false; // Ordinary active wooden barricade, independent of the solo plate.
    if (!intact) north.hp = 0;
    simulation.throwGrenade('a');
    const grenade = [...simulation.grenades.values()][0];
    let minimumZ = grenade.z;
    advanceGrenades(simulation, 1.2, hz, () => minimumZ = Math.min(minimumZ, grenade.z));
    if (intact) assert.ok(minimumZ > -6, `Board must stop the ${hz} Hz throw`);
    else assert.ok(minimumZ < -6.5, 'Removing boards leaves the actual doorway clear');
    assert.equal(north.hp, intact ? north.maxHp : 0, 'Impacts do not secretly destroy barricades');
  }
});

test('the loft slab catches throws from below and supports grenades thrown upstairs', () => {
  for (const hz of [30, 10]) for (const upstairs of [false, true]) {
    const { simulation, player } = fixture();
    Object.assign(player, { x: 5.5, y: upstairs ? WORLD.loftY : 0, z: 0, pitch: upstairs ? 0 : 1.48, grenades: 1 });
    simulation.throwGrenade('a');
    const grenade = [...simulation.grenades.values()][0];
    advanceGrenades(simulation, 1.7, hz, () => {
      if (upstairs) assert.ok(grenade.y >= WORLD.loftY + GRENADES.radius - .001);
      else assert.ok(grenade.y <= WORLD.loftY - .24 - GRENADES.radius + .001, 'No throw through the loft floor');
    });
  }
});

test('real staircase treads and rotated finite stringers also stop upward throws', () => {
  for (const hz of [30, 10]) for (const x of [(STAIRS.minX + STAIRS.maxX) / 2, STAIR_STRINGERS[0].x]) {
    const { simulation, player } = fixture();
    Object.assign(player, { x, y: 0, z: -1, pitch: 1.48, grenades: 1 });
    simulation.throwGrenade('a');
    const grenade = [...simulation.grenades.values()][0];
    let reflected = false, maxY = grenade.y;
    advanceGrenades(simulation, .3, hz, () => { reflected ||= grenade.vy < 0; maxY = Math.max(maxY, grenade.y); });
    assert.equal(reflected, true);
    assert.ok(maxY < 2.65, 'The grenade cannot pass through the visible stair underside');
  }
});

test('upstairs throws bounce beneath the visible inclined roof instead of escaping through it', () => {
  for (const hz of [30, 10]) {
    const { simulation, player } = fixture();
    Object.assign(player, { x: 6, y: WORLD.loftY, z: 0, pitch: 1.48, grenades: 1 });
    simulation.throwGrenade('a');
    const grenade = [...simulation.grenades.values()][0];
    let maximumY = grenade.y, reflected = false;
    advanceGrenades(simulation, 1, hz, () => { maximumY = Math.max(maximumY, grenade.y); reflected ||= grenade.vy < 0; });
    assert.equal(reflected, true);
    assert.ok(maximumY > 6, 'The throw reaches the attic roof');
    assert.ok(maximumY < 6.9, 'The actual sloping underside stops the projectile');
    assert.equal(simulation.grenadeBlastVisible({ x: 6, y: 7.2, z: 0 }, { x: 6, y: 6.2, z: 0 }), false);
  }
});

test('finite triangular gables block high projectiles and blasts but leave space above the ridge open', () => {
  for (const hz of [30, 10]) {
    const { simulation } = fixture();
    const grenade = planted(simulation, { x: 0, y: 7.1, z: -5.5, vz: -8 });
    advanceGrenades(simulation, .2, hz, () => assert.ok(grenade.z >= -6 + GRENADES.radius - .001));
    assert.ok(grenade.vz > 0, 'The high gable reflects the projectile');
    assert.equal(simulation.grenadeBlastVisible({ x: 0, y: 7.1, z: -5.8 }, { x: 0, y: 7.1, z: -6.2 }), false);
    assert.equal(simulation.grenadeBlastVisible({ x: 0, y: 8.5, z: -5.8 }, { x: 0, y: 8.5, z: -6.2 }), true);
  }
});

test('blast damage is spherical, full to 2 m then smoothly fades to 4 m, and does not gain a headshot multiplier', () => {
  const { simulation, player } = fixture();
  const rows = [0, 2, 3, 4, 5].map(range => ({ range, zombie: target(simulation, { z: -5 + range, hp: 1000, maxHp: 1000 }) }));
  const grenade = planted(simulation);
  assert.equal(simulation.explodeGrenade(grenade), true);
  for (const { range, zombie } of rows) {
    const expected = range <= 2 ? 450 : range < 4 ? 450 * (4 - range) / 2 : 0;
    assert.ok(Math.abs(zombie.hp - (1000 - expected)) < 1e-8, `distance ${range}`);
  }
  assert.equal(player.kills, 0);
  assert.equal(player.score, 450 + 450 + 225, 'The health removed from three wounded bodies, without critical bonus');
  assert.equal(simulation.explodeGrenade(grenade), false, 'Repeated resolution cannot apply the damage again');
});

test('armor keeps its body protection; ordinary head markers add no grenade immunity; the boss survives', () => {
  const { simulation } = fixture(MAX_WAVES);
  const armored = target(simulation, { kind: 'armored', hp: 400 });
  const ordinary = target(simulation, { z: -4.5, hp: 400 });
  const boss = target(simulation, { z: -5.5, kind: 'brute', boss: true, scale: 1.32, hp: 3600, maxHp: 3600 });
  simulation.explodeGrenade(planted(simulation));
  assert.equal(armored.hp, 400 - 450 * .65);
  assert.equal(simulation.zombies.has(ordinary.id), false);
  assert.equal(boss.hp, 3150);
  assert.equal(simulation.zombies.has(boss.id), true);
});

test('solid walls, closed boards, loft floors and stair treads occlude blasts rather than allowing damage through geometry', () => {
  for (const scenario of ['partition', 'board', 'floor', 'tread']) {
    const { simulation } = fixture();
    const grenade = planted(simulation), zombie = target(simulation);
    if (scenario === 'partition') { Object.assign(grenade, { x: 0, y: .935, z: -1.5 }); Object.assign(zombie, { x: 0, y: 0, z: -2.5 }); }
    if (scenario === 'board') { Object.assign(grenade, { x: 0, y: .86, z: -5.5 }); Object.assign(zombie, { x: 0, y: -.075, z: -6.5 }); }
    if (scenario === 'floor') { Object.assign(grenade, { x: 5.5, y: 3, z: 0 }); Object.assign(zombie, { x: 5.5, y: 3.4, z: 0 }); }
    if (scenario === 'tread') { Object.assign(grenade, { x: 3.8, y: 1, z: -1 }); Object.assign(zombie, { x: 3.8, y: 2.7625, z: -1 }); }
    simulation.explodeGrenade(grenade);
    assert.equal(zombie.hp, 400, scenario);
    if (scenario === 'board') {
      const north = simulation.doors.find(door => door.id === 'north');
      north.sealed = false; north.hp = 0; // Removing ordinary wood removes its blast shadow.
      simulation.explodeGrenade(planted(simulation, { x: 0, y: .86, z: -5.5 }));
      assert.equal(simulation.zombies.has(zombie.id), false, 'Destroyed boards remove their blast shadow');
    }
  }
});

test('blast kills use ordinary cash, real kill accounting and one drop per threshold even for simultaneous deaths', () => {
  const { simulation, player, events } = fixture(10);
  const threshold = simulation.waveGrenadeThresholds[0];
  simulation.waveKills = threshold - 2;
  simulation.lootKills = 23;
  const victims = [target(simulation), target(simulation, { z: -4.5 }), target(simulation, { z: -5.5, kind: 'brute', hp: 400, maxHp: 700 })];
  const grenade = planted(simulation);
  simulation.explodeGrenade(grenade);
  assert.equal(player.kills, 3);
  assert.equal(simulation.waveKills, threshold + 1);
  assert.equal(simulation.lootKills, 26);
  assert.equal(simulation.waveGrenadeDrops, 1);
  const pickups = [...simulation.pickups.values()];
  assert.equal(pickups.filter(pickup => pickup.kind === 'grenade').length, 1);
  assert.equal(pickups.filter(pickup => pickup.kind === 'ammo').length, 1);
  assert.equal(pickups.filter(pickup => pickup.kind === 'health').length, 1);
  assert.deepEqual(pickups.filter(pickup => pickup.kind === 'points').map(pickup => pickup.amount), victims.map(zombie => killCash(zombie, false)));
  assert.equal(player.points, 0, 'Money remains a world pickup until somebody collects it');
  assert.equal(player.score, 3 * 400 + 25 + 50, 'The 400 HP each body had, no overkill, plus the 25/50 kill-chain bonuses');
  assert.equal(events.filter(event => event.event === 'kill').length, 3);
  assert.ok(events.filter(event => event.event === 'kill').every(event => event.headshot === false));
  assert.deepEqual(events.filter(event => event.event === 'explosion').map(event => [event.hits, event.kills]), [[3, 3]]);
  assert.equal(simulation.snapshot().remaining, simulation.toSpawn, 'Killed targets no longer inflate wave remaining');
});

test('real gunshot kills followed by a fused grenade advance the same authoritative wave allowance', () => {
  const { simulation, player, events } = fixture(5);
  Object.assign(player, { x: -4.4, y: 0, z: 1.5, yaw: 0, pitch: 0 });
  const threshold = simulation.waveGrenadeThresholds[0];
  for (let index = 0; index < threshold - 1; index++) {
    const zombie = target(simulation, { x: -4.4, y: 0, z: -2, hp: 40, maxHp: 80 });
    simulation.time = Math.max(simulation.time, player.shotAfter);
    assert.equal(simulation.shoot('a'), true); advanceBallisticFlight(simulation, .1);
    assert.equal(simulation.zombies.has(zombie.id), false);
  }
  assert.equal(simulation.waveKills, threshold - 1);
  assert.equal(simulation.waveGrenadeDrops, 0);
  const victim = target(simulation, { x: -4.4, y: 0, z: -2 });
  planted(simulation, { x: -4.4, y: .935, z: -2, fuseLeft: .1 });
  simulation.toSpawn = 1;
  for (let tick = 0; tick < 3; tick++) simulation.tick(1 / 30);
  assert.equal(simulation.zombies.has(victim.id), false);
  assert.equal(simulation.waveKills, threshold);
  assert.equal(simulation.waveGrenadeDrops, 1);
  assert.equal([...simulation.pickups.values()].filter(pickup => pickup.kind === 'grenade').length, 1);
  assert.equal(player.kills, threshold);
  const kills = events.filter(event => event.event === 'kill');
  assert.equal(kills.length, threshold);
  assert.ok(kills.slice(0, -1).every(event => event.headshot === true));
  assert.equal(kills.at(-1).headshot, false);
});

test('the last fused blast can finish the final wave and discards later airborne grenades before extraction', () => {
  const { simulation, player, events } = fixture(MAX_WAVES);
  simulation.toSpawn = 0;
  target(simulation);
  planted(simulation, { fuseLeft: .1 });
  planted(simulation, { x: 11, z: -4, fuseLeft: 1.8 });
  for (let tick = 0; tick < 3; tick++) simulation.tick(1 / 30);
  assert.equal(simulation.phase, 'extraction');
  assert.equal(simulation.grenades.size, 0);
  assert.equal(simulation.pickups.size, 0);
  assert.equal(player.kills, 1);
  for (let tick = 0; tick < 60; tick++) simulation.tick(1 / 30);
  assert.equal(events.filter(event => event.event === 'explosion').length, 1);
});

test('explosions never damage survivors, and disconnecting the thrower does not duplicate or cancel world damage', () => {
  const { simulation, player, events } = fixture();
  const teammate = simulation.addPlayer('b');
  Object.assign(player, { x: 10, z: -5 }); Object.assign(teammate, { x: 10, z: -5 });
  const zombie = target(simulation);
  const grenade = planted(simulation);
  simulation.removePlayer('a');
  assert.equal(simulation.explodeGrenade(grenade), true);
  assert.equal(simulation.zombies.has(zombie.id), false);
  assert.equal(teammate.hp, 100);
  assert.equal(events.filter(event => event.event === 'kill').at(-1).id, 'a');
  assert.equal(simulation.explodeGrenade(grenade), false);
});

test('frozen phases cannot resolve projectiles and actual gameover/extraction discard them before any later tick', () => {
  for (const phase of ['lobby', 'extraction', 'victory', 'gameover']) {
    const { simulation, events } = fixture();
    const grenade = planted(simulation, { fuseLeft: 0 });
    const zombie = target(simulation);
    simulation.phase = phase;
    simulation.updateGrenades(1);
    assert.equal(simulation.explodeGrenade(grenade), false);
    assert.equal(zombie.hp, 400);
    assert.equal(events.filter(event => event.event === 'explosion').length, 0);
  }
  for (const terminal of ['gameover', 'extraction']) {
    const { simulation, player, events } = fixture(MAX_WAVES);
    player.grenades = 1; simulation.throwGrenade('a');
    if (terminal === 'gameover') simulation.endGame();
    else { simulation.toSpawn = 0; simulation.zombies.clear(); assert.equal(simulation.beginExtraction(), true); }
    assert.equal(simulation.grenades.size, 0);
    for (let tick = 0; tick < 30; tick++) simulation.tick(.1);
    assert.equal(events.filter(event => event.event === 'explosion').length, 0);
  }
});

test('predictGrenade foretells the real burst exactly, partition, slab, treads and planks included, and throws nothing', () => {
  const throws = [
    { x: 0, z: 0, yaw: 0, pitch: 0 }, // into the partition, falls back
    { x: 5.5, y: 0, z: 0, pitch: 1.48 }, // under the loft slab
    { x: (STAIRS.minX + STAIRS.maxX) / 2, y: 0, z: -1, pitch: 1.48 }, // under the treads
    { x: 0, z: -5.5, yaw: 0, pitch: .2 }, // at the north boards
    { x: 6, y: WORLD.loftY, z: 0, pitch: 1.48 }, // under the roof
    { x: -4, z: 3, yaw: 2.3, pitch: .5 }, { x: 2, z: 4, yaw: -1.2, pitch: -.3 },
  ];
  for (const pose of throws) {
    const { simulation, player, events } = fixture();
    const north = simulation.doors.find(door => door.id === 'north'); north.sealed = false;
    Object.assign(player, { y: 0, yaw: 0, ...pose, grenades: 2, throwAfter: 0 });
    const before = { grenades: simulation.grenades.size, next: simulation.nextGrenadeId, carried: player.grenades, events: events.length, boards: JSON.stringify(simulation.doors) };
    const predicted = simulation.predictGrenade(player);
    assert.deepEqual({ grenades: simulation.grenades.size, next: simulation.nextGrenadeId, carried: player.grenades, events: events.length, boards: JSON.stringify(simulation.doors) }, before, 'nothing thrown, spent or changed');
    // Another aim than the held one gives the throw along that aim.
    const turned = simulation.predictGrenade(player, { yaw: player.yaw + Math.PI, pitch: .3 });
    assert.notDeepEqual(turned, predicted);
    assert.equal(simulation.throwGrenade('a'), true);
    for (let tick = 0; tick < 70 && simulation.grenades.size; tick++) simulation.tick(1 / 30);
    const burst = events.find(event => event.event === 'explosion');
    assert.deepEqual({ x: burst.x, y: burst.y, z: burst.z }, predicted, JSON.stringify(pose));
  }
});
