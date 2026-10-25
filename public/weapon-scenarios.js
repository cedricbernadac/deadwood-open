import { blastDamageAtDistance, flameFalloff } from './area-damage.js';
import { enemyHitbox, enemyDamageMultiplier } from './enemies.js';
import { PLAYER_POSTURE } from './movement.js';
import { MINIGUN_TIMING } from './minigun.js';
import { longRangeFalloff, penetrationMultiplier } from './ballistics.js';

// An ammunition-independent proximity throughput experiment. Its periodic
// crowd is measured within 90 m; it is not a survival or long-range simulator.
export const SCENARIO_DEFAULTS = Object.freeze({ distances: Object.freeze([0, 4, 12]),
  spacing: .96, samples: 32, shotsPerSample: 48, seed: 104729, targetHp: 400,
  playerRadius: .25, eyeHeight: PLAYER_POSTURE.crouchedEye });
const HALF = .32, BODY_HEIGHT = 1.82, EPS = 1e-8;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function scenarioRandom(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

function bodyDistance(target, origin = { x: 0, y: .88, z: 0 }) {
  const box = enemyHitbox(target);
  return Math.hypot(Math.max(box.minX - origin.x, 0, origin.x - box.maxX),
    Math.max(box.minY - origin.y, 0, origin.y - box.maxY),
    Math.max(box.minZ - origin.z, 0, origin.z - box.maxZ));
}

// Exact same slab intersection and concentric square-to-disk mapping as shoot().
export function scenarioRayBox(origin, direction, box, maxDistance) {
  let near = 0, far = maxDistance;
  for (const axis of ['x', 'y', 'z']) {
    if (Math.abs(direction[axis]) < 1e-10) {
      if (origin[axis] < box[`min${axis.toUpperCase()}`] || origin[axis] > box[`max${axis.toUpperCase()}`]) return Infinity;
    } else {
      const a = (box[`min${axis.toUpperCase()}`] - origin[axis]) / direction[axis];
      const b = (box[`max${axis.toUpperCase()}`] - origin[axis]) / direction[axis];
      near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
      if (near > far) return Infinity;
    }
  }
  return near <= maxDistance ? near : Infinity;
}

function falloff(weapon, distance) {
  return longRangeFalloff(weapon, distance);
}

function directionAt(yaw, pitch) {
  return { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
}

/** A finite, exact window into the infinite square packing. Body AABBs never
 * overlap: spacing >= .64*sqrt(2), including arbitrary lattice rotations.
 * One first body is deliberately aimed at. All later positions come from a
 * random phase/orientation, not a perfectly aligned penetration queue.
 * distance is the free horizontal gap from the player's .25 m skin.
 */
export function scenarioGeometry(distance, options = {}) {
  const { spacing, playerRadius, eyeHeight } = { ...SCENARIO_DEFAULTS, ...options };
  const radius = options.radius ?? 66;
  if (!Number.isFinite(distance) || distance < 0 || !Number.isFinite(radius) || radius <= 0
    || !Number.isFinite(spacing) || spacing < 2 * HALF * Math.SQRT2
    || !Number.isFinite(playerRadius) || playerRadius < 0 || !Number.isFinite(eyeHeight) || eyeHeight <= 0)
    throw new TypeError('Invalid scenario geometry');
  const random = scenarioRandom(options.seed ?? SCENARIO_DEFAULTS.seed);
  const theta = random() * Math.PI / 2, cosine = Math.cos(theta), sine = Math.sin(theta);
  const phaseX = random() * spacing, phaseZ = random() * spacing;
  const origin = { x: 0, y: eyeHeight, z: 0 }, gap = playerRadius + distance;
  const anchor = { id: 'first', x: 0, y: 0, z: -gap - HALF, kind: 'walker', scale: 1 };
  anchor.nearDistance = bodyDistance(anchor, origin);
  const targets = radius >= gap ? [anchor] : [];
  // The square enclosing the rotated disk is larger by sqrt(2).
  const extent = Math.ceil((radius + spacing) * Math.SQRT2 / spacing);
  for (let ix = -extent; ix <= extent; ix++) for (let iz = -extent; iz <= extent; iz++) {
    const a = ix * spacing + phaseX, b = iz * spacing + phaseZ;
    const x = a * cosine - b * sine, z = a * sine + b * cosine;
    if (Math.hypot(x, z) > radius) continue;
    const target = { id: `${ix}:${iz}`, x, y: 0, z, kind: 'walker', scale: 1 };
    target.nearDistance = bodyDistance(target, origin);
    if (target.nearDistance < gap - EPS) continue;
    if (Math.abs(x - anchor.x) < 2 * HALF - EPS && Math.abs(z - anchor.z) < 2 * HALF - EPS) continue;
    targets.push(target);
  }
  return { origin, yaw: 0, pitch: 0, targets, distance, radius, spacing, theta,
    density: 1 / spacing ** 2, firstBodyDistance: gap };
}

// Fire/melee use their different authoritative target points. Fire tests the
// centre in X/Z, but the blade can reach a body's exposed near face/corners.
function conePoint(origin, direction, zombie, profile, melee = false) {
  const box = enemyHitbox(zombie), inset = melee ? .01 : .05;
  const minY = box.minY + inset, maxY = box.maxY - inset;
  const coords = axis => melee ? [...new Set([clamp(origin[axis], box[`min${axis.toUpperCase()}`], box[`max${axis.toUpperCase()}`]),
    zombie[axis], box[`min${axis.toUpperCase()}`], box[`max${axis.toUpperCase()}`]])] : [zombie[axis]];
  let nearest = null;
  for (const x of coords('x')) for (const z of coords('z')) {
    const dx = x - origin.x, dz = z - origin.z, horizontalSquared = dx * dx + dz * dz;
    if (horizontalSquared > profile.range ** 2 + EPS) continue;
    const verticalReach = Math.sqrt(Math.max(0, profile.range ** 2 - horizontalSquared));
    const lower = Math.max(minY, origin.y - verticalReach), upper = Math.min(maxY, origin.y + verticalReach);
    if (lower > upper) continue;
    const horizontalDot = dx * direction.x + dz * direction.z;
    const alignment = y => (horizontalDot + (y - origin.y) * direction.y) / Math.max(EPS, Math.hypot(dx, y - origin.y, dz));
    let y = alignment(lower) > alignment(upper) ? lower : upper;
    if (horizontalDot > EPS) {
      const optimum = clamp(origin.y + direction.y * horizontalSquared / horizontalDot, lower, upper);
      if (alignment(optimum) > alignment(y)) y = optimum;
    }
    const range = Math.hypot(dx, y - origin.y, dz);
    if (range < EPS || alignment(y) < Math.cos(profile.coneAngle / 2) - (melee ? EPS : 0)) continue;
    if (!nearest || range < nearest.range) nearest = { x, y, z, range };
  }
  return nearest;
}

/** Resolve one attack on immortal, unarmoured body targets. Damage isn't
 * clipped at HP and the field doesn't move or get depleted. Target HP never
 * changes a projectile's damage. Duplicate pellet intersections
 * count separately in intersections, once per body in targetsHit.
 */
export function scenarioShot(weapon, { targets, origin = { x: 0, y: .88, z: 0 }, yaw = 0, pitch = 0,
  random = () => .5, targetHp = SCENARIO_DEFAULTS.targetHp, mode = 'light' } = {}) {
  if (!weapon || !Array.isArray(targets) || !(targetHp > 0)) throw new TypeError('Invalid scenario shot');
  return resolveShot(weapon, { targets, origin, yaw, pitch, random, targetHp, mode }, prepareRays(targets, origin));
}

function prepareRays(targets, origin) {
  return targets.map(zombie => ({ zombie, box: enemyHitbox(zombie), lower: bodyDistance(zombie, origin) }))
    .sort((a, b) => a.lower - b.lower);
}

function resolveShot(weapon, { targets, origin, yaw = 0, pitch = 0, random = () => .5,
  targetHp = SCENARIO_DEFAULTS.targetHp, mode = 'light' }, candidates) {
  const direction = directionAt(yaw, pitch), affected = new Set();
  let damage = 0, intersections = 0, burnWeight = 0;
  if (weapon.melee) {
    const profile = weapon.attacks[mode];
    if (!profile) throw new TypeError('Invalid melee mode');
    const hits = targets.map(zombie => ({ zombie, point: conePoint(origin, direction, zombie, profile, true) }))
      .filter(hit => hit.point).sort((a, b) => a.point.range - b.point.range || a.zombie.id.localeCompare(b.zombie.id))
      .slice(0, profile.maxTargets);
    for (const { zombie } of hits) { damage += profile.damage * profile.retention ** intersections++ * enemyDamageMultiplier(zombie, false); affected.add(zombie.id); }
  } else if (weapon.fuel) {
    for (const zombie of targets) {
      const point = conePoint(origin, direction, zombie, weapon);
      if (!point) continue;
      // Archived profiles predate the edge curve and retain their flat reach.
      const strength = weapon.fullDamageRange === undefined ? 1 : flameFalloff(weapon, point.range);
      if (!(strength > 0)) continue;
      const weighted = strength * enemyDamageMultiplier(zombie, false);
      damage += weapon.contactDps * weapon.interval * weighted;
      burnWeight += weighted;
      intersections++; affected.add(zombie.id);
    }
  } else if (weapon.explosive) {
    let first = weapon.range;
    for (const zombie of targets) first = Math.min(first, scenarioRayBox(origin, direction, enemyHitbox(zombie), weapon.range));
    if (first < weapon.range) {
      const travel = Math.max(0, first - 1e-4);
      const impact = { x: origin.x + direction.x * travel, y: origin.y + direction.y * travel, z: origin.z + direction.z * travel };
      for (const zombie of targets) {
        const box = enemyHitbox(zombie);
        const range = Math.hypot(zombie.x - impact.x, (box.minY + box.maxY) / 2 - impact.y, zombie.z - impact.z);
        if (range >= weapon.radiusDamage) continue;
        const attenuation = weapon.blastCurve === 'smootherstep' ? blastDamageAtDistance(weapon, range) / weapon.damage
          : range <= weapon.innerRadius ? 1 : (weapon.radiusDamage - range) / (weapon.radiusDamage - weapon.innerRadius);
        damage += weapon.damage * attenuation * enemyDamageMultiplier(zombie, false);
        intersections++; affected.add(zombie.id);
      }
    }
  } else {
    for (let pellet = 0; pellet < weapon.pellets; pellet++) {
      let horizontal = random() * 2 - 1, vertical = random() * 2 - 1;
      if (weapon.pellets > 1 && (horizontal !== 0 || vertical !== 0)) {
        const major = Math.abs(horizontal) > Math.abs(vertical), radius = major ? horizontal : vertical;
        const angle = major ? Math.PI / 4 * vertical / horizontal : Math.PI / 2 - Math.PI / 4 * horizontal / vertical;
        horizontal = radius * Math.cos(angle); vertical = radius * Math.sin(angle);
      }
      const ray = directionAt(yaw + horizontal * weapon.spread, pitch + vertical * weapon.spread);
      const hits = [];
      for (const { zombie, box, lower } of candidates) {
        // A ray cannot enter a box before its Euclidean nearest point.
        // Once the nearest N intersections are certain, farther bodies cannot
        // change penetration. This is exact, not a range/density approximation.
        if (hits.length >= weapon.penetrationTargets && lower > hits.at(-1).at + EPS) break;
        const at = scenarioRayBox(origin, ray, box, weapon.range);
        if (at >= weapon.range) continue;
        hits.push({ zombie, at });
        hits.sort((a, b) => a.at - b.at || a.zombie.id.localeCompare(b.zombie.id));
        if (hits.length > weapon.penetrationTargets) hits.pop();
      }
      for (const [index, { zombie, at }] of hits.entries()) {
        damage += weapon.damage * falloff(weapon, at) * penetrationMultiplier(weapon, index, at) * enemyDamageMultiplier(zombie, false);
        intersections++; affected.add(zombie.id);
      }
    }
  }
  return { damage, targetsHit: affected.size, intersections, targetIds: [...affected], ...(weapon.fuel && { burnWeight }) };
}

export function scenarioTiming(weapon, { id, mode = 'light', spinUp = MINIGUN_TIMING.windup } = {}) {
  if (weapon?.melee) {
    const profile = weapon.attacks?.[mode];
    if (!profile || !(profile.duration > 0) || profile.windup < 0 || profile.windup >= profile.duration) throw new TypeError('Invalid melee timing');
    return { cycleTime: profile.duration, shotsPerCycle: 1, shotsPerSecond: 1 / profile.duration,
      firstDamageAt: profile.windup, reloadTime: 0, preparationTime: profile.windup, ammoPerSecond: 0 };
  }
  if (!weapon || !(weapon.magazine >= 1) || !Number.isInteger(weapon.magazine) || !(weapon.interval > 0)
    || !Number.isFinite(weapon.reloadTime) || weapon.reloadTime < 0 || !Number.isFinite(spinUp) || spinUp < 0)
    throw new TypeError('Invalid weapon timing');
  const preparationTime = id === 'minigun' ? spinUp : 0;
  const cycleTime = (weapon.magazine - 1) * weapon.interval + Math.max(weapon.reloadTime, weapon.interval) + preparationTime;
  const shotsPerSecond = weapon.magazine / cycleTime;
  const result = { cycleTime, shotsPerCycle: weapon.magazine, shotsPerSecond, firstDamageAt: preparationTime,
    reloadTime: weapon.reloadTime, preparationTime, ammoPerSecond: shotsPerSecond };
  if (weapon.fuel) {
    const lastGap = Math.max(weapon.reloadTime, weapon.interval) + preparationTime;
    result.burnCoverage = ((weapon.magazine - 1) * Math.min(weapon.interval, weapon.burnDuration)
      + Math.min(lastGap, weapon.burnDuration)) / cycleTime;
  }
  return result;
}

// Remove magazine downtime and firearm preparation, keeping actual cadence.
// The blade is deliberately an exception: its preparation is part of the
// strike's rate of fire, with movement allowed before the current-pose impact.
// One cycle is one shot/strike. This does not change authoritative timings.
export function scenarioActiveTiming(weapon, { mode = 'light' } = {}) {
  if (weapon?.melee) return scenarioTiming(weapon, { mode });
  const cycleTime = weapon?.interval;
  if (!Number.isFinite(cycleTime) || cycleTime <= 0) throw new TypeError('Invalid active weapon timing');
  const shotsPerSecond = 1 / cycleTime;
  return { cycleTime, shotsPerCycle: 1, shotsPerSecond, firstDamageAt: 0, reloadTime: 0, preparationTime: 0,
    ammoPerSecond: weapon.melee ? 0 : shotsPerSecond,
    ...(weapon.fuel && { burnCoverage: Math.min(1, weapon.burnDuration / cycleTime) }) };
}

function validateWeapon(id, weapon) {
  if (!weapon || !['range', 'damage', 'interval'].every(key => Number.isFinite(weapon[key]) && weapon[key] > 0))
    throw new TypeError(`Invalid scenario weapon: ${id}`);
  scenarioTiming(weapon, { id });
  if (weapon.melee) for (const mode of ['light', 'heavy']) {
    scenarioTiming(weapon, { id, mode });
    if (!['damage', 'range', 'coneAngle', 'maxTargets', 'retention'].every(key => Number.isFinite(weapon.attacks[mode][key]) && weapon.attacks[mode][key] > 0))
      throw new TypeError(`Invalid melee profile: ${mode}`);
  }
  else if (weapon.fuel && !['contactDps', 'burnDps', 'burnDuration', 'coneAngle'].every(key => Number.isFinite(weapon[key]) && weapon[key] > 0))
    throw new TypeError(`Invalid flame profile: ${id}`);
  else if (weapon.explosive && !['radiusDamage', 'innerRadius'].every(key => Number.isFinite(weapon[key]) && weapon[key] > 0))
    throw new TypeError(`Invalid blast profile: ${id}`);
  else if (!weapon.fuel && !weapon.explosive && !['pellets', 'spread', 'penetrationTargets', 'penetrationRetention'].every(key => Number.isFinite(weapon[key]) && weapon[key] >= 0))
    throw new TypeError(`Invalid projectile profile: ${id}`);
}

/** Browser/Node API; accepts the authoritative /world.json weapons object.
 * Defaults: 32 independent packing phases, 48 random triggers per phase.
 * Per-phase extrema describe these samples, not statistical bounds or kills/s.
 */
export function scenarioReport(weapons, options = {}) {
  const config = { ...SCENARIO_DEFAULTS, ...options };
  if (!weapons || typeof weapons !== 'object' || !Object.keys(weapons).length || !Array.isArray(config.distances) || !config.distances.length
    || config.distances.some(d => !Number.isFinite(d) || d < 0) || !(config.targetHp > 0) || !Number.isFinite(config.targetHp)
    || !Number.isInteger(config.samples) || config.samples < 1 || config.samples > 100
    || !Number.isInteger(config.shotsPerSample) || config.shotsPerSample < 1 || config.shotsPerSample > 10000)
    throw new TypeError('Invalid scenario report options');
  const rows = [];
  for (const [id, weapon] of Object.entries(weapons)) {
    validateWeapon(id, weapon);
    for (const mode of weapon.melee ? ['light', 'heavy'] : [undefined]) rows.push({ id, ...(mode && { mode }), cells: [] });
  }
  // This proximity crowd benchmark is bounded even when physical bullets
  // have a technical lifetime horizon hundreds of metres away. Exact shot
  // resolution remains available separately through scenarioShot().
  const radius = Math.min(90, Math.max(...Object.values(weapons).map(weapon => Math.max(weapon.range,
    ...Object.values(weapon.attacks ?? {}).map(profile => profile.range)) + (weapon.radiusDamage ?? 0))) + Math.SQRT2 * HALF);
  for (const distance of config.distances) {
    const accumulators = rows.map(() => []);
    for (let sample = 0; sample < config.samples; sample++) {
      const geometry = scenarioGeometry(distance, { ...config, radius, seed: (config.seed + sample * 65537) >>> 0 });
      for (const [index, row] of rows.entries()) {
        const weapon = weapons[row.id], timing = scenarioTiming(weapon, row), activeTiming = scenarioActiveTiming(weapon, row);
        const reach = row.mode ? weapon.attacks[row.mode].range : weapon.range;
        const spread = weapon.spread ?? 0, tangent = Math.tan(spread);
        const targets = geometry.targets.filter(zombie => {
          if (zombie.nearDistance > reach + (weapon.radiusDamage ?? 0)) return false;
          // Conservative broad phase only. Zone weapons keep the full disk.
          return weapon.melee || weapon.fuel || weapon.explosive
            || zombie.z - HALF <= 0 && Math.abs(zombie.x) <= Math.max(0, -zombie.z + HALF) * tangent + HALF + EPS;
        });
        const count = weapon.melee || weapon.fuel || weapon.explosive ? 1 : config.shotsPerSample;
        const random = scenarioRandom((config.seed + sample * 8191 + index * 104729) >>> 0);
        const candidates = prepareRays(targets, geometry.origin);
        let shotDamage = 0, targetCount = 0, intersections = 0, burnWeight = 0;
        for (let shot = 0; shot < count; shot++) {
          const result = resolveShot(weapon, { ...geometry, targets, random, targetHp: config.targetHp, mode: row.mode }, candidates);
          shotDamage += result.damage / count; targetCount += result.targetsHit / count; intersections += result.intersections / count;
          burnWeight += (result.burnWeight ?? 0) / count;
        }
        const contactDps = shotDamage * timing.shotsPerSecond;
        const burnDps = weapon.fuel ? burnWeight * weapon.burnDps * timing.burnCoverage : 0;
        const activeContactDps = shotDamage * activeTiming.shotsPerSecond;
        const activeBurnDps = weapon.fuel ? burnWeight * weapon.burnDps * activeTiming.burnCoverage : 0;
        accumulators[index].push({ rawDps: contactDps + burnDps, contactDps, burnDps, shotDamage, targetCount, intersections, burnWeight,
          activeRawDps: activeContactDps + activeBurnDps, activeContactDps, activeBurnDps });
      }
    }
    rows.forEach((row, index) => {
      const samples = accumulators[index], mean = key => samples.reduce((sum, sample) => sum + sample[key], 0) / samples.length;
      const rawDps = mean('rawDps'), variance = samples.reduce((sum, sample) => sum + (sample.rawDps - rawDps) ** 2, 0) / Math.max(1, samples.length - 1);
      const weapon = weapons[row.id], timing = scenarioTiming(weapon, row);
      const activeRawDps = mean('activeRawDps');
      const activeVariance = samples.reduce((sum, sample) => sum + (sample.activeRawDps - activeRawDps) ** 2, 0) / Math.max(1, samples.length - 1);
      row.cells.push({ distance, rawDps, targetsPerShot: mean('targetCount'), intersectionsPerShot: mean('intersections'),
        ...(weapon.fuel && { effectiveBurnTargets: mean('burnWeight') }),
        damagePerShot: mean('shotDamage'), contactDps: mean('contactDps'), burnDps: mean('burnDps'),
        minDps: Math.min(...samples.map(sample => sample.rawDps)), maxDps: Math.max(...samples.map(sample => sample.rawDps)),
        standardError: Math.sqrt(variance / samples.length), ...timing,
        samples: config.samples, shotsPerSample: weapon.melee || weapon.fuel || weapon.explosive ? 1 : config.shotsPerSample,
        active: { rawDps: activeRawDps, contactDps: mean('activeContactDps'), burnDps: mean('activeBurnDps'),
          minDps: Math.min(...samples.map(sample => sample.activeRawDps)), maxDps: Math.max(...samples.map(sample => sample.activeRawDps)),
          standardError: Math.sqrt(activeVariance / samples.length), ...scenarioActiveTiming(weapon, row) } });
    });
  }
  return { scenarios: config.distances.map(distance => ({ distance, label: distance === 0 ? 'contact' : `${distance} m` })), rows,
    assumptions: { metric: 'raw-body-damage-per-second', damageClippedAtHp: false, targetHp: config.targetHp,
      hpUse: 'All targets are immortal damage meters; target HP never changes damage', replenishedAmmo: true,
      infiniteField: false, crowdRadius: radius, maximumCrowdRadius: 90, stationaryTargets: true, aim: 'fixed frontal horizontal, crouched', headshotMultiplier: 1,
      eyeHeight: config.eyeHeight, playerRadius: config.playerRadius, bodyHeight: BODY_HEIGHT, bodyHalfWidth: HALF,
      distanceDefinition: 'free gap from player skin to nearest body surface; first ray hit is distance + playerRadius',
      packing: 'square lattice, random rotation and phase, one aimed first body, local overlaps removed',
      spacing: config.spacing, nominalDensity: 1 / config.spacing ** 2, samples: config.samples, shotsPerSample: config.shotsPerSample,
      seed: config.seed, targetsPerShotDefinition: 'unique bodies hit per trigger; pellet intersections separately reported',
      burn: 'one shared non-stacking burn, periodic union of live intervals including reload',
      burnSpatialWeight: 'contact-distance attenuation and armor; effectiveBurnTargets is the sum of those factors',
      cycle: 'R immediately after final shot: (magazine-1)*interval + max(reloadTime,interval) + minigun spin-up; melee windup is inside its duration',
      activeCycle: 'same sampled impacts, firearms without reload/spin-up: one shot per interval; melee exception keeps full duration and windup; shared burn union recalculated',
      environment: 'open flat ground, no walls, cover, recoil, pushback, armour, enemies moving, deaths or player danger',
      convergence: 'periodic crowd sampled within a maximum radius of 90 m; long-range crowd contributions are excluded',
      limitations: 'raw throughput is neither kills/s nor survivability; no overkill deduction, tactical sweep, frame/network latency, stock or pickup scarcity' } };
}
