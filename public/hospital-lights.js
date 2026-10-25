// The hospital's runtime lights follow the Blender fixtures (build_hospital.py):
// ceiling luminaires under the 3.2 m suspended ceiling, two of them high in the
// light shafts over the stair wells; cellar diffusers under the slab.
const SHAFTS = Object.freeze([
  Object.freeze({ minX: -16.9, maxX: -13.3, minZ: -9.35, maxZ: -1.45 }),
  Object.freeze({ minX: 12.9, maxX: 16.5, minZ: 3.65, maxZ: 11.55 }),
]);
export const TUBE_Y = Object.freeze({ ceiling: 3.1075, shaft: 5.91 });
const inShaft = (x, z) => SHAFTS.some(s => x > s.minX && x < s.maxX && z > s.minZ && z < s.maxZ);
export const GROUND_TUBES = Object.freeze([
  [-15, .7, 'on'], [-15, -10, 'dead'], [-15, -5.4, 'on'], [-15, 9.4, 'aged'],
  [-8, .7, 'dead'], [-8, -10, 'on'], [-8, -5.4, 'on'], [-8, 9.4, 'aged'],
  [0, .7, 'on'], [0, -10, 'on'], [0, -5.4, 'on'], [0, 9.4, 'aged'],
  [8, .7, 'on'], [8, -10, 'on'], [8, -5.4, 'flicker'], [8, 9.4, 'dead'],
  [15, .7, 'on'], [15, -10, 'on'], [15, -5.4, 'dead'], [15, 9.4, 'aged'],
].map(([x, z, state]) => Object.freeze({ x, z, state, y: inShaft(x, z) ? TUBE_Y.shaft : TUBE_Y.ceiling })));
// Each live cellar diffuser carries its spotlight's quality tier: none (every
// tier), 'medium' or 'high'. The six lit before the third pass keep the tiers
// they had then; the three lit since (the z = 0 row) are 'high'. Per tier:
// low 3 cellar spots (13 lights in all), medium 5 (24), high 9 (31).
export const CELLAR_TUBES = Object.freeze([
  [-12, -10, 'on'], [-12, 0, 'on', 'high'], [-12, 9, 'dead'],
  [-5, -10, 'on', 'medium'], [-5, 0, 'dead'], [-5, 9, 'on', 'high'],
  [3, -10, 'dead'], [3, 0, 'on', 'high'], [3, 9, 'on'],
  [11, -10, 'on'], [11, 0, 'on', 'high'], [11, 9, 'flicker', 'medium'],
].map(([x, z, state, tier]) => Object.freeze({ x, z, state, y: -.635, ...(tier ? { tier } : {}) })));
export const WARM_FIXTURES = Object.freeze([
  [1.66, 2.955, -14.67], [1.66, 2.955, 14.67], [-19.67, 2.955, 1.66], [19.67, 2.955, 1.66],
  [4.95, 1.79, 14.82], [6.65, 1.79, 14.82],
  [-8, 5.532, 18], [8, 5.532, 18], [-23, 5.532, -12], [23, 5.532, -12],
].map(([x, y, z]) => Object.freeze({ x, y, z })));

const COLD = 0xd5e9e5, AGED = 0xffd9a6, AMBER = 0xffb76b, SODIUM = 0xff963d;
// A ceiling tube 2.9 m above the floor needs about a quarter of the old 5.7 m
// intensity; its narrower cone keeps most of its light on its own side of the
// partitions (three.js lights are not occluded by the walls). Ground tubes
// are thinned and tiered by position in the grid; the cellar's nine live
// diffusers all get a spotlight, on the tier written in CELLAR_TUBES.
const tubeLamps = (tubes, cellar) => tubes.filter((tube, index) => tube.state !== 'dead' && (cellar || index % 3 !== 1)).map((tube, index) => {
  const high = tube.y > 5;
  return {
    x: tube.x, y: tube.y - (cellar ? .005 : .2), z: tube.z, color: tube.state === 'aged' ? AGED : COLD,
    intensity: cellar ? 32 : high ? 30 : 9, range: cellar ? 7.2 : high ? 8.8 : 7, angle: cellar ? 1.3 : high ? 1.05 : .8,
    flicker: tube.state === 'flicker', tier: cellar ? tube.tier : index % 4 === 1 ? 'medium' : index % 5 === 2 ? 'high' : undefined,
  };
});
export const LAMPS = Object.freeze([
  ...tubeLamps(GROUND_TUBES, false), ...tubeLamps(CELLAR_TUBES, true),
  { x: 13.25, y: 2.15, z: -8, color: COLD, intensity: 10, range: 3.2, angle: 1.1 },
  { x: 14.85, y: 2.15, z: -8.75, color: COLD, intensity: 9, range: 3.2, angle: 1.1, tier: 'medium' },
  { x: 5.8, y: 2.2, z: 13.8, color: AMBER, intensity: 5, range: 6, point: true },
  { x: 0, y: 2.85, z: -15.6, color: AMBER, intensity: 8, range: 5.5, point: true },
  { x: 0, y: 3.25, z: 15.2, color: AMBER, intensity: 10, range: 5.5, point: true },
  { x: -20.2, y: 2.95, z: 0, color: AMBER, intensity: 8, range: 5.5, point: true, tier: 'medium' },
  { x: 20.2, y: 3.25, z: 0, color: AMBER, intensity: 8, range: 5.5, point: true, tier: 'medium' },
  { x: -8, y: 5.5, z: 18, color: SODIUM, intensity: 46, range: 8, angle: .9, tier: 'medium' },
  { x: 8, y: 5.5, z: 18, color: SODIUM, intensity: 42, range: 8, angle: .9, flicker: true, tier: 'medium' },
  { x: -23, y: 5.5, z: -12, color: SODIUM, intensity: 40, range: 8, angle: .9, tier: 'high' },
  { x: 23, y: 5.5, z: -12, color: SODIUM, intensity: 44, range: 8, angle: .9, tier: 'medium' },
].map(lamp => Object.freeze(lamp)));

export function lampsFor(quality) {
  const id = quality?.id ?? 'medium';
  return LAMPS.filter(lamp => !lamp.tier || (lamp.tier === 'medium' && id !== 'low') || (lamp.tier === 'high' && id === 'high'));
}

export const INDOOR = Object.freeze({ moon: .3, ambient: 1.35, rate: 2.5,
  hospital: Object.freeze({ minX: -20, maxX: 20, minZ: -15, maxZ: 15, minY: -.3, maxY: 6.3 }) });
export function indoorTarget(position) {
  if (!position) return 0;
  const { x, y, z } = position, room = INDOOR.hospital;
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
