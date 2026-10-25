import { LEVEL, HAS_SPACE } from '../level-config.js';
import { SPACE, spaceFloor } from '../level-space.js';
// Where Frisson blood comes to rest (art/frisson/DESIGN.md, blood part): the
// server's restingSurface (simulation.mjs) rebuilt from the shared layout,
// plus the solids a stain or a droplet must not cross. Plain numbers only:
// no THREE, and nothing is allocated per call. The loft rail is left out: an
// open balustrade a droplet may fly through.
import { INTERIOR_WALLS, SOFA, coverPieces, EXTERIOR_WALLS, EXTERIOR_WALL_THICKNESS, DOOR_OPENING, WINDOWS } from '../layout.js';
import { LOFT, ARMORY, armoryRackBounds, GENERATOR_BOUNDS, STAIRS, STAIR_WELL } from '../rules.js';

// The living-room table exists only in simulation.mjs WORLD.covers; a test
// keeps this copy, and the whole list, equal to the server's.
export const TABLE = LEVEL.table;
export const COVERS = Object.freeze([...INTERIOR_WALLS, SOFA, TABLE, GENERATOR_BOUNDS, ...ARMORY.map(armoryRackBounds)]);

const box = (minX, maxX, minZ, maxZ, bottom, top) => Object.freeze({ minX, maxX, minZ, maxZ, bottom, top });
// Furniture, walls and racks as boxes: their tops are surfaces.
export const COVER_BOXES = Object.freeze(COVERS.flatMap(cover => coverPieces(cover).map(piece =>
  box(piece.minX, piece.maxX, piece.minZ, piece.maxZ, cover.baseY ?? 0, (cover.baseY ?? 0) + piece.height))));
// The outer walls, full height, open under each doorway's lintel (boards
// and windows ignored: blood never flies out through a window).
const WALL_TOP = 12;
export const OUTER_WALL_BOXES = Object.freeze(HAS_SPACE ? SPACE.facadeSections.map(b => box(b.minX,b.maxX,b.minZ,b.maxZ,b.minY,b.maxY)) : EXTERIOR_WALLS.flatMap(wall => {
  const half = EXTERIOR_WALL_THICKNESS / 2, end = wall.length / 2;
  const door = [DOOR_OPENING.center - DOOR_OPENING.width / 2, DOOR_OPENING.center + DOOR_OPENING.width / 2];
  return [[-end, door[0], 0], [door[1], end, 0], [door[0], door[1], DOOR_OPENING.top]].map(([from, to, bottom]) => wall.axis === 'x'
    ? box(from, to, wall.fixed - half, wall.fixed + half, bottom, WALL_TOP)
    : box(wall.fixed - half, wall.fixed + half, from, to, bottom, WALL_TOP));
}));
const SOLIDS = Object.freeze([...COVER_BOXES, ...OUTER_WALL_BOXES, ...(HAS_SPACE ? [...SPACE.walls, ...SPACE.rails].map(b => box(b.minX,b.maxX,b.minZ,b.maxZ,b.baseY,b.baseY+b.height)) : [])]);
// For droplets in flight, the loft floor (a slab with the stair well cut out)
// and the sixteen treads over their nominal runs, so a tread's top is
// stairTreadY's height.
const loftSlab = (minX, maxX, minZ, maxZ) => box(minX, maxX, minZ, maxZ, LOFT.y - LOFT.thickness, LOFT.y);
export const LOFT_SLABS = Object.freeze(HAS_SPACE ? SPACE.slabs.map(b => box(b.minX,b.maxX,b.minZ,b.maxZ,b.minY,b.maxY)) : [
  loftSlab(LOFT.minX, STAIR_WELL.minX, LOFT.minZ, LOFT.maxZ), loftSlab(STAIR_WELL.maxX, LOFT.maxX, LOFT.minZ, LOFT.maxZ),
  loftSlab(STAIR_WELL.minX, STAIR_WELL.maxX, LOFT.minZ, STAIR_WELL.minZ), loftSlab(STAIR_WELL.minX, STAIR_WELL.maxX, STAIR_WELL.maxZ, LOFT.maxZ),
]);
const RUN = (STAIRS.maxZ - STAIRS.minZ) / STAIRS.steps, RISE = STAIRS.topY / STAIRS.steps;
export const TREAD_BOXES = Object.freeze(HAS_SPACE ? SPACE.treads.map(b => box(b.minX,b.maxX,b.minZ,b.maxZ,b.minY,b.maxY)) : Array.from({ length: STAIRS.steps }, (_, index) => box(STAIRS.minX, STAIRS.maxX,
  STAIRS.maxZ - (index + 1) * RUN, STAIRS.maxZ - index * RUN, (index + 1) * RISE - STAIRS.treadThickness, (index + 1) * RISE)));
export const ARC_SOLIDS = Object.freeze([...SOLIDS, ...LOFT_SLABS, ...TREAD_BOXES]);
// ARC_SOLIDS starts with the walls and the furniture: the solids blood may
// stick to (BLOOD-SPRAY.md 2.5). The loft's edges and the risers do not.
export const SOLID_COUNT = SOLIDS.length;
// The windows with their glass long gone (layout.js): a wall pixel never
// floats in one. Boarded windows are solid wood, part of the wall.
export const OPEN_WINDOWS = Object.freeze(WINDOWS.filter(window => window.open));
const WINDOW_REACH = .3;

const EPS = 1e-6;
const inRect = (x, z, rect) => x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
// stairTreadY (stairs.js), written out in restingSurfaceIO so no number
// crosses a call there; a test keeps restingSurface equal to the server's.
const STAIR_RUN = STAIRS.maxZ - STAIRS.minZ;

// Registers for the allocation-free callers (blood.js on every droplet): V8
// boxes a double handed to, or returned from, a function it does not inline,
// so the hot path writes its numbers here and calls the *IO functions, which
// read their inputs at once and write their answers here or in `out`.
//   0 x, 1 y, 2 z: every IO function's point (restingSurfaceIO reads y as fromY);
//   3 vx, 4 vy, 5 vz, 6 gravity, 7 half, 8 end: arcContactIO (squareRestsIO reads 7 as half);
//   9: restingSurfaceIO's answer; 10 low, 11 high: blockedAtIO.
// The public functions below are the same code behind these registers.
export const FLOOR_IO = new Float64Array(12);
const IO = FLOOR_IO;

// The highest floor, tread, loft or furniture top at (x, z) no higher than
// fromY: where a coin, a droplet or a stain pixel comes to rest.
export function restingSurfaceIO() {
  const x = IO[0], z = IO[2], limit = IO[1] + EPS;
  let best = HAS_SPACE ? spaceFloor(x,z,limit) : 0;
  if (!HAS_SPACE && x >= STAIRS.minX && x <= STAIRS.maxX && z >= STAIRS.minZ && z <= STAIRS.maxZ) {
    const along = (STAIRS.maxZ - z) / STAIR_RUN, share = along < 0 ? 0 : along > 1 ? 1 : along;
    const tread = Math.ceil(share * STAIRS.steps - 1e-8) * STAIRS.topY / STAIRS.steps;
    if (tread <= limit && tread > best) best = tread;
  }
  if (!HAS_SPACE && LOFT.y <= limit && LOFT.y > best && x >= LOFT.minX && x <= LOFT.maxX && z >= LOFT.minZ && z <= LOFT.maxZ
    && !(x >= STAIR_WELL.minX && x <= STAIR_WELL.maxX && z >= STAIR_WELL.minZ && z <= STAIR_WELL.maxZ)) best = LOFT.y;
  for (let index = 0; index < COVER_BOXES.length; index++) {
    const piece = COVER_BOXES[index], top = piece.top;
    if (top <= limit && top > best && x >= piece.minX && x <= piece.maxX && z >= piece.minZ && z <= piece.maxZ) best = top;
  }
  IO[9] = best;
}
export function restingSurface(x, z, fromY) {
  IO[0] = x; IO[1] = fromY; IO[2] = z;
  restingSurfaceIO();
  return IO[9];
}

// Is the column at (x, z) filled by a solid between heights low and high?
export function blockedAtIO() {
  const x = IO[0], z = IO[2], low = IO[10], high = IO[11];
  for (let index = 0; index < SOLIDS.length; index++) {
    const solid = SOLIDS[index];
    if (solid.bottom < high && solid.top > low && x >= solid.minX && x <= solid.maxX && z >= solid.minZ && z <= solid.maxZ) return true;
  }
  return false;
}
export function blockedAt(x, z, low, high) {
  IO[0] = x; IO[2] = z; IO[10] = low; IO[11] = high;
  return blockedAtIO();
}

// The share (0 to 1) of the flat path from (x0, z0) to (x1, z1) travelled
// before it enters a solid spanning heights low to high. A solid the path
// starts in is ignored: a body may stand in a doorway's jamb.
export function freeTravel(x0, z0, x1, z1, low, high) {
  const dx = x1 - x0, dz = z1 - z0;
  let travel = 1;
  for (let index = 0; index < SOLIDS.length; index++) {
    const solid = SOLIDS[index];
    if (solid.bottom >= high || solid.top <= low || inRect(x0, z0, solid)) continue;
    let enter = 0, leave = 1;
    if (Math.abs(dx) < 1e-9) { if (x0 < solid.minX || x0 > solid.maxX) continue; }
    else {
      let a = (solid.minX - x0) / dx, b = (solid.maxX - x0) / dx;
      if (a > b) { const swap = a; a = b; b = swap; }
      enter = Math.max(enter, a); leave = Math.min(leave, b);
    }
    if (Math.abs(dz) < 1e-9) { if (z0 < solid.minZ || z0 > solid.maxZ) continue; }
    else {
      let a = (solid.minZ - z0) / dz, b = (solid.maxZ - z0) / dz;
      if (a > b) { const swap = a; a = b; b = swap; }
      enter = Math.max(enter, a); leave = Math.min(leave, b);
    }
    if (enter <= leave && enter < travel) travel = enter;
  }
  return travel;
}

// Does a flat square (half-size `half`) centred on (x, z) lie whole on the
// surface at height y? Each corner, 1 mm in, must be over that very surface
// and clear of walls and furniture: nothing hangs over an edge or a riser.
export function squareRestsIO() {
  const x = IO[0], y = IO[1], z = IO[2], inset = IO[7] - .001;
  for (let corner = 0; corner < 4; corner++) {
    const cx = corner & 1 ? x + inset : x - inset, cz = corner & 2 ? z + inset : z - inset;
    IO[0] = cx; IO[1] = y + .05; IO[2] = cz;
    restingSurfaceIO();
    if (Math.abs(IO[9] - y) > EPS) return false;
    IO[10] = y + .05; IO[11] = y + .25;
    if (blockedAtIO()) return false;
  }
  return true;
}
export function squareRests(x, z, half, y) {
  IO[0] = x; IO[1] = y; IO[2] = z; IO[7] = half;
  return squareRestsIO();
}

// Is (x, y, z) in an open window of an outer wall: within .3 m of the wall's
// plane, inside the window's span and height (BLOOD-SPRAY.md 4.6)?
export function openWindowAtIO() {
  const x = IO[0], y = IO[1], z = IO[2];
  for (let index = 0; index < OPEN_WINDOWS.length; index++) {
    const window = OPEN_WINDOWS[index];
    if (y < window.bottom || y > window.top) continue;
    const across = window.axis === 'x' ? z : x, along = window.axis === 'x' ? x : z;
    if (Math.abs(across - window.fixed) <= WINDOW_REACH && Math.abs(along - window.center) <= window.width / 2) return true;
  }
  return false;
}
export function openWindowAt(x, y, z) {
  IO[0] = x; IO[1] = y; IO[2] = z;
  return openWindowAtIO();
}

// What a droplet's arc meets first: from (x, y, z), flat velocity (vx, vz),
// vertical vy under `gravity`, a cube of half-size `half`, until `end` (its
// landing on the ground). The cube touches a solid once its centre is within
// `half` of the footprint. Fills `out` (no allocation): kind NONE, TOP (comes
// down on that solid's top at out.time; its centre may then be up to `half`
// past an edge, out.minX..maxZ is the top to land on), SIDE (runs into it;
// out.enter is when, out.normalX/normalZ the face it meets: -1, 0 or 1, the
// face of the slab it entered last, or the side nearest a start beside it)
// or CEILING (rises into its underside; out.low is the highest its centre may
// go). out.bottom and out.top are the solid's, out.index its place in
// ARC_SOLIDS. A solid the droplet starts in is ignored, as in freeTravel; one
// it starts beside only counts if it heads into it.
export const CONTACT = Object.freeze({ NONE: 0, TOP: 1, SIDE: 2, CEILING: 3 });
export function arcContactIO(out) {
  const x = IO[0], y = IO[1], z = IO[2], vx = IO[3], vy = IO[4], vz = IO[5], gravity = IO[6], half = IO[7];
  out.kind = CONTACT.NONE; out.time = IO[8]; out.top = out.low = out.enter = out.bottom = 0; out.minX = out.maxX = out.minZ = out.maxZ = 0;
  out.normalX = out.normalZ = 0; out.index = -1;
  const apex = vy > 0 ? y + vy * vy / (2 * gravity) : y;
  for (let index = 0; index < ARC_SOLIDS.length; index++) {
    const solid = ARC_SOLIDS[index], bottom = solid.bottom, top = solid.top, low = bottom - half, high = top + half;
    if (apex <= low) continue;
    const sMinX = solid.minX, sMaxX = solid.maxX, sMinZ = solid.minZ, sMaxZ = solid.maxZ;
    const beside = y > low && y < high && x > sMinX - half && x < sMaxX + half && z > sMinZ - half && z < sMaxZ + half;
    if (beside && x > sMinX && x < sMaxX && z > sMinZ && z < sMaxZ) continue;
    // When the cube is over the solid's footprint...
    const pad = beside ? 0 : half, minX = sMinX - pad, maxX = sMaxX + pad, minZ = sMinZ - pad, maxZ = sMaxZ + pad;
    let enter = 0, leave = out.time, axis = 0;
    if (Math.abs(vx) < 1e-9) { if (x < minX || x > maxX) continue; }
    else {
      let a = (minX - x) / vx, b = (maxX - x) / vx;
      if (a > b) { const swap = a; a = b; b = swap; }
      if (a > enter) { enter = a; axis = 1; } if (b < leave) leave = b;
    }
    if (Math.abs(vz) < 1e-9) { if (z < minZ || z > maxZ) continue; }
    else {
      let a = (minZ - z) / vz, b = (maxZ - z) / vz;
      if (a > b) { const swap = a; a = b; b = swap; }
      if (a > enter) { enter = a; axis = 2; } if (b < leave) leave = b;
    }
    if (enter > leave) continue;
    // ...and above its underside (the arc is above `low` between two roots).
    const reach = Math.sqrt(Math.max(0, vy * vy + 2 * gravity * (y - low)));
    const rise = (vy - reach) / gravity, from = Math.max(enter, rise), to = Math.min(leave, (vy + reach) / gravity);
    if (from > to) continue;
    let time, kind;
    if (y + vy * from - gravity * from * from / 2 < high) { time = from; kind = rise > enter ? CONTACT.CEILING : CONTACT.SIDE; }
    else {
      // Over the top at first: it comes down on it, or clears it.
      time = (vy + Math.sqrt(Math.max(0, vy * vy + 2 * gravity * (y - high)))) / gravity; kind = CONTACT.TOP;
      if (time > to) continue;
    }
    if (time < out.time || out.kind === CONTACT.NONE) {
      out.kind = kind; out.time = time; out.top = top; out.low = low; out.enter = enter; out.bottom = bottom;
      out.minX = sMinX; out.maxX = sMaxX; out.minZ = sMinZ; out.maxZ = sMaxZ; out.index = index;
      // The face: of the slab it entered last, or the side nearest a start beside it.
      const outX = x < sMinX ? sMinX - x : x > sMaxX ? x - sMaxX : -1, outZ = z < sMinZ ? sMinZ - z : z > sMaxZ ? z - sMaxZ : -1;
      const alongX = axis === 1 || axis === 0 && outX >= outZ;
      const sign = axis === 1 ? (vx > 0 ? -1 : 1) : axis === 2 ? (vz > 0 ? -1 : 1) : alongX ? (x < sMinX ? -1 : 1) : (z < sMinZ ? -1 : 1);
      out.normalX = alongX ? sign : 0; out.normalZ = alongX ? 0 : sign;
    }
  }
  return out;
}
export function arcContact(x, y, z, vx, vy, vz, gravity, half, end, out) {
  IO[0] = x; IO[1] = y; IO[2] = z; IO[3] = vx; IO[4] = vy; IO[5] = vz; IO[6] = gravity; IO[7] = half; IO[8] = end;
  return arcContactIO(out);
}
