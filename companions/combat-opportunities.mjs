import { LEVEL } from '../public/level-config.js';
// Read-only tactical geometry for the targets the model is actually shown.
// These are current opportunities, not hit probabilities or damage forecasts:
// aim variation, movement and bullet flight can still change the result.
import { FLAMETHROWER, enemyHitbox, enemyPosture, playerEyeHeight } from '../public/rules.js';
import { flameFalloff } from '../public/area-damage.js';
import { weaponEntries } from '../public/weapon-inventory.js';

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const outside = point => Math.abs(point.x) > LEVEL.halfWidth || Math.abs(point.z) > LEVEL.halfDepth;
const eyeOf = self => ({ x: self.x, y: self.y + playerEyeHeight(self), z: self.z });
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// Same head/chest preference as the body, but no mutable sight cache.
function aimPoint(sim, self, target) {
  const eye = eyeOf(self), posture = enemyPosture(target), scale = target.scale ?? 1, height = posture.height * scale;
  const head = (posture.head + posture.headThreshold) / 2 * scale;
  const byDoor = outside(target) || sim.doors.some(door => !door.sealed && flat(door, target) < 2.5);
  for (const offset of byDoor ? [.62 * height, .76 * height, head, .42 * height] : [head, .76 * height, .62 * height, .42 * height]) {
    const point = { x: target.x, y: (target.y ?? 0) + offset, z: target.z };
    if (sim.raiderLineClear(eye, point)) return point;
  }
  return null;
}
function rayDistance(origin, direction, box, range) {
  let near = 0, far = range;
  for (const axis of ['x', 'y', 'z']) {
    const key = axis.toUpperCase(), low = box[`min${key}`], high = box[`max${key}`];
    if (Math.abs(direction[axis]) < 1e-9) { if (origin[axis] < low || origin[axis] > high) return null; continue; }
    const first = (low - origin[axis]) / direction[axis], second = (high - origin[axis]) / direction[axis];
    near = Math.max(near, Math.min(first, second)); far = Math.min(far, Math.max(first, second));
    if (near > far) return null;
  }
  return near <= range && far >= 0 ? near : null;
}

export function piercingOpportunity(sim, self, target, observed, profile) {
  const cap = Math.max(1, Math.floor(profile?.penetrationTargets ?? 1));
  if (!profile || profile.melee || profile.fuel || profile.explosive || cap <= 1) return { count: 1, behind: 0, first: target.id };
  const point = aimPoint(sim, self, target), origin = eyeOf(self), range = Math.min(30, profile.range ?? 30);
  if (!point) return { count: 0, behind: 0, first: null };
  const length = Math.hypot(point.x - origin.x, point.y - origin.y, point.z - origin.z);
  if (!(length > 0)) return { count: 0, behind: 0, first: null };
  const direction = { x: (point.x - origin.x) / length, y: (point.y - origin.y) / length, z: (point.z - origin.z) / length };
  const hits = observed.filter(enemy => enemy.hp > 0).map(enemy => ({ enemy, distance: rayDistance(origin, direction, enemyHitbox(enemy), range) }))
    .filter(hit => hit.distance !== null && sim.raiderLineClear(origin, { x: origin.x + direction.x * (hit.distance + 1e-4),
      y: origin.y + direction.y * (hit.distance + 1e-4), z: origin.z + direction.z * (hit.distance + 1e-4) }))
    .sort((a, b) => a.distance - b.distance || a.enemy.id.localeCompare(b.enemy.id)).slice(0, cap);
  const index = hits.findIndex(hit => hit.enemy === target);
  return { count: hits.length, behind: index >= 0 ? hits.length - index - 1 : 0, first: hits[0]?.enemy.id ?? null };
}

export function flameOpportunity(sim, self, target, observed, profile = FLAMETHROWER) {
  const point = aimPoint(sim, self, target);
  return point ? flameCoverageAt(sim, self, point, observed, profile) : { count: 0, burning: 0, ids: [] };
}

// Explicit aim direction for the body and its alternate torso/cluster aims.
// Callers pass only observed enemies; the helper adds no hidden contacts.
export function flameCoverageAt(sim, self, point, observed, profile = FLAMETHROWER) {
  const origin = eyeOf(self), range = profile.range ?? FLAMETHROWER.range;
  const length = Math.hypot(point.x - origin.x, point.y - origin.y, point.z - origin.z);
  if (!(length > 0)) return { count: 0, burning: 0, ids: [] };
  const direction = { x: (point.x - origin.x) / length, y: (point.y - origin.y) / length, z: (point.z - origin.z) / length };
  let count = 0, burning = 0; const ids = [];
  for (const enemy of observed) {
    if (!(enemy.hp > 0)) continue;
    const box = enemyHitbox(enemy), dx = enemy.x - origin.x, dz = enemy.z - origin.z, horizontalSquared = dx * dx + dz * dz;
    if (horizontalSquared > range ** 2) continue;
    const reach = Math.sqrt(range ** 2 - horizontalSquared), low = Math.max(box.minY + .05, origin.y - reach), high = Math.min(box.maxY - .05, origin.y + reach);
    if (low > high) continue;
    const dot = dx * direction.x + dz * direction.z;
    const alignment = y => (dot + (y - origin.y) * direction.y) / Math.max(1e-8, Math.hypot(dx, y - origin.y, dz));
    let y = alignment(low) > alignment(high) ? low : high;
    if (dot > 1e-8) { const optimal = clamp(origin.y + direction.y * horizontalSquared / dot, low, high); if (alignment(optimal) > alignment(y)) y = optimal; }
    const distance = Math.hypot(dx, y - origin.y, dz), cone = profile.coneAngle ?? FLAMETHROWER.coneAngle;
    if (distance > range || distance < 1e-8 || alignment(y) < Math.cos(cone / 2)
      || !(flameFalloff(profile, distance) > 0) || !sim.grenadeBlastVisible(origin, { x: enemy.x, y, z: enemy.z })) continue;
    count++; ids.push(enemy.id); if (enemy.burnUntil > sim.time) burning++;
  }
  return { count, burning, ids };
}

export function carriedCombatOpportunities(sim, self, enemies, candidateLimit = 6) {
  const observed = enemies.filter(enemy => enemy.seen).map(enemy => enemy.zombie);
  const candidates = observed.slice(0, candidateLimit);
  return weaponEntries(self).map(({ id, weapon, stock }) => {
    const profile = sim.weaponProfile(self, id);
    if (!profile || profile.melee || profile.explosive || !profile.fuel && !(profile.penetrationTargets > 1)) return null;
    const targets = new Map(candidates.map(target => [target.id, profile.fuel
      ? flameOpportunity(sim, self, target, observed, profile) : piercingOpportunity(sim, self, target, observed, profile)]));
    const best = [...targets.entries()].sort((a, b) => b[1].count - a[1].count)[0];
    return { id, weapon, profile, stock, usable: stock.ammo + stock.reserve > 0, targets, best: best ? { id: best[0], ...best[1] } : null };
  }).filter(Boolean);
}
