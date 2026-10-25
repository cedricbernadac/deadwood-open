import { sampleBulletAtDistance } from './ballistics.js';
import { blastDamageAtDistance, flameFalloff } from './area-damage.js';

// This is an explanatory, frozen comparison. These old rules are deliberately
// independent of the current kernel and must never be used by gameplay.
export const BASELINE_WEAPON_IDS = Object.freeze([
  'pistol', 'smg', 'shotgun', 'rifle', 'assault', 'minigun', 'sniper', 'magnum',
  'rocket', 'flamethrower', 'bat', 'katana', 'hammer', 'fireaxe',
]);
export const LEGACY_MAGNUM_BOSS_DAMAGE = 1000;
const clamp = value => Math.max(0, Math.min(1, value));

function settings(weapon, distance, options) {
  if (!weapon || !Number.isFinite(weapon.damage) || !(weapon.explosive ? weapon.radiusDamage > 0 : weapon.range > 0)) throw new TypeError('Invalid weapon');
  if (!Number.isFinite(distance) || distance < 0) throw new TypeError('Invalid distance');
  const { target = 'boss', targetHp = 400, shotgunUnit = 'pellet', attack = 'light', flameMode = 'direct' } = options;
  if (!['boss', 'ordinary'].includes(target) || !(Number.isFinite(targetHp) && targetHp > 0)
    || !['pellet', 'shell'].includes(shotgunUnit) || !['light', 'heavy'].includes(attack)
    || !['direct', 'burn', 'total'].includes(flameMode)) throw new TypeError('Invalid history options');
  return { target, targetHp, shotgunUnit, attack, flameMode };
}

function oldBaseFalloff(weapon, distance) {
  const curve = weapon.falloff;
  if (!curve) return 1;
  if (distance <= curve.start) return curve.near;
  if (distance >= curve.end) return curve.far;
  return curve.near + (curve.far - curve.near) * (distance - curve.start) / (curve.end - curve.start);
}

export function baselineFalloff(weapon, distance) {
  if (weapon.longRangePenetration) return 1;
  const legacy = oldBaseFalloff(weapon, distance), boost = weapon.closeRangeBoost;
  if (boost && distance < boost.end) {
    const t = clamp((distance - boost.fullUntil) / (boost.end - boost.fullUntil));
    return legacy * (1 + (boost.multiplier - 1) * (1 - t * t * (3 - 2 * t)));
  }
  if (distance <= 30 || !(weapon.longRangeDamage50 >= 0) || !(weapon.damage > 0)) return legacy;
  const at30 = oldBaseFalloff(weapon, 30);
  const at50 = Math.min(at30, weapon.longRangeDamage50 / weapon.damage);
  return at30 + (at50 - at30) * clamp((distance - 30) / 20);
}

function specialSample(weapon, distance, options, historical = false) {
  if (weapon.explosive) {
    const reachable = distance < weapon.radiusDamage;
    const attenuation = distance <= weapon.innerRadius ? 1
      : (weapon.radiusDamage - distance) / (weapon.radiusDamage - weapon.innerRadius);
    return { damage: historical ? reachable ? weapon.damage * attenuation : 0 : blastDamageAtDistance(weapon, distance), reachable, endDistance: weapon.radiusDamage, metric: 'damage' };
  }
  if (weapon.fuel) {
    const attenuation = historical ? Number(distance <= weapon.range) : flameFalloff(weapon, distance);
    const base = options.flameMode === 'burn' ? weapon.burnDps : options.flameMode === 'total' ? weapon.contactDps + weapon.burnDps : weapon.contactDps;
    return { damage: base * attenuation, reachable: attenuation > 0, endDistance: weapon.range, metric: 'dps' };
  }
  if (weapon.melee) {
    const attack = weapon.attacks?.[options.attack];
    if (!attack || !(attack.range > 0) || !Number.isFinite(attack.damage)) throw new TypeError('Missing melee attack');
    const reachable = distance <= attack.range;
    return { damage: reachable ? attack.damage : 0, reachable, endDistance: attack.range, metric: 'damage' };
  }
  return null;
}

/** First body hit, without armor, upgrades or penetration into a second body.
 * Ordinary Magnum mode compares actual HP removed; all other damage is raw.
 * Explosive distance is from the explosion. Flame is a fresh target at this
 * exposure distance: direct DPS, new lingering burn DPS, or their combined DPS.
 */
export function baselineSample(weapon, distance, options = {}) {
  const selected = settings(weapon, distance, options);
  const special = specialSample(weapon, distance, selected, true);
  if (special) return special;
  const reachable = distance < weapon.range;
  let damage = weapon.oneShot
    ? selected.target === 'ordinary' ? selected.targetHp : LEGACY_MAGNUM_BOSS_DAMAGE
    : weapon.damage * baselineFalloff(weapon, distance);
  if (selected.shotgunUnit === 'shell') damage *= weapon.pellets;
  return { damage: reachable ? damage : 0, reachable, endDistance: weapon.range, metric: 'damage' };
}

export function currentSample(weapon, distance, options = {}) {
  const selected = settings(weapon, distance, options);
  const special = specialSample(weapon, distance, selected);
  if (special) return special;
  if (!weapon.bulletPhysics) throw new TypeError('Missing current bullet physics');
  const sample = sampleBulletAtDistance(weapon, distance);
  let damage = sample.damage;
  if (weapon.upgradeExempt && selected.target === 'ordinary') damage = Math.min(selected.targetHp, damage);
  if (selected.shotgunUnit === 'shell') damage *= weapon.pellets;
  return { damage: sample.reachable ? damage : 0, reachable: sample.reachable, endDistance: sample.endDistance, metric: 'damage' };
}

/** Continuous, uniformly weighted distance mean, including zero beyond reach.
 * Interior Gauss nodes give discontinuities no artificial endpoint weight.
 * Split all historical knots, then refine smooth segments for capped HP or a
 * future current damage law. This is presentation math, never gameplay.
 */
export function historyMeanDamage(weapon, { version = 'current', minDistance = 0, maxDistance = 30, ...options } = {}) {
  if (!['before', 'current'].includes(version) || !Number.isFinite(minDistance) || minDistance < 0
    || !Number.isFinite(maxDistance) || maxDistance <= minDistance) throw new TypeError('Invalid mean inputs');
  const sample = version === 'before' ? baselineSample : currentSample;
  const origin = sample(weapon, 0, options);
  const knots = new Set([minDistance, maxDistance]);
  for (const point of [origin.endDistance, weapon.falloff?.start, weapon.falloff?.end,
    weapon.closeRangeBoost?.fullUntil, weapon.closeRangeBoost?.end, 30, 50, weapon.innerRadius, weapon.fullDamageRange]) {
    if (Number.isFinite(point) && point > minDistance && point < maxDistance) knots.add(point);
  }
  const value = distance => sample(weapon, distance, options).damage;
  const gauss = (a, b) => {
    const middle = (a + b) / 2, radius = (b - a) / 2;
    return radius * (
      .6521451548625461 * (value(middle - radius * .3399810435848563) + value(middle + radius * .3399810435848563))
      + .3478548451374538 * (value(middle - radius * .8611363115940526) + value(middle + radius * .8611363115940526)));
  };
  const integrate = (a, b, whole, depth = 0) => {
    const middle = (a + b) / 2, left = gauss(a, middle), right = gauss(middle, b), refined = left + right;
    return depth >= 12 || Math.abs(refined - whole) <= 1e-10 * Math.max(1, Math.abs(refined))
      ? refined : integrate(a, middle, left, depth + 1) + integrate(middle, b, right, depth + 1);
  };
  const points = [...knots].sort((a, b) => a - b);
  let integral = 0;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index];
    integral += integrate(a, b, gauss(a, b));
  }
  return integral / (maxDistance - minDistance);
}

/** Include old breakpoints and show actual hard cutoffs as vertical segments.
 * Current physical trajectories stop with remaining energy at their horizon.
 * Values duplicated at a cutoff are drawing limits, not extra damage samples.
 */
export function historyCurve(weapon, { version = 'current', maxDistance = null, samples = 180, ...options } = {}) {
  if (!['before', 'current'].includes(version) || !Number.isInteger(samples) || samples < 2) throw new TypeError('Invalid curve inputs');
  const sample = version === 'before' ? baselineSample : currentSample;
  const origin = sample(weapon, 0, options);
  maxDistance ??= origin.endDistance;
  if (!Number.isFinite(maxDistance) || maxDistance <= 0) throw new TypeError('Invalid maximum distance');
  const physical = version === 'current' && !!weapon.bulletPhysics;
  const end = physical ? Math.min(maxDistance, origin.endDistance) : maxDistance;
  const knots = new Set(Array.from({ length: samples + 1 }, (_, index) => end * index / samples));
  for (const point of [0, end, origin.endDistance, weapon.falloff?.start, weapon.falloff?.end,
    weapon.closeRangeBoost?.fullUntil, weapon.closeRangeBoost?.end, 30, 50, weapon.innerRadius, weapon.fullDamageRange]) {
    if (Number.isFinite(point) && point >= 0 && point <= end) knots.add(point);
  }
  const points = [];
  for (const distance of [...knots].sort((a, b) => a - b)) {
    const value = sample(weapon, distance, options);
    if (!physical && !weapon.explosive && !(version === 'current' && weapon.fuel) && distance === origin.endDistance) {
      const limit = sample(weapon, Math.max(0, distance - 1e-7), options).damage;
      if (value.damage === 0 && limit > 0) points.push({ distance, damage: limit, boundary: 'left-limit' });
      points.push({ distance, damage: value.damage });
      // Melee and flame include their exact reach, unlike the old ray bullets.
      if (value.damage > 0 && distance < end) points.push({ distance, damage: 0, boundary: 'right-limit' });
    } else points.push({ distance, damage: value.damage });
  }
  return points;
}
