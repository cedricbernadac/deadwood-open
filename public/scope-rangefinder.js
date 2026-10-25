import { enemyHitbox } from './enemies.js';

function boxDistance(origin, direction, box, limit) {
  let near = 0, far = limit;
  for (const axis of ['x', 'y', 'z']) {
    const low = box['min' + axis.toUpperCase()], high = box['max' + axis.toUpperCase()];
    if (Math.abs(direction[axis]) < 1e-9) {
      if (origin[axis] < low || origin[axis] > high) return null;
      continue;
    }
    const a = (low - origin[axis]) / direction[axis], b = (high - origin[axis]) / direction[axis];
    near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
    if (near > far) return null;
  }
  return near;
}

// Straight line of sight, in metres, to the first physical contact. It does
// not predict or compensate a bullet's curved trajectory. Static geometry
// comes from the current level; enemy boxes use the authoritative shapes.
export function scopeTargetDistance({ origin, direction, enemies = [], raycast, maxDistance = 420 }) {
  if (![origin?.x, origin?.y, origin?.z, direction?.x, direction?.y, direction?.z, maxDistance].every(Number.isFinite) || maxDistance <= 0) return null;
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (length < 1e-9) return null;
  const unit = { x: direction.x / length, y: direction.y / length, z: direction.z / length };
  const staticDistance = raycast?.(origin, unit, maxDistance);
  let distance = Number.isFinite(staticDistance) && staticDistance >= 0 && staticDistance <= maxDistance ? staticDistance : null;
  for (const enemy of enemies) {
    if (enemy.hp <= 0 || ![enemy.x, enemy.y, enemy.z].every(Number.isFinite)) continue;
    const hit = boxDistance(origin, unit, enemyHitbox(enemy), distance ?? maxDistance);
    if (hit !== null && (distance === null || hit < distance)) distance = hit;
  }
  return distance;
}
