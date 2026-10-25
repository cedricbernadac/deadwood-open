import { spaceRainShelter } from './level-space.js';
import { LEVEL, HAS_SPACE } from './level-config.js';
// Authoritative expedition geometry and timings, also used by the renderer.
export const EXPEDITION = Object.freeze({
  bounds: Object.freeze({ minX: -140, maxX: 140, minZ: -64, maxZ: 64 }),
  missionWaves: Object.freeze([5, 10, 15]), interactionCooldown: .35,
});
export const RAIN = Object.freeze({
  damagePerSecond: 3,
  // Horizontal projection of the two existing pitched roof panels.
  roof: LEVEL.roof.bounds,
});
export const UMBRELLA = Object.freeze({ max: 100 });
export const GENERATOR = Object.freeze({
  ...LEVEL.generator, width: 1.05, depth: .7, height: .9,
  reach: 1.8, declineSeconds: 90, minPower: .2,
});
export const GENERATOR_BOUNDS = Object.freeze({
  id: 'generator', minX: GENERATOR.x - GENERATOR.width / 2, maxX: GENERATOR.x + GENERATOR.width / 2,
  minZ: GENERATOR.z - GENERATOR.depth / 2, maxZ: GENERATOR.z + GENERATOR.depth / 2,
  baseY: GENERATOR.y, height: GENERATOR.height,
});
export const FUEL_CACHES = Object.freeze([
  Object.freeze({ x: -125, y: 0, z: 36 }),
  Object.freeze({ x: 125, y: 0, z: -36 }),
  Object.freeze({ x: -120, y: 0, z: -50 }),
]);
// Preserve the established bonus runs while fuel expeditions move farther out.
export const SUPPLY_CACHES = HAS_SPACE ? LEVEL.supplyCaches : Object.freeze([
  Object.freeze({ x: -16, y: 0, z: 10 }),
  Object.freeze({ x: 15, y: 0, z: -11 }),
  Object.freeze({ x: -14, y: 0, z: -12 }),
]);
// Intermediate woodland exits, 5.4 m beyond the corresponding cabin facade.
// The scheduler must still warn and recheck player/body clearance at emergence.
export const SPAWN_ENTRIES = HAS_SPACE ? LEVEL.spawnEntries : Object.freeze([
  Object.freeze({ id: 'north-culvert', doorId: 'north', x: -4.2, z: -11.4, kind: 'culvert' }),
  Object.freeze({ id: 'north-woods', doorId: 'north', x: 4.2, z: -11.4, kind: 'woods' }),
  Object.freeze({ id: 'south-woods', doorId: 'south', x: -4.2, z: 11.4, kind: 'woods' }),
  Object.freeze({ id: 'south-culvert', doorId: 'south', x: 4.2, z: 11.4, kind: 'culvert' }),
  Object.freeze({ id: 'west-woods', doorId: 'west', x: -13.4, z: -3.6, kind: 'woods' }),
  Object.freeze({ id: 'west-culvert', doorId: 'west', x: -13.4, z: 3.6, kind: 'culvert' }),
  Object.freeze({ id: 'east-culvert', doorId: 'east', x: 13.4, z: -3.6, kind: 'culvert' }),
  Object.freeze({ id: 'east-woods', doorId: 'east', x: 13.4, z: 3.6, kind: 'woods' }),
]);
// Two visible clearings add long shots without replacing nearby pressure.
export const FAR_SPAWN_ENTRIES = Object.freeze([
  Object.freeze({ id: 'far-west-clearing', doorId: 'west', x: -60, z: 20, kind: 'clearing', far: true }),
  Object.freeze({ id: 'far-east-clearing', doorId: 'east', x: 60, z: -20, kind: 'clearing', far: true }),
]);
export function farSpawnShare(wave = 0) {
  if (!Number.isFinite(wave) || wave < 13) return 0;
  return wave < 15 ? .1 : .2;
}
export const SPAWN_WARNING = Object.freeze({ seconds: 2, minPlayerDistance: 4, retrySeconds: .5 });

export function rainRoofHeight(x) {
  if (HAS_SPACE) return LEVEL.roof.height - LEVEL.roof.thickness;
  return 7.32 + Math.tan(.21) * (4.15 - Math.abs(x)) - .12 / Math.cos(.21);
}

export function hasRainShelter(position, height = 0) {
  if(HAS_SPACE)return spaceRainShelter(position,height);
  if (![position?.x, position?.y, position?.z, height].every(Number.isFinite)) return false;
  const roof = RAIN.roof;
  return position.x >= roof.minX && position.x <= roof.maxX && position.z >= roof.minZ && position.z <= roof.maxZ
    && position.y + height <= rainRoofHeight(position.x);
}

export function rainExposed(position, height = 0) { return !hasRainShelter(position, height); }

export function generatorPower(elapsed, active) {
  return active ? Math.max(GENERATOR.minPower, 1 - (1 - GENERATOR.minPower) * Math.max(0, elapsed) / GENERATOR.declineSeconds) : 1;
}
