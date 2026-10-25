import { LEVEL, IS_SUPERMARKET, IS_HOSPITAL, IS_FUNFAIR, HAS_SPACE } from './public/level-config.js';
import { SPACE, spaceFloor, spaceFlightAt, spaceFlightHolding, spaceWaypoint, spaceCeiling, spaceCanOccupy, spaceWallHeight } from './public/level-space.js';
import { blastDamageAtDistance, flameFalloff } from './public/area-damage.js';
import { ARMORY, ARMORY_REACH, ARMORY_HEIGHT_REACH, STARTER_WEAPON, MAX_WAVES, waveBalance, defendedDoorIds, EXTERIOR, BARRICADE_BOARDS, SEALED_DOOR_PLATE, WEAPON_MOVEMENT, MAX_WEAPON_SLOTS, PICKUPS, FIRE_INTERVALS, ECONOMY, killCash, KILL_CHAIN, MINIGUN_AMMO, MINIGUN_TIMING, fireTolerance, NEXT_WAVE_CALL, DIFFICULTY_LEVELS, difficultyOf, FRIENDLY_FIRE_LEVELS, friendlyFireScale, friendlyFireAllowed, supplyCadence, REVIVE, COIN_GIFT, COMPANION_SHARE, ambianceOf, isFrissonLike } from './public/rules.js';
import { INTERIOR_WALLS, EXTERIOR_WALLS, EXTERIOR_WALL_THICKNESS, wallOpenings, PARTITION_CAPS, partitionCapSupport, SOFA, coverPieces } from './public/layout.js';
import { PLAYER_POSTURE, LOFT_RAIL, fallDamage, playerHeight, playerEyeHeight, playerHitbox } from './public/movement.js';
import { enemyProfile, enemyPosture, enemyVariant, enemyHitbox, enemyHeadshot, enemyDamageMultiplier, enemyHealth, enemyAppearance } from './public/enemies.js';
import { STAIRS, STAIR_WELL, STAIR_STRINGERS, STAIR_TREADS, STAIR_CONTACT, stairContactY, stairRampY as stairY, stairTreadY as stairStepY, stairCeiling, stairStringerSurface } from './public/stairs.js';
import { GROUND_WEAPONS, GROUND_WEAPON_BOUNDS, LOFT, armoryRackBounds } from './public/rules.js';
import { GRENADES, grenadeDropsForWave, FLAMETHROWER, ROCKET, MELEE, MELEE_WEAPONS, MAGNUM_BOSS_DAMAGE, ARMOR, REVIVE_SCORE_FLOOR } from './public/rules.js';
import { EXPEDITION, UMBRELLA, GENERATOR, GENERATOR_BOUNDS, FUEL_CACHES, SPAWN_ENTRIES, FAR_SPAWN_ENTRIES, farSpawnShare, SPAWN_WARNING, rainExposed, generatorPower } from './public/expedition.js';
import { longRangeFalloff, penetrationMultiplier, BALLISTICS, MIN_BULLET_DAMAGE, physicalWeaponProfile, ballisticPosition, ballisticDistance, ballisticVelocity, ballisticForwardSpeed, bulletDamageAtAge } from './public/ballistics.js';
import { BACKPACK, MAX_BONUS_LEVEL, upgradedWeapon } from './public/weapon-upgrades.js';
import { supplyMethods } from './supply.mjs';
import { installSaveGame } from './save-game.mjs';
import { weaponType, weaponEntries, activeWeaponId, resolveWeaponId, weaponStock } from './public/weapon-inventory.js';
import { characterStats } from './public/character-bonuses.js';
import { normalizeSheet, innateDebt, STANDARD_SHEET } from './public/character-sheet.js';
import { createRaiderMethods } from './raiders.mjs';
import { meleeDirection, meleeTargetPoint as reachPoint, meleeTargets } from './public/melee-reach.js';

export const TICK_RATE = 30;
export const EXTRACTION_DURATION = 12;
export const MINIGUN_WINDUP = MINIGUN_TIMING.windup;
const FROZEN_PHASES = ['extraction', 'victory', 'gameover'];
const PAUSABLE_PHASES = ['countdown', 'wave', 'intermission', 'extraction'];
export const WORLD = Object.freeze({
  width: LEVEL.width, depth: LEVEL.depth, loftY: LOFT.y, eyeHeight: 1.55,
  bounds: LEVEL.insideBounds,
  stair: STAIRS,
  loft: LOFT,
  armory: ARMORY,
  covers: [
    ...INTERIOR_WALLS,
    SOFA,
    LEVEL.table,
    GENERATOR_BOUNDS,
    ...ARMORY.map(armoryRackBounds),
  ],
});

// Uniform distance band for damage calibration, anchored separately at 10 m.
export const ENGAGEMENT_BAND = Object.freeze([0, 30]);
export function damageFalloff(weapon, distance) {
  return longRangeFalloff(weapon, distance);
}

const weaponDefinitions = {
  pistol: { name: 'Pistolet', magazine: 12, reserve: 36, interval: FIRE_INTERVALS.pistol, reloadTime: 1.25, pellets: 1, spread: .016, penetrationTargets: 1 },
  rifle: { name: 'Mitrailleuse', magazine: 30, reserve: 90, interval: FIRE_INTERVALS.rifle, reloadTime: 1.65, pellets: 1, spread: 0.008, penetrationTargets: 3 },
  shotgun: { name: 'Fusil à pompe', magazine: 8, reserve: 24, interval: FIRE_INTERVALS.shotgun, reloadTime: 2.4, pellets: 9, spread: 0.11, penetrationTargets: 2 },
  smg: { name: 'Pistolet-mitrailleur', magazine: 40, reserve: 120, interval: FIRE_INTERVALS.smg, reloadTime: 1.5, pellets: 1, spread: 0.025, penetrationTargets: 2 },
  minigun: { name: 'Minigun', ...MINIGUN_AMMO, interval: FIRE_INTERVALS.minigun, reloadTime: 3.4, pellets: 1, spread: 0.025, penetrationTargets: 4 },
  // Unique supply and bonus eligibility remain independent of impact damage.
  magnum: { name: 'Magnum doré', magazine: 6, reserve: 0, interval: FIRE_INTERVALS.magnum, reloadTime: 2.7, pellets: 1, spread: 0.002, penetrationTargets: 1, upgradeExempt: true },
  assault: { name: 'Fusil d’assaut', magazine: 24, reserve: 72, interval: FIRE_INTERVALS.assault, reloadTime: 1.6, pellets: 1, spread: .006, penetrationTargets: 2 },
  rocket: { name: 'Lance-roquettes', magazine: 1, reserve: 2, damage: ROCKET.damage, interval: FIRE_INTERVALS.rocket, reloadTime: 2.8, range: 60, pellets: 1, spread: 0, penetrationTargets: 1, penetrationRetention: 1, explosive: true, ...ROCKET },
  flamethrower: { name: 'Lance-flammes', magazine: 80, reserve: 40, damage: FLAMETHROWER.contactDps * FIRE_INTERVALS.flamethrower, interval: FIRE_INTERVALS.flamethrower, reloadTime: 3, pellets: 1, spread: 0, penetrationTargets: 1, penetrationRetention: 1, fuel: true, ...FLAMETHROWER },
  katana: { name: 'Katana', melee: true, magazine: 0, reserve: 0, damage: MELEE.light.damage, interval: FIRE_INTERVALS.katana, reloadTime: 0, range: MELEE.light.range, pellets: 0, spread: 0, penetrationTargets: MELEE.maxTargets, penetrationRetention: MELEE.retention, attacks: { light: MELEE.light, heavy: MELEE.heavy } },
  hammer: { name: 'Masse à pointes', melee: true, magazine: 0, reserve: 0, damage: 300, interval: FIRE_INTERVALS.hammer, reloadTime: 0, range: 1.8, pellets: 0, spread: 0, penetrationTargets: 2, penetrationRetention: .5, attacks: { light: MELEE_WEAPONS.hammer.light, heavy: MELEE_WEAPONS.hammer.heavy }, pushMultiplier: 2 },
  sniper: { name: 'Fusil à verrou', magazine: 5, reserve: 10, interval: FIRE_INTERVALS.sniper, reloadTime: 3, pellets: 1, spread: .001, penetrationTargets: 6 },
  bat: { name: 'Batte en bois', melee: true, magazine: 0, reserve: 0, damage: MELEE_WEAPONS.bat.light.damage, interval: FIRE_INTERVALS.bat, reloadTime: 0, range: MELEE_WEAPONS.bat.light.range, pellets: 0, spread: 0, penetrationTargets: 1, penetrationRetention: 1, attacks: { light: MELEE_WEAPONS.bat.light, heavy: MELEE_WEAPONS.bat.heavy } },
  fireaxe: { name: 'Hache de pompier', melee: true, magazine: 0, reserve: 0, damage: MELEE_WEAPONS.fireaxe.light.damage, interval: FIRE_INTERVALS.fireaxe, reloadTime: 0, range: MELEE_WEAPONS.fireaxe.light.range, pellets: 0, spread: 0, penetrationTargets: MELEE_WEAPONS.fireaxe.maxTargets, penetrationRetention: MELEE_WEAPONS.fireaxe.retention, attacks: { light: MELEE_WEAPONS.fireaxe.light, heavy: MELEE_WEAPONS.fireaxe.heavy } },
};
export const WEAPONS = Object.freeze(Object.fromEntries(Object.entries(weaponDefinitions)
  .map(([id, profile]) => [id, physicalWeaponProfile(profile, id)])));

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const milli = value => Math.round(value * 1000) / 1000;
const centi = value => Math.round(value * 100) / 100;
// Impact numbers: burns in at most four batches a second, and at most this
// many records per survivor and per tick (a screen shows twelve at once).
const BURN_DAMAGE_INTERVAL = .25, IMPACT_NUMBER_BATCH = 16;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const inRect = (x, z, rect, margin = 0) => x >= rect.minX - margin && x <= rect.maxX + margin && z >= rect.minZ - margin && z <= rect.maxZ + margin;
const isStair = (x, z) => HAS_SPACE ? SPACE.flights.some(f=>inRect(x,z,f)) : inRect(x, z, WORLD.stair);
// Players stand on the same sixteen treads that public/world.js renders.
const PLAYER_RADIUS = 0.25, PLAYER_HEIGHT = PLAYER_POSTURE.standingHeight, STEP_HEIGHT = 0.24;
const GRAVITY = 18, JUMP_SPEED = 5.6, PLAYER_MOTION_SMOOTHING = .4;
const loftRailBounds = Object.freeze({ minX: LOFT.minX - LOFT_RAIL.thickness / 2, maxX: LOFT.minX + LOFT_RAIL.thickness / 2,
  minZ: LOFT.minZ + LOFT_RAIL.endInset - LOFT_RAIL.thickness / 2, maxZ: LOFT.maxZ - LOFT_RAIL.endInset + LOFT_RAIL.thickness / 2 });
const hasLoftFloor = (x, z, radius = PLAYER_RADIUS) => inRect(x, z, WORLD.loft, radius)
  && !inRect(x, z, STAIR_WELL, -radius);
const overlapsLoftSlab = (x, z, y, height, radius = PLAYER_RADIUS) => hasLoftFloor(x, z, radius)
  && y < WORLD.loftY - 1e-6 && y + height > WORLD.loftY - LOFT.thickness + 1e-6;
const wellClearancePenalty = (x, z, radius = PLAYER_RADIUS) =>
  Math.max(0, STAIR_WELL.minX + radius - x, x - STAIR_WELL.maxX + radius)
  + Math.max(0, STAIR_WELL.minZ + radius - z, z - STAIR_WELL.maxZ + radius);
const leavesLoftPenetration = (player, x, z, y) => overlapsLoftSlab(player.x, player.z, player.y, playerHeight(player))
  && y <= player.y + 1e-6
  && wellClearancePenalty(x, z) < wellClearancePenalty(player.x, player.z) - 1e-6;
const normalizeAngle = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const validWeapon = weapon => typeof weapon === 'string' && Object.hasOwn(WEAPONS, weapon);
const outsideCabin = (x,z) => Math.abs(x)>WORLD.width/2 || Math.abs(z)>WORLD.depth/2;
const HAZARD_PHASES = ['wave','countdown','intermission'];
// Per-instance handling clocks. Inventory stock remains the sole owner of
// ammunition; dual wield never creates or copies a gun or its ammunition.
const HAND_CLOCKS = ['shotAfter', 'switchUntil', 'reloadUntil', 'reloadDuration', 'minigunSpinning', 'minigunSpinUntil'];
const handClockCopy = state => Object.fromEntries(HAND_CLOCKS.map(key => [key, state?.[key] ?? (key === 'minigunSpinning' ? false : 0)]));
const PUSH_DURATION = .26, PUSH_DECAY = .04, PUSH_DISTANCE = .35, PUSH_PER_DAMAGE = .0033;
// Zombie bodies keep their own space. A blocked zombie spills sideways around
// whoever is in its way; a long jam at one entrance sends it to another one.
const ZOMBIE_RADIUS = .29, CROWD_HEIGHT = 1.2, SEPARATION_SPEED = 1.2;
const SIDESTEP_ANGLES = [.55, 1, 1.45, 1.8];
const DOOR_CROWD_RADIUS = 2.6, DOOR_CROWD_PENALTY = 2.2, DOOR_SWITCH_AFTER = 3.5, DOOR_SWITCH_MARGIN = 2;
// Hospital (owner, 24 October): a zombie outside takes an open door only when
// its walked route is at most this many metres longer than the route to the
// nearest door; otherwise it attacks the nearest door's boards. A body bound
// for closed boards looks again for a worthwhile open door once a second.
const HOSPITAL_DOOR_DETOUR = 15, HOSPITAL_DOOR_REVIEW = 1;
// The next of a body's review beats after `time`: once a second, at an offset
// within the second taken from its id (golden-ratio spread, so consecutive
// ids land far apart). A crowd held at boards then measures its walked
// routes (4 per look) over the second's ticks instead of all on one tick.
function doorReviewBeat(zombie, time) {
  let hash = 0;
  for (const char of String(zombie.id)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const phase = (hash * .6180339887 % 1) * HOSPITAL_DOOR_REVIEW;
  return phase + HOSPITAL_DOOR_REVIEW * (Math.floor((time - phase) / HOSPITAL_DOOR_REVIEW) + 1);
}
const bodyRadius = zombie => ZOMBIE_RADIUS * (zombie.scale ?? 1);
// A bigger body keeps its centre further away: its arms reach as far beyond
// it as a walker's do. A survivor in the middle of the table or leaning on the
// sofa back is within a brute's or the boss's reach.
const meleeReach = zombie => .92 + Math.max(0, bodyRadius(zombie) - ZOMBIE_RADIUS);

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

function orientedBoxIntersects(centre, axes, half, box) {
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const world = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }];
  const boxCentre = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2, z: (box.minZ + box.maxZ) / 2 };
  const boxHalf = [(box.maxX - box.minX) / 2, (box.maxY - box.minY) / 2, (box.maxZ - box.minZ) / 2];
  const offset = { x: centre.x - boxCentre.x, y: centre.y - boxCentre.y, z: centre.z - boxCentre.z };
  const separating = [...world, ...axes, ...world.flatMap(first => axes.map(second => cross(first, second)))];
  return separating.every(axis => {
    const norm = Math.hypot(axis.x, axis.y, axis.z);
    if (norm < 1e-8) return true;
    const extent = half.reduce((sum, value, index) => sum + value * Math.abs(dot(axes[index], axis)), 0)
      + boxHalf.reduce((sum, value, index) => sum + value * Math.abs(dot(world[index], axis)), 0);
    return Math.abs(dot(offset, axis)) < extent - 1e-6 * norm;
  });
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

// Swept finite segments, rather than endpoint occupancy, prevent a fast
// grenade crossing a thin board or a tread at either 30 Hz or 10 Hz.
function sweptBox(origin, movement, box, radius = 0) {
  let near = 0, far = 1, normal = null;
  for (const axis of ['x', 'y', 'z']) {
    const low = box[`min${axis.toUpperCase()}`] - radius, high = box[`max${axis.toUpperCase()}`] + radius;
    if (Math.abs(movement[axis]) < 1e-10) {
      if (origin[axis] < low || origin[axis] > high) return null;
      continue;
    }
    const first = (low - origin[axis]) / movement[axis], second = (high - origin[axis]) / movement[axis];
    const entry = Math.min(first, second), exit = Math.max(first, second);
    if (entry >= near) {
      near = entry;
      normal = { x: 0, y: 0, z: 0, [axis]: movement[axis] > 0 ? -1 : 1 };
    }
    far = Math.min(far, exit);
    if (near > far) return null;
  }
  if (box.cap) {
    const slope = (box.cap.lowY - box.cap.highY) / (box.maxZ - box.minZ), length = Math.hypot(1, slope);
    const offset = origin.y - box.cap.highY - slope * (origin.z - box.minZ) - radius * length;
    const velocity = movement.y - slope * movement.z;
    if (Math.abs(velocity) < 1e-10) { if (offset > 1e-8) return null; }
    else if (velocity > 0) far = Math.min(far, -offset / velocity);
    else if (-offset / velocity >= near) {
      near = -offset / velocity;
      normal = { x: 0, y: 1 / length, z: -slope / length };
    }
  }
  if (near > far || near < 0 || near > 1 || far < 0) return null;
  // An object initially touching a solid may travel away from it. Starting
  // inside an expanded corner remains conservatively stopped in place.
  if (!normal) {
    const axis = ['x', 'y', 'z'].sort((a, b) => Math.abs(movement[b]) - Math.abs(movement[a]))[0];
    if (Math.abs(movement[axis]) < 1e-10) return null;
    normal = { x: 0, y: 0, z: 0, [axis]: movement[axis] > 0 ? -1 : 1 };
  }
  return { fraction: near, normal };
}

function boardFrame(door, board) {
  const yaw = Math.atan2(-door.outX, -door.outZ), c = Math.cos(yaw), s = Math.sin(yaw);
  const ca = Math.cos(board.angle), sa = Math.sin(board.angle);
  return {
    box: { minX: -board.width / 2, maxX: board.width / 2, minY: -board.height / 2, maxY: board.height / 2, minZ: -board.depth / 2, maxZ: board.depth / 2 },
    into(point, vector = false) {
      const dx = point.x - (vector ? 0 : door.x), dz = point.z - (vector ? 0 : door.z), dy = point.y - (vector ? 0 : board.y);
      const x = c * dx - s * dz;
      return { x: ca * x + sa * dy, y: -sa * x + ca * dy, z: s * dx + c * dz };
    },
    out(vector) {
      const x = ca * vector.x - sa * vector.y, y = sa * vector.x + ca * vector.y;
      return { x: c * x + s * vector.z, y, z: -s * x + c * vector.z };
    },
  };
}

function stringerFrame(beam) {
  const c = Math.cos(beam.angle), s = Math.sin(beam.angle);
  return {
    box: { minX: -beam.width / 2, maxX: beam.width / 2, minY: -beam.height / 2, maxY: beam.height / 2, minZ: -beam.length / 2, maxZ: beam.length / 2 },
    into(point, vector = false) {
      const y = point.y - (vector ? 0 : beam.centerY), z = point.z - (vector ? 0 : beam.centerZ);
      return { x: point.x - (vector ? 0 : beam.x), y: c * y + s * z, z: -s * y + c * z };
    },
    out(vector) { return { x: vector.x, y: c * vector.y - s * vector.z, z: s * vector.y + c * vector.z }; },
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
  // Exact two panels in world.js: 8.65 × .24 × 13, centered at ±4.15,
  // 7.32, 0 and rotated around Z by ∓.21 radians.
  const angle = -side * .21, c = Math.cos(angle), s = Math.sin(angle);
  return {
    box: { minX: -8.65 / 2, maxX: 8.65 / 2, minY: -.12, maxY: .12, minZ: -6.5, maxZ: 6.5 },
    into(point, vector = false) {
      const x = point.x - (vector ? 0 : side * 4.15), y = point.y - (vector ? 0 : 7.32);
      return { x: c * x + s * y, y: -s * x + c * y, z: point.z };
    },
    out(vector) { return { x: c * vector.x - s * vector.y, y: s * vector.x + c * vector.y, z: vector.z }; },
  };
}
const GRENADE_ORIENTED_SOLIDS = [...(HAS_SPACE ? [] : STAIR_STRINGERS.map(stringerFrame)), ...(HAS_SPACE ? [roofFrame(0)] : [roofFrame(-1), roofFrame(1)])];
function gableHit(origin, movement, z, radius = 0) {
  if (HAS_SPACE) return null;
  if (Math.abs(movement.z) < 1e-10) return null;
  const normalZ = movement.z > 0 ? -1 : 1;
  const fraction = (z + normalZ * radius - origin.z) / movement.z;
  if (fraction < 0 || fraction > 1) return null;
  const x = origin.x + movement.x * fraction, y = origin.y + movement.y * fraction;
  const slope = 1.7 / 8;
  if (y < 6.5 - radius || Math.abs(x) > 8 + radius
    || y > 8.2 - slope * Math.abs(x) + radius * Math.hypot(1, slope)) return null;
  return { fraction, normal: { x: 0, y: 0, z: normalZ } };
}

function wallBoxes() {
  if (HAS_SPACE) return [...SPACE.boxes, ...SPACE.facadeSections, ...WORLD.covers.flatMap(cover=>coverPieces(cover).map(piece=>({...piece,minY:cover.baseY??0,maxY:(cover.baseY??0)+piece.height})))];
  const boxes = [];
  // Match the wall sections in public/world.js. Barricade boards and the open
  // (glassless) windows let bullets through; nailed-shut windows are solid wall.
  // No window can ever be used as an entrance.
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
  // The loft leaves an opening above the complete staircase.
  const floorBottom = LOFT.y - LOFT.thickness;
  boxes.push({ minX: LOFT.minX, maxX: STAIR_WELL.minX, minY: floorBottom, maxY: LOFT.y, minZ: LOFT.minZ, maxZ: LOFT.maxZ });
  boxes.push({ minX: STAIR_WELL.maxX, maxX: LOFT.maxX, minY: floorBottom, maxY: LOFT.y, minZ: LOFT.minZ, maxZ: LOFT.maxZ });
  boxes.push({ minX: STAIR_WELL.minX, maxX: STAIR_WELL.maxX, minY: floorBottom, maxY: LOFT.y, minZ: LOFT.minZ, maxZ: STAIR_WELL.minZ });
  boxes.push({ minX: STAIR_WELL.minX, maxX: STAIR_WELL.maxX, minY: floorBottom, maxY: LOFT.y, minZ: STAIR_WELL.maxZ, maxZ: LOFT.maxZ });
  boxes.push(...STAIR_TREADS);
  for (const cover of WORLD.covers) {
    const baseY = cover.baseY ?? 0;
    const cap = PARTITION_CAPS.find(cap => cap.layoutId === cover.id);
    if (cap) {
      boxes.push({ ...cover, minY: baseY, maxY: cap.baseY });
      boxes.push({ ...cap, id: `${cover.id}-cap`, minY: cap.baseY, maxY: cap.highY, cap });
    } else for (const piece of coverPieces(cover)) boxes.push({ ...piece, minY: baseY, maxY: baseY + piece.height });
  }
  return boxes;
}

const SOLID_BOXES = wallBoxes();

function sealedDoorBox(door) {
  const { width, height, depth } = SEALED_DOOR_PLATE;
  const halfX = (door.outX ? depth : width) / 2, halfZ = (door.outZ ? depth : width) / 2;
  return { minX: door.x - halfX, maxX: door.x + halfX, minY: 0, maxY: height, minZ: door.z - halfZ, maxZ: door.z + halfZ };
}

export function navigationObstacles(y, exterior = false, height = 1.82) {
  if (HAS_SPACE && !exterior) return [...WORLD.covers.filter(c=>y<(c.baseY??0)+c.height&&y+height>(c.baseY??0)),...SPACE.walls.filter(c=>y<c.baseY+c.height&&y+height>c.baseY),...SPACE.rails.filter(c=>y<c.baseY+c.height&&y+height>c.baseY),...(y> -1.7 ? SPACE.flights.map(f=>({id:f.id+'-well',stairHole:true,...f.well,maxZ:f.maxZ})) : SPACE.flights.map(f=>({id:f.id+'-steps',minX:f.minX,maxX:f.maxX,minZ:f.minZ,maxZ:f.maxZ})))];
  // SPACE props block every outdoor route on multi-floor maps.
  if (exterior) return HAS_SPACE ? [LEVEL.buildingBounds,...SPACE.props.filter(p=>y<p.maxY&&y+height>p.minY)] : [LEVEL.buildingBounds];
  let stairObstacles = [STAIR_WELL];
  if (y < .3) {
    // Only the low part obstructs a ground-floor body. The clearance includes
    // the sloping side beams, so a tall colossus takes a higher approach.
    const length = STAIRS.maxZ - STAIRS.minZ, cosine = length / Math.hypot(length, STAIRS.topY);
    const lowTreads = STAIR_TREADS.filter(tread => tread.minY < y + height && tread.maxY > y);
    stairObstacles = [{ id: `stairs-under-${height}-${y}`, minX: STAIRS.minX, maxX: STAIRS.maxX,
      minZ: Math.min(...lowTreads.map(tread => tread.minZ)), maxZ: STAIRS.maxZ + .01 },
    ...STAIR_STRINGERS.map((beam,index) => ({
      id: `stairs-beam-${index}-${height}-${y}`, stairBeam: true, minX: beam.x - beam.width / 2, maxX: beam.x + beam.width / 2,
      minZ: Math.max(beam.minZ, beam.centerZ + (beam.centerY - beam.height / 2 / cosine - y - height) / (STAIRS.topY / length)),
      maxZ: beam.maxZ + beam.height / 2 * Math.sin(beam.angle),
    }))];
  }
  return [...WORLD.covers.filter(cover => {
    const baseY = cover.baseY ?? 0;
    return y < baseY + cover.height && y + height > baseY;
  }), ...stairObstacles];
}

// Obstacle casts made by segmentClear (navigationGraphCost reads them).
let segmentCasts = 0;
// obstacles: navigationObstacles(y, exterior, height), passed in by callers
// that test many segments against the same list.
function segmentClear(start, end, y, margin = 0.32, exterior = false, height = 1.82, radius = ZOMBIE_RADIUS, obstacles = navigationObstacles(y, exterior, height)) {
  margin = Math.max(margin, radius + .03);
  if(exterior)margin=Math.max(.46, radius + .17);
  const direction = { x: end.x - start.x, y: 0, z: end.z - start.z };
  // Broad phase: a cover whose padded box lies clear of the segment's bounds
  // cannot meet it (rayBox would miss), so only the nearby ones are cast.
  const lowX = Math.min(start.x, end.x) - 1e-9, highX = Math.max(start.x, end.x) + 1e-9;
  const lowZ = Math.min(start.z, end.z) - 1e-9, highZ = Math.max(start.z, end.z) + 1e-9;
  for (const cover of obstacles) {
    if (cover.maxX + margin < lowX || cover.minX - margin > highX || cover.maxZ + margin < lowZ || cover.minZ - margin > highZ) continue;
    segmentCasts++;
    const box = padding => ({
      minX: cover.minX - padding, maxX: cover.maxX + padding,
      minY: -100, maxY: Infinity,
      minZ: cover.minZ - padding, maxZ: cover.maxZ + padding,
    });
    const origin = { x: start.x, y, z: start.z };
    if (rayBox(origin, direction, box(margin), 1) <= 1) {
      // An impulse can leave a legal body inside the graph's extra padding.
      // Allow an escape segment only when it never enters the real collider.
      // A stairwell hole only stops the feet: the body may overhang it, and
      // its cheek rails are obstacles of their own. Exterior SPACE props are
      // tested against their real colliders: the wider boxes below left a
      // walker touching a prop no escape segment, and it stood there for the
      // rest of the wave. The facade keeps the wider boxes.
      const physical = exterior && HAS_SPACE && cover !== LEVEL.buildingBounds ? [box(radius)] : exterior ? [
        { ...box(Math.max(.425, radius + .13)), minX: cover.minX - radius, maxX: cover.maxX + radius },
        { ...box(Math.max(.425, radius + .13)), minZ: cover.minZ - radius, maxZ: cover.maxZ + radius },
      ] : [box(cover === STAIR_WELL || cover.stairHole ? 0 : radius)];
      const touchesPadding = inRect(start.x, start.z, cover, margin) !== inRect(end.x, end.z, cover, margin);
      if (touchesPadding && physical.every(bounds => !inRect(start.x, start.z, bounds)
        && !inRect(end.x, end.z, bounds) && rayBox(origin, direction, bounds, 1) > 1)) continue;
      return false;
    }
  }
  return true;
}

// The partitions never move. Reuse their corner visibility instead of testing
// every pair again for every zombie; only the start/target links are dynamic.
const navigationGraphs = new Map();
function navigationGraph(y, exterior, obstacles, occupied, height, radius) {
  const key = `${LEVEL.id}:${HAS_SPACE ? Math.round(y*1000) : "legacy"}:${height}:${radius}:` + (exterior ? 'exterior' : obstacles.map(cover => cover.id ?? 'stairs').join('|'));
  if (navigationGraphs.has(key)) return navigationGraphs.get(key);
  const margin = exterior ? Math.max(.56, radius + .27) : radius + .13;
  // The bounds fit a walker against the facade; a wider body keeps further in.
  const inset = HAS_SPACE ? Math.max(0, radius - ZOMBIE_RADIUS) : 0, bounds = LEVEL.navigationBounds;
  const corners = obstacles.flatMap(cover => {
    const padding = cover.stairBeam ? radius + .031 : margin;
    return [
      { x: cover.minX - padding, z: cover.minZ - padding }, { x: cover.maxX + padding, z: cover.minZ - padding },
      { x: cover.minX - padding, z: cover.maxZ + padding }, { x: cover.maxX + padding, z: cover.maxZ + padding },
    ];
  }).map(point => exterior ? point : { x: clamp(point.x, bounds.minX + inset, bounds.maxX - inset), z: clamp(point.z, bounds.minZ + inset, bounds.maxZ - inset) }).filter(point => !occupied(point));
  const edges = corners.map(() => corners.map(() => Infinity)), castsBefore = segmentCasts;
  for (let from = 0; from < corners.length; from++) for (let to = from + 1; to < corners.length; to++) {
    if (segmentClear(corners[from], corners[to], y, .32, exterior, height, radius, obstacles)) edges[from][to] = edges[to][from] = distance(corners[from], corners[to]);
  }
  const graph = { corners, edges, casts: segmentCasts - castsBefore }; navigationGraphs.set(key, graph); return graph;
}
const occupiedBy = (obstacles, exterior, radius) => point => obstacles.some(cover => inRect(point.x, point.z, cover, exterior ? Math.max(.46,radius+.17) : radius+.03));
// What building one indoor graph costs: its corners, the corner pairs it
// tests and the obstacle casts those tests made (cached graphs report the
// casts of their first build). A guard for the hospital's many partitions.
export function navigationGraphCost(y, height = 1.82, radius = ZOMBIE_RADIUS) {
  const obstacles = navigationObstacles(y, false, height);
  const { corners, casts } = navigationGraph(y, false, obstacles, occupiedBy(obstacles, false, radius), height, radius);
  return { obstacles: obstacles.length, corners: corners.length, pairs: corners.length * (corners.length - 1) / 2, casts };
}

function routeAroundObstacles(start, target, y, exterior = false, height = 1.82, radius = ZOMBIE_RADIUS) {
  const obstacles = navigationObstacles(y,exterior,height);
  const occupied = occupiedBy(obstacles, exterior, radius);
  let destination = { x: target.x, z: target.z };
  if (occupied(destination)) {
    // A player can stand closer to a piece of furniture than a zombie can.
    // Approach to melee distance rather than attempting to enter the collider.
    // In a lane barely wider than the body, only a closer spot is free.
    let alternatives = [];
    for (const reach of [.65, .75, .905, .905 + Math.max(0, radius - ZOMBIE_RADIUS), ...(HAS_SPACE ? [.45, .3, .15] : [])]) {
      alternatives = Array.from({ length: 16 }, (_, index) => ({
        x: target.x + Math.cos(index / 16 * Math.PI * 2) * reach,
        z: target.z + Math.sin(index / 16 * Math.PI * 2) * reach,
      })).filter(point => !obstacles.some(cover => inRect(point.x, point.z, cover,
        exterior ? Math.max(.46, radius + .17) : radius + .001)));
      if (alternatives.length) break;
    }
    alternatives.sort((a, b) => distance(start, a) - distance(start, b));
    destination = alternatives[0] ?? destination;
  }
  if (segmentClear(start, destination, y,.32,exterior,height,radius,obstacles)) return [destination];
  const { corners, edges } = navigationGraph(y, exterior, obstacles, occupied, height, radius);
  const nodes = [{ x: start.x, z: start.z }, destination, ...corners];
  const costs = nodes.map(() => Infinity), parents = nodes.map(() => -1), visited = new Set();
  costs[0] = 0;
  for (let iteration = 0; iteration < nodes.length; iteration++) {
    let current = -1;
    for (let index = 0; index < nodes.length; index++) {
      if (!visited.has(index) && Number.isFinite(costs[index]) && (current === -1 || costs[index] < costs[current])) current = index;
    }
    if (current === -1) break;
    if (current === 1) {
      const path = [];
      for (let index = 1; index !== 0; index = parents[index]) path.unshift(nodes[index]);
      return path;
    }
    visited.add(current);
    for (let index = 1; index < nodes.length; index++) {
      if (visited.has(index) || index === current) continue;
      const link = current >= 2 && index >= 2 ? edges[current - 2][index - 2]
        : segmentClear(nodes[current], nodes[index], y, .32, exterior, height, radius, obstacles) ? distance(nodes[current], nodes[index]) : Infinity;
      const cost = costs[current] + link;
      if (cost < costs[index]) { costs[index] = cost; parents[index] = current; }
    }
  }
  return [];
}

// Is a piece of furniture's top at (x, z) exactly at height y?
function furnitureTopAt(x, z, y) {
  return (HAS_SPACE || y > 0) && WORLD.covers.some(cover => coverPieces(cover).some(piece => inRect(x, z, piece) && Math.abs((cover.baseY ?? 0) + piece.height - y) < 1e-6));
}

// The highest floor, step, loft or furniture top at (x, z) no higher than
// fromY: where an item put down or sliding there comes to rest.
function restingSurface(x, z, fromY) {
  const space = typeof HAS_SPACE === 'boolean' ? HAS_SPACE : IS_SUPERMARKET;
  const surfaces = [space ? spaceFloor(x,z,fromY) : 0];
  if (!space && inRect(x, z, WORLD.stair)) surfaces.push(stairStepY(z));
  if (inRect(x, z, WORLD.loft) && !inRect(x, z, STAIR_WELL)) surfaces.push(WORLD.loftY);
  for (const cover of WORLD.covers) for (const piece of coverPieces(cover)) if (inRect(x, z, piece)) surfaces.push((cover.baseY ?? 0) + piece.height);
  return Math.max(...surfaces.filter(surface => surface <= fromY + 1e-6));
}

function weaponInventory(ownedWeapons, bonus = null, debt = null) {
  return Object.fromEntries(ownedWeapons.map(name => {
    const type = weaponType(name);
    const weapon = upgradedWeapon(WEAPONS[type], type, bonus, debt);
    return [name, { ammo: weapon.magazine, reserve: weapon.reserve }];
  }));
}

export class RoomSimulation {
  constructor(code, { random = Math.random, onEvent = () => {}, practice = false, raids = true, ambiance = 'family' } = {}) {
    this.code = code;
    this.difficulty = 'normal';
    // Friendly fire (rules.js FRIENDLY_FIRE): off unless the host picks it.
    this.friendlyFire = 'off';
    // A look only, fixed for the room's life (practice rooms too): the
    // simulation never reads it, it travels in every snapshot.
    this.ambiance = ambianceOf(ambiance);
    this.practice = practice === true;
    this.random = random;
    this.onEvent = onEvent;
    this.players = new Map();
    this.zombies = new Map();
    this.pickups = new Map();
    this.nextPickupId = 1;
    this.lootKills = 0;
    this.ammoDrops = 0;
    this.ballisticsEnabled = true;
    this.bullets = new Map();
    this.nextBulletId = 1;
    this.grenades = new Map();
    this.nextGrenadeId = 1;
    // Impact numbers (owner, 18 October): a survivor who asked for them
    // receives their own, and only theirs (takeImpactNumbers). Display only:
    // whoever watches, the combat and the score are the same.
    this.impactObservers = new Set();
    this.impactPending = new Map();
    this.burnDamagePending = new Map();
    this.burnDamageNextAt = 0;
    // Revive bonuses (owner, 18 October), paid when the wave or the night ends.
    this.reviveCredits = [];
    this.waveKills = 0;
    this.waveInitialTotal = 0;
    this.wavePlayerCount = null;
    this.waveGrenadeThresholds = [];
    this.waveGrenadeDrops = 0;
    this.doors = this.createDoors();
    this.hostId = null;
    this.phase = this.practice ? 'wave' : 'lobby';
    this.paused = false;
    this.pauseById = null;
    this.wave = 0;
    this.time = 0;
    this.timeLeft = 0;
    this.toSpawn = 0;
    this.spawnTimer = 0;
    this.spawnWarnings = new Map();
    this.raid = null;
    this.nextRaiderId = 1;
    this.raidWarnings = new Map();
    this.raidsEnabled = raids !== false;
    this.raidLootIds = new Set();
    this.supplyCrate = null;
    this.resetExpedition();
    this.brutesToSpawn = 0;
    this.waveSpawned = 0;
    this.bruteSpawnAt = [];
    this.nextZombieId = 1;
    this.nextMeleeId = 1;
    this.eventNumber = 0;
    if (this.practice) this.resetPracticeTargets();
  }

  createDoors() {
    return LEVEL.doors.map(source => {
      const door = { ...source };
      door.maxHp = BARRICADE_BOARDS.reduce((sum, board) => sum + board.maxHp, 0);
      door.boards = BARRICADE_BOARDS.map(board => board.maxHp);
      door.repairCredit = 0;
      door.sealed = false;
      door.sealPending = false;
      // Legacy tools/tests can still set aggregate HP. The real state always
      // remains the five boards; a scalar write fills them from bottom to top.
      Object.defineProperty(door, 'hp', { enumerable: true,
        get: () => door.boards.reduce((sum, hp, index) => sum + clamp(Number(hp) || 0, 0, BARRICADE_BOARDS[index].maxHp), 0),
        set: value => {
          const previous = door.hp;
          let remaining = clamp(Number(value) || 0, 0, door.maxHp);
          const nextHp = remaining;
          for (const board of BARRICADE_BOARDS) {
            door.boards[board.index] = Math.min(board.maxHp, remaining);
            remaining -= door.boards[board.index];
          }
          door.repairCredit = clamp(door.repairCredit + previous - nextHp, 0, door.maxHp);
        },
      });
      return door;
    });
  }

  damageDoor(door, damage, { boardIndex = null, zombieId = null, id = null, bash = false } = {}) {
    if (!door || door.sealed || !Number.isFinite(damage) || damage <= 0) return 0;
    let remaining = damage, removed = 0;
    const indices = boardIndex === null ? BARRICADE_BOARDS.map(board => board.index) : [boardIndex];
    for (const index of indices) {
      if (!BARRICADE_BOARDS[index] || door.boards[index] <= 0) continue;
      const amount = Math.min(remaining, door.boards[index]);
      door.boards[index] -= amount;
      remaining -= amount;
      removed += amount;
      if (remaining <= 0) break;
    }
    if (!removed) return 0;
    if (zombieId) door.repairCredit = Math.min(door.maxHp, door.repairCredit + removed);
    // `bash` marks a raider's butt-stroke, so the client never swings a zombie.
    this.event(boardIndex === null ? 'door' : 'board', {
      ...(id ? { id } : {}), ...(zombieId ? { zombieId } : {}), ...(bash ? { bash: true } : {}),
      doorId: door.id, ...(boardIndex === null ? {} : { boardIndex }), hp: door.hp, boards: [...door.boards],
    });
    return removed;
  }

  // The survivors a wave is sized for: a human counts 1, an AI companion half
  // (COMPANION_SHARE). Doors and raids take the whole part of it.
  participantWeight(player) { return player.companion === true ? COMPANION_SHARE : 1; }

  participantCount() {
    return [...this.players.values()].filter(player => !player.waiting).reduce((sum, player) => sum + this.participantWeight(player), 0);
  }

  currentWaveBalance() {
    return waveBalance(this.wave, this.wavePlayerCount ?? this.participantCount());
  }

  configureDefendedDoors(count = this.participantCount()) {
    const active = defendedDoorIds(count);
    for (const door of this.doors) {
      if (active.includes(door.id)) {
        door.sealed = false;
        door.sealPending = false;
      } else if (!door.sealed) door.sealPending = true;
    }
    this.updateDoorSeals();
  }

  solidBoxes() {
    return SOLID_BOXES.concat(this.doors.filter(door => door.sealed).map(sealedDoorBox));
  }

  updateDoorSeals() {
    for (const door of this.doors) {
      if (!door.sealPending) continue;
      const occupies = (entity, radius, height) => {
        const normal = (entity.x - door.x) * door.outX + (entity.z - door.z) * door.outZ;
        const tangent = (entity.x - door.x) * door.outZ - (entity.z - door.z) * door.outX;
        return Math.abs(normal) <= radius + .135 && Math.abs(tangent) <= 1.3 + radius
          && entity.y < 2.8 && entity.y + height > 0;
      };
      // A survivor (including a downed one) must be able to clear the threshold.
      // The pending door is already excluded from new zombie routes/spawns.
      if ([...this.players.values()].some(player => player.alive && occupies(player, PLAYER_RADIUS, playerHeight(player)))
        || [...this.zombies.values()].some(zombie => zombie.hp > 0 && occupies(zombie, bodyRadius(zombie), enemyProfile(zombie).height * (zombie.scale ?? 1)))) continue;
      door.hp = door.maxHp;
      door.repairCredit = 0;
      door.sealed = true;
      door.sealPending = false;
    }
  }

  event(event, details = {}) {
    const player = this.players.get(details.id);
    if (player?._weaponHand && ['shot', 'reload', 'minigun-spin', 'bullet-denied'].includes(event))
      details = { ...details, hand: player._weaponHand, weaponId: activeWeaponId(player) };
    this.onEvent({ type: 'event', event, eventId: ++this.eventNumber, time: this.time, ...details });
  }

  addPlayer(id, name = 'Survivant', weapon = STARTER_WEAPON, { defer = false, companion = false, sheet = null } = {}) {
    if (this.players.size >= 4) throw new Error('La cabane est complète (4 joueurs maximum).');
    if (this.players.has(id)) throw new Error('Ce joueur est déjà connecté.');
    const index = this.players.size;
    const startingWeapon = this.practice ? 'assault' : STARTER_WEAPON;
    const startingWeapons = this.practice ? ['assault', 'rocket'] : [startingWeapon];
    const waiting = defer && !this.practice && this.phase !== 'lobby';
    // The optional character sheet (public/character-sheet.js). The weapon
    // stand and the AI companions always play the standard sheet.
    const characterSheet = normalizeSheet(this.practice || companion === true ? null : sheet), sheetDebt = innateDebt(characterSheet);
    const player = {
      id, name: String(name).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24) || 'Survivant',
      x: this.practice ? -5 + [0, -.6, .6, -1.2][index] : -2.8 + index * 1.1, y: 0, z: 1.7,
      yaw: 0, pitch: 0, hp: characterStats({ bonus: null, sheetDebt }).maxHp, armor: 0, downed: false, alive: !waiting, waiting, ready: false,
      sheet: characterSheet, sheetDebt,
      weapon: startingWeapon, weaponId: startingWeapon, startingWeapon, inventory: weaponInventory(startingWeapons, null, sheetDebt), issuedWeapons: new Set(startingWeapons),
      vy: 0, grounded: true, fallStartY: null, crouched: false, jumpHeld: false, jumpRequested: false, outsideDamageAccumulator: 0,
      reloadUntil: 0, shotAfter: 0, interactAfter: 0, practiceAfter: 0, minigunSpinning: false, minigunSpinUntil: 0,
      dualWield: false, secondaryWeaponId: null, weaponStates: {},
      pendingMelee: null, meleeAfter: 0, partitionSlideLeft: 0,
      bonus: null, backpack: false, supplyPurchases: [],
      umbrella: { open: false, remaining: UMBRELLA.max },
      score: 0, scoreCarry: 0, points: 0, kills: 0, bleedOutAt: 0, grenades: 0, throwAfter: 0, killChain: 0, lastKillAt: -Infinity, nextWaveVote: false, reviveKit: false, reviveShieldUntil: 0,
      grenadierInterval: 0, grenadierUntil: null,
      input: { forward: 0, strafe: 0, sprint: false, crouch: false }, lastInputAt: this.time,
    };
    // An AI companion (companions/, LAN only): never host, never a voter,
    // coins like anyone, other pickups only the one its order targets.
    if (companion === true) Object.assign(player, { companion: true, ready: true, collectTargetId: null });
    this.players.set(id, player);
    if (!this.hostId && player.companion !== true) this.hostId = id;
    this.event('join', { id, name: player.name });
    if (waiting) this.event('join-waiting', { id });
    return player;
  }

  canAdmitPlayer(player) { return this.players.has(player.id); }

  admitReadyPlayers() {
    if (!['countdown', 'intermission'].includes(this.phase)) return;
    for (const player of this.players.values()) if (player.waiting && player.ready && this.canAdmitPlayer(player)) this.admitPlayer(player);
  }

  // Intermissions have no hostile wave. Keep a newly admitted body clear
  // of walls and surviving bodies, including late countdown arrivals.
  // `crowded` (a loaded night's loader only) accepts a spot near a zombie.
  admitPlayer(player, { crowded = false } = {}) {
    const candidates = [];
    for (const z of [1.7, 2.7, .7, 3.7, -.3]) for (const x of [-2.8, -1.7, -.6, .5, -3.9, -5, 1.6]) candidates.push({ x, y: 0, z });
    const point = candidates.find(point => this.canOccupy(player, point.x, point.z, 0, PLAYER_RADIUS)
      && ![...this.players.values()].some(other => other !== player && other.alive && Math.abs(other.y) < 1.7 && distance(point, other) < PLAYER_RADIUS * 2 + .1)
      && (crowded || ![...this.zombies.values()].some(zombie => zombie.hp > 0 && Math.abs(zombie.y) < 2 && distance(point, zombie) < 1.5)));
    if (!point) return false;
    Object.assign(player, point, { waiting: false, ready: false, alive: true, downed: false, hp: characterStats(player).maxHp,
      yaw: 0, pitch: 0, input: { forward: 0, strafe: 0, sprint: false, crouch: false }, lastInputAt: this.time });
    this.resetGrenadier(player);
    this.event('join-admitted', { id: player.id });
    return true;
  }

  readyPlayer(id) {
    const player = this.players.get(id);
    if (!player?.waiting || player.ready || !HAZARD_PHASES.includes(this.phase)) return false;
    player.ready = true;
    this.event('join-ready', { id });
    this.admitReadyPlayers();
    return true;
  }

  // A survivor changes character before a night (lobby, results) or while
  // waiting to join a running one, never once in it. The debt restarts from
  // the new sheet; a body that has not fought yet gets its new full HP and
  // full starting magazines. A seat taken back in a loaded night
  // (save-game.mjs) plays its saved character until that night ends, even
  // while it waits for its admission.
  setSheet(id, sheet) {
    const player = this.players.get(id);
    if (!player || this.practice || player.companion === true || this.seatHolders?.has(id)
      || (!['lobby', 'gameover', 'victory'].includes(this.phase) && player.waiting !== true)) return false;
    const previousStats = characterStats(player);
    player.sheet = normalizeSheet(sheet);
    this.resetSheetDebt(player, previousStats);
    if (this.phase === 'lobby' || player.waiting === true) {
      player.inventory = weaponInventory(Object.keys(player.inventory), player.bonus, player.sheetDebt);
      player.hp = characterStats(player).maxHp;
    }
    return true;
  }

  // Back to the sheet's innate debt: at join, each night, and whenever the
  // bonuses are dropped or cleared. Debt repaid at the crate goes with them.
  resetSheetDebt(player, previousStats = characterStats(player)) {
    player.sheetDebt = innateDebt(player.sheet);
    this.syncCharacterBonuses(player, previousStats);
    this.normalizeInventory(player);
  }

  removePlayer(id) {
    const player = this.players.get(id);
    if (!player) return;
    this.cancelMinigunSpin(player);
    this.cancelMelee(player.id, true);
    this.setUmbrella(id, false);
    this.dropFuel(player);
    this.dropBonus(player);
    this.dropUniqueMagnum(player);
    // A credit on them stays frozen for its reviver; nobody sees their numbers.
    this.closeReviveCredit(id);
    this.impactObservers.delete(id);
    this.dropImpactNumbers(id);
    this.players.delete(id);
    if (this.hostId === id) {
      // Never a companion: an admitted human first, then one still waiting.
      const remaining = [...this.players.values()].filter(candidate => candidate.companion !== true);
      // A waiting spectator cannot control a live team pause. Prefer an
      // admitted, connected survivor; keep a reserved participant ahead of
      // spectators when nobody is connected, until their reconnect expires.
      this.hostId = remaining.find(candidate => !candidate.waiting && this.canAdmitPlayer(candidate))?.id
        ?? remaining.find(candidate => !candidate.waiting)?.id ?? remaining[0]?.id ?? null;
    }
    if (this.paused && this.pauseById !== this.hostId) {
      this.pauseById = this.hostId;
      if (!this.hostId || this.players.get(this.hostId)?.waiting) this.paused = false; // nobody able to resume
      this.event('pause', { id, paused: this.paused, pauseById: this.pauseById });
    }
    this.event('leave', { id, hostId: this.hostId });
    // A paused loaded night still waiting for a standing survivor's seat is not lost.
    if (this.players.size && !['lobby', ...FROZEN_PHASES].includes(this.phase) && !this.fightingPlayers().length
      && !(this.paused && this.seatsAwaited())) this.endGame();
  }

  setInput(id, message) {
    const player = this.players.get(id);
    if (this.paused || !player || player.waiting || FROZEN_PHASES.includes(this.phase)) return false;
    for (const value of [message.forward, message.strafe, message.yaw, message.pitch]) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    }
    player.input = {
      forward: clamp(message.forward, -1, 1), strafe: clamp(message.strafe, -1, 1), sprint: message.sprint === true, crouch: message.crouch === true,
    };
    const jump = message.jump === true;
    if (jump && !player.jumpHeld) player.jumpRequested = true;
    player.jumpHeld = jump;
    player.yaw = normalizeAngle(message.yaw);
    player.pitch = clamp(message.pitch, -1.48, 1.48);
    player.lastInputAt = this.time;
    return true;
  }

  resetPlayerControls(cancelAttacks = false) {
    for (const player of this.players.values()) {
      player.input = { forward: 0, strafe: 0, sprint: false, crouch: false };
      player.jumpHeld = false;
      player.jumpRequested = false;
      player.lastInputAt = this.time;
      this.cancelMinigunSpin(player);
      if (cancelAttacks) this.cancelMelee(player.id, true);
    }
  }

  setPause(id, paused) {
    if (!this.players.has(id) || this.players.get(id).waiting) return false;
    // Resuming a loaded night whose only fighters are free seats would end it at once.
    const reason = typeof paused !== 'boolean' ? 'invalid' : id !== this.hostId ? 'host'
      : !PAUSABLE_PHASES.includes(this.phase) ? 'phase' : !paused && this.paused && this.seatsAwaited() ? 'seats' : null;
    if (reason) { this.event('pause-denied', { id, reason }); return false; }
    if (this.paused === paused) return true;
    this.paused = paused;
    this.pauseById = paused ? this.hostId : null;
    // Inputs held before opening a menu must never resume by themselves.
    // Physical velocity and reloads keep their remaining simulation time.
    // Cancel wind-ups for everyone, retaining their full recovery, so no
    // unseen melee impact or minigun burst fires on return from the menu.
    this.resetPlayerControls(paused);
    this.event('pause', { id, paused, pauseById: this.pauseById });
    return true;
  }

  resetExpedition() {
    this.generator = { active: false, missionWave: null, completed: 0, elapsed: 0 };
    this.fuel = null;
  }

  setUmbrella(id, open) {
    const player = this.players.get(id);
    if (this.paused || !player || typeof open !== 'boolean') return false;
    // Cancellation always works, including after a down or a frozen ending.
    if (open && (this.practice || !player.alive || player.downed || !HAZARD_PHASES.includes(this.phase))) return false;
    if (open && (!(player.umbrella?.remaining > 0) || player.throwAfter > this.time
      || (!player.pendingMelee && Math.max(player.shotAfter, player.meleeAfter,
        this.weaponHandState(player, 'secondary')?.shotAfter ?? 0) > this.time))) {
      this.event('umbrella-denied', { id, reason: player.umbrella.remaining <= 0 ? 'worn' : 'recovery' });
      return false;
    }
    if (player.umbrella.open === open) return true;
    if (open) { this.cancelMinigunSpin(player); this.cancelMelee(id); }
    player.umbrella.open = open;
    this.event('umbrella', { id, open, remaining: player.umbrella.remaining });
    return true;
  }

  beginExpeditionMission() {
    if (this.practice || this.generator.active || !EXPEDITION.missionWaves.includes(this.wave)) return false;
    const cacheIndex = EXPEDITION.missionWaves.indexOf(this.wave);
    Object.assign(this.generator, { active: true, missionWave: this.wave, elapsed: 0 });
    this.fuel = { ...FUEL_CACHES[cacheIndex], carrierId: null, cacheIndex };
    this.event('fuel-mission', { wave: this.wave, ...FUEL_CACHES[cacheIndex], declineSeconds: GENERATOR.declineSeconds });
    return true;
  }

  updateExpedition(delta) {
    if (!this.practice && this.generator.active && HAZARD_PHASES.includes(this.phase)) this.generator.elapsed += delta;
  }

  expeditionAction(id) {
    const player = this.players.get(id);
    if (this.practice || !player?.alive || player.downed || !HAZARD_PHASES.includes(this.phase)) return null;
    const atGenerator = distance(player, GENERATOR) < GENERATOR.reach && Math.abs(player.y - GENERATOR.y) < .8
      && this.interactionVisible(player, GENERATOR, GENERATOR_BOUNDS.id);
    if (atGenerator && this.fuel?.carrierId === id) return 'deliver-fuel';
    if (atGenerator && player.umbrella.remaining < UMBRELLA.max - 1e-8) return 'repair-umbrella';
    if (this.fuel && this.fuel.carrierId === null && this.canCollectPickup(player, this.fuel)
      && this.interactionVisible(player, this.fuel)) return 'take-fuel';
    return null;
  }

  expeditionInteraction(id) {
    if (this.paused) return false;
    const player = this.players.get(id), action = this.expeditionAction(id);
    if (!action || player.interactAfter > this.time) return false;
    if (action === 'take-fuel') this.fuel.carrierId = id;
    else if (action === 'deliver-fuel') {
      this.fuel = null;
      this.generator.active = false;
      this.generator.elapsed = 0;
      this.generator.completed++;
    } else player.umbrella.remaining = UMBRELLA.max;
    player.interactAfter = this.time + EXPEDITION.interactionCooldown;
    this.event(action, { id, missionWave: this.generator.missionWave });
    return true;
  }

  dropFuel(player) {
    if (!this.fuel || this.fuel.carrierId !== player.id) return false;
    const validPose = [player.x, player.y, player.z, player.yaw].every(Number.isFinite)
      && inRect(player.x, player.z, EXTERIOR.bounds) && player.grounded !== false;
    const point = validPose ? this.groundWeaponPosition(player, 'pistol') : null;
    const reachable = point && this.canOccupy({ ...player, crouched: true }, point.x, point.z, point.y, PLAYER_RADIUS);
    const target = reachable ? point : FUEL_CACHES[this.fuel.cacheIndex];
    Object.assign(this.fuel, { x: target.x, y: target.y, z: target.z, carrierId: null });
    this.event('fuel-dropped', { id: player.id, x: target.x, y: target.y, z: target.z, returnedToCache: !reachable });
    return true;
  }

  resetPracticeTargets() {
    if (!this.practice) return false;
    for (const player of this.players.values()) this.cancelMelee(player.id);
    this.zombies.clear();
    this.raidWarnings.clear();
    this.grenades.clear();
    this.bullets.clear();
    this.burnDamagePending.clear();
    this.burnDamageNextAt = 0;
    this.pickups.clear();
    // The broad west passage is clear on both sides of the central screen.
    // Two targets line up to let players discover real bullet penetration.
    const targets = [
      { x: -5, z: -1.4, hp: 80, kind: 'walker' },
      { x: -5.9, z: -1.4, hp: 165, kind: 'walker' },
      { x: -4.1, z: -1.4, hp: 400, kind: 'walker' },
      { x: -5, z: -3.8, hp: 700, kind: 'brute' },
      { x: -6.2, z: -3.8, hp: 1400, kind: 'brute' },
    ];
    for (const target of targets) {
      const zombie = { ...target, id: `z${this.nextZombieId++}`, y: 0, yaw: Math.PI,
        maxHp: target.hp, boss: false, scale: target.kind === 'brute' ? 1.22 : 1,
        speed: 0, entered: true, attackAfter: Infinity, damage: 0, barricadeDamage: 0,
        stairState: null, pushX: 0, pushZ: 0, pushLeft: 0 };
      this.zombies.set(zombie.id, zombie);
    }
    return true;
  }

  practiceAction(id, message) {
    const player = this.players.get(id);
    if (this.paused || !this.practice || !player?.alive || player.downed || !message || typeof message !== 'object'
      || Array.isArray(message) || player.practiceAfter > this.time + 1e-8) return false;
    const { action, weapon } = message;
    if (!['weapon', 'refill', 'targets', 'radar', 'backpack', 'raiders'].includes(action) || action === 'weapon' && !validWeapon(weapon)) return false;
    if (action === 'targets') this.resetPracticeTargets();
    else if (action === 'raiders') this.practiceRaiders();
    else if (action === 'backpack') {
      if (player.backpack === true) return false;
      player.backpack = true;
    }
    else if (action === 'radar') {
      if (player.bonus?.radar) return false;
      // Practice shows the radar at its best: a continuous personal map.
      (player.bonus ??= {}).radar = MAX_BONUS_LEVEL;
    }
    else {
      this.cancelMinigunSpin(player);
      this.cancelMelee(player.id);
      player.reloadUntil = 0;
      if (action === 'refill') player.inventory = weaponInventory(Object.keys(player.inventory));
      else {
        if (!resolveWeaponId(player, weapon)) {
          const stock = weaponInventory([weapon])[weapon];
          if (Object.keys(player.inventory).length >= this.weaponSlots(player)) {
            const replacedId = activeWeaponId(player);
            if (!replacedId) return false;
            // Replace only the active slot; every other slot keeps its stock
            // and ordering, whether the survivor carries two or four weapons.
            player.inventory = Object.fromEntries(Object.entries(player.inventory)
              .map(([key, heldStock]) => key === replacedId ? [weapon, stock] : [key, heldStock]));
          } else player.inventory[weapon] = stock;
        }
        this.selectInventoryWeapon(player, resolveWeaponId(player, weapon));
        player.shotAfter = Math.max(player.shotAfter, this.time + .25);
      }
      player.issuedWeapons = new Set(weaponEntries(player).map(entry => entry.weapon));
    }
    player.practiceAfter = this.time + .25;
    this.event('practice', { id, action, ...(action === 'weapon' ? { weapon } : {}) });
    return true;
  }

  selectInventoryWeapon(player, weaponId) {
    const previousId = player.weaponId;
    const changed = previousId !== weaponId;
    const carry = player.shotAfter ?? 0;
    if (changed && previousId) (player.weaponStates ??= {})[previousId] = handClockCopy(player);
    player.weaponId = weaponId;
    player.weapon = weaponId == null ? null : weaponType(weaponId, player.inventory[weaponId]);
    if (changed) {
      const saved = Object.hasOwn(player.weaponStates ?? {}, weaponId) ? player.weaponStates[weaponId] : null;
      Object.assign(player, handClockCopy(saved));
      // Keep the existing single-weapon switching recovery. Stored per-gun
      // cooldowns also survive entering/leaving dual mode: no toggle exploit.
      player.shotAfter = Math.max(carry, player.shotAfter);
    }
    this.normalizeDualWield(player);
  }

  dualWeaponIds(player) {
    const primary = activeWeaponId(player), secondary = player?.secondaryWeaponId;
    if (!player?.dualWield || !characterStats(player).dualWield || !primary || !secondary || primary === secondary) return null;
    const first = this.weaponProfile(player, primary), second = this.weaponProfile(player, secondary);
    return first && second && Object.hasOwn(player.inventory, secondary) && !first.melee && !second.melee
      ? [primary, secondary] : null;
  }

  weaponHandState(player, hand = 'primary') {
    if (!player || !['primary', 'secondary'].includes(hand)) return null;
    const weaponId = hand === 'primary' ? activeWeaponId(player) : this.dualWeaponIds(player)?.[1];
    if (!weaponId) return null;
    const state = hand === 'primary' ? player : player.weaponStates?.[weaponId];
    return { weaponId, weapon: weaponType(weaponId, player.inventory[weaponId]), ...handClockCopy(state) };
  }

  normalizeDualWield(player) {
    if (player?.dualWield && !this.dualWeaponIds(player)) this.disableDualWield(player);
    for (const id of Object.keys(player?.weaponStates ?? {})) if (!Object.hasOwn(player.inventory, id)) delete player.weaponStates[id];
  }

  disableDualWield(player) {
    const secondary = player.secondaryWeaponId, state = player.weaponStates?.[secondary];
    if (state) {
      state.reloadUntil = 0; state.minigunSpinUntil = 0;
      if (state.minigunSpinning) this.event('minigun-spin', { id: player.id, weaponId: secondary, hand: 'secondary', spinning: false });
      state.minigunSpinning = false;
    }
    const wasDual = player.dualWield;
    player.dualWield = false; player.secondaryWeaponId = null;
    if (wasDual) this.event('dual-wield', { id: player.id, enabled: false, secondaryWeaponId: null });
  }

  setDualWield(id, enabled, requested) {
    const player = this.players.get(id);
    if (typeof enabled !== 'boolean' || this.paused || !player?.alive || player.waiting || player.downed || FROZEN_PHASES.includes(this.phase)) return false;
    if (!enabled) { this.disableDualWield(player); return true; }
    const primary = activeWeaponId(player), secondary = resolveWeaponId(player, requested);
    const first = this.weaponProfile(player, primary), second = this.weaponProfile(player, secondary);
    if (!characterStats(player).dualWield || !primary || !secondary || primary === secondary || !first || !second || first.melee || second.melee) return false;
    if (player.dualWield && player.secondaryWeaponId === secondary) return true;
    this.disableDualWield(player);
    this.cancelMelee(id);
    player.dualWield = true; player.secondaryWeaponId = secondary;
    const state = (player.weaponStates ??= {})[secondary] ??= handClockCopy();
    const lock = this.time + characterStats(player).switchSeconds;
    player.shotAfter = Math.max(player.shotAfter, lock);
    state.shotAfter = Math.max(state.shotAfter, lock);
    player.switchUntil = lock; state.switchUntil = lock;
    this.event('dual-wield', { id, enabled: true, secondaryWeaponId: secondary });
    return true;
  }

  // The legacy weapon implementation operates on the gun currently in hand.
  // Focus a secondary instance only for this synchronous command, then restore
  // primary fields. Ammo stays in its own inventory entry throughout.
  withWeaponHand(player, hand, action) {
    if (!['primary', 'secondary'].includes(hand)) return false;
    if (hand === 'secondary' && !this.dualWeaponIds(player)) return false;
    const previousHand = player._weaponHand;
    const ownedHand = Object.hasOwn(player, '_weaponHand');
    const restoreHand = () => { if (ownedHand) player._weaponHand = previousHand; else delete player._weaponHand; };
    if (hand === 'primary') {
      player._weaponHand = hand;
      try { return action(); } finally { restoreHand(); }
    }
    const secondary = player.secondaryWeaponId;
    const primary = { weapon: player.weapon, weaponId: player.weaponId, ...handClockCopy(player) };
    const absentClocks = HAND_CLOCKS.filter(key => !Object.hasOwn(player, key));
    const state = (player.weaponStates ??= {})[secondary] ??= handClockCopy();
    Object.assign(player, { weapon: weaponType(secondary, player.inventory[secondary]), weaponId: secondary }, handClockCopy(state));
    player._weaponHand = hand;
    try { return action(); }
    finally {
      player.weaponStates[secondary] = handClockCopy(player);
      Object.assign(player, primary);
      for (const key of absentClocks) delete player[key];
      restoreHand();
    }
  }

  clearWeaponReloads(player) {
    player.reloadUntil = 0;
    for (const state of Object.values(player.weaponStates ?? {})) state.reloadUntil = 0;
  }

  lockWeaponSwitch(player) {
    player.switchUntil = this.time + characterStats(player).switchSeconds;
    player.shotAfter = Math.max(player.shotAfter, player.switchUntil);
  }

  syncCharacterBonuses(player, previousStats = characterStats(player)) {
    const current = characterStats(player);
    if (player.alive && !player.downed) player.hp = Math.min(current.maxHp, Math.max(0, player.hp + Math.max(0, current.maxHp - previousStats.maxHp)));
    else player.hp = Math.min(player.hp, current.maxHp);
    const ratio = current.reloadMultiplier / previousStats.reloadMultiplier;
    for (const state of [player, ...Object.entries(player.weaponStates ?? {}).filter(([id]) => id !== activeWeaponId(player)).map(([, state]) => state)]) {
      if (state.reloadUntil > this.time) state.reloadUntil = this.time + (state.reloadUntil - this.time) * ratio;
      if (state.reloadDuration > 0) state.reloadDuration *= ratio;
    }
    this.normalizeDualWield(player);
    player.grenades = Math.min(player.grenades, current.maxGrenades);
    if (current.grenadeIntervalSeconds !== previousStats.grenadeIntervalSeconds || current.maxGrenades !== previousStats.maxGrenades
      || current.grenadeDamageMultiplier !== previousStats.grenadeDamageMultiplier) this.resetGrenadier(player);
    return current;
  }

  // Only eligible simulation time earns a grenade. A full stock, incapacity,
  // absence or a changed level discards progress instead of banking it.
  grenadierIntervalFor(player) {
    const stats = characterStats(player);
    if (this.practice || !player?.alive || player.downed || player.waiting
      || !HAZARD_PHASES.includes(this.phase) || !this.canAdmitPlayer(player)
      || player.grenades >= stats.maxGrenades) return 0;
    return stats.grenadeIntervalSeconds;
  }

  resetGrenadier(player) {
    player.grenadierInterval = characterStats(player).grenadeIntervalSeconds;
    const interval = this.grenadierIntervalFor(player);
    player.grenadierUntil = interval > 0 ? this.time + interval : null;
  }

  grenadierLeft(player) {
    const interval = this.grenadierIntervalFor(player);
    if (!(interval > 0)) return null;
    return player.grenadierInterval === interval && Number.isFinite(player.grenadierUntil)
      ? Math.max(0, player.grenadierUntil - this.time) : interval;
  }

  updateGrenadiers() {
    for (const player of this.players.values()) {
      const interval = this.grenadierIntervalFor(player);
      if (!(interval > 0)) { player.grenadierUntil = null; continue; }
      if (player.grenadierInterval !== interval || !Number.isFinite(player.grenadierUntil)) {
        this.resetGrenadier(player);
        continue;
      }
      if (this.time + 1e-9 < player.grenadierUntil) continue;
      player.grenades++;
      player.grenadierUntil = player.grenades >= characterStats(player).maxGrenades ? null : this.time + interval;
      this.event('grenade-regenerated', { id: player.id, grenades: player.grenades, maxGrenades: characterStats(player).maxGrenades });
    }
  }

  newInventoryWeaponId(player, type) {
    if (!Object.hasOwn(player.inventory, type)) return type;
    let id;
    do { id = `${type}#${player.nextWeaponInstanceId = (player.nextWeaponInstanceId ?? 0) + 1}`; }
    while (Object.hasOwn(player.inventory, id));
    return id;
  }

  chooseWeapon(id, requested) {
    const player = this.players.get(id), weaponId = resolveWeaponId(player, requested);
    if (this.paused || !player || !weaponId || !validWeapon(weaponType(weaponId, player.inventory[weaponId])) || player.downed || !player.alive || FROZEN_PHASES.includes(this.phase)) return false;
    const changed = activeWeaponId(player) !== weaponId;
    if (changed) {
      this.disableDualWield(player);
      this.cancelMinigunSpin(player);
      this.cancelMelee(player.id);
      player.reloadUntil = 0;
    }
    this.selectInventoryWeapon(player, weaponId);
    if (changed) this.lockWeaponSwitch(player);
    return true;
  }

  cancelMinigunSpin(player) {
    const wasSpinning = player.minigunSpinning;
    player.minigunSpinning = false; player.minigunSpinUntil = 0;
    if (wasSpinning) this.event('minigun-spin', { id: player.id, spinning: false });
    if (!player._weaponHand && this.dualWeaponIds(player)) this.withWeaponHand(player, 'secondary', () => this.cancelMinigunSpin(player));
    return true;
  }

  cancelMelee(id, lifecycle = false) {
    if (this.paused && !lifecycle) return false;
    const player = this.players.get(id);
    if (!player?.pendingMelee) return false;
    const { attack, attackId } = player.pendingMelee;
    player.pendingMelee = null;
    // A cancelled wind-up still costs its full recovery. Dropping, equipping
    // or pausing cannot turn heavy attacks into rapid free attempts.
    this.event('melee-cancel', { id, attack, attackId });
    return true;
  }

  setMinigunSpin(id, spinning, hand = 'primary') {
    const player = this.players.get(id);
    if (!player || this.paused) return false;
    // Legacy internal callers supplied optional readiness metadata here.
    // It remains ignored: only the server's clock can finish the wind-up.
    // Network adapters separately validate their new explicit hand field.
    if (hand && typeof hand === 'object' && !Array.isArray(hand)) hand = 'primary';
    return this.withWeaponHand(player, hand, () => this.setHeldMinigunSpin(id, spinning));
  }

  setHeldMinigunSpin(id, spinning) {
    const player = this.players.get(id);
    if (this.paused || !player || typeof spinning !== 'boolean') return false;
    if (!spinning) return this.cancelMinigunSpin(player);
    if (!player.alive || player.downed || player.umbrella.open || player.weapon !== 'minigun' || weaponStock(player)?.ammo <= 0 || !weaponStock(player) || player.reloadUntil > this.time || !HAZARD_PHASES.includes(this.phase)) return false;
    if (!player.minigunSpinning) {
      player.minigunSpinning = true; player.minigunSpinUntil = this.time + MINIGUN_WINDUP;
      this.event('minigun-spin', { id, spinning: true, duration: MINIGUN_WINDUP });
    }
    return true;
  }

  awardPoints(player, amount, cash = amount) {
    if (this.practice || player.waiting) return;
    this.addScore(player, amount);
    player.points += cash;
  }

  // The score (owner, 18 October) is whole points: a snapshot or an event
  // never carries a fraction. What falloff, burns or repairs leave below a
  // point waits in scoreCarry (0 to 1) for the next hit, so nothing is lost
  // or rounded away. The practice stand keeps its running score, as it
  // always has (its hits and kills scored; awardPoints pays nothing there).
  addScore(player, amount) {
    if (!player || player.waiting || !(amount > 0) || !Number.isFinite(amount)) return 0;
    const total = (player.scoreCarry ?? 0) + amount, gained = Math.floor(total + 1e-9);
    player.scoreCarry = Math.min(1, Math.max(0, total - gained));
    player.score += gained;
    return gained;
  }

  // Rule 1: a survivor's (or companion's) hit scores the health it really
  // removed, after resistance and never past what the enemy had left, from
  // any weapon. No fixed amount per hit or per kill: a head shot already
  // pays in time and ammunition. A revive credit on this survivor copies it
  // (rule 5); the survivor alone sees it as a number at the impact.
  scoreDamage(player, zombie, removed, point = null, { headshot = false, continuous = false, killed = false, burn = false, rocket = false } = {}) {
    if (!player || !this.players.has(player.id) || !(removed > 0)) return 0;
    const gained = this.addScore(player, removed);
    const credit = gained > 0 && !this.practice ? this.openReviveCredit(player.id) : null;
    if (credit) credit.copied += gained;
    if (this.impactObservers.has(player.id) && (gained > 0 || killed)) {
      if (burn) this.queueBurnNumber(zombie, player.id, gained, killed);
      else if (point) this.queueImpactNumber(player.id, zombie.id, gained, point, { headshot, continuous, killed, rocket });
    }
    return gained;
  }

  // The survivors who asked for impact numbers (the servers' open sockets).
  // One who stops loses only what was still waiting for them.
  setImpactObservers(ids) {
    if (!ids || typeof ids[Symbol.iterator] !== 'function' || typeof ids === 'string') return false;
    this.impactObservers = new Set([...ids].filter(id => typeof id === 'string' && this.players.has(id)));
    for (const id of [...this.impactPending.keys()]) if (!this.impactObservers.has(id)) this.dropImpactNumbers(id);
    for (const [key, entry] of this.burnDamagePending) if (!this.impactObservers.has(entry.ownerId)) this.burnDamagePending.delete(key);
    if (!this.burnDamagePending.size) this.burnDamageNextAt = 0;
    return true;
  }

  dropImpactNumbers(id) {
    this.impactPending.delete(id);
    for (const [key, entry] of this.burnDamagePending) if (entry.ownerId === id) this.burnDamagePending.delete(key);
    if (!this.burnDamagePending.size) this.burnDamageNextAt = 0;
  }

  // Pellets of one shot and simultaneous hits on one enemy, until the next
  // takeImpactNumbers (every tick), make one number at the first contact.
  queueImpactNumber(ownerId, zombieId, amount, point, { headshot = false, continuous = false, killed = false, burn = false, rocket = false } = {}) {
    let pending = this.impactPending.get(ownerId);
    if (!pending) this.impactPending.set(ownerId, pending = new Map());
    const record = pending.get(zombieId);
    if (record) Object.assign(record, { amount: record.amount + amount, headshot: record.headshot || headshot,
      continuous: record.continuous && continuous, killed: record.killed || killed, burn: record.burn && burn, rocket: record.rocket || rocket });
    else pending.set(zombieId, { zombieId, x: point.x, y: point.y, z: point.z, amount, headshot, continuous, killed, burn, rocket });
  }

  // What each observer's own attacks scored since the last call: one list
  // per survivor, one record per enemy, [enemy id, x, y, z, points, flags]
  // (1 head shot, 2 flame or burn, 4 killing blow, 8 burn batch, 16 rocket
  // blast: resolved at once here, drawn by its shooter when the visible
  // rocket lands), centimetre positions.
  // The biggest and the killing blows first, IMPACT_NUMBER_BATCH at most.
  takeImpactNumbers() {
    const batches = new Map();
    for (const [id, pending] of this.impactPending) {
      if (!this.impactObservers.has(id) || !pending.size) continue;
      const records = [...pending.values()].sort((a, b) => Number(b.killed) - Number(a.killed) || b.amount - a.amount).slice(0, IMPACT_NUMBER_BATCH);
      batches.set(id, records.map(record => [record.zombieId, centi(record.x), centi(record.y), centi(record.z), record.amount,
        (record.headshot ? 1 : 0) | (record.continuous ? 2 : 0) | (record.killed ? 4 : 0) | (record.burn ? 8 : 0) | (record.rocket ? 16 : 0)]));
    }
    this.impactPending.clear();
    return batches;
  }

  // Rule 5: lifting a teammate (by hand, or with a kit used on them) opens
  // a credit for the reviver on them. While open, their own damage score is
  // copied into it; they keep theirs. Going down again, elimination or
  // leaving close it, frozen; a new revive opens a new one for its reviver.
  beginReviveCredit(reviver, revived) {
    if (this.practice || !reviver || !revived || reviver.id === revived.id) return null;
    this.closeReviveCredit(revived.id);
    const credit = { reviverId: reviver.id, revivedId: revived.id, revivedName: revived.name, copied: 0, open: true };
    this.reviveCredits.push(credit);
    return credit;
  }

  openReviveCredit(revivedId) { return this.reviveCredits.find(credit => credit.open && credit.revivedId === revivedId) ?? null; }

  closeReviveCredit(revivedId) { for (const credit of this.reviveCredits) if (credit.revivedId === revivedId) credit.open = false; }

  // At the end of the wave, a victory or a game over, each credit pays its
  // reviver max(REVIVE_SCORE_FLOOR, copied damage). A reviver who left the
  // room loses it; one whose restored seat is still free keeps it.
  payReviveCredits(reason) {
    const credits = this.reviveCredits;
    this.reviveCredits = [];
    if (this.practice) return [];
    const payouts = [];
    for (const credit of credits) {
      const reviver = this.players.get(credit.reviverId) ?? this.reservedSeats?.get(credit.reviverId);
      if (!reviver) continue;
      const amount = Math.max(REVIVE_SCORE_FLOOR, Math.round(credit.copied));
      reviver.score += amount;
      const revived = this.players.get(credit.revivedId) ?? this.reservedSeats?.get(credit.revivedId);
      payouts.push({ reviverId: credit.reviverId, revivedId: credit.revivedId, reviverName: reviver.name,
        revivedName: revived?.name ?? credit.revivedName ?? null, damage: Math.round(credit.copied), amount });
    }
    if (payouts.length) this.event('revive-bonus', { wave: this.wave, reason, payouts });
    return payouts;
  }

  dropZombieLoot(zombie, killReward, killer = null) {
    if (this.practice) return;
    // Zombies may be shot before entering the playable perimeter. Put their
    // loot on its reachable edge, rather than outside the survivors' bounds.
    let x = clamp(zombie.x, EXTERIOR.bounds.minX + .25, EXTERIOR.bounds.maxX - .25);
    let z = clamp(zombie.z, EXTERIOR.bounds.minZ + .25, EXTERIOR.bounds.maxZ - .25);
    // A body dying against a parking prop leaves its loot beside it.
    if (HAS_SPACE) ({ x, z } = this.freeSpotNear(x, z, 0, .5, .25));
    // A stair's projection also contains the ground-floor underpass. Use the
    // dead body's actual feet, never an overhead tread or an absent loft slab.
    // Clamped outdoor kills remain on the reachable outdoor ground.
    const feetY = Number.isFinite(zombie.y) ? zombie.y : 0;
    let y = HAS_SPACE ? restingSurface(x,z,feetY+.01) : 0;
    if (!HAS_SPACE && !outsideCabin(x, z)) {
      if (isStair(x, z) && feetY >= stairStepY(z) - 1e-6) y = stairStepY(z);
      if (hasLoftFloor(x, z, 0) && feetY >= WORLD.loftY - 1e-6) y = Math.max(y, WORLD.loftY);
    }
    const add = (kind, amount, special = false) => {
      const id = `p${this.nextPickupId++}`;
      const pickup = { id, kind, x, y, z, amount, special, expiresAt: this.time + PICKUPS.lifetime };
      this.pickups.set(id, pickup);
      return pickup;
    };
    if (zombie.kind === 'raider') return this.dropRaiderLoot(zombie, killReward, add);
    // A companion's kill pays it directly (a guaranteed income); it picks up
    // the piles on the floor like anyone (owner, 13 October).
    if (killer?.companion === true) killer.points += killReward;
    else add('points', killReward);
    this.lootKills++;
    // A deterministic guarantee avoids a late-wave ammunition wall caused
    // only by bad random luck. No pickup is rolled again on later ticks.
    if (this.lootKills % PICKUPS.ammoEveryKills === 0) {
      this.ammoDrops++;
      const box = add('ammo', 1, this.ammoDrops % PICKUPS.specialEvery === 0);
      box.charge = PICKUPS.ammoCharge;
    }
    if (this.lootKills % supplyCadence(PICKUPS.healthEveryKills, this.difficulty) === 0) add('health', 100);
    if (this.wave >= PICKUPS.armorFromWave && this.lootKills % PICKUPS.armorEveryKills === 0) add('armor', ARMOR.max);
    if (this.wave >= PICKUPS.reviveFromWave && this.lootKills % supplyCadence(PICKUPS.reviveEveryKills, this.difficulty) === 0) add('revive', 1);
    if (this.phase === 'wave') {
      this.waveKills++;
      while (this.waveGrenadeDrops < this.waveGrenadeThresholds.length
        && this.waveKills >= this.waveGrenadeThresholds[this.waveGrenadeDrops]) {
        add('grenade', 1);
        this.waveGrenadeDrops++;
      }
    }
  }

  // A survivor may call the next wave early during the break; once every
  // survivor present has, it comes NEXT_WAVE_CALL seconds later.
  voteNextWave(id, ready = true) {
    const player = this.players.get(id);
    if (this.practice || this.paused || !player || player.waiting || this.phase !== 'intermission') return false;
    player.nextWaveVote = ready !== false;
    const voters = this.nextWaveVoters();
    this.event('next-wave-vote', { id, ready: player.nextWaveVote, votes: voters.filter(voter => voter.nextWaveVote).length, total: voters.length });
    this.callNextWaveWhenReady();
    return true;
  }

  nextWaveVoters() { return [...this.players.values()].filter(player => !player.waiting && player.companion !== true); }

  callNextWaveWhenReady() {
    if (this.phase !== 'intermission' || this.nextWaveCalled) return;
    const voters = this.nextWaveVoters();
    if (!voters.length || !voters.every(player => player.nextWaveVote)) return;
    this.nextWaveCalled = true;
    if (this.timeLeft > NEXT_WAVE_CALL) this.timeLeft = NEXT_WAVE_CALL;
    this.event('next-wave-called', { seconds: Math.ceil(this.timeLeft) });
  }

  // Coins slide toward the nearest survivor who could pick them up from a
  // little farther away: never through a wall, a board or another floor.
  attractCoins(delta) {
    if (!(delta > 0)) return;
    for (const pickup of this.pickups.values()) {
      if (pickup.kind !== 'points') continue;
      let target = null, gap = Infinity;
      for (const player of this.players.values()) {
        if (player.id === pickup.droppedBy) continue; // a gift never flies back
        const between = distance(player, pickup);
        if (between < gap && between <= PICKUPS.magnetReach && this.canCollectPickup(player, pickup, PICKUPS.magnetReach)) { target = player; gap = between; }
      }
      if (!target || gap <= 1e-6) continue;
      const pull = 1 - gap / PICKUPS.magnetReach;
      const step = Math.min(gap, (PICKUPS.magnetSpeed.edge + (PICKUPS.magnetSpeed.contact - PICKUPS.magnetSpeed.edge) * pull) * delta);
      const onFurniture = furnitureTopAt(pickup.x, pickup.z, pickup.y);
      pickup.x += (target.x - pickup.x) / gap * step;
      pickup.z += (target.z - pickup.z) / gap * step;
      // Pulled off the sofa seat or the table, a coin falls to what is under
      // it. Elsewhere (stairs, loft, the well's edge) it keeps its height.
      if (onFurniture && !furnitureTopAt(pickup.x, pickup.z, pickup.y)) pickup.y = restingSurface(pickup.x, pickup.z, pickup.y);
    }
  }

  canCollectPickup(player, pickup, reach = PICKUPS.reach) {
    if (!player.alive || player.downed || distance(player, pickup) > reach
      || Math.abs(player.y - pickup.y) > PICKUPS.heightReach) return false;
    // Ground/loft floors, furniture, walls and individual boards all stop a
    // pickup. A short reach never permits collecting through a barricade.
    const origin = { x: player.x, y: player.y + .3, z: player.z };
    const direction = { x: pickup.x - origin.x, y: pickup.y + .3 - origin.y, z: pickup.z - origin.z };
    if (this.solidBoxes().some(box => rayBox(origin, direction, box, 1) <= 1)) return false;
    for (const door of this.doors) {
      const startNormal = door.outZ ? player.z - door.z : player.x - door.x;
      const endNormal = door.outZ ? pickup.z - door.z : pickup.x - door.x;
      if (startNormal * endNormal <= 0 && Math.abs(startNormal - endNormal) > 1e-8) {
        const crossing = startNormal / (startNormal - endNormal);
        const tangent = door.outZ ? player.x + (pickup.x - player.x) * crossing : player.z + (pickup.z - player.z) * crossing;
        if (Math.abs(tangent) < 1.3 && !this.doorPassable(door, Math.min(player.y, pickup.y), playerHeight(player))) return false;
      }
      for (const board of BARRICADE_BOARDS) {
        if (door.boards[board.index] > 0 && rayBoard(origin, direction, door, board, 1) <= 1) return false;
      }
    }
    return true;
  }

  collectPickups() {
    if (['lobby', ...FROZEN_PHASES].includes(this.phase)) return;
    for (const pickup of this.pickups.values()) {
      if (this.time >= pickup.expiresAt) { this.pickups.delete(pickup.id); continue; }
      const nearby = [...this.players.values()].filter(player => !(pickup.droppedBy === player.id && this.time < (pickup.giftAt ?? 0))
        && (player.companion !== true || pickup.kind === 'points' || player.collectTargetId === pickup.id) && this.canCollectPickup(player, pickup))
        .sort((a, b) => distance(a, pickup) - distance(b, pickup));
      for (const player of nearby) {
        const ammo = [];
        let healed = 0, armorGained = 0, removed = true, remainingFill, partial = false;
        if (pickup.kind === 'points') player.points += pickup.amount;
        else if (pickup.kind === 'revive') {
          if (player.reviveKit) continue; // one kit at a time: left for a teammate
          player.reviveKit = true;
        }
        else if (pickup.kind === 'health') {
          const { maxHp: maximum, medkitHealMultiplier: share } = characterStats(player);
          if (!(player.hp > 0 && player.hp < maximum)) continue;
          // A Chimie debt's weaker medkit restores only part of what is missing.
          if (share < 1) {
            healed = Math.min(maximum - player.hp, Math.max(1, Math.round((maximum - player.hp) * share)));
            player.hp += healed; partial = player.hp < maximum;
          } else {
            healed = maximum - player.hp;
            player.hp = maximum;
          }
        } else if (pickup.kind === 'armor') {
          // A full vest leaves the pickup for the next survivor.
          if (!((player.armor ?? 0) < ARMOR.max)) continue;
          armorGained = ARMOR.max - (player.armor ?? 0);
          player.armor = ARMOR.max;
        } else if (pickup.kind === 'grenade') {
          if (player.grenades >= characterStats(player).maxGrenades) continue;
          player.grenades++;
        } else if (pickup.kind === 'ammo') {
          const refill = pickup.special ? PICKUPS.specialAmmo : PICKUPS.ammo;
          const available = Number.isInteger(pickup.charge) ? clamp(pickup.charge, 0, PICKUPS.ammoCharge) : PICKUPS.ammoCharge;
          let consumed = 0;
          for (const [name, inventory] of Object.entries(player.inventory)) {
            const weapon = this.weaponProfile(player, name);
            const type = weaponType(name, inventory);
            const quantity = refill[type] ?? 0;
            if (!weapon || !(quantity > 0)) continue;
            const cost = PICKUPS.ammoCharge / quantity;
            const room = Math.max(0, Math.floor(weapon.magazine + weapon.reserve - inventory.ammo - inventory.reserve));
            const amount = Math.min(room, Math.floor(available / cost));
            if (amount > 0) {
              inventory.reserve += amount;
              ammo.push({ weapon: type, amount, ...(name !== type ? { weaponId: name } : {}) });
              // A full box has always refilled both carried weapons at once.
              // Preserve that paired refill with one budget: use the larger
              // fraction, rather than granting a fresh box to each survivor.
              consumed = Math.max(consumed, amount * cost);
            }
          }
          if (!ammo.length) continue;
          pickup.charge = available - consumed;
          const minimumCost = Math.min(...Object.values(refill).filter(quantity => quantity > 0).map(quantity => PICKUPS.ammoCharge / quantity));
          removed = pickup.charge < minimumCost;
          remainingFill = removed ? 0 : pickup.charge / PICKUPS.ammoCharge;
        } else continue;
        if (removed) this.pickups.delete(pickup.id);
        this.event('pickup', { id: player.id, pickupId: pickup.id, kind: pickup.kind, amount: pickup.amount, special: pickup.special,
          points: player.points, ammo, healed, armorGained, armor: player.armor ?? 0, remainingFill, removed, grenades: player.grenades,
          reviveKit: player.reviveKit === true, ...(partial ? { partial: true } : {}), ...(pickup.droppedBy && pickup.droppedBy !== player.id ? { fromId: pickup.droppedBy } : {}) });
        if (removed) break;
      }
    }
  }

  interactionVisible(player, target, ignoredCover = null) {
    const origin = { x: player.x, y: player.y + playerEyeHeight(player), z: player.z };
    const direction = { x: target.x - origin.x, y: (target.y ?? 0) + .6 - origin.y, z: target.z - origin.z };
    if (this.solidBoxes().some(box => box.id !== ignoredCover && rayBox(origin, direction, box, 1) < 1 - 1e-6)) return false;
    return this.doors.every(door => door.boards.every((hp, index) => hp <= 0 || rayBoard(origin, direction, door, BARRICADE_BOARDS[index], 1) >= 1 - 1e-6));
  }

  weaponProfile(player, id = player?.weapon) {
    const type = weaponType(id, player?.inventory?.[id]);
    return upgradedWeapon(WEAPONS[type], type, player?.bonus, player?.sheetDebt);
  }

  weaponSlots(player) {
    return player?.backpack === true ? BACKPACK.slots : MAX_WEAPON_SLOTS;
  }

  backpackMovementMultiplier(player) {
    // Weight follows the actual authoritative inventory, never a client flag
    // or a cached counter that could survive an exchange, death drop or reset.
    const carried = Object.keys(player?.inventory ?? {}).length;
    return BACKPACK.movementMultipliers[Math.min(carried, BACKPACK.slots)] ?? 1;
  }

  playerMovementMultiplier(player) {
    const secondary = player?.dualWield && characterStats(player).dualWield && player.secondaryWeaponId !== activeWeaponId(player)
      && Object.hasOwn(player.inventory ?? {}, player.secondaryWeaponId) ? player.secondaryWeaponId : null;
    const weight = secondary ? Math.min(WEAPON_MOVEMENT[player?.weapon] ?? 1,
      WEAPON_MOVEMENT[weaponType(secondary, player.inventory[secondary])] ?? 1) : WEAPON_MOVEMENT[player?.weapon] ?? 1;
    return weight * this.backpackMovementMultiplier(player) * characterStats(player).speedMultiplier;
  }

  groundWeaponPosition(player, weapon = player.weapon) {
    const profile = GROUND_WEAPON_BOUNDS[weapon];
    if (!profile) return null;
    const candidates = [GROUND_WEAPONS.dropDistance, GROUND_WEAPONS.dropDistance / 2, 0]
      .map(ahead => ({ x: player.x - Math.sin(player.yaw) * ahead, z: player.z - Math.cos(player.yaw) * ahead }));
    for (const radius of [.3, .6]) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      candidates.push({ x: player.x + dx * radius, z: player.z + dz * radius });
    }
    const expanded = candidates.flatMap(point => inRect(point.x, point.z, STAIRS, PLAYER_RADIUS)
      && player.y >= stairStepY(point.z) - PICKUPS.heightReach
      ? [point, { x: clamp(point.x, STAIRS.minX + profile.halfWidth + .01, STAIRS.maxX - profile.halfWidth - .01), z: point.z }]
      : [point]);
    for (const { x, z } of expanded) {
      if (!inRect(x, z, EXTERIOR.bounds)) continue;
      const y = restingSurface(x, z, player.y + PICKUPS.heightReach);
      if (player.grounded !== false && Math.abs(player.y - y) > PICKUPS.heightReach + 1e-6) continue;
      const onSteps = isStair(x, z) && y > 0 && y >= stairStepY(z) - 1e-6;
      const pitch = onSteps ? Math.atan2(STAIRS.topY, STAIRS.maxZ - STAIRS.minZ) : 0;
      for (const yaw of onSteps ? [0] : [0, Math.PI / 2]) {
        const c = Math.cos(yaw), s = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
        const axes = [{ x: c, y: 0, z: -s }, { x: s * sp, y: cp, z: c * sp }, { x: s * cp, y: -sp, z: c * cp }];
        const half = [profile.halfWidth, profile.height / 2, profile.halfLength];
        let modelLift = 0;
        if (onSteps) {
          // Rest the inclined underside above every discrete riser it spans.
          // The gun keeps its actual dimensions; it is never shrunk to a point.
          const minZ = z + profile.floorOffset * sp - profile.halfLength * cp;
          const maxZ = z + profile.floorOffset * sp + profile.halfLength * cp;
          const slope = Math.tan(pitch), bottom = profile.floorOffset / cp;
          modelLift = Math.max(0, -y + slope * (maxZ - z) - bottom);
          const supports = SOLID_BOXES.filter(box => STAIR_TREADS.includes(box)
            || box.minY === LOFT.y - LOFT.thickness && box.maxY === LOFT.y);
          for (const box of supports) {
            if (x + profile.halfWidth <= box.minX || x - profile.halfWidth >= box.maxX || maxZ <= box.minZ || minZ >= box.maxZ) continue;
            modelLift = Math.max(modelLift, box.maxY - y + slope * (Math.min(maxZ, box.maxZ) - z) - bottom);
          }
          modelLift += .002;
        }
        const localCentreY = profile.floorOffset + profile.height / 2;
        const centre = { x: x + axes[1].x * localCentreY, y: y + modelLift + axes[1].y * localCentreY, z: z + axes[1].z * localCentreY };
        const extent = axis => half.reduce((sum, value, index) => sum + value * Math.abs(axes[index][axis]), 0);
        if (centre.x - extent('x') < EXTERIOR.bounds.minX || centre.x + extent('x') > EXTERIOR.bounds.maxX
          || centre.z - extent('z') < EXTERIOR.bounds.minZ || centre.z + extent('z') > EXTERIOR.bounds.maxZ) continue;
        if (this.solidBoxes().some(box => orientedBoxIntersects(centre, axes, half, box))) continue;
        const frames = HAS_SPACE ? [] : [...STAIR_STRINGERS.map(stringerFrame)];
        for (const door of this.doors) for (const board of BARRICADE_BOARDS) {
          if (door.boards[board.index] > 0) frames.push(boardFrame(door, board));
        }
        if (frames.some(frame => orientedBoxIntersects(frame.into(centre), axes.map(axis => frame.into(axis, true)), half, frame.box))) continue;
        const point = { x, y, z, yaw, pitch, modelLift };
        const onSurface = { ...player, y: Math.max(y, Math.min(player.y, y + PICKUPS.heightReach)) };
        if (this.canCollectPickup(onSurface, point) && this.interactionVisible(onSurface, point)) return point;
      }
    }
    return null;
  }

  nearbyGroundWeapon(player) {
    if (!player?.alive || player.downed || !HAZARD_PHASES.includes(this.phase)) return null;
    return [...this.pickups.values()].filter(pickup => pickup.kind === 'weapon' && validWeapon(pickup.weapon)
      && this.canCollectPickup(player, pickup) && this.interactionVisible(player, pickup))
      .sort((a, b) => distance(player, a) - distance(player, b) || a.id.localeCompare(b.id))[0] ?? null;
  }

  dropWeapon(id) {
    const player = this.players.get(id);
    if (this.paused || !player?.alive || player.downed || !validWeapon(player.weapon) || !weaponStock(player)
      || player.interactAfter > this.time || !HAZARD_PHASES.includes(this.phase)) return false;
    const point = this.groundWeaponPosition(player);
    if (!point) {
      player.interactAfter = this.time + GROUND_WEAPONS.interactCooldown;
      this.event('weapon-drop-denied', { id, weapon: player.weapon, reason: 'space' });
      return false;
    }
    const weapon = player.weapon, weaponId = activeWeaponId(player), stock = weaponStock(player);
    const pickup = { id: `p${this.nextPickupId++}`, kind: 'weapon', ...point, weapon,
      ammo: stock.ammo, reserve: stock.reserve, expiresAt: Infinity };
    this.pickups.set(pickup.id, pickup);
    delete player.inventory[weaponId];
    (player.issuedWeapons ??= new Set()).add(weapon);
    this.cancelMinigunSpin(player);
    this.cancelMelee(player.id);
    player.reloadUntil = 0;
    this.selectInventoryWeapon(player, Object.keys(player.inventory)[0] ?? null);
    this.lockWeaponSwitch(player);
    player.interactAfter = this.time + GROUND_WEAPONS.interactCooldown;
    this.event('weapon-drop', { id, pickupId: pickup.id, weapon, ammo: pickup.ammo, reserve: pickup.reserve });
    return true;
  }

  takeGroundWeapon(id, pickupId) {
    const player = this.players.get(id), pickup = this.pickups.get(pickupId);
    if (this.paused || !player?.alive || player.downed || player.interactAfter > this.time || !HAZARD_PHASES.includes(this.phase)
      || pickup?.kind !== 'weapon' || !validWeapon(pickup.weapon)
      || !this.canCollectPickup(player, pickup) || !this.interactionVisible(player, pickup)) return false;
    const replacedId = Object.keys(player.inventory).length >= this.weaponSlots(player) ? activeWeaponId(player) : null;
    const replacedWeapon = replacedId ? weaponType(replacedId, player.inventory[replacedId]) : null;
    const replacement = replacedId && player.inventory[replacedId];
    const abandonedPosition = replacement ? this.groundWeaponPosition(player, replacedWeapon) : null;
    if (replacement && !abandonedPosition || Object.keys(player.inventory).length >= this.weaponSlots(player) && !replacement) {
      player.interactAfter = this.time + GROUND_WEAPONS.interactCooldown;
      this.event('weapon-pickup-denied', { id, pickupId, weapon: pickup.weapon, reason: 'space' });
      return false;
    }
    const stock = { ammo: pickup.ammo, reserve: pickup.reserve };
    const weaponId = this.newInventoryWeaponId(player, pickup.weapon);
    this.pickups.delete(pickupId);
    if (replacement) {
      // Allocate against every occupied id before replacing the selected slot:
      // another copy must never be overwritten by Object.fromEntries.
      player.inventory = Object.fromEntries(Object.entries(player.inventory).map(([name, inventory]) =>
        name === replacedId ? [weaponId, stock] : [name, inventory]));
      const abandoned = { ...pickup, ...abandonedPosition, id: `p${this.nextPickupId++}`, weapon: replacedWeapon,
        ammo: replacement.ammo, reserve: replacement.reserve, expiresAt: Infinity };
      this.pickups.set(abandoned.id, abandoned);
      this.event('weapon-drop', { id, pickupId: abandoned.id, weapon: replacedWeapon,
        ammo: abandoned.ammo, reserve: abandoned.reserve, exchange: true });
    } else player.inventory[weaponId] = stock;
    (player.issuedWeapons ??= new Set()).add(pickup.weapon);
    if (replacedWeapon) player.issuedWeapons.add(replacedWeapon);
    this.cancelMinigunSpin(player);
    this.cancelMelee(player.id);
    player.reloadUntil = 0;
    this.selectInventoryWeapon(player, weaponId);
    this.normalizeInventory(player);
    this.lockWeaponSwitch(player);
    player.interactAfter = this.time + GROUND_WEAPONS.interactCooldown;
    this.event('weapon-pickup', { id, pickupId, weapon: pickup.weapon, ammo: stock.ammo, reserve: stock.reserve, replacedWeapon });
    return true;
  }

  buyWeapon(id, crateId) {
    const player = this.players.get(id);
    const crate = ARMORY.find(item => item.id === crateId);
    if (this.paused || !player || !crate || !player.alive || player.downed || player.interactAfter > this.time || ['lobby', ...FROZEN_PHASES].includes(this.phase)) return false;
    if (distance(player, crate) >= ARMORY_REACH || Math.abs(player.y - crate.y) >= ARMORY_HEIGHT_REACH) return false;
    if (!this.interactionVisible(player, crate, `rack-${crate.id}`)) return false;
    player.interactAfter = this.time + .6;
    if (this.wave < (crate.unlockWave ?? 0)) {
      this.event('purchase-denied', { id, crateId, message: `${crate.label} disponible à la vague ${crate.unlockWave}.` });
      return false;
    }
    if (resolveWeaponId(player, crate.weapon)) {
      this.chooseWeapon(id, crate.weapon);
      return true;
    }
    if (crate.weapon === 'magnum' && !this.practice && !this.magnumAvailable()) {
      this.event('purchase-denied', { id, crateId, reason: 'unique', message: 'Le Magnum doré est unique : il est déjà porté ou au sol.' });
      return false;
    }
    if (player.issuedWeapons?.has(crate.weapon)) {
      this.event('purchase-denied', { id, crateId, message: 'Cette arme a déjà été abandonnée pendant cette vague. Elle sera de nouveau disponible à la prochaine vague.' });
      return false;
    }
    if (player.points < crate.price) {
      this.event('purchase-denied', { id, crateId, message: `Il te manque ${crate.price - player.points} pièces pour ${WEAPONS[crate.weapon].name.toLowerCase()}.` });
      return false;
    }
    const replacedId = Object.keys(player.inventory).length >= this.weaponSlots(player) ? activeWeaponId(player) : null;
    const replacedWeapon = replacedId ? weaponType(replacedId, player.inventory[replacedId]) : null;
    const replacement = replacedId && player.inventory[replacedId];
    const abandonedPosition = replacement ? this.groundWeaponPosition(player, replacedWeapon) : null;
    if (Object.keys(player.inventory).length >= this.weaponSlots(player) && (!replacement || !abandonedPosition)) {
      // An exchange needs legal supporting space before money or stock moves.
      // Reuse the bilingual drop failure already understood by the client.
      this.event('weapon-drop-denied', { id, crateId, weapon: replacedWeapon, reason: 'space' });
      return false;
    }
    const stock = weaponInventory([crate.weapon], player.bonus, player.sheetDebt)[crate.weapon];
    player.points -= crate.price;
    if (replacedWeapon) {
      // Keep the two key slots stable; replacing slot one must not swap 1/2.
      player.inventory = Object.fromEntries(Object.entries(player.inventory).map(([name, inventory]) => name === replacedId ? [crate.weapon, stock] : [name, inventory]));
      const abandoned = { id: `p${this.nextPickupId++}`, kind: 'weapon', ...abandonedPosition, weapon: replacedWeapon,
        ammo: replacement.ammo, reserve: replacement.reserve, expiresAt: Infinity };
      this.pickups.set(abandoned.id, abandoned);
      (player.issuedWeapons ??= new Set()).add(replacedWeapon);
      this.event('weapon-drop', { id, pickupId: abandoned.id, weapon: replacedWeapon,
        ammo: abandoned.ammo, reserve: abandoned.reserve, exchange: true });
    } else player.inventory[crate.weapon] = stock;
    (player.issuedWeapons ??= new Set()).add(crate.weapon);
    this.chooseWeapon(id, crate.weapon);
    this.event('purchase', { id, crateId, weapon: crate.weapon, price: crate.price, points: player.points, replacedWeapon });
    return true;
  }

  start(id) {
    if (this.practice) return false;
    if (id !== this.hostId || !['lobby', 'gameover', 'victory'].includes(this.phase) || !this.players.size) return false;
    this.releaseSeats();
    this.paused = false;
    this.pauseById = null;
    this.wave = 0;
    this.nextZombieId = 1;
    this.zombies.clear();
    this.spawnWarnings.clear();
    this.raid = null;
    this.raidWarnings.clear();
    this.nextRaiderId = 1;
    this.raidLootIds.clear();
    this.resetExpedition();
    this.pickups.clear();
    this.supplyCrate = null;
    this.nextPickupId = 1;
    this.lootKills = 0;
    this.ammoDrops = 0;
    this.grenades.clear();
    this.bullets.clear();
    this.nextGrenadeId = 1;
    this.burnDamagePending.clear();
    this.burnDamageNextAt = 0;
    this.impactPending.clear();
    this.reviveCredits = [];
    this.waveKills = 0;
    this.waveInitialTotal = 0;
    this.wavePlayerCount = null;
    this.waveGrenadeThresholds = [];
    this.waveGrenadeDrops = 0;
    this.brutesToSpawn = 0;
    this.waveSpawned = 0;
    this.bruteSpawnAt = [];
    this.doors = this.createDoors();
    for (const [index, player] of [...this.players.values()].entries()) {
      this.cancelMelee(player.id);
      // Each night restarts from the sheet's innate debt (character-sheet.js).
      const sheetDebt = innateDebt(player.sheet);
      Object.assign(player, { x: -2.8 + index * 1.1, y: 0, z: 1.7, hp: characterStats({ bonus: null, sheetDebt }).maxHp, armor: 0, downed: false, alive: true, waiting: false, ready: false,
        score: 0, scoreCarry: 0, points: 0, kills: 0, bleedOutAt: 0, grenades: 0, throwAfter: 0, reloadUntil: 0, shotAfter: 0, interactAfter: 0, minigunSpinning: false, minigunSpinUntil: 0,
        grenadierInterval: 0, grenadierUntil: null,
        killChain: 0, lastKillAt: -Infinity, nextWaveVote: false, reviveKit: false, reviveShieldUntil: 0,
        startingWeapon: STARTER_WEAPON, weapon: STARTER_WEAPON, weaponId: STARTER_WEAPON, inventory: weaponInventory([STARTER_WEAPON], null, sheetDebt), issuedWeapons: new Set([STARTER_WEAPON]),
        pendingMelee: null, meleeAfter: 0, partitionSlideLeft: 0, umbrella: { open: false, remaining: UMBRELLA.max },
        dualWield: false, secondaryWeaponId: null, weaponStates: {}, switchUntil: 0,
        bonus: null, sheetDebt, backpack: false, supplyPurchases: [],
        vy: 0, grounded: true, fallStartY: null, crouched: false, jumpHeld: false, jumpRequested: false, outsideDamageAccumulator: 0,
        input: { forward: 0, strafe: 0, sprint: false, crouch: false }, lastInputAt: this.time });
    }
    this.phase = 'countdown';
    this.timeLeft = 5;
    this.beginSupplyWave();
    this.event('countdown', { seconds: 5 });
    return true;
  }

  livingPlayers() {
    return [...this.players.values()].filter(player => !player.waiting && player.alive && !player.downed);
  }

  // Standing survivors, plus downed ones who can still get up with a kit.
  fightingPlayers() {
    return [...this.players.values()].filter(player => !player.waiting && player.alive && (!player.downed || player.reviveKit === true));
  }

  // Can this survivor revive (or keep reviving) that downed teammate?
  canReviveTarget(player, target, reach) {
    return Boolean(target && target.id !== player.id && target.alive && target.downed && !target.waiting
      && distance(player, target) < reach && Math.abs(player.y - target.y) < REVIVE.heightReach && this.interactionVisible(player, target));
  }

  // The downed teammate this survivor would start reviving (in reach and in
  // sight); the snapshot sends it so the client never offers a revive through
  // a wall.
  reviveTargetFor(player) {
    if (!player.alive || player.downed || player.waiting) return null;
    return [...this.players.values()].find(other => this.canReviveTarget(player, other, REVIVE.startReach)) ?? null;
  }

  revivePlayer(target, hp) {
    target.downed = false;
    target.hp = Math.min(characterStats(target).maxHp, hp);
    target.bleedOutAt = 0;
    target.outsideDamageAccumulator = 0;
    target.reviveShieldUntil = this.time + REVIVE.shield;
    this.resetGrenadier(target);
  }

  // The revive kit (owner, 13 October). Downed, it starts a kitDuration
  // revive (automatic: at once, when the bleed-out runs out). Standing, it
  // revives a downed teammate in reach at once. The kit is spent on success.
  useReviveKit(id, automatic = false) {
    const player = this.players.get(id);
    if ((this.paused && !automatic) || !player || player.waiting || !player.alive || player.reviveKit !== true
      || ['lobby', ...FROZEN_PHASES].includes(this.phase)) return false;
    if (player.downed) {
      if (automatic) { this.finishKitRevive(player, true); return true; }
      if (player.selfReviveAt) return true;
      player.selfReviveAt = this.time + REVIVE.kitDuration;
      this.event('revive-start', { id, targetId: id, duration: REVIVE.kitDuration, kit: true });
      return true;
    }
    if (automatic) return false;
    const current = player.reviving && this.players.get(player.reviving.targetId);
    const teammate = this.canReviveTarget(player, current, REVIVE.reach) ? current : this.reviveTargetFor(player);
    if (!teammate) return false;
    if (player.reviving) player.reviving = null; // the kit finishes the job at once
    player.reviveKit = false;
    teammate.selfReviveAt = 0;
    this.revivePlayer(teammate, REVIVE.kitHp);
    // The coins at once; the score comes from the revive credit (rule 5).
    this.awardPoints(player, 0, ECONOMY.revive);
    this.beginReviveCredit(player, teammate);
    this.event('revive', { id, targetId: teammate.id, kit: true });
    return true;
  }

  finishKitRevive(player, automatic = false) {
    player.reviveKit = false;
    player.selfReviveAt = 0;
    this.revivePlayer(player, REVIVE.kitHp);
    this.event('revive', { id: player.id, targetId: player.id, kit: true, ...(automatic ? { automatic: true } : {}) });
  }

  // Revives under way: a teammate holding E, or a kit on its owner. Both stop
  // the bleed-out; a teammate's stops when E is released, the target is up,
  // or either one is out of reach or down.
  updateRevives(delta) {
    const helped = new Set();
    for (const player of this.players.values()) {
      const channel = player.reviving;
      if (channel) {
        const target = this.players.get(channel.targetId);
        const valid = target && !target.waiting && target.alive && target.downed && player.alive && !player.downed && !player.waiting
          && this.time - channel.lastAt <= REVIVE.holdGrace + 1e-9 && distance(player, target) < REVIVE.reach
          && Math.abs(player.y - target.y) < REVIVE.heightReach;
        if (!valid) {
          player.reviving = null;
          this.event('revive-stop', { id: player.id, targetId: channel.targetId });
        } else if (this.time - channel.startedAt >= (channel.duration ?? characterStats(player).reviveSeconds) - 1e-9) {
          player.reviving = null;
          target.selfReviveAt = 0;
          this.revivePlayer(target, REVIVE.teammateHp);
          this.awardPoints(player, 0, ECONOMY.revive);
          this.beginReviveCredit(player, target);
          player.interactAfter = this.time + 1;
          this.event('revive', { id: player.id, targetId: target.id });
        } else helped.add(target);
      }
      if (player.selfReviveAt) {
        if (!player.alive || !player.downed || player.reviveKit !== true) player.selfReviveAt = 0;
        else if (this.time >= player.selfReviveAt - 1e-9) this.finishKitRevive(player);
        else helped.add(player);
      }
    }
    for (const target of helped) target.bleedOutAt += delta;
  }

  // What the HUD shows of a revive under way, for one survivor.
  reviveStatus(player) {
    if (player.reviving) return { revivingId: player.reviving.targetId, revivedBy: null,
      reviveLeft: Math.max(0, (player.reviving.duration ?? characterStats(player).reviveSeconds) - (this.time - player.reviving.startedAt)) };
    if (player.selfReviveAt) return { revivingId: null, revivedBy: player.id, reviveLeft: Math.max(0, player.selfReviveAt - this.time) };
    let best = null;
    for (const other of this.players.values()) {
      if (other.reviving?.targetId !== player.id) continue;
      const left = Math.max(0, (other.reviving.duration ?? characterStats(other).reviveSeconds) - (this.time - other.reviving.startedAt));
      if (!best || left < best.reviveLeft) best = { revivingId: null, revivedBy: other.id, reviveLeft: left };
    }
    return best ?? { revivingId: null, revivedBy: null, reviveLeft: 0 };
  }

  // Raiders who down a survivor rob them (owner, 13 October): half the coins
  // and the weapon in hand. The golden Magnum is too heavy and falls instead.
  robPlayer(player) {
    if (this.practice) return;
    const coins = Math.floor(Math.max(0, player.points ?? 0) / 2);
    player.points -= coins;
    const stolenId = activeWeaponId(player);
    let weapon = player.weapon && weaponStock(player) ? player.weapon : null, magnum = false;
    // They leave a survivor who only has the starter pistol with it, as it is.
    if (weapon === STARTER_WEAPON && Object.keys(player.inventory).length === 1) weapon = null;
    if (weapon === 'magnum') { this.dropUniqueMagnum(player); weapon = null; magnum = true; }
    else if (weapon) {
      delete player.inventory[stolenId];
      player.issuedWeapons?.delete?.(weapon); // it can be bought again at once
      this.selectInventoryWeapon(player, Object.keys(player.inventory)[0] ?? null);
    }
    if (!player.weapon) {
      Object.assign(player.inventory, weaponInventory([STARTER_WEAPON], player.bonus, player.sheetDebt));
      this.selectInventoryWeapon(player, STARTER_WEAPON);
      player.issuedWeapons?.add?.(STARTER_WEAPON);
    }
    player.reloadUntil = 0;
    this.event('robbed', { id: player.id, coins, weapon, points: player.points, ...(magnum ? { magnum } : {}) });
  }

  // A pack of coins dropped for a teammate (owner, 13 October).
  dropCoins(id) {
    const player = this.players.get(id);
    if (this.paused || this.practice || !player || player.waiting || !player.alive || player.downed || !HAZARD_PHASES.includes(this.phase)
      || (player.coinDropAfter ?? 0) > this.time || !(player.points >= COIN_GIFT.amount)) return false;
    const point = this.recoverableDropPoint(player);
    if (!point) return false;
    player.points -= COIN_GIFT.amount;
    player.coinDropAfter = this.time + COIN_GIFT.cooldown;
    const pickup = { id: `p${this.nextPickupId++}`, kind: 'points', x: point.x, y: point.y, z: point.z, amount: COIN_GIFT.amount, special: false,
      droppedBy: id, giftAt: this.time + COIN_GIFT.dropperDelay, expiresAt: Infinity };
    this.pickups.set(pickup.id, pickup);
    this.event('coins-dropped', { id, pickupId: pickup.id, amount: COIN_GIFT.amount, points: player.points });
    return true;
  }

  // The host picks the night's difficulty before it starts.
  setDifficulty(id, level) {
    if (this.practice || id !== this.hostId || !DIFFICULTY_LEVELS.includes(level) || !['lobby', 'gameover', 'victory'].includes(this.phase)) return false;
    if (this.difficulty === level) return true;
    this.difficulty = level;
    this.event('difficulty', { id, level });
    return true;
  }

  // The host picks friendly fire before the night, like the difficulty.
  setFriendlyFire(id, level) {
    if (this.practice || id !== this.hostId || !FRIENDLY_FIRE_LEVELS.includes(level) || !['lobby', 'gameover', 'victory'].includes(this.phase)
      || level !== 'off' && !friendlyFireAllowed(this.ambiance)) return false;
    if (this.friendlyFire === level) return true;
    this.friendlyFire = level;
    this.event('friendly-fire', { id, level });
    return true;
  }

  beginWave() {
    if (this.practice) return false;
    if (this.wave >= MAX_WAVES || ['extraction', 'victory', 'gameover'].includes(this.phase)) return false;
    this.wave++;
    this.phase = 'wave';
    this.nextWaveCalled = false;
    for (const player of this.players.values()) Object.assign(player, { nextWaveVote: false, waveScoreStart: player.score, waveKillsStart: player.kills });
    this.wavePlayerCount = Math.max(1, this.participantCount());
    this.configureDefendedDoors(this.wavePlayerCount);
    this.beginExpeditionMission();
    this.beginSupplyWave();
    const balance = this.currentWaveBalance();
    this.toSpawn = balance.total;
    this.waveKills = 0;
    this.waveInitialTotal = balance.total;
    this.farSpawnCount = 0;
    this.farSpawnQuota = Math.floor(balance.total * farSpawnShare(this.wave));
    this.waveGrenadeDrops = 0;
    const grenadeQuota = grenadeDropsForWave(this.wave);
    this.waveGrenadeThresholds = Array.from({ length: grenadeQuota }, (_, index) => Math.min(balance.total - 1, Math.ceil(balance.total * (index + 1) / (grenadeQuota + 1))));
    this.brutesToSpawn = balance.brutes;
    this.waveSpawned = 0;
    // Brutes replace ordinary spawns late in the wave; randomness cannot omit
    // the threat or pile every brute into its opening seconds.
    this.bruteSpawnAt = [0.55, 0.8].slice(0, this.brutesToSpawn).map(fraction => Math.ceil(this.toSpawn * fraction));
    this.spawnTimer = 0;
    this.timeLeft = 0;
    this.planRaid();
    this.event('wave', { wave: this.wave, total: this.toSpawn, headshotMultiplier: balance.headshotMultiplier, ...(this.raid ? { raid: this.raid.index } : {}) });
    return true;
  }

  finishWave() {
    if (this.practice || this.spawnWarnings.size) return false;
    if (this.wave >= MAX_WAVES) return this.beginExtraction();
    // Before the break's snapshot: the wave's total includes the bonuses.
    this.payReviveCredits('wave');
    this.phase = 'intermission';
    this.timeLeft = 12;
    this.admitReadyPlayers();
    for (const player of this.players.values()) {
      if (player.waiting) continue;
      this.cancelMinigunSpin(player);
      this.cancelMelee(player.id);
      player.inventory = weaponInventory(Object.keys(player.inventory), player.bonus, player.sheetDebt);
      player.issuedWeapons = new Set(weaponEntries(player).map(entry => entry.weapon));
      this.clearWeaponReloads(player);
      player.hp = characterStats(player).maxHp;
      player.alive = true;
      player.downed = false;
      player.bleedOutAt = 0;
      player.outsideDamageAccumulator = 0;
    }
    this.event('resupply', { wave: this.wave, seconds: 12 });
  }

  beginExtraction() {
    if (this.practice) return false;
    if (this.phase !== 'wave' || this.wave < MAX_WAVES || this.toSpawn || this.spawnWarnings.size || this.zombies.size || !this.livingPlayers().length) return false;
    this.phase = 'extraction';
    this.beginSupplyWave();
    if (this.supplyCrate) this.supplyCrate.active = false;
    this.pickups.clear();
    this.grenades.clear();
    this.bullets.clear();
    this.spawnWarnings.clear();
    this.raidWarnings.clear();
    this.timeLeft = EXTRACTION_DURATION;
    for (const player of this.players.values()) {
      this.cancelMinigunSpin(player);
      this.cancelMelee(player.id);
      player.input = { forward: 0, strafe: 0, sprint: false, crouch: false };
      player.crouched = false;
      player.vy = 0;
      player.jumpRequested = false;
      player.jumpHeld = false;
      player.reloadUntil = 0;
    }
    this.event('extraction', { wave: this.wave, seconds: EXTRACTION_DURATION });
    return true;
  }

  endGame() {
    if (this.practice) return false;
    if (FROZEN_PHASES.includes(this.phase)) return false;
    // A free restored seat still collects its bonus, like at a victory.
    this.payReviveCredits('gameover');
    this.releaseSeats();
    this.paused = false;
    this.pauseById = null;
    this.phase = 'gameover';
    this.pickups.clear();
    this.grenades.clear();
    this.bullets.clear();
    this.spawnWarnings.clear();
    this.raidWarnings.clear();
    if (this.raid) this.raid.over = true;
    this.timeLeft = 0;
    for (const player of this.players.values()) {
      this.cancelMinigunSpin(player);
      this.cancelMelee(player.id);
      player.crouched = false;
      player.input = { forward: 0, strafe: 0, sprint: false, crouch: false };
    }
    this.event('gameover', { wave: this.wave });
  }

  createZombie() {
    if (this.practice) return false;
    const balance = this.currentWaveBalance();
    this.waveSpawned = (this.waveSpawned ?? 0) + 1;
    const brute = this.brutesToSpawn > 0 && this.waveSpawned >= this.bruteSpawnAt?.[0];
    if (brute) { this.brutesToSpawn--; this.bruteSpawnAt.shift(); }
    const boss = brute && balance.bosses > 0 && this.brutesToSpawn === 0;
    const activeDoors = this.doors.filter(door => !door.sealed && !door.sealPending);
    let door = activeDoors[Math.floor(this.random() * activeDoors.length) % activeDoors.length];
    const fast = !brute && this.random() < balance.runnerChance;
    const kind = brute ? 'brute' : enemyVariant(this.wave, this.waveSpawned, fast);
    const profile = enemyProfile({ kind });
    // Spread the exact distant quota over the first third. It must not depend
    // on runner luck, nor turn ordinary walkers into faster enemies. Early
    // departures give slow arrivals time to approach before the wave ends.
    const farWindow = Math.max(1, Math.floor(this.waveInitialTotal / 3));
    const farSpawn = !brute && this.waveSpawned <= farWindow
      && this.farSpawnCount < Math.floor(this.waveSpawned * this.farSpawnQuota / farWindow);
    const farEntry = farSpawn ? FAR_SPAWN_ENTRIES[this.farSpawnCount++ % FAR_SPAWN_ENTRIES.length] : null;
    if (farEntry) door = this.doors.find(item => item.id === farEntry.doorId);
    const entries = farEntry ? [farEntry] : SPAWN_ENTRIES.filter(entry => entry.doorId === door.id);
    const entry = entries[Math.floor(this.random() * entries.length) % entries.length];
    const offset = 5.4;
    const hp = enemyHealth(this.wave, this.waveSpawned, kind, boss);
    const scale = boss ? 1.32 : brute ? 1.22 : 1;
    // Never appear inside another body: slide along the treeline instead.
    const spawn = [0, .8, 1.6, 2.4].flatMap(depth => [0, .75, -.75, 1.5, -1.5, 2.25, -2.25].map(lateral => ({
      x: entry.x + door.outX * depth + Math.abs(door.outZ) * lateral,
      z: entry.z + door.outZ * depth + Math.abs(door.outX) * lateral,
    }))).find(point => (!HAS_SPACE || spaceCanOccupy(point.x, point.z, 0, profile.height * scale, ZOMBIE_RADIUS * scale))
      && [...this.zombies.values()].every(other => !(other.hp > 0)
      || distance(point, other) >= ZOMBIE_RADIUS * scale + bodyRadius(other))) ?? { x: entry.x, z: entry.z };
    const zombie = {
      id: `z${this.nextZombieId++}`, x: spawn.x, y: 0, z: spawn.z,
      hp, maxHp: hp,
      doorId: door.id, spawnOffset: offset, spawnEntryId: entry.id, farSpawn, entered: false, kind, boss, scale,
      speed: brute ? 0.8 : fast ? balance.runnerSpeed : balance.walkerSpeed * profile.speed, attackAfter: 0, yaw: 0,
      damage: boss ? 40 : brute ? 32 : fast ? 14 : profile.damage, barricadeDamage: brute ? 36 : fast ? 16 : profile.barricadeDamage,
      attackInterval: boss ? 1.3 : brute ? 1.2 : profile.attackInterval,
      stairState: null,
      pushX: 0, pushZ: 0, pushLeft: 0,
    };
    return zombie;
  }

  materializeZombie(zombie) {
    this.zombies.set(zombie.id, zombie);
    if (zombie.kind === 'brute') this.event('brute', { zombieId: zombie.id, wave: this.wave, boss: zombie.boss });
    return zombie;
  }

  // Direct calls remain synchronous for fixtures and explicit simulation tools.
  // Only the ordinary wave scheduler reserves a telegraphed emergence.
  spawnZombie() {
    if (this.practice) return false;
    return this.materializeZombie(this.createZombie());
  }

  spawnPositionSafe(point, zombie, ignoredId = null) {
    if (!inRect(point.x, point.z, EXTERIOR.bounds, -bodyRadius(zombie)) || !outsideCabin(point.x, point.z)) return false;
    if (!this.canOccupy(zombie, point.x, point.z, 0, bodyRadius(zombie))) return false;
    if ([...this.players.values()].some(player => player.alive && distance(point, player) < SPAWN_WARNING.minPlayerDistance)) return false;
    if ([...this.zombies.values()].some(other => other.hp > 0 && distance(point, other) < bodyRadius(zombie) + bodyRadius(other))) return false;
    return [...this.spawnWarnings.values()].every(warning => warning.id === ignoredId
      || distance(point, warning) >= bodyRadius(zombie) + bodyRadius(warning.zombie));
  }

  safeSpawnPosition(zombie, ignoredId = null) {
    const door = this.doors.find(item => item.id === zombie.doorId);
    const entries = (zombie.farSpawn ? FAR_SPAWN_ENTRIES : SPAWN_ENTRIES).filter(entry => entry.doorId === door.id)
      .sort((a, b) => Number(b.id === zombie.spawnEntryId) - Number(a.id === zombie.spawnEntryId));
    const candidates = [{ x: zombie.x, z: zombie.z },
      ...entries.flatMap(entry => [0, .8, 1.6, 2.4, 3.2, 4].flatMap(depth => [0, .75, -.75, 1.5, -1.5, 2.25, -2.25].map(lateral => ({
        x: entry.x + door.outX * depth + Math.abs(door.outZ) * lateral,
        z: entry.z + door.outZ * depth + Math.abs(door.outX) * lateral,
      }))))];
    return candidates.find(point => this.spawnPositionSafe(point, zombie, ignoredId)) ?? null;
  }

  // Nearest spot a body or item can legally occupy, searching outwards from
  // (x, z). On multi-floor maps, loot drops and restored saves use it to escape
  // props without crossing a wall.
  freeSpotNear(x, z, y = 0, height = 1, radius = .3) {
    if (!HAS_SPACE || spaceCanOccupy(x, z, y, height, radius)) return { x, z };
    for (const reach of [.4, .7, 1, 1.4, 1.8, 2.3, 2.9, 3.6]) {
      for (let index = 0; index < 16; index++) {
        const angle = index / 16 * Math.PI * 2, point = { x: x + Math.cos(angle) * reach, z: z + Math.sin(angle) * reach };
        if (spaceCanOccupy(point.x, point.z, y, height, radius)) return point;
      }
    }
    return { x, z };
  }

  // Same outward search against a caller's occupancy check, rejecting any
  // candidate whose straight path from (x, z) crosses a solid box other than
  // the one the start sits in: a restored body or item never crosses a wall.
  evictionSpotNear(x, z, y, height, radius, fits) {
    const solids = this.solidBoxes();
    const holds = box => inRect(x, z, box) && y < box.maxY && y + height > box.minY;
    const clear = (px, pz) => fits(px, pz) && !solids.some(box => !holds(box) && y < box.maxY && y + height > box.minY
      && rayBox({ x, y: y + height / 2, z }, { x: px - x, y: 0, z: pz - z }, box, 1) <= 1);
    if (clear(x, z)) return { x, z };
    for (const reach of [.4, .7, 1, 1.4, 1.8, 2.3, 2.9, 3.6]) {
      for (let index = 0; index < 16; index++) {
        const angle = index / 16 * Math.PI * 2, point = { x: x + Math.cos(angle) * reach, z: z + Math.sin(angle) * reach };
        if (clear(point.x, point.z)) return point;
      }
    }
    return { x, z };
  }

  // A save written before new props or furniture existed can hold a body or
  // an item inside one. On multi-floor maps, move each to the nearest free spot:
  // bodies by the simulation's own occupancy check, items to a point outside
  // every solid box, never through a wall.
  evictRestoredFromProps() {
    if (!HAS_SPACE) return;
    const stuck = (entity, height, radius) => {
      if (!entity || !Number.isFinite(entity.x) || !Number.isFinite(entity.z)) return false;
      // Props stand at least 1 m tall and nothing can rest on one: overlap counts.
      if (SPACE.props.some(prop => inRect(entity.x, entity.z, prop, radius))) return true;
      // Furniture is jumpable: only a body within its volume is stuck, never
      // one standing on top (a jump clears the 0.8 m counters).
      const y = entity.y ?? 0;
      return WORLD.covers.some(cover => coverPieces(cover).some(piece =>
        inRect(entity.x, entity.z, piece, radius) && y < (cover.baseY ?? 0) + piece.height && y + height > (cover.baseY ?? 0)));
    };
    const move = (entity, height, radius, fits) => {
      if (!stuck(entity, height, radius)) return;
      Object.assign(entity, this.evictionSpotNear(entity.x, entity.z, entity.y ?? 0, height, radius, fits));
    };
    const moveBody = (entity, height, radius, body = entity) =>
      move(entity, height, radius, (x, z) => this.canOccupy(body, x, z, entity.y ?? 0, radius));
    const moveItem = (item, height, radius) => move(item, height, radius, (x, z) => {
      const y = item.y ?? 0;
      return !this.solidBoxes().some(box => inRect(x, z, box, radius) && y < box.maxY && y + height > box.minY);
    });
    for (const player of [...this.players.values(), ...(this.reservedSeats?.values() ?? [])]) moveBody(player, playerHeight(player), PLAYER_RADIUS);
    for (const zombie of this.zombies.values()) moveBody(zombie, enemyProfile(zombie).height * (zombie.scale ?? 1), bodyRadius(zombie));
    for (const warning of this.spawnWarnings?.values() ?? []) {
      const height = enemyProfile(warning.zombie).height * (warning.zombie.scale ?? 1), radius = bodyRadius(warning.zombie);
      moveBody(warning, height, radius, warning.zombie);
      moveBody(warning.zombie, height, radius);
    }
    for (const warning of this.raidWarnings?.values() ?? []) {
      const height = enemyProfile(warning.raider).height, radius = bodyRadius(warning.raider);
      moveBody(warning, height, radius, warning.raider);
      moveBody(warning.raider, height, radius);
      moveBody(warning.alternate, height, radius, warning.raider);
    }
    for (const pickup of this.pickups.values()) moveItem(pickup, .5, .25);
    if (this.supplyCrate) moveItem(this.supplyCrate, 1, .4);
    if (this.fuel && !this.fuel.carrierId) moveItem(this.fuel, .6, .3);
  }

  announceSpawn(warning) {
    this.event('spawn-warning', { id: warning.id, x: warning.x, y: 0, z: warning.z,
      readyAt: warning.readyAt, remaining: Math.max(0, warning.readyAt - this.time) });
  }

  reserveZombieSpawn() {
    const zombie = this.createZombie();
    const point = this.safeSpawnPosition(zombie);
    const warning = { id: zombie.id, zombie, x: point?.x ?? zombie.x, z: point?.z ?? zombie.z,
      readyAt: this.time + SPAWN_WARNING.seconds };
    Object.assign(zombie, { x: warning.x, z: warning.z });
    this.spawnWarnings.set(warning.id, warning);
    this.announceSpawn(warning);
    return warning;
  }

  updateSpawnWarnings() {
    for (const warning of this.spawnWarnings.values()) {
      if (this.time + 1e-8 < warning.readyAt) continue;
      if (!this.spawnPositionSafe(warning, warning.zombie, warning.id)) {
        const point = this.safeSpawnPosition(warning.zombie, warning.id);
        if (point) {
          Object.assign(warning, point);
          Object.assign(warning.zombie, point);
          warning.readyAt = this.time + SPAWN_WARNING.seconds;
          this.announceSpawn(warning);
        } else warning.readyAt = this.time + SPAWN_WARNING.retrySeconds;
        continue;
      }
      this.spawnWarnings.delete(warning.id);
      this.materializeZombie(warning.zombie);
    }
  }

  reload(id, hand) {
    const player = this.players.get(id);
    if (!player || this.paused || hand !== undefined && !['primary', 'secondary'].includes(hand)) return false;
    const hands = hand === undefined && this.dualWeaponIds(player) ? ['primary', 'secondary'] : [hand ?? 'primary'];
    let accepted = false;
    for (const selected of hands) accepted = this.withWeaponHand(player, selected, () => this.reloadHeld(id)) || accepted;
    return accepted;
  }

  reloadHeld(id) {
    const player = this.players.get(id);
    if (this.paused || !player || player.downed || !player.alive || player.reloadUntil > this.time || FROZEN_PHASES.includes(this.phase)) return false;
    const weapon = this.weaponProfile(player), inventory = weaponStock(player);
    if (!weapon || !inventory || weapon.melee) return false;
    if (inventory.ammo >= weapon.magazine || inventory.reserve <= 0) return false;
    this.cancelMinigunSpin(player);
    player.reloadDuration = weapon.reloadTime * characterStats(player).reloadMultiplier;
    player.reloadUntil = this.time + player.reloadDuration;
    this.event('reload', { id, weapon: player.weapon, duration: player.reloadDuration });
    return true;
  }

  shoot(id, subTick = 0, attack, hand = 'primary') {
    const player = this.players.get(id);
    if (!player || this.paused || !['primary', 'secondary'].includes(hand)) return false;
    this.normalizeDualWield(player);
    return this.withWeaponHand(player, hand, () => this.shootHeld(id, subTick, attack));
  }

  shootHeld(id, subTick = 0, attack) {
    const player = this.players.get(id);
    if (this.paused || !player || !player.alive || player.downed || player.umbrella.open || !['wave', 'countdown', 'intermission'].includes(this.phase)) return false;
    // The socket supplies only its own monotonic elapsed time since the last
    // physics tick. Client timestamps never enter this clock. Without this,
    // fast weapons lose shots merely because 90 ms is not a 30 Hz multiple.
    const shotTime = this.time + clamp(Number.isFinite(subTick) ? subTick : 0, 0, 1 / TICK_RATE);
    const weapon = this.weaponProfile(player), inventory = weaponStock(player);
    // A round may reach the server a little ahead of its slot (fireTolerance,
    // shared with the client schedule): delivery jitter then never drops a
    // held trigger's rounds, while the slots below keep the long-run rate at
    // exactly one round per interval.
    const tolerance = weapon && !weapon.melee ? fireTolerance(weapon.interval) : { early: 0, carry: 0 };
    if (player.shotAfter > shotTime + tolerance.early + 1e-8 || (player.switchUntil ?? 0) > shotTime + 1e-8 || player.reloadUntil > this.time) return false;
    if (!weapon || !inventory) return false;
    if (weapon.melee) {
      if (attack !== undefined && attack !== 'light' && attack !== 'heavy') return false;
      if (player.pendingMelee || player.meleeAfter > shotTime + 1e-8) return false;
      const mode = attack ?? 'light', profile = weapon.attacks[mode], attackId = this.nextMeleeId++;
      player.pendingMelee = { weapon: player.weapon, weaponId: activeWeaponId(player), attack: mode, attackId, impactAt: shotTime + profile.windup };
      player.meleeAfter = shotTime + profile.duration;
      player.shotAfter = player.meleeAfter;
      this.event('melee-start', { id, weapon: player.weapon, attack: mode, attackId, windup: profile.windup, duration: profile.duration });
      return true;
    }
    if (attack === 'heavy') return false;
    if (inventory.ammo <= 0) { this.reloadHeld(id); return false; }
    if (player.weapon === 'minigun' && (!player.minigunSpinning || this.time + 1e-8 < player.minigunSpinUntil)) return false;
    const physical = this.ballisticsEnabled && !!weapon.bulletPhysics;
    if (physical && this.bullets.size + weapon.pellets > BALLISTICS.maxActive) {
      this.event('bullet-denied', { id, weapon: player.weapon, weaponId: activeWeaponId(player), reason: 'capacity' });
      return false;
    }
    inventory.ammo--;
    if (player.weapon === 'minigun' && inventory.ammo === 0) this.cancelMinigunSpin(player);
    // Every weapon keeps its slots, like the client's firingSchedule: an early
    // round or one late by up to `carry` keeps its slot, so jitter neither
    // drops rounds nor speeds the weapon up. A stream that hiccups moves its
    // slots only as far as needed; a real pause starts a fresh period, never
    // with catch-up bursts.
    const shotLateness = shotTime - player.shotAfter;
    const cadenceBase = shotLateness <= tolerance.carry + 1e-8 ? player.shotAfter
      : shotLateness <= tolerance.carry + weapon.interval ? shotTime - tolerance.carry : shotTime;
    player.shotAfter = cadenceBase + weapon.interval;
    const origin = { x: player.x, y: player.y + playerEyeHeight(player), z: player.z };
    if (player.weapon === 'rocket') return this.shootRocket(player, origin);
    if (player.weapon === 'flamethrower') return this.shootFlame(player, origin);
    if (physical) return this.shootBullets(player, origin, weapon, shotTime);
    const headshotMultiplier = this.currentWaveBalance().headshotMultiplier;
    let totalHits = 0, kills = 0, boardHits = 0, headshots = 0;
    const impacts = new Map(), pellets = [];
    // Frisson rooms only (art/frisson/BLOOD-SPRAY.md section 4.1; Frisson léger
    // too, rules.js isFrissonLike): where each pellet entered each body, for
    // the pixel blood. Famille events stay as they are.
    const fallen = isFrissonLike(this.ambiance) ? [] : null;
    const mates = this.friendlyTargets(id);
    for (let pellet = 0; pellet < weapon.pellets; pellet++) {
      let horizontal = this.random() * 2 - 1, vertical = this.random() * 2 - 1;
      if (player.weapon === 'shotgun' && (horizontal !== 0 || vertical !== 0)) {
        // Concentric square-to-disk mapping: uniform pellet density over the
        // angular disk, without the over-wide corners of a square spread.
        const horizontalMajor = Math.abs(horizontal) > Math.abs(vertical);
        const radius = horizontalMajor ? horizontal : vertical;
        const angle = horizontalMajor
          ? Math.PI / 4 * (vertical / horizontal)
          : Math.PI / 2 - Math.PI / 4 * (horizontal / vertical);
        horizontal = radius * Math.cos(angle);
        vertical = radius * Math.sin(angle);
      }
      const yaw = player.yaw + horizontal * weapon.spread;
      const pitch = player.pitch + vertical * weapon.spread;
      const direction = { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
      let solidDistance = weapon.range;
      for (const box of this.solidBoxes()) solidDistance = Math.min(solidDistance, rayBox(origin, direction, box, weapon.range));
      const intersections = [];
      for (const door of this.doors) {
        if (door.sealed) continue;
        for (const board of BARRICADE_BOARDS) {
          if (door.boards[board.index] <= 0) continue;
          const hitAt = rayBoard(origin, direction, door, board, weapon.range);
          if (hitAt < solidDistance) intersections.push({ door, boardIndex: board.index, hitAt });
        }
      }
      for (const zombie of this.zombies.values()) {
        const hitAt = rayBox(origin, direction, enemyHitbox(zombie), weapon.range);
        if (hitAt < solidDistance) intersections.push({ zombie, hitAt });
      }
      // Friendly fire: teammates' bodies (none while it is off).
      for (const mate of mates) {
        const hitAt = rayBox(origin, direction, playerHitbox(mate), weapon.range);
        if (hitAt < solidDistance) intersections.push({ mate, hitAt });
      }
      // A pellet stops in the first board in its path and damages it. Once that
      // plank breaks, later pellets/bullets pass through the exact opening.
      const intersectionKey = hit => hit.door ? `${hit.door.id}:${hit.boardIndex}` : hit.zombie?.id ?? `player:${hit.mate.id}`;
      intersections.sort((a, b) => a.hitAt - b.hitAt || Number(!a.door) - Number(!b.door) || intersectionKey(a).localeCompare(intersectionKey(b)));
      let index = 0;
      const wounds = fallen ? [] : null;
      // Where this pellet visibly ends: clients draw tracers and impacts from it.
      let stop = { distance: solidDistance, kind: solidDistance < weapon.range ? 'solid' : 'range' };
      for (const { zombie, door, boardIndex, hitAt, mate } of intersections) {
        if (door) {
          if (this.damageDoor(door, Math.max(24, weapon.damage), { boardIndex, id })) boardHits++;
          stop = { distance: hitAt, kind: 'board' };
          break;
        }
        if (mate) {
          // Downed by an earlier pellet of this shot: lying, out of the way.
          if (!mate.alive || mate.downed) continue;
          this.hurtSurvivor(mate, weapon.damage * damageFalloff(weapon, hitAt) * penetrationMultiplier(weapon, index, hitAt), id, player.weapon, player);
          if (++index >= weapon.penetrationTargets) { stop = { distance: hitAt, kind: 'player' }; break; }
          continue;
        }
        const hitHeight = origin.y + direction.y * hitAt - zombie.y;
        const headshot = enemyHeadshot(zombie, hitHeight);
        const previousHp = zombie.hp;
        zombie.hp = weapon.oneShot ? (zombie.boss ? zombie.hp - MAGNUM_BOSS_DAMAGE : 0) : zombie.hp - weapon.damage * damageFalloff(weapon, hitAt) * penetrationMultiplier(weapon, index, hitAt) * (headshot ? headshotMultiplier : 1) * enemyDamageMultiplier(zombie, headshot);
        const damage = Math.max(0, Math.min(previousHp, previousHp - zombie.hp));
        const impact = impacts.get(zombie.id) ?? { zombie, x: 0, z: 0 };
        impact.x += direction.x * damage; impact.z += direction.z * damage;
        impacts.set(zombie.id, impact);
        this.scoreDamage(player, zombie, damage, { x: origin.x + direction.x * hitAt, y: origin.y + direction.y * hitAt, z: origin.z + direction.z * hitAt },
          { headshot, killed: zombie.hp <= 0 });
        totalHits++;
        if (headshot) headshots++;
        if (zombie.hp <= 0) {
          this.zombies.delete(zombie.id);
          player.kills++;
          const chain = this.recordKillChain(player);
          this.dropZombieLoot(zombie, killCash(zombie, headshot), player);
          kills++;
          // `score`: what the kill itself adds now, its chain bonus (the
          // damage was scored with the hit).
          this.event('kill', { id, zombieId: zombie.id, headshot, boss: zombie.boss === true, x: zombie.x, y: zombie.y, z: zombie.z,
            dirX: milli(direction.x), dirZ: milli(direction.z), weapon: player.weapon, score: chain.bonus,
            chain: chain.chain, chainBonus: chain.bonus, chainId: chain.chainId, range: milli(hitAt), ...(zombie.kind === 'raider' ? { raider: true } : {}) });
        }
        // The hit's power before the enemy's health clips it (a magnum round
        // counts its nominal 200 at least), and the feet before any push.
        if (wounds && zombie.kind !== 'raider') {
          const power = weapon.oneShot && !zombie.boss ? Math.max(previousHp, weapon.damage) : previousHp - zombie.hp;
          wounds.push([zombie.id, milli(hitAt), milli(power), headshot ? 1 : 0, zombie.hp <= 0 ? 1 : 0, milli(zombie.x), milli(zombie.y), milli(zombie.z)]);
          if (zombie.hp <= 0) fallen.push(zombie);
        }
        if (++index >= weapon.penetrationTargets) { stop = { distance: hitAt, kind: 'zombie' }; break; }
      }
      // A body felled earlier in this shot still stands where the pellet passes:
      // it bleeds there too (blood only: the dead take no damage, nothing scores).
      if (fallen) for (const body of fallen) {
        let seen = false;
        for (const wound of wounds) if (wound[0] === body.id) seen = true;
        if (seen) continue;
        const hitAt = rayBox(origin, direction, enemyHitbox(body), stop.distance);
        if (!(hitAt < stop.distance)) continue;
        const head = enemyHeadshot(body, origin.y + direction.y * hitAt - body.y);
        wounds.push([body.id, milli(hitAt), milli(weapon.damage * damageFalloff(weapon, hitAt) * (head ? headshotMultiplier : 1) * enemyDamageMultiplier(body, head)),
          head ? 1 : 0, 1, milli(body.x), milli(body.y), milli(body.z)]);
      }
      const entry = { yaw: milli(yaw), pitch: milli(pitch), distance: milli(stop.distance), stop: stop.kind };
      if (wounds?.length) { wounds.sort((a, b) => a[1] - b[1]); entry.wounds = wounds; }
      pellets.push(entry);
    }
    // All pellets use the original positions. Only surviving targets receive
    // one damage-weighted impulse after the complete shot has been resolved.
    for (const { zombie, x, z } of impacts.values()) {
      if (this.zombies.has(zombie.id) && zombie.hp > 0) this.pushZombie(zombie, x, z);
    }
    this.event('shot', { id, weapon: player.weapon, x: origin.x, y: origin.y, z: origin.z, yaw: player.yaw, pitch: player.pitch, hits: totalHits, kills, boardHits, headshots, pellets });
    return true;
  }

  // Reuse the cabin's swept point geometry: floor, loft, walls, stair treads,
  // finite rotated stringers, roof and gables. Boards additionally take damage.
  bulletWorldCollision(origin, movement) {
    const solid = this.grenadeCollision(origin, movement, 0);
    let result = { fraction: solid?.fraction ?? Infinity };
    for (const door of this.doors) {
      if (door.sealed) continue;
      for (const board of BARRICADE_BOARDS) {
        if (!(door.boards[board.index] > 0)) continue;
        const fraction = rayBoard(origin, movement, door, board, 1);
        if (fraction <= 1 && fraction <= result.fraction + 1e-9)
          result = { fraction, door, boardIndex: board.index };
      }
    }
    return result;
  }

  shootBullets(player, origin, weapon, shotTime = this.time) {
    const projectiles = [], profile = structuredClone(weapon), weaponType = player.weapon, weaponId = activeWeaponId(player);
    // Only sibling pellets retain fallen hitboxes, for wound visuals. The group
    // dies with its last projectile; later shots never hit these visual corpses.
    const shotGroup = { id: `shot-${this.nextBulletId}`, fallen: new Map(), blood: isFrissonLike(this.ambiance) };
    for (let pellet = 0; pellet < profile.pellets; pellet++) {
      let horizontal = this.random() * 2 - 1, vertical = this.random() * 2 - 1;
      if (weaponType === 'shotgun' && (horizontal !== 0 || vertical !== 0)) {
        const major = Math.abs(horizontal) > Math.abs(vertical), radius = major ? horizontal : vertical;
        const angle = major ? Math.PI / 4 * (vertical / horizontal) : Math.PI / 2 - Math.PI / 4 * (horizontal / vertical);
        horizontal = radius * Math.cos(angle); vertical = radius * Math.sin(angle);
      }
      const yaw = player.yaw + horizontal * profile.spread, pitch = player.pitch + vertical * profile.spread;
      const cosine = Math.cos(pitch), id = `b${this.nextBulletId++}`, speed = profile.bulletPhysics.muzzleSpeed;
      const projectile = { id, x: origin.x, y: origin.y, z: origin.z,
        vx: -Math.sin(yaw) * cosine * speed, vy: Math.sin(pitch) * speed,
        vz: -Math.cos(yaw) * cosine * speed, gravity: BALLISTICS.gravity,
        drag: profile.bulletPhysics.drag, segmentStartAge: 0, distanceOffset: 0, maxAge: BALLISTICS.maxLife };
      this.bullets.set(id, { ...projectile, ownerId: player.id, owner: player, weapon: weaponType, weaponId, hand: player._weaponHand ?? 'primary', shotId: this.activeShot?.shotId, shotGroup, profile,
        headshotMultiplier: this.currentWaveBalance().headshotMultiplier, startAt: shotTime, age: 0, hitIds: new Set(), hitCount: 0 });
      projectiles.push(projectile);
    }
    this.event('shot', { id: player.id, weapon: weaponType, weaponId, ...origin, yaw: player.yaw, pitch: player.pitch,
      time: shotTime, ballistic: true, shotGroupId: shotGroup.id, projectiles, hits: 0, kills: 0, boardHits: 0, headshots: 0, pellets: [] });
    return true;
  }

  bulletImpact(bullet, point, age, stop, details = {}) {
    const velocity = ballisticVelocity(bullet, age), speed = Math.hypot(velocity.x, velocity.y, velocity.z) || 1;
    this.event('bullet-impact', { id: bullet.ownerId, projectileId: bullet.id, weapon: bullet.weapon, weaponId: bullet.weaponId,
      ...(bullet.hand ? { hand: bullet.hand } : {}),
      ...(bullet.shotGroup ? { shotGroupId: bullet.shotGroup.id } : {}),
      ...(bullet.shotId !== undefined ? { shotId: bullet.shotId } : {}),
      x: point.x, y: point.y, z: point.z, dirX: velocity.x / speed, dirY: velocity.y / speed, dirZ: velocity.z / speed,
      age, stop, ballistic: true, ...details });
  }

  updateBullets(delta) {
    if (this.paused || !this.ballisticsEnabled || !(delta > 0)) return;
    if (!HAZARD_PHASES.includes(this.phase)) { this.bullets.clear(); return; }
    const pushes = new Map(), negligible = MIN_BULLET_DAMAGE;
    const contactAge = (bullet, fromAge, toAge, from, movement, fraction) => {
      const length2 = movement.x ** 2 + movement.y ** 2 + movement.z ** 2;
      if (fraction <= 0 || length2 < 1e-16) return fromAge;
      if (fraction >= 1) return toAge;
      let low = fromAge, high = toAge;
      for (let step = 0; step < 20; step++) {
        const middle = (low + high) / 2, point = ballisticPosition(bullet, middle);
        const share = ((point.x - from.x) * movement.x + (point.y - from.y) * movement.y + (point.z - from.z) * movement.z) / length2;
        if (share < fraction) low = middle; else high = middle;
      }
      return (low + high) / 2;
    };
    for (const bullet of [...this.bullets.values()]) {
      const until = Math.min(bullet.maxAge, Math.max(bullet.age, this.time - bullet.startAt));
      while (this.bullets.has(bullet.id) && HAZARD_PHASES.includes(this.phase) && bullet.age < until - 1e-12) {
        const fromAge = bullet.age, from = ballisticPosition(bullet, fromAge);
        if (bulletDamageAtAge(bullet.profile, bullet, fromAge) < negligible) {
          this.bulletImpact(bullet, from, fromAge, 'range', { reason: 'energy', terminal: true, remainingTargets: 0 });
          this.bullets.delete(bullet.id); break;
        }
        // A 30 Hz chord, refined only when the analytic curve bends more than
        // 3 mm away from it. Slower test ticks use the same geometric bound.
        let toAge = Math.min(until, fromAge + 1 / TICK_RATE), to;
        if (toAge >= bullet.maxAge - 1e-12) toAge = bullet.maxAge;
        for (let refinement = 0; ; refinement++) {
          to = ballisticPosition(bullet, toAge);
          const middle = ballisticPosition(bullet, (fromAge + toAge) / 2);
          const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, length2 = dx * dx + dy * dy + dz * dz;
          const share = length2 > 1e-16 ? clamp(((middle.x - from.x) * dx + (middle.y - from.y) * dy + (middle.z - from.z) * dz) / length2, 0, 1) : .5;
          if (refinement >= 2 || Math.hypot(middle.x - from.x - dx * share, middle.y - from.y - dy * share, middle.z - from.z - dz * share) <= .003) break;
          toAge = (fromAge + toAge) / 2;
        }
        let energyExpiry = false;
        if (bulletDamageAtAge(bullet.profile, bullet, toAge) < negligible) {
          let low = fromAge, high = toAge;
          for (let step = 0; step < 20; step++) {
            const middle = (low + high) / 2;
            if (bulletDamageAtAge(bullet.profile, bullet, middle) >= negligible) low = middle; else high = middle;
          }
          toAge = high; to = ballisticPosition(bullet, toAge); energyExpiry = true;
        }
        const movement = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
        const collision = this.bulletWorldCollision(from, movement), solid = collision.fraction;
        let victim = null, fraction = Math.min(1, solid);
        for (const zombie of this.zombies.values()) {
          if (!(zombie.hp > 0) || bullet.hitIds.has(zombie.id)) continue;
          const at = rayBox(from, movement, enemyHitbox(zombie), 1);
          if (at <= 1 && at < solid - 1e-9 && (at < fraction || at === fraction && (!victim || zombie.id.localeCompare(victim.id) < 0))) {
            victim = zombie; fraction = at;
          }
        }
        // Friendly fire: a teammate's body is in the way like an enemy's
        // (never the shooter's own, which the round leaves from).
        let mate = null;
        for (const player of this.friendlyTargets(bullet.ownerId)) {
          if (bullet.hitPlayerIds?.has(player.id)) continue;
          const at = rayBox(from, movement, playerHitbox(player), 1);
          if (at <= 1 && at < solid - 1e-9 && (at < fraction || at === fraction && !victim && (!mate || player.id < mate.id))) {
            mate = player; victim = null; fraction = at;
          }
        }
        // Blood-only contacts do not change velocity, remaining penetration,
        // health, loot, score or hit markers, and cannot pass an actual obstacle.
        if (bullet.shotGroup?.blood) for (const body of bullet.shotGroup.fallen.values()) {
          if (bullet.hitIds.has(body.id)) continue;
          const at = rayBox(from, movement, enemyHitbox(body), 1);
          if (!(at <= fraction && at < solid - 1e-9)) continue;
          const age = contactAge(bullet, fromAge, toAge, from, movement, at);
          const point = { x: from.x + movement.x * at, y: from.y + movement.y * at, z: from.z + movement.z * at };
          const headshot = enemyHeadshot(body, point.y - body.y);
          bullet.hitIds.add(body.id);
          this.bulletImpact(bullet, point, age, 'zombie', { zombieId: body.id, headshot, killed: true, damage: 0, visualOnly: true,
            feet: [body.x, body.y, body.z], power: bulletDamageAtAge(bullet.profile, bullet, age)
              * (headshot ? bullet.headshotMultiplier : 1) * enemyDamageMultiplier(body, headshot),
            terminal: false, remainingTargets: Math.max(0, bullet.profile.penetrationTargets - bullet.hitCount) });
        }
        if (mate) {
          // The round wounds the teammate, loses energy in the body and
          // spends one of its pierces, as in an enemy; no score, no push.
          const age = contactAge(bullet, fromAge, toAge, from, movement, fraction), weapon = bullet.profile;
          const point = { x: from.x + movement.x * fraction, y: from.y + movement.y * fraction, z: from.z + movement.z * fraction };
          const range = ballisticDistance(bullet, age), shooter = this.players.get(bullet.ownerId);
          (bullet.hitPlayerIds ??= new Set()).add(mate.id); bullet.hitCount++;
          const damage = this.hurtSurvivor(mate, bulletDamageAtAge(weapon, bullet, age), bullet.ownerId, bullet.weapon, shooter ?? point);
          const velocity = ballisticVelocity(bullet, age), velocityLength = Math.hypot(velocity.x, velocity.y, velocity.z) || 1;
          const speed = ballisticForwardSpeed(bullet, age) * Math.sqrt(Math.max(0, 1 - weapon.bulletPhysics.transmission));
          const continuation = { ...point, vx: velocity.x / velocityLength * speed, vy: velocity.y / velocityLength * speed,
            vz: velocity.z / velocityLength * speed, drag: bullet.drag, gravity: bullet.gravity,
            segmentStartAge: age, maxAge: bullet.maxAge, distanceOffset: range };
          const lifetimeExpired = age >= bullet.maxAge - 1e-12;
          const terminal = lifetimeExpired || bullet.hitCount >= weapon.penetrationTargets || bulletDamageAtAge(weapon, continuation, age) < negligible;
          this.bulletImpact(bullet, point, age, 'player', { playerId: mate.id, damage, terminal,
            remainingTargets: lifetimeExpired ? 0 : Math.max(0, weapon.penetrationTargets - bullet.hitCount),
            ...(lifetimeExpired ? { reason: 'lifetime' } : {}), ...(!terminal ? { continuation } : {}) });
          if (terminal) { this.bullets.delete(bullet.id); break; }
          Object.assign(bullet, continuation, { age });
          continue;
        }
        if (victim) {
          const zombie = victim, age = contactAge(bullet, fromAge, toAge, from, movement, fraction);
          const point = { x: from.x + movement.x * fraction, y: from.y + movement.y * fraction, z: from.z + movement.z * fraction };
          const range = ballisticDistance(bullet, age), weapon = bullet.profile;
          const headshot = enemyHeadshot(zombie, point.y - zombie.y), previousHp = zombie.hp;
          const amount = bulletDamageAtAge(weapon, bullet, age) * (headshot ? bullet.headshotMultiplier : 1) * enemyDamageMultiplier(zombie, headshot);
          zombie.hp -= amount;
          const damage = Math.min(previousHp, amount), killed = zombie.hp <= 0;
          const player = this.players.get(bullet.ownerId) === bullet.owner ? bullet.owner : null;
          this.scoreDamage(player, zombie, damage, point, { headshot, killed });
          bullet.hitIds.add(zombie.id); bullet.hitCount++;
          const velocity = ballisticVelocity(bullet, age), velocityLength = Math.hypot(velocity.x, velocity.y, velocity.z) || 1;
          const speed = ballisticForwardSpeed(bullet, age) * Math.sqrt(Math.max(0, 1 - weapon.bulletPhysics.transmission));
          const continuation = { ...point, vx: velocity.x / velocityLength * speed, vy: velocity.y / velocityLength * speed,
            vz: velocity.z / velocityLength * speed, drag: bullet.drag, gravity: bullet.gravity,
            segmentStartAge: age, maxAge: bullet.maxAge, distanceOffset: range };
          const lifetimeExpired = age >= bullet.maxAge - 1e-12;
          const terminal = lifetimeExpired || bullet.hitCount >= weapon.penetrationTargets || bulletDamageAtAge(weapon, continuation, age) < negligible;
          const horizontal = Math.hypot(velocity.x, velocity.z), dirX = horizontal > 1e-9 ? velocity.x / horizontal : 0, dirZ = horizontal > 1e-9 ? velocity.z / horizontal : 0;
          // The contact is public before the kill. A surviving bullet starts
          // a slower analytic segment on the same global physical clock.
          this.bulletImpact(bullet, point, age, 'zombie', { zombieId: zombie.id, headshot, killed, damage,
            ...(bullet.shotGroup?.blood && zombie.kind !== 'raider' ? { feet: [zombie.x, zombie.y, zombie.z], power: amount } : {}), terminal,
            remainingTargets: lifetimeExpired ? 0 : Math.max(0, weapon.penetrationTargets - bullet.hitCount),
            ...(lifetimeExpired ? { reason: 'lifetime' } : {}), ...(!terminal ? { continuation } : {}) });
          if (killed) {
            if (bullet.shotGroup?.blood && zombie.kind !== 'raider') bullet.shotGroup.fallen.set(zombie.id, { ...zombie });
            this.zombies.delete(zombie.id);
            if (player) player.kills++;
            const chain = this.recordKillChain(player, bullet.weapon);
            this.dropZombieLoot(zombie, killCash(zombie, headshot), player);
            this.event('kill', { id: bullet.ownerId, projectileId: bullet.id, ballistic: true, weaponId: bullet.weaponId,
              ...(bullet.shotId !== undefined ? { shotId: bullet.shotId } : {}), zombieId: zombie.id,
              headshot, boss: zombie.boss === true, x: zombie.x, y: zombie.y, z: zombie.z, dirX, dirZ,
              weapon: bullet.weapon, range, score: chain.bonus, chain: chain.chain, chainBonus: chain.bonus, chainId: chain.chainId,
              ...(zombie.kind === 'raider' ? { raider: true } : {}) });
          } else {
            const push = pushes.get(zombie.id) ?? { zombie, x: 0, z: 0 };
            push.x += dirX * damage; push.z += dirZ * damage; pushes.set(zombie.id, push);
          }
          if (terminal) { this.bullets.delete(bullet.id); break; }
          Object.assign(bullet, continuation, { age });
          // Recompute the remainder of this tick from the reduced velocity;
          // pre-contact intersections no longer describe the actual flight.
          continue;
        }
        if (solid <= 1) {
          const point = { x: from.x + movement.x * solid, y: from.y + movement.y * solid, z: from.z + movement.z * solid };
          const age = contactAge(bullet, fromAge, toAge, from, movement, solid);
          const board = collision.door;
          const removed = board ? this.damageDoor(board, bulletDamageAtAge(bullet.profile, bullet, age), {
            boardIndex: collision.boardIndex, id: this.players.get(bullet.ownerId) === bullet.owner ? bullet.ownerId : null }) : 0;
          this.bulletImpact(bullet, point, age, board ? 'board' : 'solid', { terminal: true, remainingTargets: 0,
            ...(board ? { doorId: board.id, boardIndex: collision.boardIndex, damage: removed, boardHits: removed > 0 ? 1 : 0 } : {}) });
          this.bullets.delete(bullet.id); break;
        }
        bullet.age = toAge;
        if (energyExpiry || toAge >= bullet.maxAge - 1e-12) {
          this.bulletImpact(bullet, to, toAge, 'range', { reason: energyExpiry ? 'energy' : 'lifetime', terminal: true, remainingTargets: 0 });
          this.bullets.delete(bullet.id); break;
        }
      }
    }
    for (const { zombie, x, z } of pushes.values()) if (this.zombies.has(zombie.id) && zombie.hp > 0) this.pushZombie(zombie, x, z);
  }

  // Shared with the client's hit prediction (public/melee-reach.js).
  meleeTargetPoint(origin, direction, zombie, profile) {
    return reachPoint(origin, direction, zombie, profile, (from, point) => this.grenadeBlastVisible(from, point));
  }

  updateMelee() {
    for (const player of this.players.values()) {
      const pending = player.pendingMelee;
      if (!pending) continue;
      if (!HAZARD_PHASES.includes(this.phase) || !player.alive || player.downed || player.umbrella.open || player.weapon !== pending.weapon || (pending.weaponId != null && activeWeaponId(player) !== pending.weaponId) || !weaponStock(player)) {
        this.cancelMelee(player.id); continue;
      }
      if (this.time + 1e-8 < pending.impactAt) continue;
      player.pendingMelee = null;
      const weapon = this.weaponProfile(player), profile = weapon.attacks[pending.attack], origin = { x: player.x, y: player.y + playerEyeHeight(player), z: player.z };
      const direction = meleeDirection(player.yaw, player.pitch);
      // Resolve from the survivor's current authoritative pose at impact.
      // Client target ids, directions and timestamps never select a victim.
      // Friendly fire: a teammate in the swing takes the blow in its turn.
      const targets = meleeTargets(origin, direction, profile, this.zombies.values(), (from, point) => this.grenadeBlastVisible(from, point), this.friendlyTargets(player.id));
      let kills = 0;
      const teammates = [];
      const impacts = targets.flatMap(({ zombie, player: mate, point }, index) => {
        if (mate) {
          const damage = this.hurtSurvivor(mate, profile.damage * profile.retention ** index, player.id, player.weapon, player);
          teammates.push({ playerId: mate.id, x: milli(point.x), y: milli(point.y), z: milli(point.z), damage });
          return [];
        }
        const amount = profile.damage * profile.retention ** index * enemyDamageMultiplier(zombie, false);
        const damage = Math.min(zombie.hp, amount), horizontal = Math.hypot(zombie.x - player.x, zombie.z - player.z);
        const away = horizontal > 1e-8 ? { x: (zombie.x - player.x) / horizontal, z: (zombie.z - player.z) / horizontal } : direction;
        const impact = { zombieId: zombie.id, x: milli(point.x), y: milli(point.y), z: milli(point.z), damage: milli(damage),
          dirX: milli(away.x), dirZ: milli(away.z) };
        // Frisson rooms only (BLOOD-SPRAY.md 4.1): the blow's power and the feet before the push.
        if (isFrissonLike(this.ambiance)) { impact.power = milli(amount); impact.feet = [milli(zombie.x), milli(zombie.y), milli(zombie.z)]; }
        const killed = this.damageSpecialZombie(zombie, amount, player.id, away, player.weapon, true, { point }, weapon.pushMultiplier ?? 1);
        if (killed) kills++;
        return [{ ...impact, killed }];
      });
      this.event('melee-hit', { id: player.id, weapon: player.weapon, attack: pending.attack, attackId: pending.attackId,
        ...origin, yaw: player.yaw, pitch: player.pitch, hits: impacts.length + teammates.length, kills, impacts, ...(teammates.length ? { teammates } : {}) });
    }
  }

  throwGrenade(id) {
    const player = this.players.get(id);
    if (this.paused || !player || !player.alive || player.downed || player.umbrella.open || !HAZARD_PHASES.includes(this.phase)
      || !(player.grenades > 0) || player.throwAfter > this.time + 1e-8) return false;
    const grenadeId = `g${this.nextGrenadeId++}`;
    const grenade = { id: grenadeId, ownerId: id, ...this.grenadeLaunch(player), damageMultiplier: characterStats(player).grenadeDamageMultiplier };
    const wasFull = player.grenades >= characterStats(player).maxGrenades;
    player.grenades--;
    if (wasFull) this.resetGrenadier(player);
    player.throwAfter = this.time + GRENADES.cooldown;
    this.grenades.set(grenadeId, grenade);
    this.event('grenade-thrown', { id, grenadeId, x: grenade.x, y: grenade.y, z: grenade.z, fuse: GRENADES.fuse });
    return true;
  }

  // A throw leaving the thrower's eye along yaw/pitch (its own by default):
  // where it starts, how fast it flies and its full fuse. A real throw and
  // predictGrenade start from this same state.
  grenadeLaunch(player, yaw = player.yaw, pitch = player.pitch) {
    const cosine = Math.cos(pitch);
    return {
      x: player.x, y: player.y + playerEyeHeight(player), z: player.z,
      vx: -Math.sin(yaw) * cosine * GRENADES.speed,
      vy: Math.sin(pitch) * GRENADES.speed + GRENADES.lift,
      vz: -Math.cos(yaw) * cosine * GRENADES.speed,
      fuseLeft: GRENADES.fuse,
    };
  }

  // Performance-score reward for rapid consecutive kills. Cash and loot are
  // resolved separately and never see this bonus; snapshot() never copies it.
  // Seconds since the player's last kill that count against the chain: a
  // reload, or the recovery of a melee blow that killed, does not count.
  chainGap(player) { return this.time - player.lastKillAt - (player.chainHeld ?? 0); }

  // Called every tick: while the player cannot fight back (reloading, the
  // gatling spinning up, or recovering from a killing blow), the chain's
  // clock stands still, for at
  // most KILL_CHAIN.holdMax between two kills: no reload trick can keep a
  // chain alive without killing. Nothing is held during the break.
  holdKillChains(delta) {
    if (!(delta > 0) || this.phase === 'intermission') return;
    for (const player of this.players.values()) {
      if (!(player.killChain > 0) || this.chainGap(player) > KILL_CHAIN.window + 1e-9) continue;
      const spin = player.minigunSpinning ? player.minigunSpinUntil ?? 0 : 0;
      const until = Math.max(player.reloadUntil ?? 0, player.chainHoldUntil ?? 0, spin), room = KILL_CHAIN.holdMax - (player.chainHeld ?? 0);
      if (until > this.time && room > 0) player.chainHeld = (player.chainHeld ?? 0) + Math.min(delta, until - this.time, room);
    }
  }

  recordKillChain(player, weapon = player?.weapon) {
    if (!player) return { chain: 0, bonus: 0, chainId: 0 };
    const chain = this.chainGap(player) <= KILL_CHAIN.window + 1e-9 ? player.killChain + 1 : 1;
    player.chainHeld = 0;
    // A slow melee blow (the mace's 2.2 s heavy) must not break the chain
    // while the weapon recovers from the swing that killed. A grenade, burn
    // or rocket kill during that recovery leaves the hold in place.
    if (MELEE_WEAPONS[weapon]) player.chainHoldUntil = player.meleeAfter ?? 0;
    // Rule 2: the chain bonus stays a score bonus (the practice stand's too).
    const bonus = Math.min(KILL_CHAIN.maxBonus, KILL_CHAIN.bonusPerKill * (chain - 1));
    // Each chain has its own number: a client receiving its kills out of
    // order (rocket kills land by distance) never mistakes one for a new chain.
    if (chain === 1) player.chainId = (player.chainId ?? 0) + 1;
    player.killChain = chain;
    player.lastKillAt = this.time;
    player.score += bonus;
    return { chain, bonus, chainId: player.chainId };
  }

  // `impact`: where the blow landed, for its impact number ({ point }, with
  // `rocket` for a rocket's blast), or a burn ({ burn: true }, numbered in
  // batches). The owner's useful damage scores either way, unless `shares`
  // splits it: a burn's [{ ownerId, amount }] in the order it burned, each
  // scoring what it really removed (the kill stays the owner's).
  damageSpecialZombie(zombie, amount, ownerId, direction, weapon, push = false, impact = null, pushMultiplier = 1) {
    if (!this.zombies.has(zombie.id) || !(zombie.hp > 0) || !(amount > 0)) return false;
    const player = this.players.get(ownerId), damage = Math.min(zombie.hp, amount);
    zombie.hp -= amount;
    const feedback = impact && typeof impact === 'object' ? impact : {};
    const options = { continuous: feedback.continuous === true, burn: feedback.burn === true, rocket: feedback.rocket === true };
    if (Array.isArray(feedback.shares) && feedback.shares.length) {
      // In burning order: a share past the health left removed nothing.
      let left = damage;
      const parts = [];
      for (const share of feedback.shares) {
        const part = Math.min(left, Math.max(0, Number(share.amount) || 0));
        if (part > 0) { parts.push({ ownerId: share.ownerId, part }); left -= part; }
      }
      if (left > 0 && parts.length) parts.at(-1).part += left; // float rounding only
      parts.forEach(({ ownerId: id, part }, index) => this.scoreDamage(this.players.get(id), zombie, part, feedback.point ?? null,
        { ...options, killed: zombie.hp <= 0 && index === parts.length - 1 }));
    } else this.scoreDamage(player, zombie, damage, feedback.point ?? null, { ...options, killed: zombie.hp <= 0 });
    if (zombie.hp > 0) {
      if (push) this.pushZombie(zombie, direction.x * damage, direction.z * damage, pushMultiplier);
      return false;
    }
    // Delete before loot and callbacks so a contact, burn and second player's
    // hit in the same tick cannot award this death more than once.
    this.zombies.delete(zombie.id);
    if (player) player.kills++;
    const chain = this.recordKillChain(player, weapon);
    this.dropZombieLoot(zombie, killCash(zombie, false), player);
    this.event('kill', { id: ownerId, zombieId: zombie.id, headshot: false, boss: zombie.boss === true,
      x: zombie.x, y: zombie.y, z: zombie.z, dirX: milli(direction.x), dirZ: milli(direction.z), weapon,
      score: chain.bonus, chain: chain.chain, chainBonus: chain.bonus, chainId: chain.chainId, ...(zombie.kind === 'raider' ? { raider: true } : {}) });
    return true;
  }

  shootRocket(player, origin) {
    const weapon = WEAPONS.rocket, cosine = Math.cos(player.pitch);
    const direction = { x: -Math.sin(player.yaw) * cosine, y: Math.sin(player.pitch), z: -Math.cos(player.yaw) * cosine };
    const movement = { x: direction.x * weapon.range, y: direction.y * weapon.range, z: direction.z * weapon.range };
    const solid = this.grenadeCollision(origin, movement, 0);
    let stopDistance = solid ? solid.fraction * weapon.range : weapon.range, stop = solid ? 'solid' : 'range';
    let struckBoard = null;
    for (const door of this.doors) for (const board of BARRICADE_BOARDS) {
      if (door.sealed) continue;
      if (door.boards[board.index] > 0 && Math.abs(rayBoard(origin, direction, door, board, weapon.range) - stopDistance) < 1e-6)
        struckBoard = { door, boardIndex: board.index };
    }
    for (const zombie of this.zombies.values()) {
      const at = rayBox(origin, direction, enemyHitbox(zombie), weapon.range);
      if (at < stopDistance) { stopDistance = at; stop = 'zombie'; struckBoard = null; }
    }
    // Friendly fire: a teammate on the line takes the rocket.
    for (const mate of this.friendlyTargets(player.id)) {
      const at = rayBox(origin, direction, playerHitbox(mate), weapon.range);
      if (at < stopDistance) { stopDistance = at; stop = 'player'; struckBoard = null; }
    }
    if (struckBoard) stop = 'board';
    // Stay on the shooter's side of a wall. Starting the blast inside a thin
    // surface would otherwise bypass it or occlude every target on both sides.
    const travel = Math.max(0, stopDistance - (stop === 'range' ? 0 : 1e-4));
    const impact = { x: origin.x + direction.x * travel, y: origin.y + direction.y * travel, z: origin.z + direction.z * travel };
    let hits = 0, kills = 0;
    // Frisson rooms only (BLOOD-SPRAY.md 4.1): each body the blast reached, at
    // its axis and middle before the push, with the blast's power.
    const wounds = isFrissonLike(this.ambiance) ? [] : null;
    if (stop !== 'range') for (const zombie of [...this.zombies.values()]) {
      const box = enemyHitbox(zombie), target = { x: zombie.x, y: (box.minY + box.maxY) / 2, z: zombie.z };
      const range = Math.hypot(target.x - impact.x, target.y - impact.y, target.z - impact.z);
      if (range >= ROCKET.radiusDamage || !this.grenadeBlastVisible(impact, target)) continue;
      const attenuation = blastDamageAtDistance(ROCKET, range) / ROCKET.damage;
      const horizontal = Math.hypot(zombie.x - impact.x, zombie.z - impact.z);
      const radial = horizontal > 1e-8 ? { x: (zombie.x - impact.x) / horizontal, z: (zombie.z - impact.z) / horizontal } : direction;
      hits++;
      const power = ROCKET.damage * attenuation * enemyDamageMultiplier(zombie, false);
      const killed = this.damageSpecialZombie(zombie, power, player.id, radial, 'rocket', true, { point: target, rocket: true });
      if (killed) kills++;
      if (wounds && zombie.kind !== 'raider') wounds.push([zombie.id, milli(target.x), milli(target.y), milli(target.z), milli(power), killed ? 1 : 0]);
    }
    const teammates = stop !== 'range' ? this.blastSurvivors(ROCKET, impact, player.id, 'rocket') : [];
    // Only the directly struck plank breaks, after blast visibility has been
    // resolved against its original protection. No friendly or area wood damage.
    const boardHits = struckBoard && this.damageDoor(struckBoard.door, ROCKET.damage, { boardIndex: struckBoard.boardIndex, id: player.id }) ? 1 : 0;
    this.event('shot', { id: player.id, weapon: 'rocket', ...origin, yaw: player.yaw, pitch: player.pitch, hits, kills, boardHits, headshots: 0, impact,
      pellets: [{ yaw: milli(player.yaw), pitch: milli(player.pitch), distance: milli(stopDistance), stop }] });
    if (stop !== 'range') {
      const blast = { id: player.id, weapon: 'rocket', ...impact, radius: ROCKET.radiusDamage, hits, kills };
      if (wounds?.length) blast.wounds = wounds;
      if (teammates.length) blast.teammates = teammates;
      this.event('explosion', blast);
    }
    return true;
  }

  shootFlame(player, origin) {
    const cosine = Math.cos(player.pitch);
    const direction = { x: -Math.sin(player.yaw) * cosine, y: Math.sin(player.pitch), z: -Math.cos(player.yaw) * cosine };
    let hits = 0, kills = 0;
    for (const zombie of [...this.zombies.values()]) {
      const reach = this.flameReach(origin, direction, enemyHitbox(zombie), zombie);
      if (!reach) continue;
      const { target, range } = reach;
      const strength = flameFalloff(FLAMETHROWER, range);
      if (!(strength > 0)) continue;
      hits++;
      // Settle the old intensity before a new contact can strengthen it.
      if (this.applyZombieBurn(zombie, this.time)) { kills++; continue; }
      const damage = FLAMETHROWER.contactDps * strength * FIRE_INTERVALS.flamethrower * enemyDamageMultiplier(zombie, false);
      if (this.damageSpecialZombie(zombie, damage, player.id, direction, 'flamethrower', false, { point: target, continuous: true })) { kills++; continue; }
      if (!(zombie.burnUntil > this.time)) {
        zombie.burnOwnerId = player.id;
        zombie.burnStartedAt = this.time;
        zombie.burnDamageAt = this.time;
      }
      // One burn: use the strongest exposure still alive, never their sum.
      // Weaker edge contacts cannot refresh an earlier full-strength flame.
      // New contacts outlive older ones, so weaker older entries are dominated.
      // Each exposure keeps its shooter: the burn it drives scores for them.
      const exposures = zombie.burnExposures ?? (zombie.burnUntil > this.time
        ? [{ strength: 1, until: zombie.burnUntil, ownerId: zombie.burnOwnerId }] : []);
      zombie.burnExposures = exposures.filter(exposure => exposure.until > this.time && exposure.strength > strength);
      zombie.burnUntil = this.time + FLAMETHROWER.burnDuration;
      zombie.burnExposures.push({ strength, until: zombie.burnUntil, ownerId: player.id });
    }
    // Friendly fire: a teammate in the cone takes, while in the flames, what
    // a body burning there would (contact and burn); survivors put the fire
    // out at once, so nothing keeps burning after.
    for (const mate of this.friendlyTargets(player.id)) {
      const reach = this.flameReach(origin, direction, playerHitbox(mate), mate);
      const strength = reach ? flameFalloff(FLAMETHROWER, reach.range) : 0;
      if (strength > 0) this.hurtSurvivor(mate, (FLAMETHROWER.contactDps + FLAMETHROWER.burnDps) * strength * FIRE_INTERVALS.flamethrower, player.id, 'flamethrower', player);
    }
    const solid = this.grenadeCollision(origin, { x: direction.x * FLAMETHROWER.range, y: direction.y * FLAMETHROWER.range, z: direction.z * FLAMETHROWER.range }, 0);
    const visibleDistance = solid ? Math.max(0, solid.fraction * FLAMETHROWER.range - 1e-4) : FLAMETHROWER.range;
    this.event('shot', { id: player.id, weapon: 'flamethrower', ...origin, yaw: player.yaw, pitch: player.pitch, hits, kills, boardHits: 0, headshots: 0,
      pellets: [{ yaw: milli(player.yaw), pitch: milli(player.pitch), distance: milli(visibleDistance), stop: solid ? 'solid' : 'range' }] });
    return true;
  }

  // The point of a body (its box, standing at body.x/z) the flame cone reaches
  // best, and its range; null out of reach, out of the cone or out of sight.
  flameReach(origin, direction, box, body) {
    // Pick the body height nearest the aim cone, including shots down stairs.
    // Maximising the dot product of the normalised target vector with the
    // aim gives dy = direction.y * horizontalSquared / horizontalDot.
    const dx = body.x - origin.x, dz = body.z - origin.z;
    const horizontalSquared = dx * dx + dz * dz;
    if (horizontalSquared > FLAMETHROWER.range ** 2) return null;
    const verticalReach = Math.sqrt(FLAMETHROWER.range ** 2 - horizontalSquared);
    const minY = Math.max(box.minY + .05, origin.y - verticalReach);
    const maxY = Math.min(box.maxY - .05, origin.y + verticalReach);
    if (minY > maxY) return null;
    const horizontalDot = dx * direction.x + dz * direction.z;
    const alignment = y => (horizontalDot + (y - origin.y) * direction.y) / Math.max(1e-8, Math.hypot(dx, y - origin.y, dz));
    let targetY = alignment(minY) > alignment(maxY) ? minY : maxY;
    if (horizontalDot > 1e-8) {
      const optimumY = clamp(origin.y + direction.y * horizontalSquared / horizontalDot, minY, maxY);
      if (alignment(optimumY) > alignment(targetY)) targetY = optimumY;
    }
    const target = { x: body.x, y: targetY, z: body.z };
    const vector = { x: target.x - origin.x, y: target.y - origin.y, z: target.z - origin.z };
    const range = Math.hypot(vector.x, vector.y, vector.z);
    if (range > FLAMETHROWER.range || range < 1e-8
      || (vector.x * direction.x + vector.y * direction.y + vector.z * direction.z) / range < Math.cos(FLAMETHROWER.coneAngle / 2)
      || !this.grenadeBlastVisible(origin, target)) return null;
    return { target, range };
  }

  // The burn over each stretch scores for the shooter of the strongest
  // exposure alive then (the newest on a tie): who keeps a body burning
  // earns what that fire removes, even when a teammate lit it. The kill, its
  // chain and its loot stay with the first igniter (burnOwnerId), so coins
  // and kill cash are unchanged.
  applyZombieBurn(zombie, to, fromFloor = -Infinity) {
    if (!Number.isFinite(zombie.burnUntil)) return false;
    const from = Math.max(fromFloor, zombie.burnDamageAt ?? zombie.burnStartedAt ?? to);
    const end = Math.min(to, zombie.burnUntil);
    // Old saved/fixture burns without exposures retain their original power;
    // an exposure without a shooter (an older save) is the first igniter's.
    const exposures = zombie.burnExposures ?? [{ strength: 1, until: zombie.burnUntil }];
    const boundaries = [...new Set([from, end, ...exposures.map(exposure => exposure.until)
      .filter(until => until > from && until < end)])].sort((a, b) => a - b);
    let weightedDuration = 0;
    const shares = [];
    if (end > from) for (let index = 1; index < boundaries.length; index++) {
      const start = boundaries[index - 1], finish = boundaries[index];
      let strongest = null;
      for (const exposure of exposures) if (exposure.until > start && (!strongest || exposure.strength >= strongest.strength)) strongest = exposure;
      const strength = Math.max(0, strongest?.strength ?? 0);
      if (!(strength > 0)) continue;
      weightedDuration += (finish - start) * strength;
      const ownerId = strongest.ownerId ?? zombie.burnOwnerId, last = shares.at(-1);
      if (last && last.ownerId === ownerId) last.weighted += (finish - start) * strength;
      else shares.push({ ownerId, weighted: (finish - start) * strength });
    }
    zombie.burnDamageAt = Math.max(zombie.burnDamageAt ?? from, end);
    // Same arithmetic as before for one shooter: their share is exactly the
    // whole burn.
    const multiplier = enemyDamageMultiplier(zombie, false), amount = FLAMETHROWER.burnDps * weightedDuration * multiplier;
    const killed = weightedDuration > 0 && this.damageSpecialZombie(zombie, amount, zombie.burnOwnerId, { x: 0, z: 0 }, 'flamethrower', false,
      { burn: true, shares: shares.map(share => ({ ownerId: share.ownerId, amount: FLAMETHROWER.burnDps * share.weighted * multiplier })) });
    if (to >= zombie.burnUntil) {
      delete zombie.burnUntil; delete zombie.burnStartedAt; delete zombie.burnOwnerId; delete zombie.burnDamageAt; delete zombie.burnExposures;
    } else if (zombie.burnExposures) zombie.burnExposures = exposures.filter(exposure => exposure.until > to);
    return killed;
  }

  // A burn's score, numbered for its owner at most four times a second, at
  // the body's middle where it stands then (it survives the death).
  queueBurnNumber(zombie, ownerId, amount, killed) {
    if (!this.impactObservers.has(ownerId)) return;
    const key = ownerId + '\0' + zombie.id, hitbox = enemyHitbox(zombie);
    if (!this.burnDamagePending.size) this.burnDamageNextAt = Math.max(this.burnDamageNextAt, this.time + BURN_DAMAGE_INTERVAL);
    const entry = this.burnDamagePending.get(key) ?? { ownerId, zombieId: zombie.id, amount: 0, killed: false };
    Object.assign(entry, { x: zombie.x, y: (hitbox.minY + hitbox.maxY) / 2, z: zombie.z, amount: entry.amount + amount, killed: entry.killed || killed });
    this.burnDamagePending.set(key, entry);
  }

  flushBurnNumbers() {
    if (this.paused || !this.burnDamagePending.size || this.time + 1e-8 < this.burnDamageNextAt) return false;
    for (const entry of this.burnDamagePending.values())
      this.queueImpactNumber(entry.ownerId, entry.zombieId, entry.amount, entry, { continuous: true, killed: entry.killed, burn: true });
    this.burnDamagePending.clear();
    this.burnDamageNextAt = this.time + BURN_DAMAGE_INTERVAL;
    return true;
  }

  updateBurns(delta) {
    if (!HAZARD_PHASES.includes(this.phase)) return;
    for (const zombie of [...this.zombies.values()]) this.applyZombieBurn(zombie, this.time, this.time - delta);
    this.flushBurnNumbers();
  }

  // Friendly fire: a grenade's or a rocket's blast on every survivor in reach
  // and in sight of its centre, its own thrower or shooter included, with the
  // falloff enemies get. What each took, for the explosion event.
  blastSurvivors(profile, centre, ownerId, weapon, multiplier = 1) {
    const hurt = [];
    for (const survivor of this.friendlyTargets()) {
      const box = playerHitbox(survivor), target = { x: survivor.x, y: (box.minY + box.maxY) / 2, z: survivor.z };
      const range = Math.hypot(target.x - centre.x, target.y - centre.y, target.z - centre.z);
      if (range >= profile.radiusDamage || !this.grenadeBlastVisible(centre, target)) continue;
      const damage = this.hurtSurvivor(survivor, blastDamageAtDistance(profile, range) * multiplier, ownerId, weapon, centre);
      if (damage > 0) hurt.push({ playerId: survivor.id, damage });
    }
    return hurt;
  }

  grenadeCollision(origin, movement, radius = GRENADES.radius) {
    let closest = null;
    const consider = hit => { if (hit && (!closest || hit.fraction < closest.fraction)) closest = hit; };
    if (!HAS_SPACE && movement.y < -1e-10 && origin.y + movement.y < radius) {
      consider({ fraction: clamp((radius - origin.y) / movement.y, 0, 1), normal: { x: 0, y: 1, z: 0 } });
    }
    // Broad phase, exact: a solid or a plank the swept segment's bounds
    // (grown by the radius and a hair) never reach cannot be hit, so it is
    // skipped; sweptBox alone decides for the others, in the same order. A
    // plank is bounded by the sphere round its centre holding its grown box.
    const reach = radius + 1e-6;
    const lowX = Math.min(origin.x, origin.x + movement.x) - reach, highX = Math.max(origin.x, origin.x + movement.x) + reach;
    const lowY = Math.min(origin.y, origin.y + movement.y) - reach, highY = Math.max(origin.y, origin.y + movement.y) + reach;
    const lowZ = Math.min(origin.z, origin.z + movement.z) - reach, highZ = Math.max(origin.z, origin.z + movement.z) + reach;
    for (const box of this.solidBoxes()) {
      if (box.maxX < lowX || box.minX > highX || box.maxY < lowY || box.minY > highY || box.maxZ < lowZ || box.minZ > highZ) continue;
      consider(sweptBox(origin, movement, box, radius));
    }
    for (const frame of GRENADE_ORIENTED_SOLIDS) {
      const hit = sweptBox(frame.into(origin), frame.into(movement, true), frame.box, radius);
      if (hit) consider({ ...hit, normal: frame.out(hit.normal) });
    }
    for (const z of [-6, 6]) consider(gableHit(origin, movement, z, radius));
    for (const door of this.doors) for (const board of BARRICADE_BOARDS) {
      if (door.sealed) continue;
      if (door.boards[board.index] <= 0) continue;
      const bound = Math.hypot(board.width / 2 + radius, board.height / 2 + radius, board.depth / 2 + radius) + 1e-6;
      if (door.x + bound < lowX || door.x - bound > highX || board.y + bound < lowY || board.y - bound > highY || door.z + bound < lowZ || door.z - bound > highZ) continue;
      const frame = boardFrame(door, board);
      const hit = sweptBox(frame.into(origin), frame.into(movement, true), frame.box, radius);
      if (hit) consider({ ...hit, normal: frame.out(hit.normal) });
    }
    return closest;
  }

  grenadeBlastVisible(origin, target) {
    const direction = { x: target.x - origin.x, y: target.y - origin.y, z: target.z - origin.z };
    if (this.solidBoxes().some(box => rayBox(origin, direction, box, 1) < 1 - 1e-6)) return false;
    if (GRENADE_ORIENTED_SOLIDS.some(frame => rayBox(frame.into(origin), frame.into(direction, true), frame.box, 1) < 1 - 1e-6)) return false;
    if ([-6, 6].some(z => { const hit = gableHit(origin, direction, z); return hit && hit.fraction < 1 - 1e-6; })) return false;
    return this.doors.every(door => BARRICADE_BOARDS.every(board => door.boards[board.index] <= 0
      || rayBoard(origin, direction, door, board, 1) >= 1 - 1e-6));
  }

  explodeGrenade(grenade) {
    if (!HAZARD_PHASES.includes(this.phase) || !this.grenades.has(grenade.id)) return false;
    // Delete before resolving damage: no repeated explosion from a second tick
    // or an event callback, even when the same blast kills a whole formation.
    this.grenades.delete(grenade.id);
    const player = this.players.get(grenade.ownerId);
    let hits = 0, kills = 0;
    // Frisson rooms only (BLOOD-SPRAY.md 4.1), as the rocket's blast.
    const wounds = isFrissonLike(this.ambiance) ? [] : null;
    for (const zombie of [...this.zombies.values()]) {
      if (!(zombie.hp > 0)) continue;
      const hitbox = enemyHitbox(zombie);
      const target = { x: zombie.x, y: (hitbox.minY + hitbox.maxY) / 2, z: zombie.z };
      const range = Math.hypot(target.x - grenade.x, target.y - grenade.y, target.z - grenade.z);
      if (range >= GRENADES.radiusDamage || !this.grenadeBlastVisible(grenade, target)) continue;
      const attenuation = blastDamageAtDistance(GRENADES, range) / GRENADES.damage;
      const damage = GRENADES.damage * (grenade.damageMultiplier ?? 1) * attenuation * enemyDamageMultiplier(zombie, false);
      const useful = Math.min(zombie.hp, damage);
      zombie.hp -= damage;
      if (wounds && zombie.kind !== 'raider') wounds.push([zombie.id, milli(target.x), milli(target.y), milli(target.z), milli(damage), zombie.hp <= 0 ? 1 : 0]);
      hits++;
      this.scoreDamage(player, zombie, useful, target, { killed: zombie.hp <= 0 });
      const dx = zombie.x - grenade.x, dz = zombie.z - grenade.z, horizontal = Math.hypot(dx, dz);
      const dirX = horizontal > 1e-8 ? dx / horizontal : 0, dirZ = horizontal > 1e-8 ? dz / horizontal : 0;
      if (zombie.hp <= 0) {
        this.zombies.delete(zombie.id);
        if (player) player.kills++;
        const chain = this.recordKillChain(player, 'grenade');
        this.dropZombieLoot(zombie, killCash(zombie, false), player);
        kills++;
        this.event('kill', { id: grenade.ownerId, zombieId: zombie.id, headshot: false, boss: zombie.boss === true,
          x: zombie.x, y: zombie.y, z: zombie.z, dirX: milli(dirX), dirZ: milli(dirZ), weapon: 'grenade',
          score: chain.bonus, chain: chain.chain, chainBonus: chain.bonus, chainId: chain.chainId, ...(zombie.kind === 'raider' ? { raider: true } : {}) });
      } else this.pushZombie(zombie, dirX * damage, dirZ * damage);
    }
    // Survivors only with friendly fire on (the thrower too); barricades never.
    const teammates = this.blastSurvivors(GRENADES, grenade, grenade.ownerId, 'grenade', grenade.damageMultiplier ?? 1);
    const blast = { id: grenade.ownerId, grenadeId: grenade.id, x: grenade.x, y: grenade.y, z: grenade.z, hits, kills };
    if (wounds?.length) blast.wounds = wounds;
    if (teammates.length) blast.teammates = teammates;
    this.event('explosion', blast);
    return true;
  }

  updateGrenades(delta) {
    if (!HAZARD_PHASES.includes(this.phase)) return;
    for (const grenade of [...this.grenades.values()]) if (this.advanceGrenade(grenade, delta)) this.explodeGrenade(grenade);
  }

  // One tick of a grenade's flight, shared by updateGrenades and
  // predictGrenade (any object with a position, a velocity and fuseLeft).
  // True once its fuse has burnt: it bursts where it then lies.
  advanceGrenade(grenade, delta) {
    let remaining = Math.min(delta, Math.max(0, grenade.fuseLeft));
    // Small deterministic substeps bound parabolic deviation; every segment
    // still sweeps every collider, including thin rotated barricade planks.
    while (remaining > 1e-8) {
      const step = Math.min(remaining, 1 / 120);
      let movement = { x: grenade.vx * step, y: grenade.vy * step - .5 * GRENADES.gravity * step * step, z: grenade.vz * step };
      grenade.vy -= GRENADES.gravity * step;
      let travelTime = step;
      for (let bounce = 0; bounce < 6; bounce++) {
        const hit = this.grenadeCollision(grenade, movement);
        if (!hit) { grenade.x += movement.x; grenade.y += movement.y; grenade.z += movement.z; break; }
        grenade.x += movement.x * hit.fraction + hit.normal.x * 1e-4;
        grenade.y += movement.y * hit.fraction + hit.normal.y * 1e-4;
        grenade.z += movement.z * hit.fraction + hit.normal.z * 1e-4;
        const impact = grenade.vx * hit.normal.x + grenade.vy * hit.normal.y + grenade.vz * hit.normal.z;
        if (impact < 0) {
          grenade.vx -= (1 + GRENADES.bounce) * impact * hit.normal.x;
          grenade.vy -= (1 + GRENADES.bounce) * impact * hit.normal.y;
          grenade.vz -= (1 + GRENADES.bounce) * impact * hit.normal.z;
        }
        if (hit.normal.y > .7) {
          grenade.vx *= GRENADES.friction; grenade.vz *= GRENADES.friction;
          if (Math.abs(grenade.vy) < .5) grenade.vy = 0;
        }
        travelTime *= 1 - hit.fraction;
        if (travelTime < 1e-8) break;
        movement = { x: grenade.vx * travelTime, y: grenade.vy * travelTime, z: grenade.vz * travelTime };
      }
      remaining -= step;
    }
    grenade.fuseLeft = Math.max(0, grenade.fuseLeft - delta);
    return grenade.fuseLeft <= 1e-8;
  }

  // Where a grenade thrown now along yaw/pitch (the player's own by
  // default) would burst: the real launch flown tick by tick through the
  // real steps, against the walls, floors and planks as they stand. Nothing
  // is thrown, spent or changed. Bodies never stop a grenade, so this is
  // exact unless a plank breaks or is rebuilt during the flight.
  predictGrenade(player, { yaw = player.yaw, pitch = player.pitch, delta = 1 / TICK_RATE } = {}) {
    const grenade = this.grenadeLaunch(player, yaw, pitch);
    for (let tick = Math.ceil(GRENADES.fuse / delta) + 1; tick > 0; tick--) if (this.advanceGrenade(grenade, delta)) break;
    return { x: grenade.x, y: grenade.y, z: grenade.z };
  }

  // `revive`: the client holds a press that began next to a downed teammate.
  // Such a press only revives: when that revive ends some other way, it must
  // not turn into a purchase, a pickup or a repair.
  interact(id, { revive = false } = {}) {
    const player = this.players.get(id);
    if (this.paused || !player || !player.alive || player.downed || player.interactAfter > this.time || ['lobby', ...FROZEN_PHASES].includes(this.phase)) return false;
    // Holding E keeps the revive under way going, up to REVIVE.reach and even
    // if another teammate falls closer; it completes in updateRevives.
    const channel = player.reviving;
    if (channel && this.canReviveTarget(player, this.players.get(channel.targetId), REVIVE.reach)) { channel.lastAt = this.time; return true; }
    const teammate = this.reviveTargetFor(player);
    if (teammate) {
      if (channel) this.event('revive-stop', { id, targetId: channel.targetId });
      const duration = characterStats(player).reviveSeconds;
      player.reviving = { targetId: teammate.id, startedAt: this.time, lastAt: this.time, duration };
      this.event('revive-start', { id, targetId: teammate.id, duration });
      return true;
    }
    if (revive) return false;
    if (this.expeditionInteraction(id)) return true;
    const groundWeapon = this.nearbyGroundWeapon(player);
    if (groundWeapon) return this.takeGroundWeapon(id, groundWeapon.id);
    const bonus = this.nearbyBonus(player);
    if (bonus) return this.takeBonus(id, bonus.id);
    const crate = ARMORY.filter(item => distance(player, item) < ARMORY_REACH && Math.abs(player.y - item.y) < ARMORY_HEIGHT_REACH)
      .sort((a, b) => distance(player, a) - distance(player, b))[0];
    if (crate) return this.buyWeapon(id, crate.id);
    if (HAS_SPACE ? Math.abs(player.y) > .8 : player.y > 0.8) return this.openSupplyMenu(player);
    const door = this.doors.find(item => !item.sealed && !item.sealPending && distance(player, item) < 2.25 && item.hp < item.maxHp);
    if (!door) return this.openSupplyMenu(player);
    return this.repairDoor(id, door.id);
  }

  // One repair action on a named door (E next to it). Companions call it
  // directly: interact() would buy at a rack first when one is in reach.
  repairDoor(id, doorId) {
    const player = this.players.get(id);
    if (this.paused || !player || !player.alive || player.downed || player.interactAfter > this.time || ['lobby', ...FROZEN_PHASES].includes(this.phase)) return false;
    const door = this.doors.find(item => item.id === doorId);
    if (HAS_SPACE && Math.abs(player.y) > .8) return false;
    if (!door || door.sealed || door.sealPending || distance(player, door) >= 2.25 || door.hp >= door.maxHp) return false;
    const occupiesPassage = (entity,radius,height) => {
      const normal=door.outZ ? entity.z-door.z : entity.x-door.x;
      const tangent=door.outZ ? entity.x-door.x : entity.z-door.z;
      return Math.abs(normal)<=radius+.135 && Math.abs(tangent)<=1.3+radius && entity.y<2.8 && entity.y+height>0;
    };
    const occupied=[...this.players.values()].some(entity=>entity.alive&&occupiesPassage(entity,PLAYER_RADIUS,playerHeight(entity)))
      || [...this.zombies.values()].some(entity=>entity.hp>0&&occupiesPassage(entity,.29*(entity.scale??1),enemyProfile(entity).height*(entity.scale??1)));
    if(occupied) {
      player.interactAfter=this.time+.55;
      this.event('repair-blocked',{id,message:'Dégage le passage avant de réparer.'});
      return false;
    }
    // 25 HP per action; a sheet's Bricolage debt restores less.
    let remaining = characterStats(player).repairHp, restored = 0;
    const indices = BARRICADE_BOARDS.map(board => board.index).sort((a, b) => Number(door.boards[a] <= 0) - Number(door.boards[b] <= 0) || a - b);
    for (const index of indices) {
      const amount = Math.min(remaining, BARRICADE_BOARDS[index].maxHp - door.boards[index]);
      door.boards[index] += amount;
      remaining -= amount;
      restored += amount;
      if (remaining <= 0) break;
    }
    const credited = Math.min(restored, door.repairCredit);
    door.repairCredit -= credited;
    // Rule 4: the score is the health the zombies really broke and this
    // action put back (25 at most, less with a Bricolage debt); 1 coin.
    if (credited > 0) this.awardPoints(player, credited, ECONOMY.repair);
    player.interactAfter = this.time + 0.55;
    this.event('repair', { id, doorId: door.id, hp: door.hp, boards: [...door.boards], points: credited > 0 ? ECONOMY.repair : 0 });
    return true;
  }

  damagePlayer(player, damage, zombie = {}) {
    if (player.waiting) return;
    // Raider hits carry their origin instead of a zombie id (no melee swing);
    // a teammate's (friendly fire, hurtSurvivor) carries its shooter too.
    const raider = zombie.source === 'raider' ? { source: 'raider', raiderId: zombie.id, fromX: milli(zombie.x), fromZ: milli(zombie.z) }
      : zombie.source === 'friendly' ? { source: 'friendly', shooterId: zombie.id, weapon: zombie.weapon, fromX: milli(zombie.x), fromZ: milli(zombie.z) } : null;
    if (this.practice) {
      // The stand drill shows where shots come from without touching health.
      if (raider && zombie.drill && player.alive && !player.downed) this.event('drill-hit', { id: player.id, raiderId: raider.raiderId, fromX: raider.fromX, fromZ: raider.fromZ, damage });
      return;
    }
    if (!player.alive || player.downed) return;
    // Just revived: a short shield, so nothing knocks them straight back down.
    if (this.time < (player.reviveShieldUntil ?? 0)) return;
    const stats = characterStats(player);
    const resistance = zombie.source === 'outside' ? stats.rainMultiplier : zombie.source === 'fall' ? 1 : stats.combatMultiplier;
    damage = milli(damage * difficultyOf(this.difficulty).damageTaken * resistance);
    if (!(damage > 0)) return;
    // The vest takes blows and falls first; exposure outside goes straight to health.
    const absorbed = zombie.source === 'outside' ? 0 : Math.min(player.armor ?? 0, damage);
    // A teammate's blow (friendly fire) also says what it really took: the
    // vest's share and the health lost, never more health than was left (the
    // shooter's red number, capped like an enemy's). Other hits keep their
    // exact fields.
    const inflicted = raider?.source === 'friendly' ? { inflicted: milli(absorbed + Math.min(Math.max(0, player.hp), damage - absorbed)) } : null;
    player.armor = (player.armor ?? 0) - absorbed;
    player.hp = Math.max(0, player.hp - (damage - absorbed));
    // Going down loses the vest; the hit already reports what is left.
    if (player.hp <= 0) player.armor = 0;
    // `damage` stays the incoming blow; `absorbed` is what the vest stopped.
    this.event('hit', { id: player.id, damage, absorbed, ...inflicted, armor: player.armor, ...(raider ?? { zombieId: zombie.id, ...(zombie.source ? {source:zombie.source} : {}) }) });
    if (player.hp <= 0) {
      this.cancelMinigunSpin(player);
      this.cancelMelee(player.id);
      this.setUmbrella(player.id, false);
      this.dropFuel(player);
      // A downed survivor keeps their bonus; it returns with the revive.
      player.downed = true;
      this.closeReviveCredit(player.id);
      this.resetGrenadier(player);
      player.input.crouch = false;
      player.crouched = false;
      this.clearWeaponReloads(player);
      player.bleedOutAt = this.time + REVIVE.bleedOut;
      player.outsideDamageAccumulator = 0;
      this.event('down', { id: player.id, seconds: REVIVE.bleedOut, ...(raider ?? (zombie.source ? {source:zombie.source} : {})) });
      if (raider?.source === 'raider') this.robPlayer(player);
      this.updateFrostAuras();
    }
  }

  // Whether friendly fire hurts in this room: a level above off, in an
  // ambiance allowed to have it (rules.js friendlyFireAllowed), never in the
  // practice range. The damage, the snapshot and the companions all ask here.
  friendlyFireOn() {
    return !this.practice && friendlyFireScale(this.friendlyFire) > 0 && friendlyFireAllowed(this.ambiance);
  }

  // Friendly fire (rules.js FRIENDLY_FIRE): the survivors a shot, a blow or a
  // blast can hurt, standing and in the night (never downed nor waiting:
  // downing and revives keep their rules), but `excludeId`; none while it is
  // off, so every shot then resolves exactly as before.
  friendlyTargets(excludeId = null) {
    if (!this.friendlyFireOn()) return [];
    const targets = [];
    for (const player of this.players.values()) if (player.id !== excludeId && player.alive && !player.downed && !player.waiting) targets.push(player);
    return targets;
  }

  // A weapon's own damage on a survivor, scaled by the friendly fire level,
  // then the usual rules (damagePlayer: difficulty, resistance, vest, the
  // revive shield, downing). `from`: where the harm came from, for the
  // victim's damage arc (the shooter, or a blast's centre). The scaled amount.
  hurtSurvivor(player, amount, shooterId, weapon, from) {
    const damage = milli(Math.max(0, amount) * friendlyFireScale(this.friendlyFire));
    if (!(damage > 0)) return 0;
    this.damagePlayer(player, damage, { source: 'friendly', id: shooterId, weapon, x: from.x, z: from.z });
    return damage;
  }

  canOccupy(entity, x, z, y, radius, respectCovers = true) {
    const isPlayer = this.players.has(entity.id);
    const bodyHeight = isPlayer ? playerHeight(entity) : enemyProfile(entity).height*(entity.scale ?? 1);
    if (HAS_SPACE && !spaceCanOccupy(x,z,y,bodyHeight,radius,isPlayer ? entity.grounded !== false ? STEP_HEIGHT : 0 : .4)) return false;
    if (!HAS_SPACE && isPlayer && overlapsLoftSlab(x, z, y, bodyHeight, radius)
      && !leavesLoftPenetration(entity, x, z, y)) return false;
    if (!HAS_SPACE && isPlayer && y < LOFT.y + LOFT_RAIL.height - 1e-6 && y + bodyHeight > LOFT.y
      && inRect(x, z, loftRailBounds, radius)) return false;
    if (!HAS_SPACE && respectCovers) {
      // Tread contacts allow the small rise of ordinary stair walking. Below
      // the staircase, however, the whole body must clear its real underside.
      const surface = isPlayer ? stairContactY(z) : stairY(z);
      // Step-height tolerance is only for feet raised by ordinary grounded
      // stair walking. An airborne shoulder cannot enter below a tread's top:
      // otherwise gravity drops it through that tread into the enclosed wood.
      const allowance = isPlayer ? entity.grounded !== false ? STEP_HEIGHT : 1e-6 : .3;
      const onTreads = (isPlayer ? inRect(x,z,STAIR_CONTACT,radius) : isStair(x,z)) && y >= surface - allowance;
      const nearFoot = x >= STAIRS.minX && x <= STAIRS.maxX
        && z >= STAIRS.maxZ - (STAIRS.maxZ - STAIRS.minZ) / STAIRS.steps && y <= .32;
      if (!onTreads && !nearFoot && y + bodyHeight > stairCeiling(x,z,y,radius) + 1e-6) return false;
    }
    if (y < LEVEL.wallHeight && y + bodyHeight > 0) {
      for (const door of this.doors) {
        const horizontalWall = door.outZ !== 0;
        const normal = horizontalWall ? z : x, tangent = horizontalWall ? x : z;
        const plane = horizontalWall ? door.z : door.x, halfLength = horizontalWall ? LEVEL.halfWidth : LEVEL.halfDepth;
        if (HAS_SPACE && y >= spaceWallHeight(door, tangent) - 1e-6) continue;
        if (Math.abs(normal-plane)>radius+.135 || Math.abs(tangent)>halfLength+radius) continue;
        if (Math.abs(tangent)+radius>1.3 || y<0 || y+bodyHeight>2.8 || !this.doorPassable(door,y,bodyHeight)) return false;
      }
    }
    for (const cover of respectCovers ? WORLD.covers : INTERIOR_WALLS) {
      const baseY = cover.baseY ?? 0;
      const height = bodyHeight;
      const cap = PARTITION_CAPS.find(cap => cap.layoutId === cover.id);
      if (cap) {
        if (y < partitionCapSupport(cap, x, z, radius) - 1e-6 && y + height > baseY) return false;
        continue;
      }
      for (const piece of coverPieces(cover)) if (y < baseY + piece.height && y + height > baseY && inRect(x, z, piece, radius)) return false;
    }
    return true;
  }

  doorPassable(door,y=0,height=PLAYER_HEIGHT) {
    if (!door || door.sealed) return false;
    const boards = door.boards;
    if (!boards) return door.hp <= 0;
    return boards.every((hp,index) => {
      if(hp<=0)return true;
      const board=BARRICADE_BOARDS[index];
      const extent=board.height/2*Math.cos(board.angle)+board.width/2*Math.abs(Math.sin(board.angle));
      const center=board.y;
      return y>=center+extent || y+height<=center-extent;
    });
  }

  outsideDamageActive(player) {
    return this.rainExposed(player) && !(player.umbrella.open && player.umbrella.remaining > 0);
  }

  rainExposed(player) {
    return !this.practice && player.alive && !player.downed && HAZARD_PHASES.includes(this.phase)
      && rainExposed(player, playerHeight(player));
  }

  updateOutsideDamage(player,delta) {
    if (this.practice) { player.outsideDamageAccumulator = 0; return; }
    if(!player.alive || player.downed || !HAZARD_PHASES.includes(this.phase)){player.outsideDamageAccumulator=0;return;}
    if(!this.rainExposed(player))return;
    let exposed = delta;
    if (player.umbrella.open && player.umbrella.remaining > 0) {
      const protectedTime = Math.min(exposed, player.umbrella.remaining);
      player.umbrella.remaining = Math.max(0, player.umbrella.remaining - protectedTime);
      exposed -= protectedTime;
      if (player.umbrella.remaining <= 1e-8) {
        player.umbrella.remaining = 0;
        this.setUmbrella(player.id, false);
        this.event('umbrella-broken', { id: player.id });
      }
    }
    player.outsideDamageAccumulator=(player.outsideDamageAccumulator??0)+exposed;
    while(player.outsideDamageAccumulator>=1-1e-8 && player.alive && !player.downed) {
      player.outsideDamageAccumulator-=1;
      this.damagePlayer(player,EXTERIOR.damagePerSecond,{source:'outside'});
    }
  }

  candidateY(entity, x, z) {
    if (HAS_SPACE) {
      const support=spaceFloor(x,z,entity.y+.3);
      if(!Number.isFinite(support)||Math.abs(support-entity.y)>.3+1e-6)return null;
      return support;
    }
    const currentStair = isStair(entity.x,entity.z), nextStair = isStair(x,z);
    const usingStairs = currentStair && entity.y >= stairY(entity.z) - .3;
    if (!usingStairs && entity.y < .3) {
      const entersFoot = x >= STAIRS.minX && x <= STAIRS.maxX
        && entity.z >= STAIRS.maxZ && z >= STAIRS.maxZ - (STAIRS.maxZ - STAIRS.minZ) / STAIRS.steps;
      if (entersFoot) return nextStair ? stairStepY(z) : 0;
      const height = enemyProfile(entity).height * (entity.scale ?? 1);
      // A body beneath a high tread stays on the ground floor. It cannot climb
      // an overhead surface or squeeze into the low end of the staircase.
      return height <= stairCeiling(x,z,0,bodyRadius(entity)) + 1e-6 ? 0 : null;
    }
    if (nextStair) {
      const targetY = stairStepY(z);
      // Enter through either landing, never through the side handrails.
      if (!currentStair && entity.z > WORLD.stair.minZ && entity.z < WORLD.stair.maxZ) return null;
      if (!currentStair && Math.abs(entity.y - targetY) > 0.3) return null;
      return targetY;
    }
    if (usingStairs) {
      if (z < WORLD.stair.minZ && entity.y > 3.08 && x >= WORLD.loft.minX) return WORLD.loftY;
      if (z > WORLD.stair.maxZ && entity.y < 0.32) return 0;
      return null;
    }
    // Zombies have no airborne fall state. Keep their center on the loft,
    // rather than accepting a partial foothold inside the stairwell that the
    // navigation graph correctly treats as a hole. Survivors may still jump
    // and balance on an edge through their separate movement solver.
    if (entity.y > 2.8) return x >= WORLD.loft.minX + .25 && hasLoftFloor(x, z, 0) ? WORLD.loftY : null;
    return 0;
  }

  playerSurface(player, x, z, belowY) {
    const surfaces = [HAS_SPACE ? spaceFloor(x,z,belowY,PLAYER_RADIUS) : 0];
    if (!HAS_SPACE) { if (inRect(x, z, STAIR_CONTACT, PLAYER_RADIUS)) surfaces.push(stairContactY(z));
    else surfaces.push(stairStringerSurface(x, z, PLAYER_RADIUS)); }
    if (hasLoftFloor(x, z)) surfaces.push(WORLD.loftY);
    if (inRect(x, z, loftRailBounds, PLAYER_RADIUS)) surfaces.push(LOFT.y + LOFT_RAIL.height);
    for (const cover of WORLD.covers) {
      const cap = PARTITION_CAPS.find(cap => cap.layoutId === cover.id);
      if (cap) surfaces.push(partitionCapSupport(cap, x, z, PLAYER_RADIUS));
      else for (const piece of coverPieces(cover)) if (inRect(x, z, piece, PLAYER_RADIUS)) surfaces.push((cover.baseY ?? 0) + piece.height);
    }
    return Math.max(...surfaces.filter(height => height <= belowY + 1e-6));
  }

  playerCandidateY(player, x, z, stepOriginY = player.y, stepAllowance = STEP_HEIGHT) {
    if (HAS_SPACE) {
      const support=this.playerSurface(player,x,z,player.y+(player.grounded?STEP_HEIGHT:.02));
      if(!Number.isFinite(support))return null;
      if(player.grounded&&support>stepOriginY+stepAllowance+1e-6)return null;
      return player.grounded&&Math.abs(support-player.y)<=STEP_HEIGHT&&Math.abs(support-stepOriginY)<=stepAllowance+1e-6?support:player.y;
    }
    const currentStair = isStair(player.x, player.z), nextStair = isStair(x, z);
    const height = playerHeight(player);
    const usingStairs = currentStair && player.y >= stairStepY(player.z) - STEP_HEIGHT;
    const ceiling = stairCeiling(x, z, player.y, PLAYER_RADIUS);
    const passesBelow = player.y + height <= ceiling + 1e-6;
    const onSide = z > WORLD.stair.minZ && z < WORLD.stair.maxZ
      && player.z > WORLD.stair.minZ && player.z < WORLD.stair.maxZ;
    // There is no handrail along the flight. Feet already above a tread may
    // leave sideways, while a body below it must still clear the real wood.
    const leavingTreads = inRect(player.x, player.z, STAIR_CONTACT, PLAYER_RADIUS)
      && player.y >= stairStepY(player.z) - STEP_HEIGHT
      && player.y >= stairStepY(z) - STEP_HEIGHT;

    // The high half is a real underpass. Keep the feet on the ground instead
    // of selecting an overhead tread as the next walkable floor.
    const approachesFoot = player.z >= WORLD.stair.maxZ && z >= WORLD.stair.maxZ - (WORLD.stair.maxZ - WORLD.stair.minZ) / WORLD.stair.steps
      && x >= WORLD.stair.minX && x <= WORLD.stair.maxX;
    const entersLanding = !currentStair && (nextStair && !onSide || approachesFoot)
      && Math.abs(stairStepY(z) - player.y) <= STEP_HEIGHT;
    if (!usingStairs && !entersLanding && !passesBelow && !leavingTreads) return null;

    const support = this.playerSurface(player, x, z, player.y + (player.grounded ? STEP_HEIGHT : 0));
    if (nextStair && stairStepY(z) > player.y + (player.grounded ? STEP_HEIGHT : 0.02) && !passesBelow) return null;
    // X and Z are swept separately, but share one step-height allowance.
    // Otherwise a diagonal move can snap down two 21 cm treads in one tick.
    if (player.grounded && support > stepOriginY + stepAllowance + 1e-6) return null;
    const targetY = player.grounded && Math.abs(support - player.y) <= STEP_HEIGHT
      && Math.abs(support - stepOriginY) <= stepAllowance + 1e-6 ? support : player.y;
    // Check the raised feet, not just their old height: otherwise a single
    // 21 cm stair step can insert the head into the slab and trap every exit.
    if (overlapsLoftSlab(x, z, targetY, height) && !leavesLoftPenetration(player, x, z, targetY)) return null;
    return targetY;
  }

  playerPartitionCap(player) {
    return PARTITION_CAPS.find(cap => Math.abs(player.y - partitionCapSupport(cap, player.x, player.z, PLAYER_RADIUS)) < .025 && player.vy <= 0);
  }

  slidePartitionCap(player, delta) {
    const cap = this.playerPartitionCap(player);
    if (cap) player.partitionSlideLeft = .25;
    else player.partitionSlideLeft = Math.max(0, (player.partitionSlideLeft ?? 0) - delta);
    if (!cap && !player.partitionSlideLeft) return;
    if (!Number.isFinite(player.fallStartY)) player.fallStartY = player.y;
    player.grounded = false;
    // The steep narrow cap has no stable foothold, even when sprinting
    // against the slide. Maintain real contact until the feet clear its edge.
    const steps = Math.max(1, Math.ceil(6 * delta / .12));
    for (let step = 0; step < steps; step++) {
      const z = player.z + 6 * delta / steps;
      const surface = cap ? partitionCapSupport(cap, player.x, z, PLAYER_RADIUS) : -Infinity;
      const y = Number.isFinite(surface) ? Math.min(player.y, surface) : player.y;
      if (this.canOccupy(player, player.x, z, y, PLAYER_RADIUS)) Object.assign(player, { y, z });
    }
  }

  updatePlayerVertical(player, delta, stepOriginY = player.y, stepAllowance = STEP_HEIGHT) {
    const support = this.playerSurface(player, player.x, player.z, player.y + STEP_HEIGHT);
    if (player.grounded && Math.abs(support - player.y) <= STEP_HEIGHT
      && Math.abs(support - stepOriginY) <= stepAllowance + 1e-6
      && !overlapsLoftSlab(player.x, player.z, support, playerHeight(player))) {
      player.y = support;
      player.vy = 0;
      player.fallStartY = null;
      return;
    }
    const steppedOff = player.grounded && support < stepOriginY - stepAllowance;
    player.grounded = false;
    const oldY = player.y;
    if (!Number.isFinite(player.fallStartY)) player.fallStartY = steppedOff ? stepOriginY : oldY;
    let nextY = oldY + player.vy * delta - 0.5 * GRAVITY * delta * delta;
    player.vy -= GRAVITY * delta;
    const floor = this.playerSurface(player, player.x, player.z, oldY);
    if (player.vy <= 0 && nextY <= floor) {
      nextY = floor;
      player.vy = 0;
      player.grounded = true;
      if (this.playerPartitionCap(player)) player.grounded = false;
    } else {
      const underside = HAS_SPACE ? spaceCeiling(player.x,player.z,oldY,PLAYER_RADIUS) : WORLD.loftY - LOFT.thickness;
      const height = playerHeight(player);
      if ((HAS_SPACE || hasLoftFloor(player.x, player.z)) && oldY + height <= underside
        && nextY + height >= underside) {
        nextY = underside - height;
        player.vy = 0;
      }
      const beneathTreads = !isStair(player.x, player.z) || oldY < stairStepY(player.z) - STEP_HEIGHT;
      const stairUnderside = !HAS_SPACE && beneathTreads ? stairCeiling(player.x, player.z, oldY, PLAYER_RADIUS) : Infinity;
      if (oldY + height <= stairUnderside + 1e-6 && nextY + height >= stairUnderside) {
        nextY = stairUnderside - height;
        player.vy = 0;
      }
    }
    player.y = nextY;
    if (player.grounded) {
      // Count the height lost from the takeoff surface, not the extra height
      // of a normal jump. Landing consumes the fall even if already downed.
      const damage = fallDamage(player.fallStartY - nextY);
      player.fallStartY = null;
      if (damage && HAZARD_PHASES.includes(this.phase)) this.damagePlayer(player, damage, { source: 'fall' });
    }
  }

  movePlayer(player, delta) {
    if (!player.alive || FROZEN_PHASES.includes(this.phase)) return;
    delta = clamp(delta, 0, 0.1);
    const stepOriginY = player.y, fromX = player.x, fromZ = player.z;
    // Keep equivalent traversal for diagnostic ticks longer than the live
    // server's 1/30 s, while never granting a second allowance for an axis.
    const stepAllowance = STEP_HEIGHT * Math.max(1, delta * TICK_RATE);
    if (!Number.isFinite(player.vy)) player.vy = 0;
    if (typeof player.grounded !== 'boolean') player.grounded = true;
    const support = this.playerSurface(player, player.x, player.z, player.y + STEP_HEIGHT);
    if (player.grounded && Math.abs(support - player.y) > STEP_HEIGHT) player.grounded = false;
    const freshInput = this.time - player.lastInputAt <= 0.6 && !player.downed;
    if (freshInput && player.input.crouch) player.crouched = true;
    else if (player.crouched) {
      // Releasing Ctrl cannot grow the body through a ceiling or a plank.
      const standing = { ...player, crouched: false };
      const underLoft = hasLoftFloor(player.x, player.z) && player.y < WORLD.loftY - .02
        && player.y + PLAYER_HEIGHT > WORLD.loftY - LOFT.thickness;
      const beneathTreads = !isStair(player.x, player.z) || player.y < stairStepY(player.z) - STEP_HEIGHT;
      const underStairs = HAS_SPACE ? player.y + PLAYER_HEIGHT > spaceCeiling(player.x,player.z,player.y,PLAYER_RADIUS) + 1e-6 : beneathTreads && player.y + PLAYER_HEIGHT > stairCeiling(player.x, player.z, player.y, PLAYER_RADIUS) + 1e-6;
      if (!underLoft && !underStairs && this.canOccupy(standing, player.x, player.z, player.y, PLAYER_RADIUS)) player.crouched = false;
    }
    if (freshInput && player.jumpRequested && player.grounded && !this.playerPartitionCap(player) && !(player.partitionSlideLeft > 0)
      && !overlapsLoftSlab(player.x, player.z, player.y, playerHeight(player))) {
      player.fallStartY = player.y;
      player.vy = JUMP_SPEED;
      player.grounded = false;
    }
    player.jumpRequested = false;
    let { forward, strafe } = freshInput ? player.input : { forward: 0, strafe: 0 };
    const magnitude = Math.hypot(forward, strafe);
    if (magnitude > 1) { forward /= magnitude; strafe /= magnitude; }
    const speed = (player.crouched ? 3.5 * PLAYER_POSTURE.crouchSpeed : freshInput && player.input.sprint ? 5.4 : 3.5) * this.playerMovementMultiplier(player);
    const dx = (-Math.sin(player.yaw) * forward + Math.cos(player.yaw) * strafe) * speed * delta;
    const sliding = this.playerPartitionCap(player) || player.partitionSlideLeft > 0;
    const dz = sliding ? 0 : (-Math.cos(player.yaw) * forward - Math.sin(player.yaw) * strafe) * speed * delta;
    const substeps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / 0.14));
    for (let step = 0; step < substeps; step++) {
      for (const [axis, amount] of [['x', dx / substeps], ['z', dz / substeps]]) {
        const bounds = EXTERIOR.bounds;
        const x = clamp(player.x + (axis === 'x' ? amount : 0), bounds.minX, bounds.maxX);
        const z = clamp(player.z + (axis === 'z' ? amount : 0), bounds.minZ, bounds.maxZ);
        const y = this.playerCandidateY(player, x, z, stepOriginY, stepAllowance);
        if (y !== null && this.canOccupy(player, x, z, y, PLAYER_RADIUS) && !this.zombieBlocksPlayer(player, x, z, y)) Object.assign(player, { x, y, z });
      }
    }
    this.slidePartitionCap(player, delta);
    this.updatePlayerVertical(player, delta, stepOriginY, stepAllowance);
    this.updatePlayerMotion(player, fromX, fromZ, delta);
  }

  // Raider aim leads against a smoothed horizontal velocity (tau 0.4 s), so
  // quick left-right taps average low; speed is capped at a sprint.
  updatePlayerMotion(player, fromX, fromZ, delta) {
    if (!(delta > 0)) return;
    const limit = 5.4 * this.playerMovementMultiplier(player);
    let vx = (player.x - fromX) / delta, vz = (player.z - fromZ) / delta;
    const speed = Math.hypot(vx, vz);
    if (speed > limit) { vx *= limit / speed; vz *= limit / speed; }
    const blend = 1 - Math.exp(-delta / PLAYER_MOTION_SMOOTHING);
    player.motionX = (player.motionX ?? 0) + (vx - (player.motionX ?? 0)) * blend;
    player.motionZ = (player.motionZ ?? 0) + (vz - (player.motionZ ?? 0)) * blend;
  }

  pushZombie(zombie, damageX, damageZ, multiplier = 1) {
    const magnitude = Math.hypot(damageX, damageZ);
    if (!Number.isFinite(magnitude) || magnitude < 1e-6 || zombie.hp <= 0 || !HAZARD_PHASES.includes(this.phase)) return;
    const resistance = zombie.boss ? .20 : zombie.kind === 'brute' ? .35 : zombie.kind === 'raider' ? .6 : 1;
    const speed = Math.min(PUSH_DISTANCE, magnitude * PUSH_PER_DAMAGE) * multiplier * resistance / PUSH_DECAY;
    let x = (zombie.pushX ?? 0) + damageX / magnitude * speed;
    let z = (zombie.pushZ ?? 0) + damageZ / magnitude * speed;
    const limit = PUSH_DISTANCE * multiplier * resistance / PUSH_DECAY, combined = Math.hypot(x, z);
    if (combined > limit) { x *= limit / combined; z *= limit / combined; }
    zombie.pushX = x; zombie.pushZ = z; zombie.pushLeft = PUSH_DURATION;
  }

  updateZombiePush(zombie, delta) {
    if (!HAZARD_PHASES.includes(this.phase) || zombie.hp <= 0 || !(zombie.pushLeft > 0)) {
      zombie.pushX = 0; zombie.pushZ = 0; zombie.pushLeft = 0; return;
    }
    const elapsed = Math.min(Math.max(Number.isFinite(delta) ? delta : 0, 0), zombie.pushLeft);
    if (!elapsed) return;
    const decay = Math.exp(-elapsed / PUSH_DECAY);
    const dx = (zombie.pushX ?? 0) * PUSH_DECAY * (1 - decay);
    const dz = (zombie.pushZ ?? 0) * PUSH_DECAY * (1 - decay);
    zombie.pushX *= decay; zombie.pushZ *= decay; zombie.pushLeft -= elapsed;
    // A real push moves under 0.7 m a tick (11 steps): a bound, whatever the state says.
    const steps = Math.min(16, Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / .06)));
    let moved = false;
    const blocked = new Set(), radius = .29 * (zombie.scale ?? 1);
    for (let step = 0; step < steps; step++) {
      for (const [axis, amount] of [['x', dx / steps], ['z', dz / steps]]) {
        if (Math.abs(amount) < 1e-9 || blocked.has(axis)) continue;
        const x = zombie.x + (axis === 'x' ? amount : 0), z = zombie.z + (axis === 'z' ? amount : 0);
        const y = this.candidateY(zombie, x, z);
        if (y !== null && this.canOccupy(zombie, x, z, y, radius) && !this.crowdBlocker(zombie, x, z, y)) {
          Object.assign(zombie, { x, y, z }); moved = true;
        } else { zombie[axis === 'x' ? 'pushX' : 'pushZ'] = 0; blocked.add(axis); }
      }
    }
    if (moved) {
      zombie.navigation = null; zombie.portalRoute = null;
      if (!isStair(zombie.x, zombie.z)) zombie.stairState = null;
    }
    if (zombie.pushLeft <= 1e-8 || Math.hypot(zombie.pushX, zombie.pushZ) < .01) {
      zombie.pushX = 0; zombie.pushZ = 0; zombie.pushLeft = 0;
    }
  }

  // A step may never move deeper into another zombie or a standing survivor,
  // although bodies that already overlap are always free to separate.
  crowdBlocker(zombie, x, z, y) {
    const radius = bodyRadius(zombie);
    const blocks = (other, minimum) => {
      if (Math.abs((other.y ?? 0) - y) > CROWD_HEIGHT) return false;
      const next = Math.hypot(x - other.x, z - other.z);
      return next < minimum && next < Math.hypot(zombie.x - other.x, zombie.z - other.z) - 1e-6;
    };
    for (const other of this.zombies.values()) {
      if (other !== zombie && other.hp > 0 && blocks(other, radius + bodyRadius(other))) return other;
    }
    for (const player of this.players.values()) {
      if (player.alive && !player.downed && blocks(player, radius + PLAYER_RADIUS)) return player;
    }
    return null;
  }

  // Survivors cannot walk through a zombie either; one that already overlaps
  // a body (late arrival, shove) may still step away from it.
  zombieBlocksPlayer(player, x, z, y) {
    for (const zombie of this.zombies.values()) {
      if (!(zombie.hp > 0)) continue;
      const bottom = zombie.y ?? 0, top = bottom + enemyProfile(zombie).height * (zombie.scale ?? 1);
      if (y >= top || y + playerHeight(player) <= bottom) continue;
      const next = Math.hypot(x - zombie.x, z - zombie.z);
      if (next < PLAYER_RADIUS + bodyRadius(zombie) && next < Math.hypot(player.x - zombie.x, player.z - zombie.z) - 1e-6) return true;
    }
    return false;
  }

  zombieCrowded(zombie) {
    return this.time - (zombie.crowdedAt ?? -Infinity) < .3;
  }

  stepZombie(zombie, directionX, directionZ, amount, respectCover = true) {
    const attempt = (angle, scale) => {
      const cosine = Math.cos(angle), sine = Math.sin(angle);
      const x = zombie.x + (directionX * cosine - directionZ * sine) * amount * scale;
      const z = zombie.z + (directionX * sine + directionZ * cosine) * amount * scale;
      const y = this.candidateY(zombie, x, z);
      if (y === null || !this.canOccupy(zombie, x, z, y, bodyRadius(zombie), respectCover)) return { result: 'wall' };
      const blocker = this.crowdBlocker(zombie, x, z, y);
      if (blocker) return { result: 'crowd', blocker };
      Object.assign(zombie, { x, y, z });
      return { result: 'moved' };
    };
    const direct = attempt(0, 1);
    if (direct.result !== 'crowd') {
      if (direct.result === 'moved') zombie.crowdedSince = null;
      return direct.result;
    }
    zombie.crowdedAt = this.time;
    zombie.crowdedSince ??= this.time;
    // Spill around the body in the way, away from its side, and keep that side
    // while it works so a jam spreads outwards instead of forming a still queue.
    const { blocker } = direct;
    const cross = directionX * (blocker.z - zombie.z) - directionZ * (blocker.x - zombie.x);
    const parity = Number(String(zombie.id).replace(/\D/g, '')) % 2 ? 1 : -1;
    const side = this.time - (zombie.sideStepAt ?? -Infinity) < .8 ? zombie.sideStep
      : Math.abs(cross) > .02 ? -Math.sign(cross) : zombie.sideStep ?? parity;
    for (const sign of [side, -side]) {
      for (const angle of SIDESTEP_ANGLES) {
        if (attempt(sign * angle, angle > 1.2 ? .6 : .85).result !== 'moved') continue;
        zombie.sideStep = sign; zombie.sideStepAt = this.time;
        return 'moved';
      }
    }
    return 'crowd';
  }

  moveZombieTowards(zombie, target, delta, respectCover = true) {
    if(HAS_SPACE && !target.flightId && Number.isFinite(target.y) && (Math.abs(target.y-zombie.y)>.3 || spaceFlightAt(zombie.x,zombie.z,zombie.y)))target=spaceWaypoint(zombie,target);
    if(HAS_SPACE) {
      const flight=SPACE.flights.find(f=>target.flightId===f.id||distance(target,f.upper)<1e-6);
      if(flight && zombie.y>=-.3 && zombie.z>=flight.maxZ && distance(zombie,flight.upper)<=3) {
        const clearance=bodyRadius(zombie)+.03;
        if(zombie.x<flight.minX+clearance || zombie.x>flight.maxX-clearance) {
          const alongside=zombie.z<flight.maxZ+.5+clearance && (zombie.x<flight.minX || zombie.x>flight.maxX);
          const steer=alongside?{x:zombie.x<flight.minX?flight.minX-.32-clearance:flight.maxX+.32+clearance,y:flight.topY,z:flight.upper.z}:{...flight.upper};
          // The funfair arcade wall can block this straight run; keep the graph then.
          if(!IS_FUNFAIR||segmentClear(zombie,steer,zombie.y,.32,outsideCabin(zombie.x,zombie.z)&&outsideCabin(steer.x,steer.z),enemyProfile(zombie).height*(zombie.scale??1),bodyRadius(zombie))) {
            target=steer;respectCover=false;zombie.navigation=null;
          }
        }
      }
    }
    if (HAS_SPACE && target.flightId) respectCover=false;
    if (distance(zombie, target) < 0.08) return true;
    let waypoint = target;
    // Off a flight, or past a holdLanding flight's head rails bound for the upper floor, the visibility graph steers.
    if (respectCover && (HAS_SPACE ? !spaceFlightHolding(zombie,target) : (!isStair(zombie.x, zombie.z) || zombie.y < stairY(zombie.z) - .3))) {
      const navigation = zombie.navigation;
      if (!navigation || distance(navigation.target, target) > 0.8 || !navigation.path.length || HAS_SPACE && Math.abs((navigation.level??zombie.y)-zombie.y)>.2) {
        const exterior=outsideCabin(zombie.x,zombie.z)&&outsideCabin(target.x,target.z);
        const path = routeAroundObstacles(zombie, target, zombie.y,exterior,enemyProfile(zombie).height*(zombie.scale??1),bodyRadius(zombie));
        zombie.navigation = { ...(HAS_SPACE ? {level:zombie.y} : {}), target: { x: target.x, z: target.z }, path, direct: path.length === 1 && distance(path[0], target) < 1e-9 };
      }
      const path = zombie.navigation.path;
      // A straight route follows small target moves instead of a stale point.
      if (zombie.navigation.direct && path.length === 1) path[0] = { x: target.x, z: target.z };
      // Another body standing on a corner must not hide the rest of the route.
      const reach = this.zombieCrowded(zombie) ? .45 : .1;
      while (path.length > 1 && distance(zombie, path[0]) < reach
        && segmentClear(zombie,path[1],zombie.y,.32,outsideCabin(zombie.x,zombie.z)&&outsideCabin(target.x,target.z),enemyProfile(zombie).height*(zombie.scale??1),bodyRadius(zombie))) path.shift();
      if (!path.length) return false;
      waypoint = path[0];
    } else zombie.navigation = null;
    const dx = waypoint.x - zombie.x, dz = waypoint.z - zombie.z, length = Math.hypot(dx, dz);
    if (length < 0.001) { zombie.navigation = null; return false; }
    zombie.yaw = Math.atan2(-dx, -dz);
    // Frost and a sheet's smell combine: (1 − strongest slow) × (1 + strongest haste).
    if (this.stepZombie(zombie, dx / length, dz / length, Math.min(zombie.speed * (1 - (zombie.frostSlow ?? 0)) * (1 + (zombie.scentHaste ?? 0)) * delta, length), respectCover) === 'wall') zombie.navigation = null;
    return distance(zombie, target) < 0.08;
  }

  separateZombies(delta) {
    const bodies = [...this.zombies.values()].filter(zombie => zombie.hp > 0);
    const shift = (zombie, x, z) => {
      const y = this.candidateY(zombie, x, z);
      if (y !== null && this.canOccupy(zombie, x, z, y, bodyRadius(zombie)) && !this.crowdBlocker(zombie, x, z, y)) Object.assign(zombie, { x, y, z });
    };
    for (let first = 0; first < bodies.length; first++) {
      for (let second = first + 1; second < bodies.length; second++) {
        const a = bodies[first], b = bodies[second];
        if (Math.abs((a.y ?? 0) - (b.y ?? 0)) > CROWD_HEIGHT) continue;
        const minimum = bodyRadius(a) + bodyRadius(b);
        let dx = a.x - b.x, dz = a.z - b.z;
        const gap = Math.hypot(dx, dz);
        if (gap >= minimum) continue;
        // Bodies on the exact same spot still part deterministically.
        if (gap < 1e-6) { const angle = first * 2.4 + second; dx = Math.cos(angle); dz = Math.sin(angle); }
        else { dx /= gap; dz /= gap; }
        const amount = Math.min((minimum - gap) / 2, SEPARATION_SPEED * delta);
        shift(a, a.x + dx * amount, a.z + dz * amount);
        shift(b, b.x - dx * amount, b.z - dz * amount);
      }
    }
  }

  barricadeFront(zombie, door, sign) {
    const normal = ((zombie.x - door.x) * door.outX + (zombie.z - door.z) * door.outZ) * sign;
    const tangent = Math.abs((zombie.x - door.x) * door.outZ - (zombie.z - door.z) * door.outX);
    return normal >= .4 && normal <= .85 && tangent <= 1.25;
  }

  doorChoices(zombie, target, height, fromOutside) {
    const sign = fromOutside ? 1 : -1;
    // The hospital measures an exterior arrival's walk round the 40 x 30 m
    // building (the outdoor visibility graph), not the straight line.
    const walked = IS_HOSPITAL && fromOutside;
    const choices = this.doors.filter(door => !door.sealed && !door.sealPending).map(door => {
      const threshold = { x: door.x + door.outX * sign * .75, z: door.z + door.outZ * sign * .75 };
      let crowd = 0;
      for (const other of this.zombies.values()) {
        if (other !== zombie && other.hp > 0 && (other.y ?? 0) < .3 && distance(other, threshold) < DOOR_CROWD_RADIUS) crowd++;
      }
      const open = this.doorPassable(door, 0, height);
      if (walked) {
        const metres = this.exteriorWalk(zombie, threshold, height);
        return { door, open, metres, cost: metres + crowd * DOOR_CROWD_PENALTY };
      }
      // An exterior arrival chooses an entrance, independent of a survivor
      // far across the clearing. Interior exits may still follow that target.
      return { door, open, cost: distance(zombie, door) + (fromOutside ? 0 : distance(target, door)) + crowd * DOOR_CROWD_PENALTY };
    });
    if (!walked) return choices.sort((a, b) => Number(b.open) - Number(a.open) || a.cost - b.cost);
    // The nearest door by the walk; an open door first only within the detour.
    choices.sort((a, b) => a.cost - b.cost);
    const nearest = Math.min(...choices.map(choice => choice.metres));
    const open = choices.find(choice => choice.open && choice.metres <= nearest + HOSPITAL_DOOR_DETOUR);
    return open ? [open, ...choices.filter(choice => choice !== open)] : choices;
  }

  // Metres walked outside from a body to a point, round the building and the
  // parking props; an unreachable point counts as a very long walk.
  exteriorWalk(zombie, point, height) {
    const path = routeAroundObstacles(zombie, point, zombie.y ?? 0, true, height, bodyRadius(zombie));
    if (!path.length) return distance(zombie, point) * 3;
    let metres = 0, last = zombie;
    for (const step of path) { metres += distance(last, step); last = step; }
    return metres;
  }

  moveZombieThroughDoor(zombie,target,delta) {
    const routedDoor = this.doors.find(door => door.id === zombie.portalRoute?.doorId);
    if (routedDoor?.sealed || routedDoor?.sealPending) { zombie.portalRoute = null; zombie.navigation = null; }
    const fromOutside=outsideCabin(zombie.x,zombie.z),toOutside=outsideCabin(target.x,target.z);
    const through = (door, sign) => {
      const tangentX=Math.abs(door.outZ),tangentZ=Math.abs(door.outX);
      const lateral=(zombie.x-door.x)*tangentX+(zombie.z-door.z)*tangentZ;
      const clearance=1.3-bodyRadius(zombie)-.04;
      const aligning=Math.abs(lateral)>clearance;
      // Put the alignment goal beyond moveZombieTowards' 8 cm arrival radius.
      const lane=clamp(lateral,-clearance+(aligning?.1:0),clearance-(aligning?.1:0));
      // A crowd sidestep can leave a legal body beside the jamb. Align along
      // the wall before moving through it, instead of retrying a blocked diagonal.
      const normal=((zombie.x-door.x)*door.outX+(zombie.z-door.z)*door.outZ)*sign;
      const along=aligning?normal:-.9;
      this.moveZombieTowards(zombie,{x:door.x+door.outX*sign*along+tangentX*lane,z:door.z+door.outZ*sign*along+tangentZ*lane},delta,false);
    };
    if(zombie.portalRoute?.stage==='cross') {
      const route=zombie.portalRoute,door=this.doors.find(item=>item.id===route.doorId),sign=route.fromOutside?1:-1;
      const destination={x:door.x-door.outX*sign*.9,z:door.z-door.outZ*sign*.9};
      // Bodies already standing on the destination cannot keep a crossing open forever.
      const crossed=-((zombie.x-door.x)*door.outX+(zombie.z-door.z)*door.outZ)*sign>=.6;
      if(distance(zombie,destination)>.1 && !crossed){
        if(!this.doorPassable(door,0,enemyProfile(zombie).height*(zombie.scale??1)) && this.time>=zombie.attackAfter) {
          this.damageDoor(door,zombie.barricadeDamage??(zombie.kind==='brute'?36:zombie.kind==='runner'?16:enemyProfile(zombie).barricadeDamage),{zombieId:zombie.id,bash:zombie.kind==='raider'});
          zombie.attackAfter=this.time+(zombie.kind==='brute'?(zombie.attackInterval??1.2):.85);
        }
        through(door,sign);return true;
      }
      zombie.portalRoute=null;zombie.navigation=null;
    }
    const height=enemyProfile(zombie).height*(zombie.scale??1);
    // After a push across the wall plane, finish the valid opening directly;
    // the exterior navigation graph intentionally treats the cabin as solid.
    const passage=this.doors.find(door=>!door.sealed && !door.sealPending && Math.abs((zombie.x-door.x)*door.outX+(zombie.z-door.z)*door.outZ)<.76
      && Math.abs((zombie.x-door.x)*door.outZ-(zombie.z-door.z)*door.outX)+.29*(zombie.scale??1)<1.3
      && this.doorPassable(door,zombie.y,height));
    if(passage && (fromOutside!==toOutside || Math.abs((zombie.x-passage.x)*passage.outX+(zombie.z-passage.z)*passage.outZ)<.46)) {
      const sign=toOutside?-1:1;
      zombie.portalRoute={doorId:passage.id,fromOutside:!toOutside,toOutside,stage:'cross'};
      zombie.navigation=null;zombie.entered=true;
      through(passage,sign);
      return true;
    }
    if(fromOutside===toOutside){zombie.portalRoute=null;return false;}
    let route=zombie.portalRoute;
    if(route && !this.doorPassable(this.doors.find(door=>door.id===route.doorId),0,height)
      && this.doors.some(door=>this.doorPassable(door,0,height))) {
      // Bound for boards while a door is open. The hospital keeps the boards
      // unless an open door is now within the detour, asked on the body's own
      // beat once a second (doorReviewBeat). A first look, or a beat that
      // passed while the body was not here, waits for its next beat.
      if(!IS_HOSPITAL || !fromOutside || route.fromOutside!==fromOutside || route.toOutside!==toOutside)route=null;
      else if(zombie.doorReviewAt==null || this.time-zombie.doorReviewAt>=Math.max(delta,1e-6))zombie.doorReviewAt=doorReviewBeat(zombie,this.time);
      else if(this.time>=zombie.doorReviewAt) {
        zombie.doorReviewAt=doorReviewBeat(zombie,this.time);
        const best=this.doorChoices(zombie,target,height,fromOutside)[0];
        if(best.open && best.door.id!==route.doorId)route=null;
      }
    }
    if(!route || route.fromOutside!==fromOutside || route.toOutside!==toOutside) {
      const candidates=this.doorChoices(zombie,target,height,fromOutside);
      route=zombie.portalRoute={doorId:candidates[0].door.id,fromOutside,toOutside,stage:'approach'};
      zombie.navigation=null;
    }
    let door=this.doors.find(item=>item.id===route.doorId);
    const sign=fromOutside?1:-1;
    // Head for the stretch of barricade in front of this body rather than its
    // centre, so the crowd fans out along the boards instead of lining up.
    const slot=item=>{
      const tangentX=Math.abs(item.outZ),tangentZ=Math.abs(item.outX);
      // Fan out across intact boards, but choose a body-sized lane before
      // reaching an open jamb. Lateral realignment at the threshold can be
      // impossible when a full crowd has already packed both sides.
      const clearance=this.doorPassable(item,0,height)?Math.max(.1,1.3-bodyRadius(zombie)-.12):1.1;
      const lateral=clamp((zombie.x-item.x)*tangentX+(zombie.z-item.z)*tangentZ,-clearance,clearance);
      return {x:item.x+item.outX*sign*.75+tangentX*lateral,z:item.z+item.outZ*sign*.75+tangentZ*lateral};
    };
    const arrived=item=>distance(zombie,slot(item))<=.1 || this.barricadeFront(zombie,item,sign);
    if(route.stage==='approach' && !arrived(door) && zombie.crowdedSince!=null
      && this.time-zombie.crowdedSince>=DOOR_SWITCH_AFTER && this.time>=(zombie.routeCheckAt??0)) {
      // Stuck behind a jam: go round the cabin when another entrance is clearly better.
      zombie.routeCheckAt=this.time+1;
      const candidates=this.doorChoices(zombie,target,height,fromOutside);
      const current=candidates.find(candidate=>candidate.door===door);
      if(candidates[0].door!==door && candidates[0].open===current.open && candidates[0].cost<current.cost-DOOR_SWITCH_MARGIN) {
        door=candidates[0].door; route.doorId=door.id;
        zombie.navigation=null; zombie.crowdedSince=null;
      }
    }
    if(route.stage==='approach') {
      // Several bodies attack side by side across the whole barricade.
      if(!arrived(door)){this.moveZombieTowards(zombie,slot(door),delta);return true;}
      zombie.crowdedSince=null;
      // If everyone is far outside, hold the interior threshold rather than
      // immediately leaving and being ordered back inside on the next tick.
      if(!fromOutside && toOutside && distance(zombie,target)>5)return true;
      if(!this.doorPassable(door,0,height)) {
        zombie.yaw=Math.atan2(door.outX*sign,door.outZ*sign);
        if(this.time>=zombie.attackAfter) {
          this.damageDoor(door,zombie.barricadeDamage??(zombie.kind==='brute'?36:zombie.kind==='runner'?16:enemyProfile(zombie).barricadeDamage),{zombieId:zombie.id,bash:zombie.kind==='raider'});
          zombie.attackAfter=this.time+(zombie.kind==='brute'?(zombie.attackInterval??1.2):.85);
        }
        return true;
      }
      route.stage='cross'; zombie.navigation=null; zombie.entered=true;
    }
    through(door,sign);
    return true;
  }

  updateFrostAuras() {
    const standing = [...this.players.values()].filter(player => player.alive && !player.downed && !player.waiting)
      .map(player => ({ player, stats: characterStats(player) }));
    const carriers = standing.filter(({ stats }) => stats.auraRadius > 0 && stats.auraSlow > 0);
    // A sheet's Chimie debt is the mirror aura («odeur de produits»): the
    // strongest nearby smell hastens zombies, same reach rules, half on bosses.
    const smells = standing.filter(({ stats }) => stats.hasteRadius > 0 && stats.haste > 0);
    const reaches = (zombie, player, radius) => Math.abs((zombie.y ?? 0) - player.y) <= 1.2 && distance(zombie, player) <= radius + 1e-8
      && this.grenadeBlastVisible({ x: player.x, y: player.y + playerHeight(player) * .5, z: player.z },
        { x: zombie.x, y: (zombie.y ?? 0) + enemyProfile(zombie).height * (zombie.scale ?? 1) * .5, z: zombie.z });
    for (const zombie of this.zombies.values()) {
      let slow = 0, haste = 0;
      if (zombie.hp > 0 && zombie.kind !== 'raider' && HAZARD_PHASES.includes(this.phase)) {
        for (const { player, stats } of carriers) if (reaches(zombie, player, stats.auraRadius)) slow = Math.max(slow, stats.auraSlow * (zombie.boss ? .5 : 1));
        for (const { player, stats } of smells) if (reaches(zombie, player, stats.hasteRadius)) haste = Math.max(haste, stats.haste * (zombie.boss ? .5 : 1));
      }
      zombie.frostSlow = slow;
      if (haste || zombie.scentHaste) zombie.scentHaste = haste;
    }
  }

  completeWeaponReloads(player) {
    this.normalizeDualWield(player);
    if (!activeWeaponId(player)) player.reloadUntil = 0;
    for (const hand of ['primary', 'secondary']) {
      const state = this.weaponHandState(player, hand);
      if (!state?.reloadUntil || state.reloadUntil > this.time) continue;
      const weapon = this.weaponProfile(player, state.weaponId), inventory = weaponStock(player, state.weaponId);
      if (weapon && inventory) {
        const count = Math.min(Math.max(0, weapon.magazine - inventory.ammo), inventory.reserve);
        inventory.ammo += count; inventory.reserve -= count;
      }
      if (hand === 'primary') player.reloadUntil = 0;
      else player.weaponStates[state.weaponId].reloadUntil = 0;
    }
  }

  handSnapshot(player, hand) {
    const state = this.weaponHandState(player, hand);
    if (!state) return null;
    const stock = weaponStock(player, state.weaponId), profile = this.weaponProfile(player, state.weaponId);
    const round = value => Math.round(value * 1000) / 1000;
    return { weapon: state.weapon, weaponId: state.weaponId, ammo: stock?.ammo ?? 0, reserve: stock?.reserve ?? 0,
      magazine: profile?.magazine ?? 0, reserveCapacity: profile?.reserve ?? 0,
      reloading: state.reloadUntil > this.time, reloadLeft: round(Math.max(0, state.reloadUntil - this.time)),
      reloadDuration: state.reloadDuration, fireReadyLeft: round(Math.max(0, state.shotAfter - this.time, (state.switchUntil ?? 0) - this.time)),
      minigunSpinning: state.minigunSpinning, minigunReady: state.minigunSpinning && this.time + 1e-8 >= state.minigunSpinUntil,
      minigunSpinLeft: state.minigunSpinning ? round(Math.max(0, state.minigunSpinUntil - this.time)) : 0 };
  }

  updateZombie(zombie, delta, living) {
    const exterior=outsideCabin(zombie.x,zombie.z);
    const closeOutside=living.filter(player=>outsideCabin(player.x,player.z)&&distance(zombie,player)<=5);
    const inside=living.filter(player=>!outsideCabin(player.x,player.z));
    const candidates=exterior&&closeOutside.length?closeOutside:inside.length?inside:living;
    const target = candidates.reduce((nearest, player) => {
      const score = distance(zombie, player) + Math.abs(zombie.y - player.y) * 3;
      return !nearest || score < nearest.score ? { player, score } : nearest;
    }, null)?.player;
    if (!target) {
      if(exterior || zombie.portalRoute?.stage==='cross')this.moveZombieThroughDoor(zombie,{x:0,z:0,y:0},delta);
      return;
    }
    const separation=distance(zombie,target);
    // A missing windowpane admits bullets, but never a body or a zombie arm
    // through its deep sill. Door attacks still require a breached opening.
    const reach = meleeReach(zombie);
    const crossesClosedFacade = separation < reach && this.doors.some(door => {
      const axis = door.outZ ? 'z' : 'x', tangent = door.outZ ? 'x' : 'z';
      const from = zombie[axis] - door[axis], to = target[axis] - door[axis];
      if (from * to >= 0) return false;
      const crossing = zombie[tangent] + (target[tangent] - zombie[tangent]) * from / (from - to);
      if (Math.abs(crossing) > (door.outZ ? LEVEL.halfWidth : LEVEL.halfDepth)) return false;
      return Math.abs(crossing) > 1.28 || !this.doorPassable(door, Math.min(zombie.y, target.y), Math.min(enemyProfile(zombie).height, playerHeight(target)));
    });
    const meleeClear = separation < reach && !crossesClosedFacade && this.grenadeBlastVisible(
      { x: zombie.x, y: zombie.y + enemyProfile(zombie).height * (zombie.scale ?? 1) * .72, z: zombie.z },
      { x: target.x, y: target.y + playerHeight(target) * .68, z: target.z });
    if (meleeClear && Math.abs(zombie.y - target.y) < Math.min(1.25, enemyProfile(zombie).height)) {
      if (this.time >= zombie.attackAfter) {
        this.damagePlayer(target, zombie.damage ?? (zombie.kind === 'brute' ? 32 : zombie.kind === 'runner' ? 14 : enemyProfile(zombie).damage), zombie);
        zombie.attackAfter = this.time + (zombie.attackInterval ?? (zombie.kind === 'brute' ? 1.2 : enemyProfile(zombie).attackInterval));
      }
      return;
    }
    if(exterior && !closeOutside.length) {
      // Enter by the best available door unless a survivor is actually nearby
      // in the clearing. A distant player cannot pull the crowd past an entrance.
      // Melee above still reaches a survivor physically blocking an open door.
      this.moveZombieThroughDoor(zombie,{x:0,z:0,y:0},delta);
      return;
    }
    if(HAS_SPACE) {
      if(Math.abs(zombie.y)<.3 && this.moveZombieThroughDoor(zombie,{...target,y:0},delta))return;
      const point=spaceWaypoint(zombie,target);
      this.moveZombieTowards(zombie,point,delta,!point.flightId);
      return;
    }
    const onStair = isStair(zombie.x, zombie.z) && zombie.y >= stairY(zombie.z) - .3;
    const targetOnStair = isStair(target.x, target.z) && target.y >= stairY(target.z) - .3;
    if (onStair && !zombie.stairState) zombie.stairState = target.y >= zombie.y ? 'ascending' : 'descending';
    const stairX=(WORLD.stair.minX+WORLD.stair.maxX)/2;
    const lowerLanding={x:stairX,z:WORLD.stair.maxZ+.5},upperLanding={x:stairX,z:WORLD.stair.minZ-.5};
    // A landing occupied by another body still counts once the steps are behind.
    const landed = destination => this.zombieCrowded(zombie) && !isStair(zombie.x, zombie.z) && distance(zombie, destination) < .6;
    if (zombie.stairState === 'ascending') {
      const destination = targetOnStair ? { x: stairX, z: target.z } : upperLanding;
      if (this.moveZombieTowards(zombie, destination, delta, false) || landed(destination)) zombie.stairState = null;
      return;
    }
    if (zombie.stairState === 'descending') {
      const destination = targetOnStair ? { x: stairX, z: target.z } : lowerLanding;
      if (this.moveZombieTowards(zombie, destination, delta, false) || landed(destination)) zombie.stairState = null;
      return;
    }
    if(zombie.y<.3 && this.moveZombieThroughDoor(zombie,target,delta))return;
    if ((target.y >= WORLD.loftY - .3 || targetOnStair) && zombie.y < .3) {
      if (distance(zombie, lowerLanding) < 0.35) zombie.stairState = 'ascending';
      else this.moveZombieTowards(zombie, lowerLanding, delta);
      return;
    }
    if (target.y < WORLD.loftY - 0.3 && zombie.y > WORLD.loftY - 0.3) {
      if (distance(zombie, upperLanding) < 0.35) zombie.stairState = 'descending';
      else this.moveZombieTowards(zombie, upperLanding, delta);
      return;
    }
    this.moveZombieTowards(zombie, target, delta);
  }

  tick(delta = 1 / TICK_RATE) {
    // Every gameplay deadline is expressed in this clock. Freeze before
    // advancing it, rather than compensating dozens of separate timers.
    if (this.paused) return;
    delta = clamp(delta, 0, 0.1);
    this.time += delta;
    // Burn numbers due during an ending still reach their owner.
    this.flushBurnNumbers();
    this.updateGrenadiers();
    if (!HAZARD_PHASES.includes(this.phase)) {
      this.bullets.clear();
      for (const zombie of this.zombies.values()) this.updateZombiePush(zombie, 0);
    }
    if(FROZEN_PHASES.includes(this.phase))for(const player of this.players.values())player.outsideDamageAccumulator=0;
    if (this.phase === 'extraction') {
      this.timeLeft = Math.max(0, this.timeLeft - delta);
      if (this.timeLeft <= 1e-8) {
        this.phase = 'victory';
        this.payReviveCredits('victory');
        this.releaseSeats();
        this.timeLeft = 0;
        this.event('victory', { wave: this.wave });
      }
      return;
    }
    if (FROZEN_PHASES.includes(this.phase)) return;
    this.admitReadyPlayers();
    this.updateExpedition(delta);
    this.updateRevives(delta);
    for (const player of this.players.values()) {
      if (player.waiting) continue;
      this.movePlayer(player, delta);
      this.updateOutsideDamage(player, delta);
      this.completeWeaponReloads(player);
      if (player.downed && player.alive && this.time >= player.bleedOutAt) {
        // A kit still in the bag lifts its owner instead of letting them go.
        if (!(player.reviveKit && this.useReviveKit(player.id, true))) {
          this.dropUniqueMagnum(player);
          // Elimination releases the bonus at its current level for the team.
          this.dropBonus(player);
          player.alive = false;
          this.closeReviveCredit(player.id);
          this.event('eliminated', { id: player.id });
        }
      }
    }
    this.updateDoorSeals();
    if (HAZARD_PHASES.includes(this.phase)) {
      this.updateMelee();
      this.updateBullets(delta);
      this.updateBurns(delta);
      this.updateGrenades(delta);
      this.holdKillChains(delta);
      this.attractCoins(delta);
      this.collectPickups();
    }
    if (this.phase === 'countdown' || this.phase === 'intermission') {
      this.callNextWaveWhenReady(); // also after a survivor leaves
      this.timeLeft = Math.max(0, this.timeLeft - delta);
      if (this.timeLeft <= 0) this.beginWave();
    }
    if (this.phase !== 'wave' || this.practice) this.updateFrostAuras();
    for (const zombie of this.zombies.values()) this.updateZombiePush(zombie, delta);
    if (this.practice) { this.updatePracticeRaiders(delta, this.livingPlayers()); return; }
    if (this.phase !== 'wave') return;
    const balance = this.currentWaveBalance();
    this.spawnTimer -= delta;
    this.updateSpawnWarnings();
    if (this.toSpawn > 0 && this.spawnTimer <= 0 && this.zombies.size + this.spawnWarnings.size < balance.maxActive) {
      this.reserveZombieSpawn();
      this.toSpawn--;
      this.spawnTimer = balance.spawnInterval;
    }
    const living = this.livingPlayers();
    // A downed survivor with a revive kit is still in the fight.
    if (!this.fightingPlayers().length) { this.endGame(); return; }
    this.updateRaid(delta, living);
    this.updateFrostAuras();
    // Zombies ignore raiders; raiders run their own state machine.
    for (const zombie of this.zombies.values()) {
      if (zombie.kind === 'raider') this.updateRaider(zombie, delta, living);
      else this.updateZombie(zombie, delta, living);
    }
    this.separateZombies(delta);
    if (!this.fightingPlayers().length) this.endGame();
    else if (!this.toSpawn && !this.spawnWarnings.size && !this.zombies.size && this.raidSettled()) this.finishWave();
  }

  snapshot() {
    const round = number => Math.round(number * 1000) / 1000;
    return {
      type: 'state', ballisticsEnabled: this.ballisticsEnabled,
      ...(HAS_SPACE ? { mapId: LEVEL.id } : {}),
      room: this.code, hostId: this.hostId, phase: this.phase, practice: this.practice, difficulty: this.difficulty, friendlyFire: this.friendlyFireOn() ? this.friendlyFire : 'off', ambiance: this.ambiance,
      paused: this.paused, pauseById: this.pauseById, ...this.seatSnapshot(),
      practiceTargets: this.practice ? this.zombieCount() : 0,
      maxWaves: MAX_WAVES, extractionDuration: EXTRACTION_DURATION, outsideDamagePerSecond: milli(EXTERIOR.damagePerSecond * difficultyOf(this.difficulty).damageTaken),
      maxWeaponSlots: MAX_WEAPON_SLOTS, pickupReach: PICKUPS.reach,
      magnumAvailable: this.magnumAvailable(),
      companionsAvailable: this.companionsAvailable === true, // a companion brain is connected (LAN server)
      companionSelections: [...(this.companionSelections ?? [])],
      supplyCrate: this.supplyCrate ? { ...this.supplyCrate, claimed: [...this.supplyCrate.claimed] } : null,
      minigunSpinDuration: MINIGUN_WINDUP,
      wavePlayerCount: this.wavePlayerCount,
      headshotMultiplier: this.currentWaveBalance().headshotMultiplier,
      // Raiders already count in zombies.size; only announced or unreleased ones are added.
      wave: this.wave, remaining: this.toSpawn + this.spawnWarnings.size + this.zombies.size + this.raidPending(), toSpawn: this.toSpawn,
      zombiesRemaining: this.toSpawn + this.spawnWarnings.size + this.zombieCount(),
      raid: this.raidSnapshot(), nextRaidWave: this.nextRaidWave(),
      time: round(this.time), timeLeft: round(this.timeLeft),
      expedition: {
        enabled: !this.practice,
        generator: { x: GENERATOR.x, y: GENERATOR.y, z: GENERATOR.z, reach: GENERATOR.reach,
          power: round(generatorPower(this.generator.elapsed, this.generator.active)), active: this.generator.active,
          missionWave: this.generator.missionWave, completed: this.generator.completed },
        fuel: this.fuel ? (() => {
          const point = this.players.get(this.fuel.carrierId) ?? this.fuel;
          return { x: round(point.x), y: round(point.y), z: round(point.z), carrierId: this.fuel.carrierId };
        })() : null,
      },
      spawnWarnings: [...this.spawnWarnings.values()].map(warning => ({ id: warning.id, x: round(warning.x), y: 0, z: round(warning.z),
        readyAt: round(warning.readyAt), remaining: round(Math.max(0, warning.readyAt - this.time)) })).concat(this.raidWarningSnapshot()),
      players: [...this.players.values()].map(player => ({
        id: player.id, name: player.name, ...(player.companion === true ? { companion: true, companionSlot: player.companionSlot,
          companionProfile: player.companionProfile ? { selection: player.companionProfile.selection, archetype: player.companionProfile.archetype } : null } : {}), x: round(player.x), y: round(player.y), z: round(player.z), yaw: round(player.yaw), pitch: round(player.pitch),
        hp: player.hp, maxHp: characterStats(player).maxHp, armor: player.armor ?? 0, downed: player.downed, alive: player.alive, waiting: player.waiting === true, ready: player.ready === true, weapon: player.weapon, weaponId: activeWeaponId(player),
        dualWield: Boolean(this.dualWeaponIds(player)), secondaryWeaponId: this.dualWeaponIds(player)?.[1] ?? null,
        hands: { primary: this.handSnapshot(player, 'primary'), secondary: this.handSnapshot(player, 'secondary') },
        backpack: player.backpack === true, weaponSlots: this.weaponSlots(player), movementMultiplier: this.playerMovementMultiplier(player),
        backpackMovementMultiplier: this.backpackMovementMultiplier(player),
        nearbyWeaponId: this.nearbyGroundWeapon(player)?.id ?? null, reviveTargetId: this.reviveTargetFor(player)?.id ?? null,
        nearbyBonusId: this.nearbyBonus(player)?.id ?? null, bonus: player.bonus ? { ...player.bonus } : null,
        // The optional character sheet and what is left of its debt (null once
        // repaid), for the lobby, the HUD and the crate previews.
        character: (({ preset, name, stats } = player.sheet ?? STANDARD_SHEET) => ({ preset, name, stats: { ...stats } }))(),
        sheetDebt: Object.keys(player.sheetDebt ?? {}).length ? { ...player.sheetDebt } : null,
        supplyAction: this.supplyAction(player), supplyPurchases: player.supplyPurchases ?? [],
        grenades: player.grenades, maxGrenades: characterStats(player).maxGrenades, throwLeft: round(Math.max(0, player.throwAfter - this.time)),
        grenadierLeft: this.grenadierLeft(player) == null ? null : round(this.grenadierLeft(player)),
        crouched: player.crouched === true, eyeHeight: playerEyeHeight(player),
        ammo: weaponStock(player)?.ammo ?? 0, reserve: weaponStock(player)?.reserve ?? 0, magazine: this.weaponProfile(player)?.magazine ?? 0, reserveCapacity: this.weaponProfile(player)?.reserve ?? 0,
        minigunSpinning: player.minigunSpinning, minigunReady: player.minigunSpinning && this.time + 1e-8 >= player.minigunSpinUntil,
        minigunSpinLeft: player.minigunSpinning ? round(Math.max(0, player.minigunSpinUntil - this.time)) : 0,
        reloading: player.reloadUntil > this.time, reloadLeft: round(Math.max(0, player.reloadUntil - this.time)),
        fireReadyLeft: round(Math.max(0, player.shotAfter - this.time)),
        meleeAttack: player.pendingMelee?.attack ?? null, meleeAttackId: player.pendingMelee?.attackId ?? null,
        meleeWindupLeft: round(Math.max(0, (player.pendingMelee?.impactAt ?? 0) - this.time)),
        meleeReadyLeft: round(Math.max(0, (player.meleeAfter ?? 0) - this.time)),
        bleedOutLeft: player.downed && player.alive ? round(Math.max(0, player.bleedOutAt - this.time)) : 0,
        score: player.score, points: player.points, kills: player.kills, nextWaveVote: player.nextWaveVote === true, reviveKit: player.reviveKit === true, ...this.reviveStatus(player),
        waveScore: Math.max(0, player.score - (player.waveScoreStart ?? player.score)), waveKills: Math.max(0, player.kills - (player.waveKillsStart ?? player.kills)), ownedWeapons: weaponEntries(player).map(entry => entry.weapon), grounded: player.grounded,
        weapons: weaponEntries(player).map(({ id, weapon, stock }) => ({ id, weapon, ammo: stock.ammo, reserve: stock.reserve, magazine: this.weaponProfile(player, id).magazine, reserveCapacity: this.weaponProfile(player, id).reserve, equipped: id === activeWeaponId(player) })),
        weaponSupply: [...(player.issuedWeapons ?? [])],
        outside: outsideCabin(player.x,player.z), outsideDamageActive: this.outsideDamageActive(player),
        umbrella: { open: player.umbrella.open, remaining: round(player.umbrella.remaining), max: UMBRELLA.max },
        carryingFuel: this.fuel?.carrierId === player.id, rainExposed: this.rainExposed(player),
        expeditionAction: this.expeditionAction(player.id),
      })),
      zombies: [...this.zombies.values()].map(zombie => ({
        id: zombie.id, x: round(zombie.x), y: round(zombie.y), z: round(zombie.z), yaw: round(zombie.yaw), hp: Math.max(0, round(zombie.hp)), maxHp: zombie.maxHp, kind: zombie.kind, scale: zombie.scale ?? 1, boss: zombie.boss === true,
        frostSlow: round(zombie.frostSlow ?? 0),
        height: round(enemyPosture(zombie).height * (zombie.scale ?? 1)), headHeight: round(enemyPosture(zombie).head * (zombie.scale ?? 1)),
        family: enemyAppearance(zombie).id,
        burning: HAZARD_PHASES.includes(this.phase) && zombie.burnUntil > this.time,
        burnLeft: HAZARD_PHASES.includes(this.phase) ? round(Math.max(0, (zombie.burnUntil ?? 0) - this.time)) : 0,
        pushX: HAZARD_PHASES.includes(this.phase) ? round(zombie.pushX ?? 0) : 0,
        pushZ: HAZARD_PHASES.includes(this.phase) ? round(zombie.pushZ ?? 0) : 0,
        ...(zombie.kind === 'raider' ? this.raiderSnapshot(zombie) : {}),
      })),
      grenades: [...this.grenades.values()].map(grenade => ({ id: grenade.id, x: round(grenade.x), y: round(grenade.y), z: round(grenade.z), fuseLeft: round(grenade.fuseLeft) })),
      doors: this.doors.map(({ id, x, z, hp, maxHp, boards, sealed, sealPending }) => ({ id, x, z, hp, maxHp, boards: [...boards], sealed, sealPending })),
      pickups: [...this.pickups.values()].map(pickup => ({ id: pickup.id, kind: pickup.kind, x: round(pickup.x), y: round(pickup.y), z: round(pickup.z), amount: pickup.amount, special: pickup.special,
        ...(pickup.kind === 'bonus' ? { bonus: pickup.bonus } : {}),
        ...(pickup.kind === 'weapon' ? { weapon: pickup.weapon, ammo: pickup.ammo, reserve: pickup.reserve,
          yaw: pickup.yaw ?? 0, pitch: pickup.pitch ?? 0, modelLift: pickup.modelLift ?? 0 } : {}),
        fill: pickup.kind === 'ammo' ? (Number.isInteger(pickup.charge) ? clamp(pickup.charge, 0, PICKUPS.ammoCharge) : PICKUPS.ammoCharge) / PICKUPS.ammoCharge : undefined,
        expiresIn: Number.isFinite(pickup.expiresAt) ? round(Math.max(0, pickup.expiresAt - this.time)) : null })),
      armory: ARMORY,
    };
  }
}

Object.assign(RoomSimulation.prototype, supplyMethods);
// Manual save/load of a paused night and its reserved seats (save-game.mjs).
installSaveGame(RoomSimulation, { WEAPONS, tickRate: TICK_RATE, push: { duration: PUSH_DURATION, speed: PUSH_DISTANCE / PUSH_DECAY } });
// Raid helpers receive the private hitscan geometry rather than importing it back.
Object.assign(RoomSimulation.prototype, createRaiderMethods({ rayBox, rayBoard, WEAPONS, damageFalloff, bodyRadius, outsideCabin, WORLD }));

// Player commands supplied by the feature mixins follow the same pause gate.
// Lifecycle helpers (death/disconnection drops and snapshots) stay available.
for (const name of ['claimSupply', 'takeBonus', 'buySupply']) {
  const method = RoomSimulation.prototype[name];
  RoomSimulation.prototype[name] = function (...args) {
    return this.paused || this.players.get(args[0])?.waiting ? false : method.apply(this, args);
  };
}
