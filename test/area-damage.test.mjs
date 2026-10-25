import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomSimulation, WEAPONS } from '../simulation.mjs';
import { GRENADES, ROCKET, FLAMETHROWER, FIRE_INTERVALS } from '../public/rules.js';
import { enemyHitbox } from '../public/enemies.js';
import { blastDamageAtDistance, flameFalloff } from '../public/area-damage.js';

const near = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `${actual} != ${expected}`);
// Bernstein form, independent of a quintic polynomial implementation.
function edgeWeight(distance, start, end) {
  if (distance <= start) return 1;
  if (distance >= end) return 0;
  const t = (distance - start) / (end - start);
  return (1 - t) ** 3 * (1 + 3 * t + 6 * t ** 2);
}
function fixture(weapon = 'flamethrower') {
  const events = [], simulation = new RoomSimulation('AREA', { random: () => .5, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a'); simulation.start('a');
  simulation.wave = 13; simulation.beginWave(); simulation.spawnTimer = 999;
  Object.assign(player, { x: 12, y: 0, z: 8, yaw: 0, pitch: 0, weapon,
    inventory: { [weapon]: { ammo: WEAPONS[weapon].magazine, reserve: WEAPONS[weapon].reserve } } });
  return { simulation, player, events };
}
function target(simulation, id, overrides = {}) {
  const zombie = { id, x: 12, y: 0, z: 6, yaw: 0, hp: 10000, maxHp: 10000, kind: 'walker', scale: 1,
    speed: 0, attackAfter: Infinity, entered: true, ...overrides };
  simulation.zombies.set(id, zombie); return zombie;
}
function advance(simulation, seconds, hz) {
  for (let tick = 0; tick < Math.round(seconds * hz); tick++) {
    simulation.time += 1 / hz; simulation.updateBurns(1 / hz);
  }
}
function planted(simulation, origin = { x: 12, y: .935, z: 6 }) {
  const grenade = { id: `g${simulation.nextGrenadeId++}`, ownerId: 'a', ...origin, vx: 0, vy: 0, vz: 0, fuseLeft: 1.8 };
  simulation.grenades.set(grenade.id, grenade); return grenade;
}

test('area profiles preserve near power and use a positive monotone quintic edge with C2 joins', () => {
  assert.equal(ROCKET.damage, 700); assert.equal(GRENADES.damage, 450);
  assert.equal(FLAMETHROWER.fullDamageRange, 5); assert.equal(FLAMETHROWER.range, 6);
  assert.equal(FLAMETHROWER.contactDps, 50); assert.equal(FLAMETHROWER.burnDps, 175); assert.equal(FLAMETHROWER.burnDuration, 4);
  const curves = [
    { value: d => blastDamageAtDistance(ROCKET, d) / 700, start: 2, end: 4 },
    { value: d => blastDamageAtDistance(GRENADES, d) / 450, start: 2, end: 4 },
    { value: d => flameFalloff(FLAMETHROWER, d), start: 5, end: 6 },
  ];
  for (const { value, start, end } of curves) {
    let previous = 1;
    for (let distance = 0; distance <= end + 1; distance += .01) {
      const actual = value(distance);
      assert.ok(Number.isFinite(actual) && actual >= 0 && actual <= previous + 1e-12);
      near(actual, edgeWeight(distance, start, end), 1e-12); previous = actual;
    }
    assert.equal(value(0), 1); assert.equal(value(start), 1); assert.equal(value(end), 0);
    const span = end - start;
    near(value(start + span / 4), .896484375); near(value(start + span / 2), .5); near(value(start + span * .75), .103515625);
    const h = .0001;
    for (const join of [start, end]) {
      near((value(join + h) - value(join - h)) / (2 * h), 0, 1e-5);
      near((value(join + h) - 2 * value(join) + value(join - h)) / h ** 2, 0, .005);
    }
  }
});

test('real grenade blasts apply the smooth spherical edge and body armor once', () => {
  for (const kind of ['walker', 'armored']) {
    const { simulation, player } = fixture(), teammate = simulation.addPlayer('b');
    Object.assign(teammate, { x: 12, y: 0, z: 6 });
    const rows = [0, 2, 2.5, 3, 3.5, 4, 4.5].map(distance => ({ distance,
      zombie: target(simulation, `body-${distance}`, { x: 12 + distance, kind }) }));
    const centre = enemyHitbox(rows[0].zombie);
    const grenade = planted(simulation, { x: 12, y: (centre.minY + centre.maxY) / 2, z: 6 });
    assert.equal(simulation.explodeGrenade(grenade), true);
    for (const { distance, zombie } of rows)
      near(10000 - zombie.hp, 450 * edgeWeight(distance, 2, 4) * (kind === 'armored' ? .65 : 1));
    assert.equal(player.hp, 100); assert.equal(teammate.hp, 100);
    assert.equal(simulation.explodeGrenade(grenade), false, 'a second resolution cannot duplicate damage');
  }
});

test('real rocket impacts use the same smooth radial edge independently of travel distance', () => {
  for (const travel of [3, 12]) for (const kind of ['walker', 'armored']) {
    const { simulation, player, events } = fixture('rocket');
    // A direct body puts the impact at its near face, 0.0001 m before contact.
    const primary = target(simulation, 'direct', { y: .615, z: player.z - travel });
    const impactZ = primary.z + .32 + .0001;
    const rows = [2, 2.5, 3, 3.5, 4, 4.5].map(distance => ({ distance,
      zombie: target(simulation, `edge-${distance}`, { x: player.x + distance, y: .615, z: impactZ, kind }) }));
    assert.equal(simulation.shoot(player.id), true);
    const impact = events.find(event => event.event === 'shot').impact;
    near(impact.z, impactZ); near(impact.y, 1.55); near(10000 - primary.hp, 700);
    for (const { distance, zombie } of rows)
      near(10000 - zombie.hp, 700 * edgeWeight(distance, 2, 4) * (kind === 'armored' ? .65 : 1));
    assert.equal(player.inventory.rocket.ammo, 0);
  }
});

test('real flames scale immediate contact and the entire four-second burn at the edge', () => {
  for (const hz of [10, 30]) for (const kind of ['walker', 'armored']) {
    const { simulation, player, events } = fixture();
    const rows = [1, 3, 5, 5.25, 5.5, 5.75, 6, 6.5].map(distance => ({ distance,
      zombie: target(simulation, `flame-${distance}`, { z: player.z - distance, kind }) }));
    assert.equal(simulation.shoot(player.id), true);
    for (const { distance, zombie } of rows) {
      const strength = edgeWeight(distance, 5, 6), armor = kind === 'armored' ? .65 : 1;
      near(10000 - zombie.hp, 50 * FIRE_INTERVALS.flamethrower * strength * armor);
      if (strength === 0) assert.equal(zombie.burnUntil, undefined, `${distance} m cannot start a burn`);
    }
    assert.equal(events.find(event => event.event === 'shot').hits, 6);
    advance(simulation, 4.2, hz);
    for (const { distance, zombie } of rows) {
      near(10000 - zombie.hp, (6.25 + 700) * edgeWeight(distance, 5, 6) * (kind === 'armored' ? .65 : 1));
      assert.equal(zombie.burnUntil, undefined);
    }
    assert.equal(player.inventory.flamethrower.ammo, 79);
  }
});

test('overlapping flame exposures keep only the strongest live strength without extending it at full power', () => {
  for (const hz of [10, 30]) for (const firstStrong of [true, false]) {
    const { simulation, player } = fixture(), zombie = target(simulation, 'burn');
    const teammate = simulation.addPlayer('b');
    Object.assign(teammate, { x: 12, y: 0, yaw: 0, pitch: 0, weapon: 'flamethrower',
      inventory: { flamethrower: { ammo: 80, reserve: 40 } } });
    player.z = zombie.z + (firstStrong ? 3 : 5.5);
    teammate.z = zombie.z + (firstStrong ? 5.5 : 3);
    assert.equal(simulation.shoot(player.id), true);
    advance(simulation, 1, hz);
    assert.equal(simulation.shoot(teammate.id), true);
    assert.equal(zombie.burnOwnerId, player.id, 'first igniter keeps credit throughout a continuous burn');
    const before = zombie.hp; simulation.updateBurns(1 / hz); near(zombie.hp, before);
    advance(simulation, 4.2, hz);
    // Full then half: 4*175 + 1*87.5; half then full: 1*87.5 + 4*175.
    near(10000 - zombie.hp, 787.5 + 6.25 + 3.125);
    assert.equal(zombie.burnUntil, undefined);
  }
});

test('a stronger contact settles elapsed weak burning before upgrading the live exposure', () => {
  const { simulation, player } = fixture(), zombie = target(simulation, 'upgrade');
  player.z = zombie.z + 5.5; simulation.shoot(player.id);
  // No updateBurns call in between: shootFlame must settle this elapsed second.
  simulation.time += 1; player.z = zombie.z + 3;
  simulation.shoot(player.id);
  near(10000 - zombie.hp, 3.125 + 87.5 + 6.25);
  advance(simulation, 4.2, 30);
  near(10000 - zombie.hp, 3.125 + 787.5 + 6.25);
});

test('flame edge kills keep first-igniter team credit and expired burns accept a new owner', () => {
  const { simulation, player, events } = fixture();
  const zombie = target(simulation, 'victim', { z: 2.5, hp: 120, maxHp: 120 });
  const teammate = simulation.addPlayer('b');
  Object.assign(teammate, { x: player.x, y: 0, z: player.z, yaw: 0, pitch: 0, weapon: 'flamethrower',
    inventory: { flamethrower: { ammo: 80, reserve: 40 } } });
  simulation.shoot(player.id); simulation.shoot(teammate.id); advance(simulation, 2, 30);
  assert.equal(simulation.zombies.has(zombie.id), false); assert.equal(player.kills, 1); assert.equal(teammate.kills, 0);
  assert.deepEqual(events.filter(event => event.event === 'kill').map(event => event.id), [player.id]);
  assert.equal(player.hp, 100); assert.equal(teammate.hp, 100);
  const survivor = target(simulation, 'new-owner', { z: 2.5 });
  simulation.shoot(player.id); advance(simulation, 4.2, 30); simulation.shoot(teammate.id);
  assert.equal(survivor.burnOwnerId, teammate.id);
});

test('smooth edge damage still cannot pass through the cabin partition', () => {
  for (const weapon of ['flamethrower', 'rocket', 'grenade']) {
    const { simulation, player } = fixture(weapon === 'grenade' ? 'pistol' : weapon);
    Object.assign(player, { x: -1, z: -1 });
    const zombie = target(simulation, 'protected', { x: -1, z: -4.5 });
    if (weapon === 'grenade') simulation.explodeGrenade(planted(simulation, { x: -1, y: .935, z: -1 }));
    else simulation.shoot(player.id);
    advance(simulation, 4.2, 30);
    assert.equal(zombie.hp, 10000, weapon); assert.equal(zombie.burnUntil, undefined, weapon);
  }
});
