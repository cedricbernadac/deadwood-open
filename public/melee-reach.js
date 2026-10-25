import { LEVEL, HAS_SPACE } from './level-config.js';
import { SPACE } from './level-space.js';
// Melee reach, shared by the server, which resolves every blow, and the client,
// which predicts it shortly before contact so that a swing that will miss
// never plays its recorded impact. meleeTargetPoint and meleeTargets are the
// server's own code; meleeWillLand and trackMotion are the client's lenient
// prediction from snapshots. The sight lines below mirror RoomSimulation's
// grenadeBlastVisible (walls, covers, loft, treads, stringers, roof, gables,
// planks and seals); test/melee-reach.test.mjs keeps them identical.
import { ARMORY, BARRICADE_BOARDS, LOFT, SEALED_DOOR_PLATE, armoryRackBounds } from './rules.js';
import { INTERIOR_WALLS, EXTERIOR_WALLS, EXTERIOR_WALL_THICKNESS, wallOpenings, PARTITION_CAPS, SOFA, coverPieces } from './layout.js';
import { STAIR_WELL, STAIR_STRINGERS, STAIR_TREADS } from './stairs.js';
import { GENERATOR_BOUNDS } from './expedition.js';
import { enemyHitbox } from './enemies.js';
import { playerHitbox } from './movement.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const meleeDirection = (yaw, pitch) => {
  const cosine = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cosine, y: Math.sin(pitch), z: -Math.cos(yaw) * cosine };
};

// visible(origin, point): the blow's line of sight to a candidate point.
// box: the body struck, an enemy's unless given (a teammate's, friendly fire).
export function meleeTargetPoint(origin, direction, zombie, profile, visible, box = enemyHitbox(zombie)) {
  const minY = box.minY + .01, maxY = box.maxY - .01;
  // Test the real body's near face, centre and corners. This lets a blade
  // reach an exposed edge without hitting through cover or beyond its reach.
  const coordinates = axis => [...new Set([clamp(origin[axis], box[`min${axis.toUpperCase()}`], box[`max${axis.toUpperCase()}`]),
    zombie[axis], box[`min${axis.toUpperCase()}`], box[`max${axis.toUpperCase()}`]])];
  let nearest = null;
  for (const x of coordinates('x')) for (const z of coordinates('z')) {
    const dx = x - origin.x, dz = z - origin.z, horizontalSquared = dx * dx + dz * dz;
    if (horizontalSquared > profile.range ** 2 + 1e-8) continue;
    const verticalReach = Math.sqrt(Math.max(0, profile.range ** 2 - horizontalSquared));
    const lower = Math.max(minY, origin.y - verticalReach), upper = Math.min(maxY, origin.y + verticalReach);
    if (lower > upper) continue;
    const horizontalDot = dx * direction.x + dz * direction.z;
    const alignment = y => (horizontalDot + (y - origin.y) * direction.y) / Math.max(1e-8, Math.hypot(dx, y - origin.y, dz));
    let y = alignment(lower) > alignment(upper) ? lower : upper;
    if (horizontalDot > 1e-8) {
      const optimum = clamp(origin.y + direction.y * horizontalSquared / horizontalDot, lower, upper);
      if (alignment(optimum) > alignment(y)) y = optimum;
    }
    const range = Math.hypot(dx, y - origin.y, dz), point = { x, y, z };
    if (range < 1e-8 || alignment(y) < Math.cos(profile.coneAngle / 2) - 1e-8
      || !visible(origin, point)) continue;
    if (!nearest || range < nearest.range) nearest = { ...point, range };
  }
  return nearest;
}

// The bodies a blow lands on, nearest first, at most profile.maxTargets:
// { zombie, point }, or { player, point } for a teammate in the swing when
// friendly fire is on (survivors: those it can hurt; none otherwise).
export function meleeTargets(origin, direction, profile, zombies, visible, survivors = []) {
  const targets = [...zombies].map(zombie => ({ zombie, point: meleeTargetPoint(origin, direction, zombie, profile, visible) }));
  for (const player of survivors) targets.push({ player, point: meleeTargetPoint(origin, direction, player, profile, visible, playerHitbox(player)) });
  const key = target => String((target.zombie ?? target.player).id);
  return targets.filter(target => target.point).sort((a, b) => a.point.range - b.point.range || key(a).localeCompare(key(b)))
    .slice(0, profile.maxTargets);
}

// The client's prediction leans towards a hit: a wrong "hit" only keeps the
// recorded impact, as before; a wrong "miss" would silence a blow that lands.
// reach and arc: margins for turns and steps during the windup; tick: the
// server resolves on the first 30 Hz tick at or after contact, up to two
// ticks after the event's time plus windup; horizon caps the extrapolation;
// a faster apparent motion between snapshots is a jump, not a velocity.
export const MELEE_PREDICTION = Object.freeze({ reach: .3, arc: Math.PI / 9, tick: 1 / 15, horizon: .5, maxSpeed: 8 });

// Horizontal velocity of each actor between its two latest snapshots. A
// same-time snapshot keeps the estimate; a gap, a jump or a restart resets it.
export function trackMotion(motion, actors, time) {
  const seen = new Set();
  for (const actor of actors ?? []) {
    if (actor?.id == null || !Number.isFinite(actor.x) || !Number.isFinite(actor.z)) continue;
    seen.add(actor.id);
    const last = motion.get(actor.id), dt = last && Number.isFinite(time) ? time - last.time : NaN;
    if (dt >= 0 && dt < .01) continue;
    let vx = 0, vz = 0;
    if (dt >= .01 && dt <= .25) {
      vx = (actor.x - last.x) / dt; vz = (actor.z - last.z) / dt;
      if (Math.hypot(vx, vz) > MELEE_PREDICTION.maxSpeed) vx = vz = 0;
    }
    motion.set(actor.id, { x: actor.x, z: actor.z, time, vx, vz });
  }
  for (const id of motion.keys()) if (!seen.has(id)) motion.delete(id);
  return motion;
}

// Will the blow land `horizon` seconds after the snapshot? The survivor and
// the bodies (optional vx, vz) are tried at the snapshot, at contact and at
// the last tick that can resolve it, with the margins above: any landing
// counts as a hit. survivors: teammates the blow can hurt (friendly fire).
export function meleeWillLand(origin, direction, profile, zombies, visible, horizon = 0, survivors = []) {
  const lenient = { ...profile, range: profile.range + MELEE_PREDICTION.reach, coneAngle: Math.min(2 * Math.PI, profile.coneAngle + MELEE_PREDICTION.arc) };
  const ahead = clamp(Number.isFinite(horizon) ? horizon : 0, 0, MELEE_PREDICTION.horizon);
  const at = (body, h) => ({ ...body, x: body.x + (Number.isFinite(body.vx) ? body.vx : 0) * h, z: body.z + (Number.isFinite(body.vz) ? body.vz : 0) * h });
  return [0, ahead, ahead + MELEE_PREDICTION.tick].some(h => {
    const eye = at(origin, h);
    if ([...zombies].some(zombie => meleeTargetPoint(eye, direction, at(zombie, h), lenient, visible))) return true;
    return survivors.some(player => { const body = at(player, h); return meleeTargetPoint(eye, direction, body, lenient, visible, playerHitbox(body)); });
  });
}

function rayBox(origin, direction, box, maxDistance) {
  let near = 0, far = maxDistance;
  for (const axis of ['x', 'y', 'z']) {
    const low = box[`min${axis.toUpperCase()}`], high = box[`max${axis.toUpperCase()}`];
    if (Math.abs(direction[axis]) < 1e-8) {
      if (origin[axis] < low || origin[axis] > high) return Infinity;
      continue;
    }
    const first = (low - origin[axis]) / direction[axis], second = (high - origin[axis]) / direction[axis];
    near = Math.max(near, Math.min(first, second));
    far = Math.min(far, Math.max(first, second));
    if (near > far) return Infinity;
  }
  if (box.cap) {
    const slope = (box.cap.lowY - box.cap.highY) / (box.maxZ - box.minZ);
    const offset = origin.y - box.cap.highY - slope * (origin.z - box.minZ);
    const velocity = direction.y - slope * direction.z;
    if (Math.abs(velocity) < 1e-8) { if (offset > 1e-8) return Infinity; }
    else if (velocity > 0) far = Math.min(far, -offset / velocity);
    else near = Math.max(near, -offset / velocity);
  }
  return near <= far && near <= maxDistance ? near : Infinity;
}

function rayBoard(origin, direction, door, board, maxDistance) {
  const yaw = Math.atan2(-door.outX, -door.outZ), cosine = Math.cos(yaw), sine = Math.sin(yaw);
  const rotateIntoBoard = (point, isDirection = false) => {
    const dx = point.x - (isDirection ? 0 : door.x), dz = point.z - (isDirection ? 0 : door.z);
    const x = cosine * dx - sine * dz, z = sine * dx + cosine * dz;
    const y = point.y - (isDirection ? 0 : board.y);
    const c = Math.cos(board.angle), s = Math.sin(board.angle);
    return { x: c * x + s * y, y: -s * x + c * y, z };
  };
  return rayBox(rotateIntoBoard(origin), rotateIntoBoard(direction, true), {
    minX: -board.width / 2, maxX: board.width / 2,
    minY: -board.height / 2, maxY: board.height / 2,
    minZ: -board.depth / 2, maxZ: board.depth / 2,
  }, maxDistance);
}

function stringerFrame(beam) {
  const c = Math.cos(beam.angle), s = Math.sin(beam.angle);
  return {
    box: { minX: -beam.width / 2, maxX: beam.width / 2, minY: -beam.height / 2, maxY: beam.height / 2, minZ: -beam.length / 2, maxZ: beam.length / 2 },
    into(point, vector = false) {
      const y = point.y - (vector ? 0 : beam.centerY), z = point.z - (vector ? 0 : beam.centerZ);
      return { x: point.x - (vector ? 0 : beam.x), y: c * y + s * z, z: -s * y + c * z };
    },
  };
}
function roofFrame(side) {
  if (HAS_SPACE) {
    const { bounds, height, thickness } = LEVEL.roof, centreY = height - thickness / 2;
    return {
      box: { ...bounds, minY: -thickness / 2, maxY: thickness / 2 },
      into(point, vector = false) { return { x: point.x, y: point.y - (vector ? 0 : centreY), z: point.z }; },
      out(vector) { return { ...vector }; },
    };
  }
  const angle = -side * .21, c = Math.cos(angle), s = Math.sin(angle);
  return {
    box: { minX: -8.65 / 2, maxX: 8.65 / 2, minY: -.12, maxY: .12, minZ: -6.5, maxZ: 6.5 },
    into(point, vector = false) {
      const x = point.x - (vector ? 0 : side * 4.15), y = point.y - (vector ? 0 : 7.32);
      return { x: c * x + s * y, y: -s * x + c * y, z: point.z };
    },
  };
}
const ORIENTED_SOLIDS = HAS_SPACE ? [roofFrame(0)] : [...STAIR_STRINGERS.map(stringerFrame), roofFrame(-1), roofFrame(1)];
function gableHit(origin, movement, z) {
  if (HAS_SPACE) return null;
  if (Math.abs(movement.z) < 1e-10) return null;
  const fraction = (z - origin.z) / movement.z;
  if (fraction < 0 || fraction > 1) return null;
  const x = origin.x + movement.x * fraction, y = origin.y + movement.y * fraction;
  const slope = 1.7 / 8;
  if (y < 6.5 || Math.abs(x) > 8 || y > 8.2 - slope * Math.abs(x)) return null;
  return { fraction };
}

// WORLD.covers and wallBoxes() of simulation.mjs.
export const SIGHT_COVERS = Object.freeze([
  ...INTERIOR_WALLS,
  SOFA,
  LEVEL.table,
  GENERATOR_BOUNDS,
  ...ARMORY.map(armoryRackBounds),
]);
function wallBoxes() {
  const boxes = [];
  if (HAS_SPACE) {
    boxes.push(...SPACE.boxes, ...SPACE.facadeSections);
    for (const cover of SIGHT_COVERS) for (const piece of coverPieces(cover))
      boxes.push({ ...piece, minY: cover.baseY ?? 0, maxY: (cover.baseY ?? 0) + piece.height });
    return boxes;
  }
  const half = EXTERIOR_WALL_THICKNESS / 2;
  for (const { id, axis, fixed, length } of EXTERIOR_WALLS) {
    const section = (min, max, minY, maxY) => {
      if (max <= min || maxY <= minY) return;
      boxes.push(axis === 'x'
        ? { minX: min, maxX: max, minY, maxY, minZ: fixed - half, maxZ: fixed + half }
        : { minX: fixed - half, maxX: fixed + half, minY, maxY, minZ: min, maxZ: max });
    };
    let cursor = -length / 2;
    for (const opening of wallOpenings(id)) {
      const min = opening.center - opening.width / 2, max = opening.center + opening.width / 2;
      section(cursor, min, 0, LEVEL.wallHeight);
      section(min, max, 0, opening.bottom);
      section(min, max, opening.top, LEVEL.wallHeight);
      cursor = max;
    }
    section(cursor, length / 2, 0, LEVEL.wallHeight);
  }
  const floorBottom = LOFT.y - LOFT.thickness;
  boxes.push({ minX: LOFT.minX, maxX: STAIR_WELL.minX, minY: floorBottom, maxY: LOFT.y, minZ: LOFT.minZ, maxZ: LOFT.maxZ });
  boxes.push({ minX: STAIR_WELL.maxX, maxX: LOFT.maxX, minY: floorBottom, maxY: LOFT.y, minZ: LOFT.minZ, maxZ: LOFT.maxZ });
  boxes.push({ minX: STAIR_WELL.minX, maxX: STAIR_WELL.maxX, minY: floorBottom, maxY: LOFT.y, minZ: LOFT.minZ, maxZ: STAIR_WELL.minZ });
  boxes.push({ minX: STAIR_WELL.minX, maxX: STAIR_WELL.maxX, minY: floorBottom, maxY: LOFT.y, minZ: STAIR_WELL.maxZ, maxZ: LOFT.maxZ });
  boxes.push(...STAIR_TREADS);
  for (const cover of SIGHT_COVERS) {
    const baseY = cover.baseY ?? 0;
    const cap = PARTITION_CAPS.find(cap => cap.layoutId === cover.id);
    if (cap) {
      boxes.push({ ...cover, minY: baseY, maxY: cap.baseY });
      boxes.push({ ...cap, id: `${cover.id}-cap`, minY: cap.baseY, maxY: cap.highY, cap });
    } else for (const piece of coverPieces(cover)) boxes.push({ ...piece, minY: baseY, maxY: baseY + piece.height });
  }
  return boxes;
}
const SIGHT_BOXES = wallBoxes();
function sealedDoorBox(door) {
  const { width, height, depth } = SEALED_DOOR_PLATE;
  const halfX = (door.outX ? depth : width) / 2, halfZ = (door.outZ ? depth : width) / 2;
  return { minX: door.x - halfX, maxX: door.x + halfX, minY: 0, maxY: height, minZ: door.z - halfZ, maxZ: door.z + halfZ };
}
// RoomSimulation.solidBoxes() for these doors.
export const sightBoxes = doors => SIGHT_BOXES.concat(doors.filter(door => door.sealed).map(sealedDoorBox));

// The four entrances of createDoors(); snapshots carry their planks and seals.
const DOOR_FACES = Object.freeze({ north: { outX: 0, outZ: -1 }, south: { outX: 0, outZ: 1 }, west: { outX: -1, outZ: 0 }, east: { outX: 1, outZ: 0 } });
export const sightDoors = doors => (doors ?? []).filter(door => DOOR_FACES[door?.id] && Array.isArray(door.boards))
  .map(door => ({ ...door, ...DOOR_FACES[door.id] }));

export function sightClear(origin, target, doors) {
  const direction = { x: target.x - origin.x, y: target.y - origin.y, z: target.z - origin.z };
  if (sightBoxes(doors).some(box => rayBox(origin, direction, box, 1) < 1 - 1e-6)) return false;
  if (ORIENTED_SOLIDS.some(frame => rayBox(frame.into(origin), frame.into(direction, true), frame.box, 1) < 1 - 1e-6)) return false;
  if ([-6, 6].some(z => { const hit = gableHit(origin, direction, z); return hit && hit.fraction < 1 - 1e-6; })) return false;
  return doors.every(door => BARRICADE_BOARDS.every(board => door.boards[board.index] <= 0
    || rayBoard(origin, direction, door, board, 1) >= 1 - 1e-6));
}
