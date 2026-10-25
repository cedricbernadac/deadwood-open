import { BULLET_PROFILES } from './bullet-profiles.js';

// Point-mass game approximation: constant-density quadratic longitudinal drag.
// F = rho * Cd * A * v² / 2, k = rho * Cd * A / (2m).
// v(s) = v0 exp(-ks), s(t) = log(1 + k v0 t) / k.
// Gravity adds the vertical drop separately; wind, spin and vertical drag are
// omitted. Remaining forward energy governs penetration, without gravity gain.
// Damage can have an explicit smooth game response, independent of flight drag.
// Sources: NASA Glenn drag equation; OpenStax University Physics 7.2.
export const AIR_DENSITY = 1.225;
export const DAMAGE_PER_JOULE = 1;
export const MIN_BULLET_DAMAGE = .01;
const MAX_LIFE = 4;
const clamp = value => Math.max(0, Math.min(1, value));

export function dragCoefficient(profile) {
  return profile?.mass > 0 && profile?.dragArea >= 0 ? AIR_DENSITY * profile.dragArea / (2 * profile.mass) : 0;
}
function advance(speed, drag, time) {
  return drag > 0 ? Math.log1p(drag * speed * time) / drag : speed * time;
}
const speeds = Object.freeze(Object.fromEntries(Object.entries(BULLET_PROFILES).map(([id, profile]) => [id, profile.muzzleSpeed])));
const ranges = Object.freeze(Object.fromEntries(Object.entries(BULLET_PROFILES).map(([id, profile]) =>
  [id, advance(profile.muzzleSpeed, dragCoefficient(profile), MAX_LIFE)])));
export const BALLISTICS = Object.freeze({ speed: 170, speeds, ranges, gravity: 9.81,
  maxLife: MAX_LIFE, maxActive: 256, airDensity: AIR_DENSITY, damagePerJoule: DAMAGE_PER_JOULE,
  minimumDamage: MIN_BULLET_DAMAGE });
export const OUTDOOR_BULLET_PROFILES = BULLET_PROFILES;

export function physicalWeaponProfile(weapon, id) {
  if (!weapon || weapon.melee || weapon.fuel || weapon.explosive || !BULLET_PROFILES[id] || weapon.bulletPhysics) return weapon;
  const profile = BULLET_PROFILES[id];
  const { falloff, longRangeDamage50, closeRangeBoost, distanceFade, oneShot, ...base } = weapon;
  const { muzzleDamage, damageCurve, ...flight } = profile;
  const bulletPhysics = Object.freeze({ ...flight, drag: dragCoefficient(profile) });
  return { ...base, bulletPhysics,
    damage: muzzleDamage ?? DAMAGE_PER_JOULE * profile.transmission * .5 * profile.mass * profile.muzzleSpeed ** 2,
    ...(damageCurve ? { damageCurve } : {}),
    ballisticSpeed: profile.muzzleSpeed, range: ranges[id],
    penetrationRetention: 1 - profile.transmission,
    ...(profile.spread !== undefined ? { spread: profile.spread } : {}),
    ...(id === 'magnum' ? { upgradeExempt: true } : {}) };
}
export const outdoorWeaponProfile = physicalWeaponProfile;
export function ballisticSpeed(weapon) { return speeds[weapon] ?? BALLISTICS.speed; }
export function ballisticRange(weapon, fallback) { return ranges[weapon] ?? fallback; }

// Compatibility for custom profiles. Shipped bullets use one smooth response
// over their whole distance, with no hard damage steps at historical ranges.
export function legacyFalloff(weapon, distance) {
  const curve = weapon?.falloff;
  if (!curve || !Number.isFinite(distance)) return 1;
  if (distance <= curve.start) return curve.near;
  if (distance >= curve.end) return curve.far;
  return curve.near + (curve.far - curve.near) * (distance - curve.start) / (curve.end - curve.start);
}
export function longRangeFalloff(weapon, distance, legacyMultiplier = legacyFalloff(weapon, distance)) {
  if (weapon?.bulletPhysics) {
    const d = Math.max(0, Number.isFinite(distance) ? distance : 0), curve = weapon.damageCurve;
    return curve?.kind === 'rational'
      ? 1 / (1 + (d / curve.halfDistance) ** curve.power)
      : Math.exp(-2 * weapon.bulletPhysics.drag * d);
  }
  return legacyMultiplier;
}
export function penetrationMultiplier(weapon, index = 0, distance = 0) {
  const retention = weapon?.penetrationRetention ?? 1;
  if (weapon?.bulletPhysics) return retention ** index;
  const distantLoss = index > 0 && !weapon?.longRangePenetration
    ? 1 - .25 * clamp(((Number.isFinite(distance) ? distance : 0) - 30) / 20) : 1;
  return retention ** index * distantLoss;
}
function localAge(projectile, age) {
  const bounded = Math.max(0, Math.min(Number.isFinite(age) ? age : 0, projectile.maxAge ?? MAX_LIFE));
  return Math.max(0, bounded - (projectile.segmentStartAge ?? 0));
}
export function ballisticForwardSpeed(projectile, age) {
  const speed = Math.hypot(projectile.vx, projectile.vy, projectile.vz);
  return speed / (1 + Math.max(0, projectile.drag ?? 0) * speed * localAge(projectile, age));
}
export function ballisticPosition(projectile, age) {
  const time = localAge(projectile, age), speed = Math.hypot(projectile.vx, projectile.vy, projectile.vz);
  const scale = speed > 0 ? advance(speed, Math.max(0, projectile.drag ?? 0), time) / speed : time;
  return { x: projectile.x + projectile.vx * scale,
    y: projectile.y + projectile.vy * scale - .5 * projectile.gravity * time * time,
    z: projectile.z + projectile.vz * scale };
}
export function ballisticVelocity(projectile, age) {
  const time = localAge(projectile, age), speed = Math.hypot(projectile.vx, projectile.vy, projectile.vz);
  const scale = 1 / (1 + Math.max(0, projectile.drag ?? 0) * speed * time);
  return { x: projectile.vx * scale, y: projectile.vy * scale - projectile.gravity * time, z: projectile.vz * scale };
}
export function bulletEnergyAtAge(weapon, projectile, age) {
  return weapon?.bulletPhysics ? .5 * weapon.bulletPhysics.mass * ballisticForwardSpeed(projectile, age) ** 2 : 0;
}
export function bulletDamageAtAge(weapon, projectile, age) {
  if (!weapon?.bulletPhysics) return weapon?.damage ?? 0;
  const distance = ballisticDistance(projectile, age), physics = weapon.bulletPhysics;
  // A continuation has already lost energy in earlier bodies. Divide out only
  // the free-flight drag so that penetration is applied once, and the distance
  // response never restarts at the most recent body.
  const freeSpeed = physics.muzzleSpeed * Math.exp(-physics.drag * distance);
  const retained = (ballisticForwardSpeed(projectile, age) / freeSpeed) ** 2;
  return weapon.damage * longRangeFalloff(weapon, distance) * retained;
}
export function negligibleBulletDamage(weapon, projectile, age) {
  return bulletDamageAtAge(weapon, projectile, age) < MIN_BULLET_DAMAGE;
}

// Physical bullets use longitudinal advance; no quadrature per tick.
// Old no-drag fixtures retain their historical arc-length convention.
export function ballisticDistance(projectile, age) {
  const time = localAge(projectile, age), speed = Math.hypot(projectile.vx, projectile.vy, projectile.vz);
  if (projectile.drag !== undefined) return (projectile.distanceOffset ?? 0) + advance(speed, Math.max(0, projectile.drag), time);
  const gravity = projectile.gravity, horizontal = Math.hypot(projectile.vx, projectile.vz), vertical = projectile.vy;
  if (!(gravity > 0)) return speed * time;
  const integral = value => horizontal < 1e-9 ? .5 * value * Math.abs(value)
    : .5 * (value * Math.hypot(horizontal, value) + horizontal * horizontal * Math.asinh(value / horizontal));
  return Math.max(0, (integral(vertical) - integral(vertical - gravity * time)) / gravity);
}
export function ballisticRangeAge(projectile, range) {
  if (projectile.drag !== undefined) {
    const speed = Math.hypot(projectile.vx, projectile.vy, projectile.vz), drag = Math.max(0, projectile.drag);
    const remaining = Math.max(0, range - (projectile.distanceOffset ?? 0));
    const time = speed > 0 ? drag > 0 ? Math.expm1(drag * remaining) / (drag * speed) : remaining / speed : MAX_LIFE;
    return Math.min(projectile.maxAge ?? MAX_LIFE, (projectile.segmentStartAge ?? 0) + time);
  }
  let low = 0, high = projectile.maxAge ?? MAX_LIFE;
  for (let step = 0; step < 32; step++) {
    const mid = (low + high) / 2;
    if (ballisticDistance(projectile, mid) < range) low = mid; else high = mid;
  }
  return high;
}

// Horizontal free-flight reference, ignoring terrain interception. Damage uses
// the same smooth game response as real contacts. Outside lifetime, retain the
// theoretical damage rather than inventing zero; the graph ends at the limit.
export function sampleBulletAtDistance(weapon, distance) {
  if (!weapon?.bulletPhysics || !Number.isFinite(distance) || distance < 0) return null;
  const physics = weapon.bulletPhysics, speed = physics.muzzleSpeed, drag = physics.drag;
  const time = drag > 0 ? Math.expm1(drag * distance) / (drag * speed) : distance / speed;
  const remainingSpeed = speed * Math.exp(-drag * distance);
  const damage = weapon.damage * longRangeFalloff(weapon, distance);
  const curve = weapon.damageCurve;
  const negligibleDistance = weapon.damage <= MIN_BULLET_DAMAGE ? 0
    : curve?.kind === 'rational' ? curve.halfDistance * (weapon.damage / MIN_BULLET_DAMAGE - 1) ** (1 / curve.power)
    : drag > 0 ? Math.log(weapon.damage / MIN_BULLET_DAMAGE) / (2 * drag) : Infinity;
  return { distance, horizontal: distance, travelled: distance, time, speed: remainingSpeed,
    energy: .5 * physics.mass * remainingSpeed ** 2, damage, drop: .5 * BALLISTICS.gravity * time ** 2,
    reachable: time <= MAX_LIFE + 1e-9 && damage >= MIN_BULLET_DAMAGE * (1 - 1e-12),
    endDistance: Math.min(advance(speed, drag, MAX_LIFE), negligibleDistance) };
}
