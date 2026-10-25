import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WEAPONS, WORLD, MINIGUN_WINDUP, damageFalloff } from '../simulation.mjs';
import { settleBallisticFlight } from './helpers/ballistic-flight.mjs';
import { stairTreadY } from '../public/stairs.js';
import { ARMORY, ARMORY_RACK, waveBalance } from '../public/rules.js';

// Every fixture fires from 2 m: the round enters the target box at 1.68 m.
const PISTOL = WEAPONS.pistol.damage * damageFalloff(WEAPONS.pistol, 1.68);
const SHELL = WEAPONS.shotgun.pellets * WEAPONS.shotgun.damage * damageFalloff(WEAPONS.shotgun, 2.68);
const PISTOL_PUSH = PISTOL * .0033;

function setup(weapon = 'pistol') {
  const events = [];
  const simulation = new RoomSimulation('PUSH01', { random: () => .5, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a'); simulation.start('a');
  player.weapon = weapon;
  player.inventory[weapon] = { ammo: WEAPONS[weapon].magazine, reserve: WEAPONS[weapon].reserve };
  Object.assign(player, { x: 1, y: 0, z: 4, yaw: 0, pitch: 0 });
  simulation.timeLeft = 999;
  if (weapon === 'minigun') { simulation.setMinigunSpin('a', true); simulation.time += MINIGUN_WINDUP; }
  return { simulation, player, events };
}
function target(simulation, id = 'target', options = {}) {
  const zombie = { id, x: 1, y: .4, z: 2, hp: 100000, maxHp: 100000, kind: 'walker', scale: 1,
    speed: 0, yaw: 0, attackAfter: Infinity, pushX: 0, pushZ: 0, pushLeft: 0, ...options };
  simulation.zombies.set(id, zombie); return zombie;
}
const magnitude = zombie => Math.hypot(zombie.pushX, zombie.pushZ);
const close = (actual, expected, tolerance = 1e-5) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
function landShot(simulation, id = 'a') {
  const accepted = simulation.shoot(id);
  if (accepted) settleBallisticFlight(simulation);
  return accepted;
}
function finishPush(simulation, delta = 1 / 30) {
  for (let elapsed = 0; elapsed < .31; elapsed += delta) simulation.tick(delta);
}
function shootTowards(simulation, player, zombie, dx, dz) {
  Object.assign(player, { x: zombie.x - dx * 2, y: zombie.y, z: zombie.z - dz * 2,
    yaw: Math.atan2(-dx, -dz), pitch: 0 });
  assert.equal(landShot(simulation, player.id), true);
}
function resume(simulation, zombie, player, seconds = 3) {
  zombie.speed = 1.15; simulation.phase = 'wave'; simulation.toSpawn = 1; simulation.spawnTimer = 999;
  for (let index = 0; index < seconds * 30; index++) simulation.tick();
  assert.ok(Math.hypot(zombie.x - player.x, zombie.z - player.z) < 1, 'the actual AI must resume pursuit');
}

test('a physical impact queues a directional impulse without moving a target before its motion tick', () => {
  for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0], [Math.SQRT1_2, -Math.SQRT1_2]]) {
    const { simulation, player } = setup(), zombie = target(simulation, 'target', { x: 0, z: 2 });
    Object.assign(player, { x: -dx * 2, z: 2 - dz * 2, yaw: Math.atan2(-dx, -dz) });
    assert.equal(simulation.shoot('a'), true);
    assert.equal(zombie.hp, 100000); assert.equal(magnitude(zombie), 0, 'launch alone has no impulse');
    settleBallisticFlight(simulation);
    const entryDistance = 2 - .32 / Math.max(Math.abs(dx), Math.abs(dz));
    const damage = WEAPONS.pistol.damage * damageFalloff(WEAPONS.pistol, entryDistance);
    close(zombie.x, 0); close(zombie.z, 2); close(zombie.hp, 100000 - damage);
    assert.ok(zombie.pushX * dx + zombie.pushZ * dz > 0);
    const state = simulation.snapshot().zombies[0];
    close(state.pushX, Math.round(zombie.pushX * 1000) / 1000);
    finishPush(simulation);
    const moved = Math.hypot(zombie.x, zombie.z - 2);
    // The unchanged integrator clears speeds below 0.01 m/s, leaving at most
    // decayTime * 0.01 = 0.0004 m of the theoretical impulse untravelled.
    const expected = damage * .0033 * (1 - Math.exp(-.26 / .04));
    assert.ok(moved > expected - .0004 && moved <= expected + 1e-5);
    close(zombie.x * dz - (zombie.z - 2) * dx, 0);
    assert.equal(magnitude(zombie), 0);
  }
});

test('headshot damage strengthens the impulse and penetration weakens it for each target', () => {
  const body = setup(), head = setup();
  const bodyTarget = target(body.simulation), headTarget = target(head.simulation, 'target', { y: 0 });
  landShot(body.simulation); landShot(head.simulation);
  close(magnitude(headTarget) / magnitude(bodyTarget), waveBalance(head.simulation.wave).headshotMultiplier);
  const { simulation } = setup('rifle');
  const front = target(simulation, 'front', { z: 1 }), rear = target(simulation, 'rear', { z: -2 });
  landShot(simulation);
  const frontDamage = WEAPONS.rifle.damage * damageFalloff(WEAPONS.rifle, 2.68);
  const rearDamage = WEAPONS.rifle.damage * damageFalloff(WEAPONS.rifle, 5.68) * WEAPONS.rifle.penetrationRetention;
  close(magnitude(rear) / magnitude(front), rearDamage / frontDamage);
  close(front.hp, 100000 - frontDamage); close(rear.hp, 100000 - rearDamage);
});

test('all nine shotgun pellets aggregate once per survivor and preserve full-shot damage', () => {
  const { simulation, events } = setup('shotgun');
  const front = target(simulation, 'front', { z: 1 }), rear = target(simulation, 'rear', { z: -2 });
  const push = simulation.pushZombie.bind(simulation), calls = [];
  simulation.pushZombie = (zombie, x, z) => { calls.push(zombie.id); return push(zombie, x, z); };
  landShot(simulation);
  assert.deepEqual(calls, ['front', 'rear']);
  const rearDamage = WEAPONS.shotgun.pellets * WEAPONS.shotgun.damage * damageFalloff(WEAPONS.shotgun, 5.68) * .45;
  close(front.hp, 100000 - SHELL);
  // Gravity changes the penetrated segment's direction very slightly; this
  // straight-line reference remains within 0.00003 HP at these short ranges.
  close(rear.hp, 100000 - rearDamage, .00003);
  // A point-blank shell now reaches the 35 cm impulse cap; the rear body stays below it.
  const impulse = damage => Math.min(.35, damage * .0033);
  close(magnitude(rear) / magnitude(front), impulse(rearDamage) / impulse(SHELL));
  assert.equal(front.z, 1); assert.equal(rear.z, -2);
  assert.equal(events.filter(event => event.event === 'bullet-impact' && event.stop === 'zombie').length, WEAPONS.shotgun.pellets * 2);
  finishPush(simulation);
  assert.ok(1 - front.z > .34 && 1 - front.z <= .35);
});

test('targets killed by later pellets or the golden magnum receive no impulse', () => {
  for (const [weapon, hp] of [['shotgun', 40], ['magnum', 1500]]) {
    const { simulation } = setup(weapon), zombie = target(simulation, 'target', { hp });
    landShot(simulation);
    assert.equal(simulation.zombies.has(zombie.id), false);
    assert.equal(magnitude(zombie), 0); assert.equal(zombie.z, 2);
  }
});

test('equal damage pushes brutes and the final boss less than ordinary zombies', () => {
  const speeds = [];
  for (const options of [{}, { kind: 'brute', scale: 1.22 }, { kind: 'brute', scale: 1.32, boss: true }]) {
    const { simulation } = setup(), zombie = target(simulation, 'target', options);
    landShot(simulation);
    const expected = WEAPONS.pistol.damage * damageFalloff(WEAPONS.pistol, 2 - .32 * zombie.scale);
    close(zombie.hp, 100000 - expected); speeds.push(magnitude(zombie) / expected);
    finishPush(simulation);
    assert.ok(2 - zombie.z <= PISTOL_PUSH);
  }
  close(speeds[1] / speeds[0], .35); close(speeds[2] / speeds[0], .20);
});

test('repeated and opposing automatic rounds have a bounded combined impulse', () => {
  const { simulation, player } = setup('minigun'), zombie = target(simulation);
  for (let round = 0; round < 40; round++) {
    simulation.time = Math.max(simulation.time, player.shotAfter);
    assert.equal(landShot(simulation), true);
    assert.ok(magnitude(zombie) <= .35 / .04 + 1e-8);
    assert.equal(zombie.z, 2, 'accepted commands alone cannot displace targets');
  }
  finishPush(simulation); assert.ok(2 - zombie.z <= .35);
  const opposite = setup(), other = target(opposite.simulation);
  landShot(opposite.simulation); opposite.simulation.time = Math.max(opposite.simulation.time, opposite.player.shotAfter);
  Object.assign(opposite.player, { x: 1, z: 0, yaw: Math.PI }); landShot(opposite.simulation);
  assert.ok(magnitude(other) < 1e-8); finishPush(opposite.simulation); close(other.z, 2);
});

test('short impulses do not stop attacks and real walking resumes after amortization', () => {
  const { simulation, player } = setup(), zombie = target(simulation, 'target', { z: 3.4, y: 0, attackAfter: 0, speed: 1.15 });
  // Keep this melee fixture beside the new waist-high wall, not inside it.
  player.x = 1.6; zombie.x = 1.6;
  simulation.phase = 'wave'; simulation.toSpawn = 1; simulation.spawnTimer = 999;
  landShot(simulation); simulation.tick();
  assert.equal(player.hp, 89); assert.ok(zombie.attackAfter > simulation.time);
  const walking = setup(), walker = target(walking.simulation, 'walker', { y: 0 });
  walking.player.x = 1.6; walker.x = 1.6;
  landShot(walking.simulation); finishPush(walking.simulation);
  const before = walker.z; resume(walking.simulation, walker, walking.player);
  assert.ok(walker.z > before + .8); assert.equal(magnitude(walker), 0);
});

test('closed boards on every door block recoil without being damaged by the target impact', () => {
  for (const doorIndex of [0, 1, 2, 3]) {
    const { simulation, player } = setup(), door = simulation.doors[doorIndex];
    const zombie = target(simulation, 'target', { x: door.x - door.outX * .46, y: 0, z: door.z - door.outZ * .46 });
    shootTowards(simulation, player, zombie, door.outX, door.outZ);
    finishPush(simulation);
    assert.ok(Math.abs((zombie.x - door.x) * door.outX + (zombie.z - door.z) * door.outZ) >= .425 - 1e-8);
    assert.equal(door.hp, door.maxHp);
    assert.equal(simulation.canOccupy(zombie, zombie.x, zombie.z, zombie.y, .29), true);
  }
});

test('open window rays still cannot push bodies through the wall, even with a large delta', () => {
  const { simulation, player } = setup('shotgun');
  Object.assign(player, { x: -4.8, z: -3.54 });
  const zombie = target(simulation, 'near', { x: -4.8, y: 0, z: -5.54 });
  const outside = target(simulation, 'outside', { x: -4.8, y: 0, z: -7.5 });
  landShot(simulation); assert.ok(outside.hp < outside.maxHp, 'the bullet genuinely passes through the window');
  simulation.tick(10); finishPush(simulation, .1);
  assert.ok(zombie.z >= -5.575 - 1e-8);
  assert.equal(simulation.canOccupy(zombie, zombie.x, zombie.z, zombie.y, .29), true);
});

test('recoil respects furniture heights and AI escapes the navigation padding afterwards', () => {
  const rack = ARMORY.find(item => item.weapon === 'magnum'), rackSouth = rack.z + ARMORY_RACK.width / 2;
  const cases = [
    { x: -2.85, y: 0, z: 2.8, dx: -1, dz: 0, boundary: -3.2, axis: 'x' },
    { x: .55, y: 0, z: -.5, dx: -1, dz: 0, boundary: .2, axis: 'x' },
    { x: rack.x - .42, y: WORLD.loftY, z: rackSouth + .35, dx: 0, dz: -1, boundary: rackSouth, axis: 'z' },
  ];
  for (const point of cases) {
    const { simulation, player } = setup('shotgun'), zombie = target(simulation, 'target', point);
    shootTowards(simulation, player, zombie, point.dx, point.dz); finishPush(simulation, .1);
    assert.ok(zombie[point.axis] >= point.boundary + .29 - 1e-8);
    assert.ok(zombie[point.axis] < point.boundary + .32, 'exercise the extra navigation padding, not only clear space');
    assert.equal(simulation.canOccupy(zombie, zombie.x, zombie.z, zombie.y, .29), true);
    resume(simulation, zombie, player);
  }
  // Both shooter and target stay behind the new partition; the target begins
  // below the loft crate's footprint, clear of the downstairs shotgun crate.
  const { simulation, player } = setup('shotgun'), below = target(simulation, 'below', { x: 7.1, y: 0, z: -4.6 });
  shootTowards(simulation, player, below, 0, -1); finishPush(simulation);
  assert.equal(simulation.canOccupy(player, player.x, player.z, player.y, .25), true);
  assert.ok(below.z < -4.9, 'the upstairs crate does not block the ground-floor body');
});

test('after recoil in every open portal the normal AI completes entry and exit', () => {
  for (const doorIndex of [0, 1, 2, 3]) for (const exiting of [false, true]) {
    const { simulation, player } = setup(), door = simulation.doors[doorIndex]; door.hp = 0;
    const sign = exiting ? -1 : 1;
    const zombie = target(simulation, 'target', { x: door.x + door.outX * .15 * sign, y: 0, z: door.z + door.outZ * .15 * sign,
      portalRoute: { doorId: door.id, fromOutside: !exiting, toOutside: exiting, stage: 'cross' } });
    Object.assign(player, { x: door.x - door.outX * 3 * sign, y: 0, z: door.z - door.outZ * 3 * sign,
      yaw: Math.atan2(-door.outX * sign, -door.outZ * sign), pitch: 0 });
    assert.equal(landShot(simulation), true); finishPush(simulation);
    resume(simulation, zombie, player);
  }
  const { simulation, player } = setup(), door = simulation.doors[0]; door.hp = 0;
  const zombie = target(simulation, 'changed-target', { x: 0, y: 0, z: -6.15,
    portalRoute: { doorId: door.id, fromOutside: true, toOutside: false, stage: 'cross' } });
  Object.assign(player, { x: 0, y: 0, z: -9, yaw: Math.PI, pitch: 0 });
  landShot(simulation); finishPush(simulation); resume(simulation, zombie, player);
});

test('stairs follow their slope and landings while sides and the loft railing stay solid', () => {
  const slope = setup(), zombie = target(slope.simulation, 'stairs', { x: 3.8, y: stairTreadY(1), z: 1 });
  shootTowards(slope.simulation, slope.player, zombie, 0, -1); finishPush(slope.simulation);
  assert.ok(zombie.z < 1); close(zombie.y, stairTreadY(zombie.z));
  const side = setup(), railing = target(side.simulation, 'side', { x: 3.05, y: stairTreadY(1), z: 1 });
  shootTowards(side.simulation, side.player, railing, -1, 0); finishPush(side.simulation);
  assert.ok(railing.x >= 3); close(railing.y, stairTreadY(railing.z));
  const loft = setup(), edge = target(loft.simulation, 'edge', { x: WORLD.loft.minX + .28, y: WORLD.loftY, z: -3 });
  shootTowards(loft.simulation, loft.player, edge, -1, 0); finishPush(loft.simulation);
  assert.ok(edge.x >= WORLD.loft.minX + .25); assert.equal(edge.y, WORLD.loftY);
  const top = setup(), landing = target(top.simulation, 'landing', { x: 3.8, y: stairTreadY(-1.99), z: -1.99 });
  shootTowards(top.simulation, top.player, landing, 0, -1); finishPush(top.simulation);
  assert.ok(landing.z < -2); assert.equal(landing.y, WORLD.loftY);
  resume(top.simulation, landing, top.player);
  for (const y of [0, WORLD.loftY]) {
    const fixture = setup('shotgun'), nearRail = target(fixture.simulation, 'near-rail', { x: 5, y, z: 0 });
    shootTowards(fixture.simulation, fixture.player, nearRail, -1, 0); finishPush(fixture.simulation);
    assert.ok(nearRail.x >= WORLD.stair.maxX);
    resume(fixture.simulation, nearRail, fixture.player);
  }
});

test('legal exterior corners escape navigation padding without routing through adjacent wall faces', () => {
  for (const [signX, signZ] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const { simulation, player } = setup('shotgun');
    const zombie = target(simulation, 'corner', { x: signX * 8.5, y: 0, z: signZ * 6.5 });
    shootTowards(simulation, player, zombie, -signX * Math.SQRT1_2, -signZ * Math.SQRT1_2);
    finishPush(simulation);
    assert.ok(Math.abs(zombie.x) > 8.29 && Math.abs(zombie.x) < 8.425);
    assert.ok(Math.abs(zombie.z) > 6.29 && Math.abs(zombie.z) < 6.425);
    assert.equal(simulation.canOccupy(zombie, zombie.x, zombie.z, zombie.y, .29), true);
    Object.assign(player, { x: signX * 10, y: 0, z: 0 });
    resume(simulation, zombie, player, 8);
    assert.equal(simulation.canOccupy(zombie, zombie.x, zombie.z, zombie.y, .29), true);
  }
});

test('amortization is stable across tick sizes and inactive phases never move a queued impulse', () => {
  const displacements = [];
  for (const delta of [1 / 120, 1 / 30, .1]) {
    const { simulation } = setup('shotgun'), zombie = target(simulation);
    landShot(simulation); finishPush(simulation, delta); displacements.push(2 - zombie.z);
  }
  assert.ok(Math.max(...displacements) - Math.min(...displacements) < .001);
  for (const phase of ['lobby', 'extraction', 'victory', 'gameover']) {
    const { simulation } = setup(), zombie = target(simulation);
    landShot(simulation); simulation.phase = phase; simulation.tick(.1);
    assert.equal(zombie.z, 2); assert.equal(magnitude(zombie), 0);
    assert.equal(simulation.snapshot().zombies[0].pushZ, 0);
    assert.equal(landShot(simulation), false);
  }
  const { simulation, player } = setup();
  const vertical = target(simulation, 'vertical', { x: player.x, y: 0, z: player.z });
  player.pitch = -Math.PI / 2; landShot(simulation); finishPush(simulation);
  assert.ok(Number.isFinite(vertical.x) && Number.isFinite(vertical.z)); assert.equal(magnitude(vertical), 0);
});
