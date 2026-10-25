import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomSimulation, WEAPONS, MINIGUN_WINDUP, damageFalloff } from '../simulation.mjs';
import { penetrationMultiplier, BALLISTICS } from '../public/ballistics.js';
import { settleBallisticFlight } from './helpers/ballistic-flight.mjs';

const close = (actual, expected, message = '') => assert.ok(Math.abs(actual - expected) < 2e-4, `${message}: ${actual} != ${expected}`);
const ordinary = ['pistol', 'rifle', 'shotgun', 'smg', 'minigun', 'assault'];
function room(weapon) {
  const events = [], simulation = new RoomSimulation('BALLST', { random: () => .5, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a'); simulation.start('a');
  // Elevated static metering lane: targets follow free-flight drop to isolate
  // power/precision from ground collisions. This is not a traversable map fixture.
  Object.assign(player, { x: -44, y: 100, z: -25, yaw: -Math.PI / 2, pitch: 0, weapon, weaponId: weapon,
    inventory: { [weapon]: { ammo: WEAPONS[weapon].magazine, reserve: WEAPONS[weapon].reserve } } });
  simulation.phase = 'wave'; simulation.toSpawn = 1; simulation.spawnTimer = 100000;
  if (weapon === 'minigun') { simulation.setMinigunSpin('a', true); simulation.time += MINIGUN_WINDUP; }
  return { simulation, player, events };
}
const drag = weapon => 1.225 * weapon.bulletPhysics.dragArea / (2 * weapon.bulletPhysics.mass);
function damageAt(weapon, distance) {
  const c = weapon.damageCurve;
  return weapon.damage * (c ? 1 / (1 + (distance / c.halfDistance) ** c.power) : Math.exp(-2 * drag(weapon) * distance));
}
function target(simulation, player, distance, id = 'target', { head = false } = {}) {
  const weapon = WEAPONS[player.weapon], k = drag(weapon);
  const age = Math.expm1(k * distance) / (k * weapon.bulletPhysics.muzzleSpeed), drop = .5 * 9.81 * age ** 2;
  const zombie = { id, x: player.x + distance + .32, y: player.y + (head ? 0 : .4) - drop, z: player.z,
    hp: 10000, maxHp: 10000, kind: 'walker', scale: 1, speed: 0, attackAfter: Infinity, entered: false };
  simulation.zombies.set(id, zombie); return zombie;
}
function measuredHits(shot, impacts) {
  const segments = new Map(shot.projectiles.map(projectile => [projectile.id, projectile]));
  return impacts.filter(hit => hit.stop === 'zombie' && !hit.visualOnly).map(hit => {
    const segment = segments.get(hit.projectileId), speed = Math.hypot(segment.vx, segment.vy, segment.vz);
    const duration = hit.age - segment.segmentStartAge;
    const distance = segment.distanceOffset + Math.log1p(segment.drag * speed * duration) / segment.drag;
    if (hit.continuation) segments.set(hit.projectileId, hit.continuation);
    return { ...hit, distance };
  });
}

test('actual delayed body impacts follow the smooth curve at close and medium distances', () => {
  for (const type of ordinary) for (const distance of [.5, 4, 10, 12, 20, 30]) {
    const { simulation, player } = room(type), zombie = target(simulation, player, distance);
    assert.equal(simulation.shoot(player.id), true, type); assert.equal(zombie.hp, 10000, 'no hitscan damage');
    const { impacts, remaining } = settleBallisticFlight(simulation);
    assert.equal(remaining, 0);
    assert.equal(impacts.filter(hit => hit.zombieId === zombie.id).length, WEAPONS[type].pellets);
    close(10000 - zombie.hp, damageAt(WEAPONS[type], distance) * WEAPONS[type].pellets, `${type}, ${distance} m`);
  }
});

test('real penetration retains one energy loss per body and every weapon target cap', () => {
  for (const type of ordinary) {
    const { simulation, player, events } = room(type), weapon = WEAPONS[type];
    const targets = Array.from({ length: weapon.penetrationTargets + 1 }, (_, index) => target(simulation, player, 4 + index * 2, `z${index}`));
    simulation.shoot(player.id); const shot = events.at(-1);
    const hits = measuredHits(shot, settleBallisticFlight(simulation).impacts);
    targets.forEach((zombie, index) => {
      const contacts = hits.filter(hit => hit.zombieId === zombie.id);
      assert.equal(contacts.length, index < weapon.penetrationTargets ? weapon.pellets : 0, `${type}, body ${index}`);
      const expected = contacts.reduce((sum, hit) => sum + damageAt(weapon, hit.distance) * (1 - weapon.bulletPhysics.transmission) ** index, 0);
      close(10000 - zombie.hp, expected, `${type}, body ${index}`);
    });
  }
});

test('50-metre impacts remain positive and firearm curves decrease continuously', () => {
  for (const type of ['pistol', 'rifle', 'smg', 'minigun', 'assault']) {
    const { simulation, player } = room(type), zombie = target(simulation, player, 50);
    simulation.shoot(player.id); settleBallisticFlight(simulation);
    close(10000 - zombie.hp, damageAt(WEAPONS[type], 50), type); assert.ok(zombie.hp < 10000);
    let previous = Infinity;
    for (let distance = 0; distance <= WEAPONS[type].range; distance += .25) {
      const next = WEAPONS[type].damage * damageFalloff(WEAPONS[type], distance);
      assert.ok(next <= previous + 1e-8, `${type} grows stronger at ${distance} m`); previous = next;
    }
  }
});

test('the SMG crosses 30 metres while gravity still stops low flat shots', () => {
  for (const distance of [29.9, 30.1, 50]) {
    const { simulation, player } = room('smg'), zombie = target(simulation, player, distance);
    simulation.shoot(player.id); settleBallisticFlight(simulation);
    close(10000 - zombie.hp, damageAt(WEAPONS.smg, distance), `${distance} m`);
  }
  const { simulation, player } = room('smg'); player.y = 0;
  const zombie = target(simulation, player, 100); zombie.y = .4;
  simulation.shoot(player.id); const flight = settleBallisticFlight(simulation);
  assert.equal(zombie.hp, 10000); assert.ok(flight.impacts.some(hit => hit.stop === 'solid' && Math.abs(hit.y) < 1e-7));
});

test('the Gatling crosses 65 metres and free projectiles expire at the physical lifetime', () => {
  for (const distance of [56, 64.9, 65.1]) {
    const { simulation, player } = room('minigun'), zombie = target(simulation, player, distance);
    simulation.shoot(player.id); settleBallisticFlight(simulation);
    close(10000 - zombie.hp, damageAt(WEAPONS.minigun, distance), `${distance} m`);
  }
  assert.ok(WEAPONS.minigun.range < WEAPONS.rifle.range);
  for (const type of ordinary) {
    const { simulation, player } = room(type); simulation.shoot(player.id);
    const flight = settleBallisticFlight(simulation);
    assert.equal(flight.remaining, 0); assert.equal(flight.impacts.length, WEAPONS[type].pellets);
    assert.ok(flight.impacts.every(hit => hit.stop === 'range' && hit.reason === 'lifetime' && hit.age === BALLISTICS.maxLife));
  }
});

test('the Gatling scatters distant rounds while its close sweep and machine-gun precision connect', () => {
  function hitRate(type, distance) {
    const { simulation, player } = room(type), body = target(simulation, player, distance);
    body.hp = body.maxHp = 1e8;
    let seed = 104729, hits = 0;
    simulation.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    for (let shot = 0; shot < 500; shot++) {
      player.inventory[type].ammo = WEAPONS[type].magazine;
      simulation.time = Math.max(simulation.time, player.shotAfter);
      assert.equal(simulation.shoot(player.id), true);
      hits += settleBallisticFlight(simulation, { step: 1 / 30 }).impacts.some(hit => hit.zombieId === body.id) ? 1 : 0;
    }
    return hits / 500;
  }
  assert.equal(WEAPONS.minigun.spread, .025);
  assert.equal(hitRate('minigun', 4), 1);
  assert.ok(hitRate('minigun', 50) < .3);
  assert.ok(hitRate('rifle', 50) > .7);
});

test('distant penetration uses physical retention without an arbitrary extra distance penalty', () => {
  const { simulation, player, events } = room('rifle'), weapon = WEAPONS.rifle;
  const targets = [50, 51, 52, 53].map((distance, index) => target(simulation, player, distance, `z${index}`));
  simulation.shoot(player.id); const shot = events.at(-1);
  const hits = measuredHits(shot, settleBallisticFlight(simulation).impacts);
  assert.equal(hits.length, 3);
  hits.forEach((hit, index) => close(10000 - targets[index].hp, damageAt(weapon, hit.distance) * .65 ** index));
  assert.equal(targets[3].hp, 10000);
  close(penetrationMultiplier(weapon, 2, 30), .65 ** 2); close(penetrationMultiplier(weapon, 2, 40), .65 ** 2);
});

test('the bolt rifle penetrates six distant bodies with energy loss and keeps its bolt cycle', () => {
  const { simulation, player, events } = room('sniper'), weapon = WEAPONS.sniper;
  const targets = Array.from({ length: 7 }, (_, index) => target(simulation, player, 60 + index * 2, `z${index}`));
  simulation.shoot(player.id); const shot = events.at(-1);
  assert.equal(player.inventory.sniper.ammo, 4);
  assert.equal(simulation.shoot(player.id), false, 'the bolt cycle cannot be bypassed');
  const hits = measuredHits(shot, settleBallisticFlight(simulation).impacts); assert.equal(hits.length, 6);
  hits.forEach((hit, index) => close(10000 - targets[index].hp, damageAt(weapon, hit.distance) * .85 ** index, `body ${index}`));
  assert.equal(targets[6].hp, 10000);
  simulation.time = Math.max(simulation.time, player.shotAfter); assert.equal(simulation.shoot(player.id), true);
});

test('a drop-compensated distant sniper headshot applies its multiplier and keeps finite reload stock', () => {
  const { simulation, player } = room('sniper'), zombie = target(simulation, player, 80, 'head', { head: true });
  simulation.shoot(player.id); const hit = settleBallisticFlight(simulation).impacts.find(hit => hit.zombieId === zombie.id);
  assert.equal(hit.headshot, true); close(10000 - zombie.hp, damageAt(WEAPONS.sniper, 80) * simulation.currentWaveBalance().headshotMultiplier);
  assert.equal(WEAPONS.sniper.magazine, 5); assert.equal(WEAPONS.sniper.reserve, 10);
  player.inventory.sniper.ammo = 0; assert.equal(simulation.reload(player.id), true);
  close(player.reloadUntil - simulation.time, 3);
  simulation.time = player.reloadUntil; simulation.tick(0);
  assert.deepEqual(player.inventory.sniper, { ammo: 5, reserve: 5 });
});
