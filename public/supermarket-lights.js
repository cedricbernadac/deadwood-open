// Le Dernier Panier's light plan, shared by the runtime and its tests.
// build_supermarket.py mirrors SHOP_TUBES / CELLAR_TUBES (same coordinates,
// same states: on, aged, dead, flicker) when it assigns the tube materials.
// Half the shop tubes are dead in whole bays, so lit runs alternate with dim
// aisles; one peripheral tube per floor stutters; two old tubes glow warm.
export const SHOP_TUBES = Object.freeze([
  [-11, -8, 'dead'], [-11, -3, 'dead'], [-11, 3, 'on'], [-11, 8, 'aged'],
  [-6, -8, 'flicker'], [-6, -3, 'dead'], [-6, 3, 'on'], [-6, 8, 'aged'],
  [-1, -8, 'dead'], [-1, -3, 'on'], [-1, 3, 'on'], [-1, 8, 'dead'],
  [5.5, -8, 'dead'], [5.5, -3, 'on'], [5.5, 3, 'dead'], [5.5, 8, 'dead'],
].map(([x, z, state]) => Object.freeze({ x, z, state })));
export const CELLAR_TUBES = Object.freeze([
  [1.4, -8.8, 'on'], [6.6, -8.8, 'on'], [8.8, -3, 'on'], [5, 2.8, 'dead'], [7.9, 8.8, 'flicker'],
].map(([x, z, state]) => Object.freeze({ x, z, state })));
// Warm fixtures outside the tubes: door lamps, terrace pendants and sconces.
// Each gets a soft halo; build_supermarket.py places the fixtures themselves.
export const WARM_FIXTURES = Object.freeze([
  [-1.75, 2.62, 11.32], [1.75, 2.62, 11.32], [0, 2.97, -11.32], [-14.32, 2.97, 0], [14.32, 2.82, 0],
  [9.1, 3.23, -6.6], [11, 2.74, -6.6], [13, 2.69, -6.6],
  [13.79, 2.37, -8], [13.79, 2.37, -3], [13.79, 2.37, 3], [13.79, 2.37, 8],
  [-9, 6.0, 16.65], [15.15, 6.0, -13.8],
].map(([x, y, z]) => Object.freeze({ x, y, z })));

const COLD = 0xcfe7de, AGED = 0xffd9a6, WARM = 0xffc285, AMBER = 0xffa75a, SODIUM = 0xff8a2a;
// Spots aim at the floor. Point lights cast no shadow here, so every range
// stays shorter than the distance to the other floor's nearest lit surface.
// tier: every quality, 'medium' (medium and high) or 'high' (high only).
export const LAMPS = Object.freeze([
  // Shop tubes that work (one light per tube, aimed straight down).
  { x: -11, y: 5.72, z: 3, color: COLD, intensity: 30, range: 8.8 },
  { x: -11, y: 5.72, z: 8, color: AGED, intensity: 30, range: 8.8 },
  { x: -6, y: 5.72, z: -8, color: COLD, intensity: 28, range: 8.8, flicker: true },
  { x: -6, y: 5.72, z: 3, color: COLD, intensity: 26, range: 8.8, tier: 'medium' },
  { x: -1, y: 5.72, z: -3, color: COLD, intensity: 32, range: 8.8 },
  { x: -1, y: 5.72, z: 3, color: COLD, intensity: 28, range: 8.8 },
  { x: 5.5, y: 5.72, z: -3, color: COLD, intensity: 32, range: 8.8 },
  { x: -6, y: 5.72, z: 8, color: AGED, intensity: 26, range: 8.8, tier: 'medium' },
  // Cellar tubes: wide cones from under the diffusers (hung below the pipes).
  { x: 6.6, y: -.64, z: -8.8, color: COLD, intensity: 20, range: 6, angle: 1.3 },
  { x: 8.8, y: -.64, z: -3, color: COLD, intensity: 20, range: 6, angle: 1.3 },
  { x: 1.4, y: -.64, z: -8.8, color: COLD, intensity: 18, range: 6, angle: 1.3, tier: 'high' },
  { x: 7.9, y: -.64, z: 8.8, color: COLD, intensity: 16, range: 6, angle: 1.3, flicker: true, tier: 'medium' },
  // Terrace: under the middle pendant (short: the cellar wall top is 3.5 m away).
  { x: 11, y: 2.65, z: -6.6, color: WARM, intensity: 14, range: 3.4, angle: 1.3 },
  { x: 13.4, y: 2.3, z: 3, color: WARM, intensity: 6, range: 5.2, point: true, tier: 'high' },
  // Doors: warm lamps on the cladding wash the wall and the doorstep.
  { x: 0, y: 2.5, z: 11.6, color: AMBER, intensity: 10, range: 5.5, point: true },
  { x: 0, y: 2.9, z: -11.55, color: AMBER, intensity: 7, range: 5.5, point: true },
  { x: -14.55, y: 2.9, z: 0, color: AMBER, intensity: 7, range: 5.5, point: true, tier: 'medium' },
  { x: 14.55, y: 2.75, z: 0, color: AMBER, intensity: 7, range: 5.5, point: true, tier: 'medium' },
  // Parking lamps (SPACE.props lamp heads): two of four still work, one
  // stutters. 7.5 m of range lights the facade, never the shop behind it.
  // The north-east lamp leans over the delivery van so its corner is never a blind pocket.
  { x: -9, y: 5.95, z: 16.65, color: SODIUM, intensity: 48, range: 7.5, angle: .9, tier: 'medium' },
  { x: 9, y: 5.95, z: 16.65, color: SODIUM, intensity: 40, range: 7.5, angle: .9, flicker: true, tier: 'medium' },
  { x: 15.15, y: 5.95, z: -13.8, color: SODIUM, intensity: 44, range: 7.5, angle: .9, tier: 'medium' },
].map(lamp => Object.freeze(lamp)));

export function lampsFor(quality) {
  const id = quality?.id ?? 'medium';
  return LAMPS.filter(lamp => !lamp.tier || (lamp.tier === 'medium' && id !== 'low') || (lamp.tier === 'high' && id === 'high'));
}

// Inside, the moon only reaches through doors and windows. Without shadow
// maps it would light every floor, cellar included, and wash out the pools,
// so its share follows the camera's zone, as an eye adapting to the dark.
export const INDOOR = Object.freeze({ moon: .3, ambient: 1.35, rate: 2.5,
  shop: { minX: -14, maxX: 7.9, minZ: -11, maxZ: 11, minY: -.3, maxY: 6.3 } });
export function indoorTarget(position) {
  if (!position) return 0;
  const { x, y, z } = position, shop = INDOOR.shop;
  if (y < shop.minY) return 1; // the cellar
  return x > shop.minX && x < shop.maxX && z > shop.minZ && z < shop.maxZ && y < shop.maxY ? 1 : 0;
}

const fract = value => value - Math.floor(value);
const unit = (slot, salt) => fract(Math.sin(slot * 78.233 + salt * 12.9898) * 43758.5453);
export const FLICKER = Object.freeze({ slot: 2.6, dip: .36, floor: .4 });
// A tired starter, never a strobe: in about half of the 2.6 s slots, two or
// three smooth sags of 0.36 s each (under three per second), never below
// 40 %. Reduced motion keeps the tube steady.
export function flickerLevel(time, reducedMotion = false) {
  if (reducedMotion || !Number.isFinite(time)) return 1;
  const slot = Math.floor(time / FLICKER.slot), within = time - slot * FLICKER.slot;
  const hum = .97 + .03 * Math.sin(time * 9);
  if (unit(slot, 0) > .5) return hum;
  const dips = 2 + Math.floor(unit(slot, 1) * 2), u = (within - (.2 + unit(slot, 2) * .6)) / FLICKER.dip;
  if (u < 0 || u >= dips) return hum;
  const depth = .35 + .25 * unit(slot, 3 + Math.floor(u));
  return 1 - depth * Math.sin(Math.PI * fract(u)) ** 2;
}
