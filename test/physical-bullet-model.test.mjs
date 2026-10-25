import test from 'node:test';
import assert from 'node:assert/strict';
import { BULLET_PROFILES } from '../public/bullet-profiles.js';
import { AIR_DENSITY, DAMAGE_PER_JOULE, BALLISTICS, physicalWeaponProfile, dragCoefficient,
  longRangeFalloff, ballisticPosition, ballisticVelocity, ballisticForwardSpeed, ballisticDistance,
  ballisticRangeAge, bulletEnergyAtAge, bulletDamageAtAge, negligibleBulletDamage, sampleBulletAtDistance } from '../public/ballistics.js';

const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b)), `${a} ~= ${b}`);
const base = { damage: 1, range: 45, pellets: 1, falloff: { start: 30, end: 50, near: 1, far: .1 }, closeRangeBoost: {}, oneShot: true };
const projectileFor = weapon => ({ x: 0, y: 1.55, z: 0, vx: 0, vy: 0, vz: -weapon.ballisticSpeed,
  drag: weapon.bulletPhysics.drag, gravity: BALLISTICS.gravity, maxAge: BALLISTICS.maxLife });
function expectedDamage(weapon, id, distance) {
  const curve = BULLET_PROFILES[id].damageCurve;
  return curve ? weapon.damage / (1 + (distance / curve.halfDistance) ** curve.power)
    : weapon.damage * Math.exp(-2 * dragCoefficient(weapon.bulletPhysics) * distance);
}
function continuedProjectile(weapon, projectile, age) {
  const point = ballisticPosition(projectile, age), velocity = ballisticVelocity(projectile, age);
  const norm = Math.hypot(velocity.x, velocity.y, velocity.z);
  const speed = ballisticForwardSpeed(projectile, age) * Math.sqrt(1 - weapon.bulletPhysics.transmission);
  return { ...projectile, ...point, vx: velocity.x / norm * speed, vy: velocity.y / norm * speed, vz: velocity.z / norm * speed,
    segmentStartAge: age, distanceOffset: ballisticDistance(projectile, age) };
}

test('all eight profiles retain physical flight while optional muzzle damage calibrates gameplay power', () => {
  assert.equal(Object.keys(BULLET_PROFILES).length, 8);
  for (const [id, parameters] of Object.entries(BULLET_PROFILES)) {
    const weapon = physicalWeaponProfile(base, id);
    assert.ok(parameters.mass > 0 && parameters.dragArea > 0 && parameters.muzzleSpeed > 0);
    assert.ok(parameters.transmission > 0 && parameters.transmission <= 1);
    near(weapon.bulletPhysics.drag, AIR_DENSITY * parameters.dragArea / (2 * parameters.mass));
    near(weapon.damage, parameters.muzzleDamage ?? DAMAGE_PER_JOULE * parameters.transmission * .5 * parameters.mass * parameters.muzzleSpeed ** 2);
    assert.equal(weapon.falloff, undefined); assert.equal(weapon.closeRangeBoost, undefined); assert.equal(weapon.oneShot, undefined);
    near(weapon.penetrationRetention, 1 - parameters.transmission);
    assert.equal(physicalWeaponProfile(weapon, id), weapon);
  }
  near(physicalWeaponProfile(base, 'magnum').damage, 2000);
  assert.equal(physicalWeaponProfile(base, 'magnum').upgradeExempt, true);
  assert.equal(base.oneShot, true, 'input data never changes');
});

test('smooth rational or exponential curves have matching values and slopes across former joins', () => {
  for (const id of Object.keys(BULLET_PROFILES)) {
    const weapon = physicalWeaponProfile(base, id), k = dragCoefficient(weapon.bulletPhysics);
    for (const d of [1, 4, 6, 8, 12, 18, 20, 25, 30, 35, 45, 50, 55, 65, 80, 90, 100, 120, 180, 200, 220, 240, 300]) {
      const value = weapon.damage * longRangeFalloff(weapon, d), h = .001;
      const left = weapon.damage * (longRangeFalloff(weapon, d) - longRangeFalloff(weapon, d - h)) / h;
      const right = weapon.damage * (longRangeFalloff(weapon, d + h) - longRangeFalloff(weapon, d)) / h;
      const curve = BULLET_PROFILES[id].damageCurve;
      const derivative = curve
        ? -weapon.damage * curve.power / curve.halfDistance * (d / curve.halfDistance) ** (curve.power - 1) / (1 + (d / curve.halfDistance) ** curve.power) ** 2
        : -2 * k * value;
      near(value, expectedDamage(weapon, id, d));
      near(left, derivative, .0001); near(right, derivative, .0001);
      assert.ok(value > 0, 'no arbitrary damage cutoff');
    }
  }
});

test('close damage calibration preserves the approved muzzle speeds and energy transmission shares', () => {
  const speeds = { pistol: 170, smg: 170, shotgun: 170, rifle: 170, assault: 250, minigun: 200, sniper: 382.5, magnum: 450 };
  const shares = { pistol: .7, smg: .45, shotgun: .55, rifle: .35, assault: .4, minigun: .3, sniper: .15, magnum: .9 };
  for (const [id, speed] of Object.entries(speeds)) {
    assert.equal(physicalWeaponProfile(base, id).ballisticSpeed, speed, id);
    assert.equal(BULLET_PROFILES[id].transmission, shares[id], id);
  }
});

test('assault ammunition keeps a faster, flatter distant trajectory than the minigun', () => {
  const assault = physicalWeaponProfile(base, 'assault'), minigun = physicalWeaponProfile(base, 'minigun');
  assert.equal(assault.ballisticSpeed, 250);
  assert.equal(minigun.ballisticSpeed, 200);
  for (const distance of [50, 100]) {
    const far = sampleBulletAtDistance(assault, distance), spray = sampleBulletAtDistance(minigun, distance);
    assert.ok(far.reachable && spray.reachable);
    assert.ok(far.damage > spray.damage, `${distance} m power`);
    assert.ok(far.drop < spray.drop * .6, `${distance} m drop`);
    assert.ok(far.time < spray.time * .8, `${distance} m travel time`);
  }
});

test('horizontal flight, graph and authoritative impact damage agree at every sampled distance', () => {
  for (const id of Object.keys(BULLET_PROFILES)) {
    const weapon = physicalWeaponProfile(base, id), projectile = projectileFor(weapon);
    for (const share of [.01, .1, .5, .9, 1]) {
      const d = weapon.range * share, sample = sampleBulletAtDistance(weapon, d), at = ballisticPosition(projectile, sample.time);
      near(-at.z, d); near(at.y, 1.55 - sample.drop);
      near(ballisticDistance(projectile, sample.time), d);
      near(ballisticRangeAge(projectile, d), sample.time);
      near(ballisticForwardSpeed(projectile, sample.time), sample.speed);
      near(bulletEnergyAtAge(weapon, projectile, sample.time), sample.energy);
      near(bulletDamageAtAge(weapon, projectile, sample.time), sample.damage);
      near(sample.damage, weapon.damage * longRangeFalloff(weapon, d));
      assert.equal(sample.reachable, true);
    }
    const beyond = sampleBulletAtDistance(weapon, weapon.range + 1);
    assert.equal(beyond.reachable, false); assert.ok(beyond.damage > 0, 'technical horizon is not fake zero damage');
  }
});

test('impact damage at 10 m and through two bodies follows total distance without applying retention twice', () => {
  for (const id of Object.keys(BULLET_PROFILES)) {
    const weapon = physicalWeaponProfile(base, id), retention = 1 - weapon.bulletPhysics.transmission;
    let projectile = projectileFor(weapon), retained = 1;
    for (const distance of [10, 25, 40]) {
      const age = ballisticRangeAge(projectile, distance);
      near(ballisticDistance(projectile, age), distance);
      const sample = sampleBulletAtDistance(weapon, distance);
      near(bulletEnergyAtAge(weapon, projectile, age), sample.energy * retained);
      near(bulletDamageAtAge(weapon, projectile, age), expectedDamage(weapon, id, distance) * retained);
      const next = continuedProjectile(weapon, projectile, age);
      near(bulletEnergyAtAge(weapon, next, age), bulletEnergyAtAge(weapon, projectile, age) * retention);
      near(bulletDamageAtAge(weapon, next, age), bulletDamageAtAge(weapon, projectile, age) * retention);
      projectile = next; retained *= retention;
    }
  }
});

test('rational negligible-damage horizon agrees with the actual impact kernel before the lifetime cap', () => {
  const original = physicalWeaponProfile(base, 'pistol');
  // A short synthetic half-distance reaches .01 PV well before four seconds.
  const curve = { kind: 'rational', halfDistance: .5, power: 3 };
  const weapon = { ...original, damage: 8, damageCurve: curve,
    bulletPhysics: { ...original.bulletPhysics, damageCurve: curve } };
  const expected = .5 * Math.cbrt(8 / .01 - 1);
  const at = sampleBulletAtDistance(weapon, expected), p = projectileFor(weapon);
  near(at.endDistance, expected);
  near(at.damage, .01);
  assert.equal(at.reachable, true, 'the threshold itself is included');
  for (let distance = expected - .01; distance < expected + .01; distance += .0001) {
    const sample = sampleBulletAtDistance(weapon, distance);
    assert.ok(Object.values(sample).filter(value => typeof value === 'number').every(Number.isFinite));
  }
  assert.ok(at.time < BALLISTICS.maxLife);
  assert.equal(sampleBulletAtDistance(weapon, expected - 1e-5).reachable, true);
  assert.equal(sampleBulletAtDistance(weapon, expected + 1e-5).reachable, false);
  assert.equal(negligibleBulletDamage(weapon, p, ballisticRangeAge(p, expected - 1e-5)), false);
  assert.equal(negligibleBulletDamage(weapon, p, ballisticRangeAge(p, expected + 1e-5)), true);
});

test('drag acceleration matches its quadratic law and gravity remains independent', () => {
  const weapon = physicalWeaponProfile(base, 'assault'), p = projectileFor(weapon), t = .3, h = 1e-5;
  const before = ballisticVelocity(p, t - h), after = ballisticVelocity(p, t + h), speed = ballisticForwardSpeed(p, t);
  near((after.z - before.z) / (2 * h), p.drag * speed ** 2, 1e-7);
  near((after.y - before.y) / (2 * h), -BALLISTICS.gravity, 1e-7);
  assert.ok(speed < weapon.ballisticSpeed);
});

test('continuation consumes energy, keeps global age and follows the slower segment', () => {
  const weapon = physicalWeaponProfile(base, 'assault'), p = projectileFor(weapon), age = .1;
  const point = ballisticPosition(p, age), velocity = ballisticVelocity(p, age), energy = bulletEnergyAtAge(weapon, p, age);
  const norm = Math.hypot(velocity.x, velocity.y, velocity.z), retained = Math.sqrt(1 - weapon.bulletPhysics.transmission);
  const speed = ballisticForwardSpeed(p, age) * retained;
  const next = { ...p, ...point, vx: velocity.x / norm * speed, vy: velocity.y / norm * speed, vz: velocity.z / norm * speed,
    segmentStartAge: age, distanceOffset: ballisticDistance(p, age) };
  near(bulletEnergyAtAge(weapon, next, age), energy * (1 - weapon.bulletPhysics.transmission));
  near(ballisticDistance(next, age), next.distanceOffset);
  assert.deepEqual(ballisticPosition(next, age), point);
  assert.ok(ballisticPosition(next, age + .05).z > ballisticPosition(p, age + .05).z);
  assert.equal(negligibleBulletDamage(weapon, { ...next, vx: 0, vy: 0, vz: 0 }, age), true);
});
