// The funfair's runtime lights follow the Blender fixtures: ceiling luminaires
// under the 3.2 m suspended ceiling and cellar diffusers under the ground slab.
export const TUBE_Y = Object.freeze({ ceiling: 3.105, cellar: -.57 });
export const GROUND_TUBES = Object.freeze([
  [-15, -10, 'on'], [-15, -4, 'dead'], [-15, 1, 'on'], [-15, 9, 'aged'],
  [-8, -10, 'dead'], [-8, -4, 'on'], [-8, 1, 'flicker'], [-8, 9, 'aged'],
  [0, -10, 'on'], [0, -4, 'on'], [0, 1, 'on'], [0, 9, 'aged'],
  [6, -10, 'on'], [6, -4, 'on'], [6, 1, 'on'], [6, 9, 'dead'],
  [14, -10, 'on'], [14, -4, 'on'], [14, 1, 'dead'],
].map(([x, z, state]) => Object.freeze({ x, z, state, y: TUBE_Y.ceiling })));
export const CELLAR_TUBES = Object.freeze([
  [-13, -9, 'on'], [-13, 0, 'on'], [-13, 9, 'dead'],
  [-5, -9, 'on'], [-5, 0, 'dead'], [-5, 9, 'on'],
  [5, -9, 'dead'], [5, 0, 'on'], [5, 9, 'on'],
  [14, -9, 'on'], [14, 0, 'on'], [14, 9, 'flicker'],
].map(([x, z, state]) => Object.freeze({ x, z, state, y: TUBE_Y.cellar })));
export const WARM_FIXTURES = Object.freeze([
  [1.66, 2.955, -12.67], [1.66, 2.955, 12.67], [-17.67, 2.955, 1.66], [17.67, 2.955, 1.66],
  [-8, 5.57, 16], [8, 5.57, 16], [-20, 5.57, -14],
].map(([x, y, z]) => Object.freeze({ x, y, z })));

const COLD = 0xd5e9e5, AGED = 0xffd9a6, AMBER = 0xffb76b, SODIUM = 0xff963d;
const groundPlan = [
  [-15, 1], [-15, -10], [6, -4], [-8, 1], [0, 9], [14, -4],
  [0, -10, 'medium'], [0, 1, 'high'],
];
const cellarPlan = [[-13, -9], [-5, 9], [5, 0], [14, -9], [14, 9, 'medium']];
const tubeLamp = (tubes, x, z, cellar, tier) => {
  const tube = tubes.find(item => item.x === x && item.z === z);
  const high = tube.y > 5;
  return {
    x, y: tube.y - (cellar ? .005 : .2), z, color: tube.state === 'aged' ? AGED : COLD,
    intensity: cellar ? 20 : high ? 30 : 9, range: cellar ? 6 : high ? 8.8 : 7,
    angle: cellar ? 1.3 : high ? 1.05 : .8, flicker: tube.state === 'flicker', tier,
  };
};
export const LAMPS = Object.freeze([
  ...groundPlan.map(([x, z, tier]) => tubeLamp(GROUND_TUBES, x, z, false, tier)),
  ...cellarPlan.map(([x, z, tier]) => tubeLamp(CELLAR_TUBES, x, z, true, tier)),
  { x: 0, y: 2.85, z: -13.6, color: AMBER, intensity: 8, range: 5.5, point: true },
  { x: 0, y: 3, z: 13.2, color: AMBER, intensity: 10, range: 5.5, point: true },
  { x: -18.2, y: 2.95, z: 0, color: AMBER, intensity: 8, range: 5.5, point: true, tier: 'medium' },
  { x: 18.2, y: 3, z: 0, color: AMBER, intensity: 8, range: 5.5, point: true, tier: 'medium' },
  { x: -8, y: 5.5, z: 16, color: SODIUM, intensity: 46, range: 8, angle: .9 },
  { x: 8, y: 5.5, z: 16, color: SODIUM, intensity: 42, range: 8, angle: .9, flicker: true, tier: 'medium' },
  { x: -20, y: 5.5, z: -14, color: SODIUM, intensity: 44, range: 8, angle: .9, tier: 'medium' },
].map(lamp => Object.freeze(lamp)));

export function lampsFor(quality) {
  const id = quality?.id ?? 'medium';
  return LAMPS.filter(lamp => !lamp.tier || (lamp.tier === 'medium' && id !== 'low') || (lamp.tier === 'high' && id === 'high'));
}

export const INDOOR = Object.freeze({ moon: .3, ambient: 1.35, rate: 2.5,
  funfair: Object.freeze({ minX: -18, maxX: 18, minZ: -13, maxZ: 13, minY: -.3, maxY: 6.3 }) });
export function indoorTarget(position) {
  if (!position) return 0;
  const { x, y, z } = position, room = INDOOR.funfair;
  if (y < room.minY) return 1;
  return x > room.minX && x < room.maxX && z > room.minZ && z < room.maxZ && y < room.maxY ? 1 : 0;
}

const fract = value => value - Math.floor(value);
const unit = (slot, salt) => fract(Math.sin(slot * 78.233 + salt * 12.9898) * 43758.5453);
export const FLICKER = Object.freeze({ slot: 2.6, dip: .36, floor: .4 });
export function flickerLevel(time, reducedMotion = false) {
  if (reducedMotion || !Number.isFinite(time)) return 1;
  const slot = Math.floor(time / FLICKER.slot), within = time - slot * FLICKER.slot;
  const hum = .97 + .03 * Math.sin(time * 9);
  if (unit(slot, 0) > .5) return hum;
  const dips = 2 + Math.floor(unit(slot, 1) * 2), u = (within - (.2 + unit(slot, 2) * .6)) / FLICKER.dip;
  if (u < 0 || u >= dips) return hum;
  const depth = .35 + .25 * unit(slot, 3 + Math.floor(u));
  return Math.max(FLICKER.floor, 1 - depth * Math.sin(Math.PI * fract(u)) ** 2);
}
