import { LEVEL, HAS_SPACE } from './level-config.js';
// A short central screen shelters the living room from the north entry.
// Both ends stay open, without jambs or overhead lintels. The loft stays open.
// The rendered meshes, body collisions, bullets and navigation share these bounds.
const WALL_THICKNESS = .24;

function bounds(axis, fixed, min, max, baseY, height) {
  return axis === 'x'
    ? { minX: min, maxX: max, minZ: fixed - WALL_THICKNESS / 2, maxZ: fixed + WALL_THICKNESS / 2, baseY, height }
    : { minX: fixed - WALL_THICKNESS / 2, maxX: fixed + WALL_THICKNESS / 2, minZ: min, maxZ: max, baseY, height };
}

export const INTERIOR_WALLS = HAS_SPACE ? LEVEL.furniture : Object.freeze([
  Object.freeze({ id: 'rear-front-panel-end', kind: 'partition', axis: 'x', ...bounds('x', -2, -3.3, 2.1, 0, 3.05) }),
  // Waist-high cover remains freely accessible around both ends.
  Object.freeze({ id: 'living-low-wall', kind: 'low-cover', axis: 'z', ...bounds('z', .9, 2.7, 4.5, 0, 1.15) }),
]);
// The living-room sofa (owner, 13 October): a seat, two arms and a back that
// a survivor can jump onto from any side (a jump clears 0.87 m); from the seat
// an arm is a step and the back a small jump. The back stays under a crawler's
// height (.82), so every zombie can still bite a survivor standing on it. Zombies still walk around its
// whole footprint (the cover box); bodies, feet, bullets and dropped items
// use the pieces. The rendered sofa matches these heights.
const sofaPiece = (part, minX, maxX, minZ, maxZ, height) => Object.freeze({ id: 'sofa', part, minX, maxX, minZ, maxZ, height });
export const SOFA = HAS_SPACE ? LEVEL.sofa : Object.freeze({
  id: 'sofa', minX: -6, maxX: -3.2, minZ: 2.4, maxZ: 3.5, height: .8,
  parts: Object.freeze([
    sofaPiece('seat', -5.7, -3.5, 2.4, 3.2, .48),
    sofaPiece('back', -6, -3.2, 3.2, 3.5, .8),
    sofaPiece('arm-west', -6, -5.7, 2.4, 3.2, .72),
    sofaPiece('arm-east', -3.5, -3.2, 2.4, 3.2, .72),
  ]),
});
// The solid pieces of a cover: the cover itself unless it has parts.
export const coverPieces = cover => cover.parts ?? [cover];
// A pitched wooden cap keeps the screen's original silhouette but gives its
// narrow upper edge no stable foothold. North is high; it sheds rain south.
export const PARTITION_CAPS = HAS_SPACE ? Object.freeze([]) : Object.freeze([
  Object.freeze({ layoutId: 'rear-front-panel-end', minX: -3.3, maxX: 2.1,
    minZ: -2.12, maxZ: -1.88, baseY: 2.75, highY: 3.05, lowY: 2.75 }),
]);
export function partitionCapHeight(cap, z) {
  const fraction = Math.max(0, Math.min(1, (z - cap.minZ) / (cap.maxZ - cap.minZ)));
  return cap.highY + (cap.lowY - cap.highY) * fraction;
}
// Highest contact beneath a round footprint, including at either end of the
// screen. Rendering, body contact and the slide share the same sloped surface.
export function partitionCapSupport(cap, x, z, radius = 0) {
  const dx = Math.max(cap.minX - x, 0, x - cap.maxX);
  if (dx > radius) return -Infinity;
  const reach = Math.sqrt(Math.max(0, radius * radius - dx * dx));
  if (z + reach < cap.minZ || z - reach > cap.maxZ) return -Infinity;
  return partitionCapHeight(cap, Math.max(cap.minZ, z - reach));
}
// Outer walls, their barricaded doorway and their windows. Shared by the
// rendered walls and the authoritative solids (bullets, grenades, flames).
export const EXTERIOR_WALL_THICKNESS = .27;
export const EXTERIOR_WALLS = Object.freeze([
  Object.freeze({ id: 'north', axis: 'x', fixed: -LEVEL.halfDepth, length: LEVEL.width, rotation: 0 }),
  Object.freeze({ id: 'south', axis: 'x', fixed: LEVEL.halfDepth, length: LEVEL.width, rotation: Math.PI }),
  Object.freeze({ id: 'west', axis: 'z', fixed: -LEVEL.halfWidth, length: LEVEL.depth, rotation: Math.PI / 2 }),
  Object.freeze({ id: 'east', axis: 'z', fixed: LEVEL.halfWidth, length: LEVEL.depth, rotation: -Math.PI / 2 }),
]);
export const DOOR_OPENING = Object.freeze({ center: 0, width: 2.6, bottom: 0, top: 2.8 });
// Pinwheel: each wall keeps one window with its glass long gone, and each
// corner has exactly one. The other four are nailed shut and fully solid.
export const WINDOWS = Object.freeze([
  ['north', -4.8, true], ['north', 4.8, false], ['west', 3.5, true], ['west', -3.5, false],
  ['south', 4.8, true], ['south', -4.8, false], ['east', -3.5, true], ['east', 3.5, false],
].map(([wall, center, open]) => {
  const { axis, fixed } = EXTERIOR_WALLS.find(item => item.id === wall);
  if (HAS_SPACE) center *= axis === 'x' ? LEVEL.halfWidth / 8 : LEVEL.halfDepth / 6;
  return Object.freeze({ id: `${wall}${center < 0 ? '-a' : '-b'}`, wall, axis, fixed, center, width: 1.9, bottom: 1.15, top: 2.65, open });
}));
// The doorway plus the windows of one wall, ordered along it. Boarded windows
// are only returned for decoration; for solids they are part of the wall.
export function wallOpenings(wallId, { includeBoarded = false } = {}) {
  return [{ ...DOOR_OPENING, door: true, open: true },
    ...WINDOWS.filter(window => window.wall === wallId && (includeBoarded || window.open))]
    .sort((a, b) => a.center - b.center);
}
// No framed interior doors: the broad side passages have no trim or lintel.
export const INTERIOR_DOORWAYS = Object.freeze([]);
export const INTERIOR_PASSAGES = HAS_SPACE ? Object.freeze([]) : Object.freeze([
  Object.freeze({ id: 'rear-west', axis: 'x', ...bounds('x', -2, -7.85, -3.3, 0, 3.05) }),
  Object.freeze({ id: 'rear-east', axis: 'x', ...bounds('x', -2, 2.1, 7.85, 0, 3.05) }),
]);
