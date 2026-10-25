// The same sixteen treads define the rendered staircase and server surfaces.
export const STAIRS = Object.freeze({
  minX: 3, maxX: 4.6, minZ: -2, maxZ: 2.5, topY: 3.4,
  steps: 16, treadThickness: .2, treadOverlap: .02,
});
// Extra head/shoulder clearance beside the treads prevents climbing into the
// loft slab. The opening is shared by the floor meshes and the simulation.
export const STAIR_WELL = Object.freeze({
  minX: STAIRS.minX - .3, maxX: STAIRS.maxX + .3,
  minZ: STAIRS.minZ, maxZ: STAIRS.maxZ,
});
const length = STAIRS.maxZ - STAIRS.minZ;
const depth = length / STAIRS.steps;
// Stop the upper end 10 cm before the landing. A rotated square beam with
// its centerline ending at the landing would protrude above the floor.
export const STAIR_STRINGERS = Object.freeze([STAIRS.minX + .04, STAIRS.maxX - .04].map(x => {
  const minZ = STAIRS.minZ + .1, maxZ = STAIRS.maxZ, run = maxZ - minZ;
  const centerZ = (minZ + maxZ) / 2, rise = run * STAIRS.topY / length;
  return Object.freeze({
    x, minZ, maxZ, run, centerY: (STAIRS.maxZ - centerZ) * STAIRS.topY / length - .02, centerZ,
    width: .13, height: .17, length: Math.hypot(run, rise), angle: Math.atan2(rise, run),
  });
}));
const clamp01 = value => Math.max(0, Math.min(1, value));
export const stairRampY = z => clamp01((STAIRS.maxZ - z) / length) * STAIRS.topY;
export const stairTreadY = z => Math.ceil(clamp01((STAIRS.maxZ - z) / length) * STAIRS.steps - 1e-8) * STAIRS.topY / STAIRS.steps;
export const STAIR_TREADS = Object.freeze(Array.from({ length: STAIRS.steps }, (_, index) => {
  const top = (index + 1) * STAIRS.topY / STAIRS.steps;
  const centerZ = STAIRS.maxZ - (index + .5) * depth;
  return Object.freeze({ minX: STAIRS.minX, maxX: STAIRS.maxX, minY: top - STAIRS.treadThickness, maxY: top, minZ: centerZ - (depth + STAIRS.treadOverlap) / 2, maxZ: centerZ + (depth + STAIRS.treadOverlap) / 2 });
}));
// The first and last rendered treads extend 1 cm beyond the nominal run.
// Their end lips must support a foot as well as obstruct its head.
export const STAIR_CONTACT = Object.freeze({ minX: STAIRS.minX, maxX: STAIRS.maxX,
  minZ: STAIR_TREADS.at(-1).minZ, maxZ: STAIR_TREADS[0].maxZ });
export const stairContactY = z => z >= STAIRS.maxZ ? STAIRS.topY / STAIRS.steps : stairTreadY(z);

function stringerVerticalBounds(x, z, radius, beam) {
  // The body footprint is a circle. Beside a thin stringer its forward reach
  // is smaller than the full radius; a square footprint invents a high lip.
  const distanceX = Math.max(0, Math.abs(x - beam.x) - beam.width / 2);
  if (distanceX > radius) return null;
  const reachZ = Math.sqrt(Math.max(0, radius * radius - distanceX * distanceX));
  const slope = STAIRS.topY / length, cosine = length / Math.hypot(length, STAIRS.topY);
  const halfHeight = beam.height / 2 / cosine;
  const halfDepth = beam.run / 2 + beam.height / 2 * Math.sqrt(1 - cosine * cosine);
  const { centerZ, centerY } = beam;
  if (z + reachZ < centerZ - halfDepth || z - reachZ > centerZ + halfDepth) return null;
  const downhill = Math.min(z + reachZ, centerZ + halfDepth), uphill = Math.max(z - reachZ, centerZ - halfDepth);
  const extent = beam.length / 2 * Math.sin(beam.angle) + beam.height / 2 * Math.cos(beam.angle);
  return {
    bottom: Math.max(centerY - extent, centerY - slope * (downhill - centerZ) - halfHeight),
    top: Math.min(centerY + extent, centerY - slope * (uphill - centerZ) + halfHeight),
  };
}

// A foot can step onto the exposed outer edge of a stringer before leaving
// the flight. This thin support must not turn into a wall or an absent floor.
export function stairStringerSurface(x, z, radius = .25) {
  return Math.max(-Infinity, ...STAIR_STRINGERS.map(beam => stringerVerticalBounds(x, z, radius, beam)?.top ?? -Infinity));
}

// Lowest underside over a body's footprint. Side stringers are thin sloping
// beams, not a solid wall filling the space from the floor to the stairs.
export function stairCeiling(x, z, feetY = 0, radius = .25) {
  let ceiling = Infinity;
  for (const tread of STAIR_TREADS) {
    if (x + radius >= tread.minX && x - radius <= tread.maxX && z + radius >= tread.minZ && z - radius <= tread.maxZ && feetY < tread.maxY - 1e-6) ceiling = Math.min(ceiling, tread.minY);
  }
  for (const beam of STAIR_STRINGERS) {
    const bounds = stringerVerticalBounds(x, z, radius, beam);
    if (!bounds) continue;
    // The sloping faces stop at the finite end caps; extrapolating them
    // through those caps creates an invisible lip above the upper landing.
    if (feetY < bounds.top - 1e-6) ceiling = Math.min(ceiling, bounds.bottom);
  }
  return ceiling;
}
