import { LEVEL, IS_SUPERMARKET, IS_HOSPITAL, IS_FUNFAIR, HAS_SPACE } from '../public/level-config.js';
import { SPACE, spaceFloor, spaceFlightAt, spaceFloorId, spaceFlightHolding } from '../public/level-space.js';
import { companionWaypoint } from './routes.mjs';
// The companion's body (companions/DESIGN.md, "Orders"). It carries out the
// order its brain chose with a human player's commands only (setInput, shoot,
// reload, repairDoor, interact, useReviveKit, buyWeapon, chooseWeapon,
// claimSupply, buySupply). It walks the zombies' own visibility graph, aims
// like a person (reaction time, turn speed, tremor) and fires only along
// lines clear of walls and of intact planks in sight, sparing our barricades
// behind its target. It never chooses what to do next: that is the brain's
// job.
import { ARMORY, ARMORY_REACH, ARMORY_HEIGHT_REACH, BARRICADE_BOARDS, LOFT, REVIVE, STAIRS, STAIR_WELL, GRENADES, FLAMETHROWER, ROCKET, PLAYER_POSTURE, RAIN, difficultyOf, enemyPosture, enemyHitbox, playerEyeHeight, playerHitbox, stairTreadY } from '../public/rules.js';
import { meleeTargets } from '../public/melee-reach.js';
import { characterStats } from '../public/character-bonuses.js';
import { LATE_SUPPLIES } from '../public/weapon-upgrades.js';
import { GENERATOR, GENERATOR_BOUNDS, UMBRELLA } from '../public/expedition.js';
import { weaponEntries, activeWeaponId, weaponStock, weaponType } from '../public/weapon-inventory.js';
import { OUTDOORS, TERRACE_PASSAGE, sheltered, wayOut, wetApproach, doorwayOpen, doorwayPassage, shutOut } from './outdoors.mjs';
import { COINS, calm, coinPiles, giveUp, theirs, walk } from './coins.mjs';
import { fightsBetter, replaced, worthBuying } from './arsenal.mjs';
import { crateAccessAtDoor, nextCrateWave } from './crate-opportunity.mjs';
import { flameCoverageAt } from './combat-opportunities.mjs';

const TICK = 1 / 30;
// Hospital and funfair: an order's time limit sized to its walk at this
// body's own pace (a minigun, a flamethrower or a full backpack slow it down).
// routes.mjs counts straight legs through the partitions: x1.7 for the
// doorways. Fixed limits ran out a few metres short (audit, 24 October).
const walkSeconds = (sim, player, target) => walk(player, target) * 1.7 / (OUTDOORS.pace * Math.min(1, sim.playerMovementMultiplier?.(player) ?? 1));
const STAIR_X = (STAIRS.minX + STAIRS.maxX) / 2;
const LOWER_LANDING = Object.freeze({ x: STAIR_X, y: 0, z: STAIRS.maxZ + .5 });
const UPPER_LANDING = Object.freeze({ x: STAIR_X, y: LOFT.y, z: STAIRS.minZ - .5 });
// A flight is only started from straight in front of it, at its head or foot.
const LANE = (STAIRS.maxX - STAIRS.minX) / 2 - .25;
const atFlight = (point, climb) => Math.abs(point.x - STAIR_X) < LANE && (climb === 'down'
  ? point.z > UPPER_LANDING.z - .6 && point.z < STAIRS.minZ + .6 : point.z > STAIRS.maxZ - .6 && point.z < LOWER_LANDING.z + .6);
// What a foot finds at (x, z) from height y, as in playerSurface: the loft
// (to a body's radius from the well), a tread, or the ground floor. A body
// never steps off an edge higher than LEDGE.
const floorAt = (x, z, y) => HAS_SPACE ? spaceFloor(x, z, y + .35, .25) : y > 2.8 && x >= LOFT.minX - .25 && x <= LOFT.maxX + .25 && z >= LOFT.minZ - .25 && z <= LOFT.maxZ + .25
  && !(x > STAIR_WELL.minX + .25 && x < STAIR_WELL.maxX - .25 && z > STAIR_WELL.minZ + .25 && z < STAIR_WELL.maxZ - .25) ? LOFT.y
  : x >= STAIRS.minX && x <= STAIRS.maxX && z >= STAIRS.minZ - .02 && z <= STAIRS.maxZ ? stairTreadY(z) : 0;
const LEDGE = .6;
// The loft post: two metres from the head of the stairs, watching the flight.
// Supermarket (lot 3 audit): SPACE.refuge is blind to both flights (10% and
// 5% of the treads). The companion fallback is the cellar reserve instead:
// the first bot on 'loft' stands at the foot of the interior stair watching
// up it (every tread in sight), a second one watches the exterior flight from
// a measured spot across the cellar (9.4,-4.4 sees the whole garden flight
// and its foot, none of the interior one). SPACE.refuge itself is untouched.
// Hospital, same pattern: SPACE.refuge (0,-3.4,-6) sees neither flight (0%
// and 14% of the treads). The first bot watches up the main stair from the
// far corner of its foot hall (-16.6,-13.1): every tread and the head, the
// pharmacy doorway and the strip west of the flight: a zombie crossing the
// basement through the pharmacy comes into sight past its west shelf, about
// 7 m away (2.3 m from just past the foot, at (-14,-10.5); audit, 24
// October). The second watches up the service stair (13,0): its whole
// flight and its head. On the hospital and funfair LOFT_POST_EXTERIOR is that
// service stair post (the name is the supermarket's). Funfair posts are at
// (-13.1,-10.5) and (12.7,0): measured sightlines cover every tread and the
// head of their own flight, and no tread of the other flight.
export const LOFT_POST = IS_SUPERMARKET ? Object.freeze({ x: 4.6, y: -3.4, z: -9.5 })
  : IS_HOSPITAL ? Object.freeze({ x: -16.6, y: -3.4, z: -13.1 })
    : IS_FUNFAIR ? Object.freeze({ x: -13.1, y: -3.4, z: -10.5 }) : Object.freeze({ x: 2.2, y: LOFT.y, z: -3.9 });
export const LOFT_POST_EXTERIOR = IS_SUPERMARKET ? Object.freeze({ x: 9.4, y: -3.4, z: -4.4 })
  : IS_HOSPITAL ? Object.freeze({ x: 13, y: -3.4, z: 0 })
    : IS_FUNFAIR ? Object.freeze({ x: 12.7, y: -3.4, z: 0 }) : null;
const LOFT_WATCH = HAS_SPACE ? SPACE.watch : Object.freeze({ x: STAIR_X, y: 1.4, z: STAIRS.maxZ });
const LOFT_WATCH_EXTERIOR = IS_SUPERMARKET ? Object.freeze({ x: 11.2, y: -2, z: 4.5 })
  : IS_HOSPITAL ? Object.freeze({ x: 14.7, y: -1.53, z: 7.65 })
    : IS_FUNFAIR ? Object.freeze({ x: 12.7, y: -1.53, z: 7.65 }) : null;
// Which of the two posts a companion on the 'loft' order takes (supermarket,
// hospital and funfair): 0 for LOFT_POST, 1 or more for LOFT_POST_EXTERIOR. It
// ranks by lobby slot among itself and the companions standing on that order,
// so the two never fight over one spot; a teammate down, out or waiting for
// the next wave holds no post, and the one behind it takes over (review, 24
// October). The eyes name the same post.
export function loftRank(sim, id) {
  const mates = [...sim.players.values()].filter(other => other.companion === true
    && (other.id === id || (other.alive && !other.downed && !other.waiting && sim.companionOrders?.get(other.id)?.kind === 'loft')))
    .sort((a, b) => (a.companionSlot ?? 99) - (b.companionSlot ?? 99) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return Math.max(0, mates.findIndex(other => other.id === id));
}
// Enemies remain inside but none has been seen for this long: the interior
// watch climbs and peeks round the stair head (zombies jam at its cheek
// corners, around (5.4,0,-0.2) and (3.0,0,-0.2)). Supermarket only: the
// hospital and funfair posts keep their watch.
const LOFT_PEEK = IS_SUPERMARKET ? Object.freeze({ x: 4.2, y: 0, z: .3 }) : null, LOFT_PEEK_AFTER = 15;
// Survivors keep this far inside the outer walls; only doorways lead out, and
// only a trip outside takes one: a collect order for a pickup, or a claim
// order for the supply crate (companions/outdoors.mjs).
const INSIDE = LEVEL.companionBounds;
// Supermarket: dry spots in the roofed terrace passage, from which the east
// door (on the open-air terrace) is guarded and the terrace watched.
const PASSAGE_SPOTS = TERRACE_PASSAGE ? [[0, 0], [0, .8], [0, -.8], [-.6, 0], [-.6, .9], [-.6, -.9]].map(([x, z]) => Object.freeze({ x: TERRACE_PASSAGE.x + x, y: 0, z: TERRACE_PASSAGE.z + z })) : [];
// GUARD: an enemy this close to anyone is shot whatever stands behind it.
const SIGHT = 30, HOLD = 20, REFLEX = 4, STEP = 6, FLAME = 4.5, GUARD = 2;
// Room left round a teammate's line: by the trigger, and when choosing a
// target or a spot to shoot from (spots on a teammate: see crowded()).
const CLEARANCE = .45, BERTH = .7;
// Friendly fire adds a little room round the team: a wound is no longer
// impossible, only cheaper at 'reduced'.
const FF_ROOM = .15;
// movePlayer's sprint (m/s), before a gun's weight and a sheet's bonus.
const SPRINT = 5.4;
const STEP_RISE = .24; // movePlayer's STEP_HEIGHT: a tread climbed in one tick
// The owner's cheat sheet: never let a zombie reach you (back off while
// shooting), aim for the head, line them up for guns that pierce.
const KITE = 2, KITE_STEP = 1.2, LINE_WIDTH = .5, LINE_DEPTH = 8;
// Taking hits (owner, 13 October): never stay planted. Losing HURT health in
// HURT_WINDOW seconds falls back to cover for a moment; a step back from a
// zombie is held a moment too, so it does not walk straight back into it.
const HURT = 15, HURT_WINDOW = 2, KITE_HOLD = 1.5, COVER_HOLD = 2, SELF_GUARD = 1.2;
// The longest wait inside for the next crate: past any break (12 s), so it
// only ends a wait that something else has stalled.
const CRATE_WAIT = 15;
// A person, not an aimbot (rad, rad/s, s, m). Tremor values are deviations;
// each enemy in sight within crowdWithin (up to crowdMax) widens it by crowd.
export const AIM = Object.freeze({ reaction: [.3, .45], gain: 8, minRate: .7, maxRate: 4.5, tremorYaw: .11, tremorPitch: .065,
  tremorEvery: [.35, .6], fresh: 1.6, flinch: 2.2, flinchFor: .6, crowd: .15, crowdWithin: 5, crowdMax: 4,
  settle: .015, hurried: .12, close: 2.5, glance: [.15, .25], pause: [.05, .2] });
const PARAMS = { shoot: 'zombieId', defend: 'doorId', repair: 'doorId', revive: 'playerId', kit: 'playerId', follow: 'playerId', collect: 'pickupId', buy: 'rackId', weapon: 'weapon', dual: 'weapon', grenade: 'zombieId', claim: 'bonus', supply: 'service' };
const PEEKERS = new Set(['hold', 'defend', 'loft', 'follow']);
// Orders that may keep a body on the open-air terrace, in the rain.
const OUT_IN_THE_RAIN = new Set(['shoot', 'grenade', 'repair', 'revive', 'kit', 'collect', 'coins', 'claim', 'supply', 'buy', 'follow']);
const KINDS = new Set(['hold', 'shoot', 'defend', 'repair', 'revive', 'kit', 'self-kit', 'wait', 'follow', 'collect', 'coins', 'buy', 'weapon', 'dual', 'reload', 'loft', 'grenade', 'claim', 'supply', 'umbrella']);
// The pitch that lands a grenade `distance` away when its fuse ends, `drop`
// metres below the hand: the throw played forward like a person judging it.
const throwTable = new Map();
function throwPitch(distance, drop) {
  const key = `${Math.round(distance * 4)}:${Math.round(drop * 4)}`;
  if (throwTable.has(key)) return throwTable.get(key);
  let best = null;
  for (let pitch = -.5; pitch <= 1.0001; pitch += .02) {
    let along = 0, height = 0, ahead = GRENADES.speed * Math.cos(pitch), rise = GRENADES.speed * Math.sin(pitch) + GRENADES.lift;
    for (let time = 0; time < GRENADES.fuse; time += 1 / 120) {
      rise -= GRENADES.gravity / 120; height += rise / 120; along += ahead / 120;
      if (height <= drop && rise < 0) { height = drop; rise = -rise * GRENADES.bounce; ahead *= GRENADES.friction; }
    }
    const miss = Math.abs(along - distance);
    if (!best || miss < best.miss) best = { pitch, miss };
  }
  throwTable.set(key, best.pitch);
  return best.pitch;
}
// Pellet directions tested before a shot, in units of the weapon's spread:
// rows no further apart than a plank seen from across the cabin (0.27 m at
// about 20 m), over the square spread or the shotgun's disk.
const PLANK_ANGLE = .012;
const patterns = new Map();
function pelletPattern(spread, disk) {
  if (!(spread > 0)) return [[0, 0]];
  const key = `${spread}:${disk}`;
  if (!patterns.has(key)) {
    const rows = Math.max(3, Math.ceil(2 * spread / PLANK_ANGLE) + 1), pattern = [];
    for (let row = 0; row < rows; row++) {
      const vertical = -1 + 2 * row / (rows - 1), width = disk ? Math.sqrt(Math.max(0, 1 - vertical * vertical)) : 1;
      for (const horizontal of width > 1e-9 ? [-width, 0, width] : [0]) pattern.push([horizontal, vertical]);
    }
    patterns.set(key, pattern);
  }
  return patterns.get(key);
}
// Rounds that go on past or through the enemy are judged on the intended
// line, over a 7 x 7 grid out to the spread plus SPARE tremor deviations
// (gaps no wider than a door seen from across the cabin). Planks up to
// AROUND beyond the aimed point stand round the target itself (an enemy in
// a doorway): those are in plain sight, like planks in front.
const SPARE = 1, AROUND = .6, GRID = Array.from({ length: 7 }, (_, index) => -1 + index / 3);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const inRect = (point, rect, margin = 0) => point.x >= rect.minX - margin && point.x <= rect.maxX + margin && point.z >= rect.minZ - margin && point.z <= rect.maxZ + margin;
const outside = point => Math.abs(point.x) > LEVEL.halfWidth || Math.abs(point.z) > LEVEL.halfDepth;
const floorOf = point => HAS_SPACE ? spaceFlightAt(point.x, point.z, point.y ?? 0) ? 'stair' : spaceFloorId(point) : inRect(point, STAIRS) && point.y > .3 ? 'stair' : point.y > 2.8 ? 'loft' : 'ground';
const standingLevel = point => floorOf(point) === 'stair' ? null : HAS_SPACE ? (spaceFloorId(point) === 'cellar' ? SPACE.minY : 0) : point.y > 2.8 ? LOFT.y : point.y < .3 ? 0 : null;
const eyeOf = player => ({ x: player.x, y: player.y + playerEyeHeight(player), z: player.z });
const ray = (yaw, pitch) => ({ x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) });
const lookAt = (from, to) => ({ yaw: Math.atan2(-(to.x - from.x), -(to.z - from.z)), pitch: Math.atan2((to.y ?? 0) - from.y, Math.hypot(to.x - from.x, to.z - from.z)) });
// World direction → setInput axes (yaw 0 faces -Z; see movePlayer).
const relative = (dir, yaw, scale = 1) => ({ forward: (-dir.x * Math.sin(yaw) - dir.z * Math.cos(yaw)) * scale, strafe: (dir.x * Math.cos(yaw) - dir.z * Math.sin(yaw)) * scale });
const sameOrder = (a, b) => a.kind === b.kind && (!PARAMS[a.kind] || a[PARAMS[a.kind]] === b[PARAMS[a.kind]]);
const reach = weapon => !weapon ? 0 : weapon.melee ? (weapon.attacks?.light?.range ?? 1.6) - .2 : weapon.fuel ? FLAME : Math.min(weapon.range ?? SIGHT, SIGHT);

// Distance along a ray to an axis-aligned box (an enemy's hitbox, or a solid
// with the partition's sloping cap, as in the simulation), or Infinity.
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
    const slope = (box.cap.lowY - box.cap.highY) / (box.maxZ - box.minZ), offset = origin.y - box.cap.highY - slope * (origin.z - box.minZ);
    const velocity = direction.y - slope * direction.z;
    if (Math.abs(velocity) < 1e-8) { if (offset > 1e-8) return Infinity; }
    else if (velocity > 0) far = Math.min(far, -offset / velocity);
    else near = Math.max(near, -offset / velocity);
  }
  return near <= far && near <= maxDistance ? near : Infinity;
}

// The pack a grenade order aims at: every living zombie within 2 m of the
// target on its floor. Its centre lies on that floor, at the pack's middle.
export function grenadePack(sim, enemy) {
  const pack = [...sim.zombies.values()].filter(other => other.hp > 0 && flat(other, enemy) <= 2 && Math.abs((other.y ?? 0) - (enemy.y ?? 0)) < 1);
  const center = { x: pack.reduce((sum, other) => sum + other.x, 0) / pack.length, y: enemy.y ?? 0, z: pack.reduce((sum, other) => sum + other.z, 0) / pack.length };
  return { pack, center };
}
// Friendly fire and grenades (the body's trigger, and the throws the eyes
// offer in companions/situation.mjs): the blast hurts every standing
// survivor within radiusDamage of its centre, measured in 3D to the middle of
// the body's box (blastSurvivors), the thrower included, a floor above or
// below as well. True when one of them stands within that and half a metre.
const BLAST_ROOM = GRENADES.radiusDamage + .5;
// How far ahead a step is judged against a live grenade's reach: more than
// a tick at a sprint (5.4 m/s, a speed bonus on top).
const BLAST_LOOK = .4;
const standing = (sim, thrower) => [thrower, ...[...sim.players.values()].filter(other => other.id !== thrower.id && other.alive && !other.downed && !other.waiting)];
export function blastEndangers(sim, thrower, centre) {
  return standing(sim, thrower).some(survivor => {
    const box = playerHitbox(survivor);
    return Math.hypot(survivor.x - centre.x, (box.minY + box.maxY) / 2 - centre.y, survivor.z - centre.z) < BLAST_ROOM;
  });
}
// A pack's centre as the blast centre (the grenade at rest on its floor),
// and the earlier rule (that flat distance, on the same floor) kept too, so
// no throw it refused is allowed now.
export function packEndangers(sim, thrower, center) {
  return blastEndangers(sim, thrower, { ...center, y: center.y + GRENADES.radius })
    || standing(sim, thrower).some(survivor => Math.abs(survivor.y - center.y) < 1.5 && flat(survivor, center) < BLAST_ROOM);
}
// The throw that lands on `center` from where the thrower stands (the body
// turns to it), and whether a throw along `aim` (the hand's own by default)
// would burst within that reach, flown as the room flies it (a wall it falls
// back from, a slab's underside): sim.predictGrenade.
export function grenadeAim(player, center) {
  const eye = eyeOf(player), distance = flat(player, center);
  return { distance, yaw: Math.atan2(-(center.x - player.x), -(center.z - player.z)), pitch: throwPitch(distance, center.y - eye.y) };
}
export const throwEndangers = (sim, thrower, aim = thrower) => blastEndangers(sim, thrower, sim.predictGrenade(thrower, { yaw: aim.yaw, pitch: aim.pitch }));
// Where each grenade in flight (anyone's) will burst: a copy of it flown on
// through the authority's own steps (advanceGrenade) until its fuse ends.
// The flight is deterministic, so one answer serves every body, kept per
// grenade and flown again from where it is now every BURST_REFRESH seconds
// (a plank broken or rebuilt meanwhile).
const BURST_REFRESH = .25, bursts = new WeakMap();
export function liveBursts(sim) {
  if (!(sim.grenades?.size > 0) || typeof sim.advanceGrenade !== 'function') return [];
  const found = [];
  for (const grenade of sim.grenades.values()) {
    let known = bursts.get(grenade);
    if (!known || !(sim.time - known.at < BURST_REFRESH && sim.time >= known.at)) {
      const flight = { x: grenade.x, y: grenade.y, z: grenade.z, vx: grenade.vx, vy: grenade.vy, vz: grenade.vz, fuseLeft: grenade.fuseLeft };
      for (let tick = Math.ceil(Math.max(0, flight.fuseLeft) / TICK) + 1; tick > 0; tick--) if (sim.advanceGrenade(flight, TICK)) break;
      known = { at: sim.time, burst: { x: flight.x, y: flight.y, z: flight.z } };
      bursts.set(grenade, known);
    }
    found.push(known.burst);
  }
  return found;
}
// The burst a trigger has just predicted for the grenade it threw: the same
// launch, flown the same way, so liveBursts need not fly it again.
function foretold(sim, ownerId, burst) {
  let thrown = null;
  for (const grenade of sim.grenades?.values() ?? []) if (grenade.ownerId === ownerId) thrown = grenade;
  if (thrown && thrown.fuseLeft === GRENADES.fuse) bursts.set(thrown, { at: sim.time, burst });
}

export function createCompanionBody(sim, id, { random = Math.random, profile } = {}) {
  // Only an explicit profile change at the lobby/new-night boundary updates
  // handling. Copy its arrays so changing another body never leaks into it.
  const configuration = selected => Object.freeze(Object.fromEntries(Object.entries(AIM).map(([key, fallback]) => {
    const value = selected?.aim?.[key] ?? fallback;
    return [key, Array.isArray(value) ? Object.freeze([...value]) : value];
  })));
  let aimConfig = configuration(profile ?? sim.players.get(id)?.companionProfile);
  // stray: a trip outside cut short, maybe in a doorway: back inside first.
  // folded: until when the umbrella stays folded after a fight in the rain.
  let order = null, run = null, sight = new Map(), cover = new Map(), glanceAt = 0, returning = false, stray = false, folded = -Infinity;
  let fallback = null, wounds = [], flamePoint = null, flameCache = null;
  const freshAim = () => ({ yaw: null, pitch: 0, error: Infinity, targetId: null, acquiredAt: -Infinity, reactionUntil: 0, nextShotAt: 0, secondaryNextShotAt: 0, secondarySpinAt: -Infinity, tremorAt: 0, tremorYaw: 0, tremorPitch: 0,
    spinAt: -Infinity, health: -Infinity, flinchUntil: -Infinity, steady: 1 });
  const aim = freshAim();
  const nav = {};
  // Routes come from the zombies' visibility graph, read through a motionless
  // stand-in (speed 0): it never enters sim.zombies, never steps, never bites.
  let navigation = null, plan = null;
  const proxy = { id: `\u0000route:${id}`, kind: 'walker', scale: 1, speed: 0, x: 0, y: 0, z: 0, yaw: 0 };
  Object.defineProperty(proxy, 'navigation', { get: () => navigation, set: value => { navigation = value; if (value) plan = value; } });
  const between = ([low, high]) => low + (high - low) * random();
  const doorOf = doorId => sim.doors.find(door => door.id === doorId);
  const finish = result => { if (run?.status === 'running') run.status = result; };
  // A new order keeps the flight under way (waypoint() turns or ends it).
  const resetNav = () => Object.assign(nav, { path: [], goal: null, level: null, plannedAt: -Infinity, climb: nav.climb ?? null, progress: null, unstickUntil: 0, side: 1 });
  resetNav();
  // Players walk through one another: a spot on a teammate is no spot at all.
  const crowded = (spot, radius = .65) => [...sim.players.values()].some(other => other.id !== id && other.alive && !other.waiting
    && flat(other, spot) < radius && Math.abs(other.y - (spot.y ?? 0)) < 1.5);

  function report() {
    const player = sim.players.get(id);
    if (!player) return order ? 'failed' : 'idle';
    if (!player.waiting && (!player.alive || player.downed)) return 'down';
    return run ? run.status : 'idle';
  }

  // ---- Eyes: a glance every 0.15-0.25 s at the nearest enemies.
  function visibleOffset(eye, enemy) {
    const posture = enemyPosture(enemy), scale = enemy.scale ?? 1, height = posture.height * scale;
    // The head first (x2.2) once it is well inside; outside or by a door, the
    // chest keeps the planks behind it safe from a trembling aim or a spread.
    const head = (posture.head + posture.headThreshold) / 2 * scale;
    const byDoor = outside(enemy) || sim.doors.some(door => !door.sealed && flat(door, enemy) < 2.5);
    for (const offset of byDoor ? [.62 * height, .76 * height, head, .42 * height] : [head, .76 * height, .62 * height, .42 * height]) {
      if (sim.raiderLineClear(eye, { x: enemy.x, y: (enemy.y ?? 0) + offset, z: enemy.z })) return offset;
    }
    return null;
  }
  function glance(player, named) {
    if (sim.time < glanceAt) return;
    glanceAt = sim.time + between(aimConfig.glance);
    const eye = eyeOf(player), near = [];
    for (const enemy of sim.zombies.values()) {
      if (!(enemy.hp > 0)) continue;
      const gap = Math.hypot(enemy.x - player.x, (enemy.y ?? 0) - player.y, enemy.z - player.z);
      if (gap <= SIGHT || enemy.id === named) near.push({ enemy, gap });
    }
    near.sort((a, b) => a.gap - b.gap);
    const checked = near.slice(0, 10), index = near.findIndex(item => item.enemy.id === named);
    if (index >= 10) checked.push(near[index]);
    sight = new Map(); cover = new Map();
    for (const { enemy } of checked) {
      const offset = visibleOffset(eye, enemy);
      if (offset !== null) sight.set(enemy.id, offset);
    }
  }
  const aimPoint = enemy => ({ x: enemy.x, y: (enemy.y ?? 0) + (sight.get(enemy.id) ?? 1.1), z: enemy.z });

  // ---- Legs: same-floor routes, then the staircase through its landings.
  function standable(player, spot) {
    if (!inRect(spot, INSIDE) || crowded(spot)) return false;
    if (HAS_SPACE) {
      if (spaceFlightAt(spot.x, spot.z, spot.y ?? 0, .25) || Math.abs(spaceFloor(spot.x, spot.z, (spot.y ?? 0) + .35, .25) - (spot.y ?? 0)) > .35) return false;
    } else if (spot.y > 2.8 ? spot.x < LOFT.minX + .45 || inRect(spot, STAIR_WELL, .4) : inRect(spot, STAIRS, .35)) return false;
    return sim.canOccupy(player, spot.x, spot.z, spot.y, .32);
  }
  // The spot itself, or the nearest free one round it when a teammate stands there.
  function freeSpot(player, spot, keep = () => true) {
    if (!crowded(spot)) return spot;
    for (const radius of [.8, 1.2, 1.6]) {
      const ring = Array.from({ length: 12 }, (_, index) => ({ x: spot.x + Math.cos(index * Math.PI / 6) * radius, y: spot.y, z: spot.z + Math.sin(index * Math.PI / 6) * radius }))
        .filter(item => keep(item) && standable(player, item)).sort((a, b) => flat(player, a) - flat(player, b));
      if (ring.length) return ring[0];
    }
    return spot;
  }
  // An order's time limit: `fixed` seconds, on the hospital and funfair at
  // least the walk to `target` and `spare` seconds, reckoned once per order.
  function limit(player, target, fixed, spare) {
    return IS_HOSPITAL || IS_FUNFAIR ? (run.limit ??= Math.max(fixed, walkSeconds(sim, player, target) + spare)) : fixed;
  }
  // Where a flight under way ends, a step beyond its landing.
  function flightEnd(player) {
    if (HAS_SPACE) {
      const flight = spaceFlightAt(player.x, player.z, player.y);
      return flight ? { ...(nav.climb === 'down' || !nav.climb && player.y < -1.7 ? flight.lower : flight.upper) } : { x: player.x, y: player.y, z: player.z };
    }
    const climb = nav.climb ?? (player.y > LOFT.y / 2 ? 'up' : 'down');
    return climb === 'up' ? { x: STAIR_X, y: LOFT.y, z: STAIRS.minZ - 1.2 } : { x: STAIR_X, y: 0, z: STAIRS.maxZ + 1.2 };
  }
  // A spot `depth` inside a door, `lateral` aside, with a view of the threshold.
  // dry: only under the roof (a guard post); the east door's posts all stand
  // on the open-air terrace, so it is guarded from the roofed passage.
  function post(player, door, depths, laterals, dry = false) {
    const alongX = Math.abs(door.outZ), alongZ = Math.abs(door.outX), threshold = { x: door.x - door.outX * .3, y: 1.4, z: door.z - door.outZ * .3 };
    const usable = spot => (!dry || sheltered(spot)) && standable(player, spot) && sim.raiderLineClear({ x: spot.x, y: 1.55, z: spot.z }, threshold);
    for (const depth of depths) for (const lateral of laterals) {
      const spots = [1, -1].map(side => ({ x: door.x - door.outX * depth + alongX * lateral * side, y: 0, z: door.z - door.outZ * depth + alongZ * lateral * side }))
        .filter(usable).sort((a, b) => flat(player, a) - flat(player, b));
      if (spots.length) return spots[0];
    }
    return dry ? PASSAGE_SPOTS.find(usable) ?? null : null;
  }
  // Out of the rain without leaving the building: down a wet flight to its
  // dry foot, otherwise into the roofed terrace passage.
  function dryGoal(player) {
    if (sheltered(player) || outside(player)) return null;
    const flight = floorOf(player) === 'stair' && spaceFlightAt(player.x, player.z, player.y);
    return flight ? { ...flight.lower } : freeSpot(player, TERRACE_PASSAGE, sheltered);
  }
  function doorwayInside(point) {
    const door = sim.doors.filter(item => !item.sealed).sort((a, b) => flat(point, a) - flat(point, b))[0];
    return door ? { x: door.x - door.outX * 1.6, y: 0, z: door.z - door.outZ * 1.6 } : null;
  }
  // Back in through this doorway, well clear of it: straight through once in
  // its passage, otherwise to the step in front of it first.
  function homeward(player, door) {
    const normal = (player.x - door.x) * door.outX + (player.z - door.z) * door.outZ;
    const tangent = Math.abs((player.x - door.x) * door.outZ - (player.z - door.z) * door.outX);
    const within = { x: door.x - door.outX * 1.4, y: 0, z: door.z - door.outZ * 1.4 };
    if (normal < 1.4 && normal > -1.2 && tangent < .9 && Math.abs(player.y) < .3) return { ...within, through: true, doorId: door.id };
    return outside(player) ? { x: door.x + door.outX * 1.2, y: 0, z: door.z + door.outZ * 1.2 } : within;
  }
  // Through the nearest open doorway (bodies only go out on a trip for a
  // pickup; this is for one that finds itself outside, or a trip cut short).
  // Shut out, every doorway boarded up behind it, it goes to the step of the
  // nearest one to shoot a plank out of it (knock): waiting would leave it to
  // the rain and the zombies, where only a human could revive it.
  function comeBackInside(player) {
    const nearest = filter => sim.doors.filter(filter).sort((a, b) => flat(player, a) - flat(player, b))[0];
    if (!outside(player)) {
      if (!sheltered(player)) return dryGoal(player);
      const door = nearest(item => !item.sealed); return door ? homeward(player, door) : null;
    }
    const door = nearest(item => doorwayOpen(sim, item));
    if (door) return homeward(player, door);
    const shut = nearest(item => !item.sealed && !item.sealPending);
    return shut ? { x: shut.x + shut.outX * 1.2, y: 0, z: shut.z + shut.outZ * 1.2, shut } : null;
  }
  // The lowest plank that keeps a standing survivor out of this doorway, as
  // in doorPassable, and where to aim at it.
  function plankOf(door) {
    const board = BARRICADE_BOARDS.find(item => door.boards[item.index] > 0
      && item.y - item.height / 2 * Math.cos(item.angle) - item.width / 2 * Math.abs(Math.sin(item.angle)) < PLAYER_POSTURE.standingHeight);
    return board ? { x: door.x, y: board.y, z: door.z } : null;
  }

  function crouchAtDoor(player, goal) {
    const door = goal?.through && doorOf(goal.doorId);
    if (!door || player.y > .3 || !doorwayPassage(sim, door)?.crouch) return false;
    const normal = Math.abs((player.x - door.x) * door.outX + (player.z - door.z) * door.outZ);
    const tangent = Math.abs((player.x - door.x) * door.outZ - (player.z - door.z) * door.outX);
    return normal <= 1.6 && tangent < 1.05;
  }
  // The zombies' route from a point: [] when it has none, null when it has
  // nothing to plan (on the flight, or there already).
  function route(from, level, goal) {
    Object.assign(proxy, { x: from.x, y: level, z: from.z });
    navigation = null; plan = null;
    sim.moveZombieTowards(proxy, goal, TICK);
    return plan ? plan.path.map(point => ({ x: point.x, z: point.z })) : null;
  }
  function routed(player, goal) {
    const level = HAS_SPACE ? (spaceFloorId(player) === 'cellar' ? SPACE.minY : 0) : player.y > 2.8 ? LOFT.y : 0;
    if (!nav.goal || flat(nav.goal, goal) > .4 || sim.time - nav.plannedAt > .7 || nav.level !== level) {
      let path = route(player, level, goal);
      // A body is thinner than a zombie: by the flight's foot or a wall it can
      // stand where the zombies' graph has no room and finds no route (straight
      // on, it climbed the flight and stuck there). Then from the nearest spot
      // round it, a straight step away, that has one.
      for (const radius of path?.length === 0 ? [.4, .8] : []) {
        const ring = Array.from({ length: 8 }, (_, index) => ({ x: player.x + Math.cos(index * Math.PI / 4) * radius, y: level, z: player.z + Math.sin(index * Math.PI / 4) * radius }))
          .filter(spot => standable(player, spot) && walkable(player, spot)).sort((a, b) => flat(a, goal) - flat(b, goal));
        const found = ring.map(spot => ({ spot, rest: route(spot, level, goal) })).find(item => item.rest?.length);
        if (found) { path = [{ x: found.spot.x, z: found.spot.z }, ...found.rest]; break; }
      }
      nav.path = path ?? [];
      Object.assign(nav, { goal: { x: goal.x, z: goal.z }, plannedAt: sim.time, level });
    }
    while (nav.path.length && flat(player, nav.path[0]) < .3) nav.path.shift();
    return nav.path[0] ?? goal;
  }
  function waypoint(player, goal) {
    if (goal.through) return goal; // straight through a doorway
    if (outside(player)) return routed(player, goal);
    if (HAS_SPACE) {
      // Commit from the approach landing until the flight is fully left: its
      // band (spaceFlightAt) reaches past both landings, so clearing the
      // commitment within .35 m of one let a same-floor target "behind" the
      // flight pull the body straight back over the treads, every other tick.
      if (nav.spaceFlight) {
        if (spaceFlightAt(player.x, player.z, player.y)) return nav.spaceFlight.end;
        nav.spaceFlight = null;
      }
      const point = companionWaypoint(player, goal), flight = spaceFlightAt(player.x, player.z, player.y);
      if (point.flightId) {
        nav.climb = point.y < player.y ? 'down' : 'up';
        // Committed only to one of the flight's landings (supermarket,
        // hospital and funfair). A target standing on the flight (a human
        // going down or up it) is walked to and replanned every tick:
        // committed to where he stood, the follower turned back there on the
        // treads for good (audits, 24 October).
        const committed = SPACE.flights.find(item => item.id === point.flightId);
        if ([committed?.lower, committed?.upper].some(end => end && flat(end, point) < .01 && Math.abs(end.y - point.y) < .01)) nav.spaceFlight = { id: point.flightId, end: point };
        return point;
      }
      // On the flight's apron with its landing spent: never the raw same-floor
      // target back across the treads — off the band through the landing
      // first; the rest of the route is planned once the feet have left it.
      // Past a hospital flight's head rails, bound upstairs, it has left it
      // (spaceFlightHolding, as the zombies and routes.mjs).
      if (flight && spaceFlightHolding(player, goal)) return (goal.y ?? 0) < -1.7 ? flight.lower : flight.upper;
      nav.climb = null;
      // Each approach uses the authority's visibility graph; only the selected
      // flight is walked straight, so orders never cut across an open well.
      return routed(player, point);
    }
    const from = floorOf(player), to = floorOf(goal);
    const want = to === 'loft' ? 'up' : to === 'ground' ? 'down' : goal.z < player.z ? 'up' : 'down';
    if (nav.climb && nav.climb !== want) nav.climb = want;
    if (nav.climb === 'up' && from === 'loft' && player.z < STAIRS.minZ - .05) nav.climb = null;
    if (nav.climb === 'down' && player.y < .05 && player.z > STAIRS.maxZ + .05) nav.climb = null;
    // Pushed or stepped aside before it reached the flight: back to the landing first.
    if (nav.climb && from === (nav.climb === 'down' ? 'loft' : 'ground') && !atFlight(player, nav.climb)) nav.climb = null;
    // Once on the flight, finish it like the zombies' stairState: no stopping halfway.
    if (nav.climb || from === 'stair') {
      if (to === 'stair') return Math.abs(player.z - goal.z) < .3 ? goal : { x: STAIR_X, y: goal.y, z: goal.z };
      nav.climb = want;
      return want === 'up' ? UPPER_LANDING : LOWER_LANDING;
    }
    if (from === to) return routed(player, goal);
    const landing = from === 'ground' ? LOWER_LANDING : UPPER_LANDING;
    if (flat(player, landing) < .35) {
      nav.climb = from === 'ground' ? 'up' : 'down';
      return nav.climb === 'up' ? UPPER_LANDING : LOWER_LANDING;
    }
    return routed(player, landing);
  }
  // Blocked for 0.8 s: sidestep and back off (on the flight, only back off).
  function unstick(player, dir) {
    if (!nav.progress || flat(player, nav.progress) > .25) nav.progress = { x: player.x, z: player.z, at: sim.time };
    else if (sim.time - nav.progress.at > .8) {
      Object.assign(nav, { unstickUntil: sim.time + .45, side: -nav.side, plannedAt: -Infinity });
      nav.progress.at = sim.time;
    }
    if (sim.time >= nav.unstickUntil) return dir;
    if (HAS_SPACE ? spaceFlightAt(player.x, player.z, player.y, .1) : inRect(player, STAIRS, .1) && player.y > .1) return { x: -dir.x, z: -dir.z };
    const x = -dir.z * nav.side * .9 - dir.x * .45, z = dir.x * nav.side * .9 - dir.z * .45, length = Math.hypot(x, z);
    return { x: x / length, z: z / length };
  }
  // Never toward the outside (but straight through a doorway), never off the
  // loft (only the committed flight enters the stair well), never off any
  // edge higher than a knee: the body slides along it instead. It never jumps
  // either. Each axis is looked at too, as movePlayer sweeps them one by one.
  function fence(player, dir, through = false) {
    let { x, z } = dir;
    if (!outside(player) && !through) {
      if ((player.x <= INSIDE.minX && x < 0) || (player.x >= INSIDE.maxX && x > 0)) x = 0;
      if ((player.z <= INSIDE.minZ && z < 0) || (player.z >= INSIDE.maxZ && z > 0)) z = 0;
    }
    const safe = (dx, dz) => {
      const ahead = { x: player.x + dx * .35, z: player.z + dz * .35 };
      return (HAS_SPACE || !(player.y > 2.8 && !nav.climb && inRect(ahead, STAIR_WELL, .05))) && player.y - floorAt(ahead.x, ahead.z, player.y) <= LEDGE;
    };
    for (const [cx, cz] of [[x, z], [x, 0], [0, z]]) {
      const length = Math.hypot(cx, cz);
      if (length < (cx === x && cz === z ? 1e-6 : .2) || !safe(cx / length, cz / length) || (cx && cz && (!safe(cx / length, 0) || !safe(0, cz / length)))) continue;
      return { x: cx / length, z: cz / length };
    }
    return null;
  }
  function steer(player, goal, arrive) {
    const gap = flat(player, goal);
    // Arrived on the goal's floor: never halfway up or down the flight.
    if (gap <= arrive && Math.abs(player.y - (goal.y ?? 0)) < 1 && (floorOf(player) !== 'stair' || floorOf(goal) === 'stair')) {
      nav.progress = null; return { dir: null, arrived: true };
    }
    const point = waypoint(player, goal);
    const dx = point.x - player.x, dz = point.z - player.z, length = Math.hypot(dx, dz);
    if (length < 1e-3) return { dir: null, arrived: false };
    const dir = fence(player, unstick(player, { x: dx / length, z: dz / length }), goal.through === true);
    const final = flat(point, goal) < .05;
    return { dir, arrived: false, far: gap > 5, scale: final ? clamp((gap - arrive * .5) / .7, .35, 1) : 1 };
  }
  // Friendly fire: a grenade in flight, anyone's, hurts every standing
  // survivor within radiusDamage of where it will burst (liveBursts), in 3D
  // to the middle of the body's box. Until it has burst the body keeps out of
  // that reach and half a metre (BLAST_ROOM): whatever its order, a step that
  // would take it closer slides along the edge instead, or waits; and a body
  // found inside (there at the throw, or pushed in) gets out at once, along
  // the radial or the nearest way round a wall. Off, nothing is asked.
  function blastZones(player) {
    if (!friendly()) return [];
    const box = playerHitbox(player), middle = (box.minY + box.maxY) / 2, zones = [];
    for (const burst of liveBursts(sim)) {
      const rise = middle - burst.y;
      if (Math.abs(rise) >= BLAST_ROOM) continue;
      const radius = Math.sqrt(BLAST_ROOM * BLAST_ROOM - rise * rise), gap = flat(player, burst);
      if (gap >= radius + BLAST_LOOK) continue;
      zones.push({ radius, gap, away: gap > 1e-6 ? { x: (player.x - burst.x) / gap, z: (player.z - burst.z) / gap } : null });
    }
    return zones;
  }
  function keepClear(player, move, through) {
    const zones = blastZones(player);
    if (!zones.length) return move;
    const dot = (a, b) => a.x * b.x + a.z * b.z;
    // Never closer to a reach it is not in yet.
    const closes = dir => zones.some(zone => zone.gap >= zone.radius && dot(dir, zone.away) < -1e-6);
    const inside = zones.filter(zone => zone.gap < zone.radius);
    if (inside.length) {
      let x = 0, z = 0;
      for (const zone of inside) if (zone.away) { const weight = 1 - zone.gap / zone.radius + .05; x += zone.away.x * weight; z += zone.away.z * weight; }
      const length = Math.hypot(x, z);
      const out = length > 1e-6 ? { x: x / length, z: z / length } : null;
      const turns = out ? [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2] : Array.from({ length: 8 }, (_, index) => index * Math.PI / 4);
      for (const turn of turns) {
        const base = out ?? { x: 1, z: 0 }, cos = Math.cos(turn), sin = Math.sin(turn);
        const dir = fence(player, { x: base.x * cos - base.z * sin, z: base.x * sin + base.z * cos }, through);
        if (dir && (!out || dot(dir, out) > .1) && !closes(dir)) return { dir, arrived: false, far: true, scale: 1, clearing: true };
      }
      return { dir: null, arrived: false };
    }
    if (!move?.dir) return move;
    let { x, z } = move.dir;
    for (const zone of zones) {
      const inward = -(x * zone.away.x + z * zone.away.z);
      if (inward > 0) { x += inward * zone.away.x; z += inward * zone.away.z; }
    }
    const length = Math.hypot(x, z);
    const dir = length < .2 ? null : fence(player, { x: x / length, z: z / length }, through);
    return { ...move, dir: dir && !closes(dir) ? dir : null };
  }
  // A step aside: the nearest standable spot, on rings round the body and
  // within `limit` of `anchor`, with a line to the enemy clear of walls,
  // planks and teammates, and no plank of ours behind it. The shoot order
  // searches 6 m round where it began; a holding order peeks from close by.
  // preferOpen (a teammate pinned from his far side): among the spots of the
  // first ring that has any, the most open one — the side away from walls.
  function clearSpot(player, enemy, radii, anchor, limit, weapon, preferOpen = false) {
    const y = standingLevel(player), range = reach(weapon), pressing = urgent(enemy);
    if (y === null) return null;
    for (const radius of radii) {
      const found = [];
      for (let index = 0; index < 12; index++) {
        const angle = index * Math.PI / 6, spot = { x: player.x + Math.cos(angle) * radius, y, z: player.z + Math.sin(angle) * radius };
        // Never up to a gun's spared target: its bite would leave no choice of line.
        if (flat(spot, anchor) > limit || (!weapon?.melee && !pressing && flat(spot, enemy) < GUARD + .3) || !standable(player, spot)) continue;
        // A sidestep inside the automatic retreat radius would be reversed
        // immediately, even when its purpose is to protect a teammate.
        if (!weapon?.melee && [...sim.zombies.values()].some(other => other.hp > 0 && other.kind !== 'raider' && !outside(other)
          && Math.abs((other.y ?? 0) - y) < 1.2 && flat(spot, other) < KITE + .3)) continue;
        const eye = { x: spot.x, y: y + 1.55, z: spot.z }, offset = visibleOffset(eye, enemy);
        if (offset === null) continue;
        const point = { x: enemy.x, y: (enemy.y ?? 0) + offset, z: enemy.z };
        if (Math.hypot(point.x - eye.x, point.y - eye.y, point.z - eye.z) <= range && !teammateInLine(eye, point, BERTH)
          && (pressing || !intoPlanks(eye, enemy, point, weapon))) {
          if (!preferOpen) return spot;
          found.push(spot);
        }
      }
      if (found.length) return found.map(spot => ({ spot, open: openness(player, spot) })).sort((a, b) => b.open - a.open)[0].spot;
    }
    return null;
  }
  // A spot by a downed teammate from where E reaches that one and no other
  // downed teammate: the nearest on the closest ring that has one, skipping
  // spots already tried (null on the flight: it walks to them there).
  function reviveSpot(player, mate, tried = []) {
    const y = standingLevel(mate);
    if (y === null) return null;
    const others = [...sim.players.values()].filter(other => other.id !== id && other.id !== mate.id && other.alive && other.downed && !other.waiting);
    for (const radius of [1, 1.4, 1.8]) {
      let best = null;
      for (let index = 0; index < 12; index++) {
        const angle = index * Math.PI / 6, spot = { x: mate.x + Math.cos(angle) * radius, y, z: mate.z + Math.sin(angle) * radius };
        if ((best && flat(player, spot) >= flat(player, best)) || tried.some(item => flat(item, spot) < .3) || !standable(player, spot)) continue;
        const there = { ...player, ...spot };
        if (sim.interactionVisible(there, mate) && !others.some(other => flat(other, spot) < REVIVE.startReach + .2
          && Math.abs(other.y - y) < REVIVE.heightReach && sim.interactionVisible(there, other))) best = spot;
      }
      if (best) return best;
    }
    return null;
  }

  // ---- Hands: target choice, a person's aim, and the trigger.
  // The best enemy in sight and reach. One hidden by a teammate, or with one
  // of our planks behind it, is left in aim.hidden so a holding order can
  // step aside for a better line.
  // Zombies a shot at `target` would also cross: beyond it, near the line.
  function linedUp(player, target) {
    const dx = target.x - player.x, dz = target.z - player.z, length = Math.hypot(dx, dz);
    if (length < .1) return 0;
    let count = 0;
    for (const other of sim.zombies.values()) {
      if (other === target || !sight.has(other.id) || !(other.hp > 0) || Math.abs((other.y ?? 0) - (target.y ?? 0)) > 1) continue;
      const along = ((other.x - player.x) * dx + (other.z - player.z) * dz) / length;
      const across = Math.abs((other.x - player.x) * dz - (other.z - player.z) * dx) / length;
      if (along > length && along < length + LINE_DEPTH && across < LINE_WIDTH
        && sim.raiderLineClear({ x: target.x, y: (target.y ?? 0) + 1.1, z: target.z }, { x: other.x, y: (other.y ?? 0) + 1.1, z: other.z })) count++;
    }
    return count;
  }
  // Flames cover bodies, not a headshot line. Compare visible torsos and the
  // direction between two of them: a wide pair may fit the real 40° cone even
  // though aiming at either edge only burns one. Never inspect unseen enemies.
  function flamePlans(player, weapon) {
    const eye = eyeOf(player), key = `${glanceAt}:${weapon.range}:${weapon.coneAngle}`;
    const observed = [...sight.keys()].map(enemyId => sim.zombies.get(enemyId)).filter(enemy => enemy?.hp > 0);
    if (flameCache?.key === key && Math.hypot(eye.x - flameCache.eye.x, eye.y - flameCache.eye.y, eye.z - flameCache.eye.z) < .2
      && flameCache.targets.size === observed.length && observed.every(enemy => {
        const previous = flameCache.targets.get(enemy.id);
        return previous && Math.hypot(enemy.x - previous.x, (enemy.y ?? 0) - previous.y, enemy.z - previous.z) < .2;
      })) return flameCache.plans;
    const units = observed.map(enemy => {
      const box = enemyHitbox(enemy), chest = { x: enemy.x, y: (box.minY + box.maxY) / 2, z: enemy.z };
      const point = sim.raiderLineClear(eye, chest) ? chest : aimPoint(enemy);
      const length = Math.hypot(point.x - eye.x, point.y - eye.y, point.z - eye.z);
      return { enemy, length, x: (point.x - eye.x) / length, y: (point.y - eye.y) / length, z: (point.z - eye.z) / length };
    }).filter(unit => unit.length > 1e-8 && unit.length <= (weapon.range ?? FLAME));
    const directions = [...units], plans = new Map(), pairCosine = Math.cos(weapon.coneAngle ?? FLAMETHROWER.coneAngle);
    for (let first = 0; first < units.length; first++) for (let second = first + 1; second < units.length; second++) {
      const a = units[first], b = units[second];
      if (a.x * b.x + a.y * b.y + a.z * b.z < pairCosine) continue;
      const length = Math.hypot(a.x + b.x, a.y + b.y, a.z + b.z);
      if (length > 1e-8) directions.push({ x: (a.x + b.x) / length, y: (a.y + b.y) / length, z: (a.z + b.z) / length });
    }
    // Geometry cheaply ranks the alternatives first. Only four promising
    // cones need the real obstacle checks, once per glance or a moved body,
    // rather than rebuilding collision tests for every pair on every tick.
    const geometry = { time: sim.time, grenadeBlastVisible: () => true };
    const candidates = directions.map(direction => {
      const toward = { x: eye.x + direction.x, y: eye.y + direction.y, z: eye.z + direction.z };
      return { direction, toward, count: flameCoverageAt(geometry, player, toward, observed, weapon).count };
    }).filter(candidate => candidate.count >= 2).sort((a, b) => b.count - a.count).slice(0, 4);
    for (const { direction, toward } of candidates) {
      const coverage = flameCoverageAt(sim, player, toward, observed, weapon);
      if (coverage.count < 2) continue; // keep the familiar aim for an isolated enemy
      for (const unit of units) {
        if (!coverage.ids.includes(unit.enemy.id)) continue;
        const point = { x: eye.x + direction.x * unit.length, y: eye.y + direction.y * unit.length, z: eye.z + direction.z * unit.length };
        // The middle of a group can be a partition or a floor: a useful cone
        // must also have a clear central jet, with room past a teammate.
        const alignment = unit.x * direction.x + unit.y * direction.y + unit.z * direction.z, previous = plans.get(unit.enemy.id);
        if (!previous || coverage.count > previous.count || coverage.count === previous.count && alignment > previous.alignment + 1e-8) {
          if (!sim.grenadeBlastVisible(eye, point) || teammateInLine(eye, point, BERTH)) continue;
          plans.set(unit.enemy.id, { point, count: coverage.count, alignment });
        }
      }
    }
    flameCache = { key, eye, plans, targets: new Map(observed.map(enemy => [enemy.id, { x: enemy.x, y: enemy.y ?? 0, z: enemy.z }])) };
    return plans;
  }
  // A step away from the zombies about to bite, toward the free side; none
  // on the stairs or with a blade (it has to be close to strike).
  function backOff(player, weapon) {
    if (weapon?.melee || floorOf(player) === 'stair') return null;
    let awayX = 0, awayZ = 0, close = 0;
    for (const enemy of sim.zombies.values()) {
      if (!(enemy.hp > 0) || enemy.kind === 'raider' || outside(enemy) || Math.abs((enemy.y ?? 0) - player.y) > 1.2) continue;
      const gap = flat(player, enemy);
      if (gap >= KITE || gap < 1e-3) continue;
      awayX += (player.x - enemy.x) / (gap * gap); awayZ += (player.z - enemy.z) / (gap * gap); close++;
    }
    if (!close) return null;
    // Away from them, but never into a corner: a spot that leaves room to keep
    // backing off beats the straightest line.
    const heading = Math.atan2(awayX, awayZ), spots = [];
    for (const turn of [0, .5, -.5, 1, -1, 1.6, -1.6, 2.2, -2.2]) {
      const spot = { x: player.x + Math.sin(heading + turn) * KITE_STEP, y: player.y, z: player.z + Math.cos(heading + turn) * KITE_STEP };
      if (standable(player, spot) && walkable(player, spot)) spots.push({ spot, open: openness(player, spot) });
    }
    // The straightest way out among spots that leave room to keep going.
    return (spots.find(item => item.open >= 4) ?? spots[0])?.spot ?? null;
  }
  // A straight step with nothing waist-high in the way (the living-room wall).
  function walkable(player, spot) {
    const knee = y => y + .5;
    if (!sim.raiderLineClear({ x: player.x, y: knee(player.y), z: player.z }, { x: spot.x, y: knee(spot.y), z: spot.z })) return false;
    return [.35, .7].every(share => standable(player, { x: player.x + (spot.x - player.x) * share, y: player.y, z: player.z + (spot.z - player.z) * share }));
  }
  // How many of eight further steps from a spot stay free: 8 in the open, ~3 in a corner.
  function openness(player, spot) {
    let open = 0;
    for (let index = 0; index < 8; index++) {
      const angle = index / 8 * Math.PI * 2;
      if (standable(player, { x: spot.x + Math.sin(angle) * KITE_STEP, y: spot.y, z: spot.z + Math.cos(angle) * KITE_STEP })) open++;
    }
    return open;
  }
  // Under fire: the nearby spot furthest from the zombies inside and out of
  // every raider's sight, a little toward the team.
  function takeCover(player) {
    const zombies = [...sim.zombies.values()].filter(enemy => enemy.hp > 0 && enemy.kind !== 'raider' && !outside(enemy) && Math.abs((enemy.y ?? 0) - player.y) < 1.2);
    const raiders = [...sim.zombies.values()].filter(enemy => enemy.hp > 0 && enemy.kind === 'raider');
    const mates = [...sim.players.values()].filter(other => other.id !== id && other.alive && !other.downed && !other.waiting);
    let best = null;
    for (const radius of [1.5, 2.5]) for (let index = 0; index < 12; index++) {
      const angle = index / 12 * Math.PI * 2, spot = { x: player.x + Math.sin(angle) * radius, y: player.y, z: player.z + Math.cos(angle) * radius };
      if (!standable(player, spot)) continue;
      const room = Math.min(4, ...zombies.map(enemy => flat(spot, enemy)), 4);
      const chest = { x: spot.x, y: spot.y + 1.1, z: spot.z };
      const hidden = raiders.every(raider => !sim.raiderLineClear({ x: raider.x, y: (raider.y ?? 0) + 1.5, z: raider.z }, chest));
      const team = mates.length ? Math.min(...mates.map(mate => flat(spot, mate))) : 0;
      const score = room + (hidden ? 3 : 0) - team * .1 + openness(player, spot) * .3;
      if (!best || score > best.score) best = { spot, score };
    }
    return best?.spot ?? null;
  }
  function choose(player, engage, weapon) {
    const limit = weapon?.melee ? Math.min(engage.range, 5) : Math.min(engage.range, reach(weapon)), eye = eyeOf(player), ranked = [];
    const pierce = weapon?.melee ? 1 : weapon?.penetrationTargets ?? 1, flames = weapon?.fuel ? flamePlans(player, weapon) : null;
    flamePoint = null;
    for (const zombieId of sight.keys()) {
      if (engage.only && zombieId !== engage.only) continue;
      const enemy = sim.zombies.get(zombieId);
      if (!enemy || !(enemy.hp > 0)) continue;
      const gap = Math.hypot(enemy.x - player.x, (enemy.y ?? 0) - player.y, enemy.z - player.z);
      if (gap > limit) continue;
      const immediate = Boolean(flames && urgent(enemy)), plan = immediate ? null : flames?.get(zombieId);
      let score = gap - (!flames && gap < 3 ? 10 : 0) - (zombieId === aim.targetId ? 3 : 0);
      if (plan) score -= 2 * (plan.count - 1);
      if (pierce > 1) score -= 1.5 * Math.min(pierce - 1, linedUp(player, enemy)); // several in a row: one shot, several hits
      if (engage.near && flat(enemy, engage.near) < engage.nearRadius && Math.abs((enemy.y ?? 0) - (engage.near.y ?? 0)) < 2) score -= 20;
      ranked.push({ enemy, score, plan, urgent: immediate });
    }
    ranked.sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.score - b.score);
    aim.hidden = null;
    for (const { enemy, plan } of ranked) {
      if (!teammateInLine(eye, plan?.point ?? aimPoint(enemy), BERTH) && !spares(player, enemy, weapon)) {
        aim.hidden = null; flamePoint = plan?.point ?? null; return enemy;
      }
      aim.hidden ??= enemy;
    }
    return null;
  }
  // About to bite a teammate, or right on the body (it backs off before
  // that): protect first, planks or not.
  const urgent = enemy => [...sim.players.values()].some(other => other.alive && !other.waiting
    && flat(other, enemy) < (other.id === id ? SELF_GUARD : GUARD) && Math.abs(other.y - (enemy.y ?? 0)) < 2);
  // Doorways that still hold an intact plank, as boxes round their plane: a
  // stray round finds the planks, not the gaps between them.
  function doorways() {
    const half = BARRICADE_BOARDS[0].width / 2;
    return sim.doors.filter(door => !door.sealed && door.boards?.some(hp => hp > 0)).map(door => {
      const heights = BARRICADE_BOARDS.filter(board => door.boards[board.index] > 0).map(board => board.y);
      const minY = Math.min(...heights) - .2, maxY = Math.max(...heights) + .2;
      return door.outX ? { minX: door.x - .15, maxX: door.x + .15, minY, maxY, minZ: door.z - half, maxZ: door.z + half }
        : { minX: door.x - half, maxX: door.x + half, minY, maxY, minZ: door.z - .15, maxZ: door.z + .15 };
    });
  }
  // Would rounds aimed at this point go on, past or through the enemy, into
  // one of our own barricades? Judged on the intended line, with the spread
  // and a margin for the hand's tremor, never on where the tremor points this
  // tick, so it cannot sort hits from misses. Planks in front are in sight.
  function intoPlanks(eye, enemy, point, weapon) {
    if (!weapon || weapon.melee || weapon.fuel) return false;
    const ways = doorways();
    if (!ways.length) return false;
    const spread = weapon.spread ?? 0, range = weapon.range ?? SIGHT, box = enemyHitbox(enemy), single = (weapon.penetrationTargets ?? 1) <= 1 || weapon.explosive;
    const view = lookAt(eye, point), length = Math.hypot(point.x - eye.x, point.y - eye.y, point.z - eye.z);
    const shaky = aim.steady * (enemy.id !== aim.targetId || sim.time - aim.acquiredAt < .6 ? aimConfig.fresh : 1);
    const wide = spread + SPARE * aimConfig.tremorYaw * shaky, high = spread + SPARE * aimConfig.tremorPitch * shaky;
    for (const horizontal of GRID) for (const vertical of GRID) {
      const direction = ray(view.yaw + horizontal * wide, view.pitch + vertical * high);
      const struck = rayBox(eye, direction, box, range), front = Math.min(struck, length + AROUND);
      if (single && struck < Infinity) continue; // stopped by the enemy
      for (const way of ways) {
        const at = rayBox(eye, direction, way, range);
        if (at > front && at < Infinity && !sim.raiderSolids().some(solid => rayBox(eye, direction, solid, at) < at - 1e-6)) return true;
      }
    }
    return false;
  }
  function driftsIntoPlanks(eye, player, weapon, length) {
    const ways = doorways();
    if (!ways.length) return false;
    const spread = weapon.spread ?? 0, range = weapon.range ?? SIGHT;
    // The centre and two outer heights can straddle a surviving upper plank:
    // an intermediate pellet still hits it. Use the same fine cone sampling
    // as for visible planks in front, independently of the random shot draw.
    for (const [horizontal, vertical] of pelletPattern(spread, (weapon.pellets ?? 1) > 1)) {
      const direction = ray(player.yaw + horizontal * spread, player.pitch + vertical * spread);
      for (const way of ways) {
        const at = rayBox(eye, direction, way, range);
        if (at > length + AROUND && at < Infinity && !sim.raiderSolids().some(solid => rayBox(eye, direction, solid, at) < at - 1e-6)) return true;
      }
    }
    return false;
  }
  // Holds its fire to spare our planks behind this enemy (once per glance).
  function spares(player, enemy, weapon) {
    // Judged again as soon as either has moved 20 cm (backing off, a lunge).
    const cell = point => `${Math.round(point.x * 5)},${Math.round(point.z * 5)}`;
    const key = `${enemy.id}:${weapon?.name}:${weapon?.spread}:${cell(player)}:${cell(enemy)}`;
    if (!cover.has(key)) cover.set(key, intoPlanks(eyeOf(player), enemy, aimPoint(enemy), weapon));
    return cover.get(key) && !urgent(enemy);
  }
  // Wider on a fresh target, while being bitten, and with a crowd coming.
  function tremor() {
    const player = sim.players.get(id);
    let crowd = 0;
    for (const zombieId of sight.keys()) {
      const enemy = sim.zombies.get(zombieId);
      if (enemy && player && flat(player, enemy) < aimConfig.crowdWithin) crowd++;
    }
    // How shaky its hands are, fresh target aside: it knows, and spares planks accordingly.
    aim.steady = (sim.time < aim.flinchUntil ? aimConfig.flinch : 1) * (1 + aimConfig.crowd * Math.min(aimConfig.crowdMax, crowd));
    const scale = (sim.time - aim.acquiredAt < .6 ? aimConfig.fresh : 1) * aim.steady;
    const sample = () => (random() + random() + random() - 1.5) * 2; // deviation 1, within ±3
    aim.tremorYaw = sample() * aimConfig.tremorYaw * scale;
    aim.tremorPitch = sample() * aimConfig.tremorPitch * scale;
    aim.tremorAt = sim.time + between(aimConfig.tremorEvery);
  }
  function targetView(player, enemy) {
    if (enemy.id !== aim.targetId) {
      Object.assign(aim, { targetId: enemy.id, acquiredAt: sim.time, reactionUntil: sim.time + between(aimConfig.reaction) });
      tremor();
    } else if (sim.time >= aim.tremorAt) tremor();
    const view = lookAt(eyeOf(player), flamePoint ?? aimPoint(enemy));
    return { yaw: view.yaw + aim.tremorYaw, pitch: view.pitch + aim.tremorPitch };
  }
  function rotate(view, delta) {
    if (!view) { aim.error = Infinity; return; }
    const step = gap => { const rate = clamp(Math.abs(gap) * aimConfig.gain, aimConfig.minRate, aimConfig.maxRate) * delta; return clamp(gap, -rate, rate); };
    aim.yaw = wrap(aim.yaw + step(wrap(view.yaw - aim.yaw)));
    aim.pitch = clamp(aim.pitch + step(view.pitch - aim.pitch), -1.4, 1.4);
    aim.error = Math.max(Math.abs(wrap(view.yaw - aim.yaw)), Math.abs(view.pitch - aim.pitch));
  }
  // Like a person, it never shoots through a teammate standing (or lying)
  // within `radius` of the line. Friendly fire off, that is courtesy — rounds
  // pass through bodies harmlessly; on, it is survival, and fire() adds the
  // friendly() guards below on top: piercing lines watched past the target,
  // and no swing, flame cone or blast that could reach the team.
  // `rise` (friendly fire: the weapon's spread) widens the height window as
  // the radius widens sideways: a line just over a head still has pellets
  // under it.
  function teammateInLine(eye, point, radius, except = null, rise = 0) {
    const dx = point.x - eye.x, dz = point.z - eye.z, length = dx * dx + dz * dz;
    if (length < 1e-9) return false;
    const reach = rise * Math.hypot(dx, point.y - eye.y, dz);
    for (const other of sim.players.values()) {
      if (other.id === id || other.id === except || !other.alive || other.waiting) continue;
      const along = ((other.x - eye.x) * dx + (other.z - eye.z) * dz) / length, y = eye.y + (point.y - eye.y) * along, slack = reach * along;
      if (along > 0 && along < 1 && Math.hypot(eye.x + dx * along - other.x, eye.z + dz * along - other.z) < radius
        && y > other.y - .1 - slack && y < other.y + (other.downed ? .6 : 1.85) + slack) return true;
    }
    return false;
  }
  // Friendly fire (the room's setting): bullets pierce bodies into whoever
  // stands behind, and blades, flames and blasts hurt the team. Every trigger
  // pull goes through these guards; off, not a single check is added.
  const friendly = () => sim.friendlyFireOn?.() === true;
  // A teammate friendly fire can hurt: standing and in play (a downed or
  // waiting one is never hit, so it never blocks a shot either).
  const exposed = other => other.id !== id && other.alive && !other.downed && !other.waiting;
  // How far a teammate's body may rise or sink before a round fired this tick
  // reaches him: a stair tread (the authority's 0.24 m step) or a jump's first
  // tick (JUMP_SPEED 5.6 m/s gives 0.18 m) on the ground; in the air, one tick
  // of his vertical speed and gravity. 3 cm of margin either way.
  function heightRoom(other) {
    const step = STEP_RISE + .03;
    if (other.grounded !== false) return { up: step, down: step };
    const vy = other.vy ?? 0;
    return { up: Math.max(step, Math.max(0, vy) * TICK + .03), down: Math.max(step, (Math.max(0, -vy) + 18 * TICK) * TICK + .03) };
  }
  // A standing teammate near the ray, between `from` and `to` metres along it
  // (the height window widened by `rise` per metre, as in teammateInLine).
  function teammatePast(eye, aimed, from, to, radius, rise = 0) {
    for (const other of sim.players.values()) {
      if (!exposed(other)) continue;
      const along = (other.x - eye.x) * aimed.x + (other.z - eye.z) * aimed.z;
      if (along <= from || along >= to) continue;
      const y = eye.y + aimed.y * along, slack = rise * along, { up, down } = heightRoom(other);
      if (y <= other.y - down - slack || y >= other.y + 1.75 + up + slack) continue;
      if (Math.hypot(eye.x + aimed.x * along - other.x, eye.z + aimed.z * along - other.z) < radius) return true;
    }
    return false;
  }
  // Every direction a round of this aim may take (pelletPattern over its
  // spread, as the authority draws it), against each standing teammate's
  // box: none may meet one in sight. This catches what the corridor above
  // cannot see: a body overlapping the shooter's own (bodies pass through
  // one another; the round starts inside it), or beside and just behind the
  // eye. The round flies on the tick it is fired, after sim.tick has moved
  // the players: by then a crouched teammate may have stood up, and any may
  // have taken a stride at his top speed (his gun's weight, his sheet's
  // bonus), stepped up a tread or left the ground on a jump. So each box is
  // taken standing, grown sideways by that stride and 3 cm (never less than
  // FF_ROOM), and in height by one tick's rise and fall (see heightRoom).
  function pelletsClear(player, eye, weapon) {
    const spread = weapon.spread ?? 0, range = weapon.range ?? SIGHT;
    const boxes = [...sim.players.values()].filter(exposed).map(other => {
      const box = playerHitbox({ ...other, crouched: false });
      const room = Math.max(FF_ROOM, SPRINT * (sim.playerMovementMultiplier?.(other) ?? 1) * TICK + .03);
      const { up, down } = heightRoom(other);
      return { minX: box.minX - room, maxX: box.maxX + room, minY: box.minY - down, maxY: box.maxY + up, minZ: box.minZ - room, maxZ: box.maxZ + room };
    });
    if (!boxes.length) return true;
    for (const [horizontal, vertical] of pelletPattern(spread, (weapon.pellets ?? 1) > 1)) {
      const direction = ray(player.yaw + horizontal * spread, player.pitch + vertical * spread);
      for (const box of boxes) {
        const at = rayBox(eye, direction, box, range);
        if (at === Infinity) continue;
        if (at < 1e-6 || sim.raiderLineClear(eye, { x: eye.x + direction.x * at, y: eye.y + direction.y * at, z: eye.z + direction.z * at })) return false;
      }
    }
    return true;
  }
  // A round that pierces, or misses, keeps flying past its target: watch the
  // line on to the first solid or intact board, or the weapon's range, the
  // clearance growing with the spread (taken at the far end, a little wide of
  // the near part). A pistol's miss would wound a teammate behind too.
  function pierceClear(eye, aimed, weapon, length) {
    const range = weapon.range ?? SIGHT;
    let stop = range;
    for (const solid of sim.raiderSolids()) stop = Math.min(stop, rayBox(eye, aimed, solid, range));
    for (const hit of sim.raiderBoardHits(eye, aimed, stop)) stop = Math.min(stop, hit.hitAt);
    if (stop <= length + 1e-6) return true;
    return !teammatePast(eye, aimed, length, stop, CLEARANCE + FF_ROOM + (weapon.spread ?? 0) * stop, weapon.spread ?? 0);
  }
  // A swing is a cone, never a line: refuse to start one with a teammate in
  // the attack it will use, reach and arc a little widened for the windup.
  function swingClear(player, eye, weapon) {
    const attack = weapon.attacks?.light;
    if (!attack) return true;
    const wide = { ...attack, range: attack.range + .3, coneAngle: attack.coneAngle + .2 };
    const mates = [...sim.players.values()].filter(exposed);
    return !mates.length || !meleeTargets(eye, ray(player.yaw, player.pitch), wide, [],
      (from, point) => sim.grenadeBlastVisible(from, point), mates).length;
  }
  // Flames are a cone too: never light them with a teammate the jet reaches
  // (the authority's own cone, shootFlame's flameReach: any point of the
  // body in sight, a head over a low wall too), nor with one in reach of a
  // slightly wider jet, near enough the aim, in sight at the feet, the middle,
  // the chest or the head.
  function flameClear(player, eye, weapon) {
    const cosine = Math.cos((weapon.coneAngle ?? FLAMETHROWER.coneAngle) / 2 + .1), range = (weapon.range ?? FLAMETHROWER.range) + .5;
    const aimed = ray(player.yaw, player.pitch);
    for (const other of sim.players.values()) {
      if (!exposed(other)) continue;
      const box = playerHitbox(other);
      if (sim.flameReach(eye, aimed, box, other)) return false;
      for (const y of [box.minY + .05, (box.minY + box.maxY) / 2, other.y + 1.1, box.maxY - .05]) {
        const point = { x: other.x, y, z: other.z };
        const vector = { x: point.x - eye.x, y: point.y - eye.y, z: point.z - eye.z }, gap = Math.hypot(vector.x, vector.y, vector.z);
        if (gap > range || gap < 1e-8) continue;
        if ((vector.x * aimed.x + vector.y * aimed.y + vector.z * aimed.z) / gap < cosine) continue;
        if (sim.grenadeBlastVisible(eye, point)) return false;
      }
    }
    return true;
  }
  // A rocket bursts on the first solid, teammate or zombie on its line
  // (shootRocket: any zombie, not only the target; and nothing at the aimed
  // point itself, so a hand off the mark flies on past it), and the blast
  // hurts every standing survivor within radiusDamage, the shooter included.
  // Judged there, on the real aim, and as before at the aimed point or the
  // solid or teammate in front of it: both must be clear.
  function blastClear(player, eye, aimed, weapon, length) {
    const range = weapon.range ?? SIGHT;
    const solid = sim.grenadeCollision(eye, { x: aimed.x * range, y: aimed.y * range, z: aimed.z * range }, 0);
    let flight = solid ? Math.max(0, solid.fraction * range - 1e-4) : range;
    for (const other of sim.players.values()) {
      if (!exposed(other)) continue;
      const at = rayBox(eye, aimed, playerHitbox(other), range);
      if (at < flight) flight = at;
    }
    const stop = Math.min(length, flight);
    let burst = flight;
    for (const zombie of sim.zombies.values()) {
      const at = rayBox(eye, aimed, enemyHitbox(zombie), range);
      if (at < burst) burst = Math.max(0, at - 1e-4);
    }
    const radius = (weapon.radiusDamage ?? ROCKET.radiusDamage) + .5;
    // Nothing met within range: the rocket never bursts.
    for (const distance of burst !== stop && burst < range ? [stop, burst] : [stop]) {
      const impact = { x: eye.x + aimed.x * distance, y: eye.y + aimed.y * distance, z: eye.z + aimed.z * distance };
      if (Math.hypot(player.x - impact.x, player.y + .9 - impact.y, player.z - impact.z) < radius) return false;
      for (const other of sim.players.values()) {
        if (!exposed(other)) continue;
        if (Math.hypot(other.x - impact.x, other.y + .9 - impact.y, other.z - impact.z) < radius) return false;
      }
    }
    return true;
  }
  function friendlyClear(player, eye, aimed, weapon, length) {
    if (weapon.melee) return swingClear(player, eye, weapon);
    if (weapon.fuel) return flameClear(player, eye, weapon);
    if (weapon.explosive) return blastClear(player, eye, aimed, weapon, length);
    return pierceClear(eye, aimed, weapon, length) && pelletsClear(player, eye, weapon);
  }
  // Planks in front are in plain sight: no pellet direction of the aim it
  // holds may meet one before or round the target (shooting through the gaps,
  // or at an enemy in the doorway itself).
  function frontClear(player, eye, enemy, weapon, length) {
    const spread = weapon.spread ?? 0, box = enemyHitbox(enemy), range = weapon.range ?? SIGHT;
    for (const [horizontal, vertical] of pelletPattern(spread, (weapon.pellets ?? 1) > 1)) {
      const direction = ray(player.yaw + horizontal * spread, player.pitch + vertical * spread);
      if (sim.raiderBoardHits(eye, direction, Math.min(range, length + AROUND, rayBox(eye, direction, box, range))).length) return false;
    }
    return true;
  }
  function fire(player, enemy, weapon, stock, hand = 'primary') {
    const state = sim.weaponHandState?.(player, hand) ?? (hand === 'primary' ? player : null);
    const next = hand === 'secondary' ? 'secondaryNextShotAt' : 'nextShotAt';
    if (!state || !weapon || !stock || sim.time < aim.reactionUntil || sim.time < aim[next] || state.reloadUntil > sim.time) return;
    // Settled on the mark, or hurried when the enemy is in its face.
    if (aim.error > (flat(player, enemy) < aimConfig.close ? aimConfig.hurried : aimConfig.settle)) return;
    const eye = eyeOf(player), point = weapon.fuel && flamePoint || aimPoint(enemy), length = Math.hypot(point.x - eye.x, point.y - eye.y, point.z - eye.z);
    if (weapon.melee ? flat(player, enemy) > reach(weapon) || Math.abs(point.y - eye.y) > 1.6 : !(stock.ammo > 0) || length > reach(weapon)) return;
    // Its own trembling aim must see the way too (never into a stair or a
    // wall in front) and pass clear of teammates.
    const aimed = ray(player.yaw, player.pitch), along = distance => ({ x: eye.x + aimed.x * distance, y: eye.y + aimed.y * distance, z: eye.z + aimed.z * distance });
    const lineClear = target => weapon.fuel ? sim.grenadeBlastVisible(eye, target) : sim.raiderLineClear(eye, target);
    if (!lineClear(point) || !lineClear(along(Math.max(0, length - .35)))
      || teammateInLine(eye, along(length), CLEARANCE + (friendly() ? FF_ROOM : 0) + (weapon.spread ?? 0) * length, null, friendly() ? weapon.spread ?? 0 : 0)
      || (friendly() && !friendlyClear(player, eye, aimed, weapon, length))
      || (!weapon.melee && !weapon.fuel && !frontClear(player, eye, enemy, weapon, length)) || spares(player, enemy, weapon)) return;
    // Where the gun really points, with its spread: when a shaky hand drifts
    // toward one of our barricades beyond the target, wait for it to settle.
    // Judged on the direction, never on whether this round would hit.
    if (!weapon.melee && !weapon.fuel && !urgent(enemy) && driftsIntoPlanks(eye, player, weapon, length)) return;
    // A scattergun past 6 m wastes shells, and its pellets fan out far enough
    // to find a barricade beyond the target.
    if ((weapon.pellets ?? 1) > 1 && length > 6 && !urgent(enemy)) return;
    fold(player);
    if (!sim.shoot(id, 0, undefined, hand)) return;
    const automatic = !weapon.melee && weapon.interval < .2;
    aim[next] = automatic ? sim.time : sim.time + weapon.interval + between(aimConfig.pause);
    if (!automatic) tremor();
  }
  // The umbrella: open in the rain (judged a step ahead, so no drop falls on
  // it first), folded under a roof, and folded only for the shot itself (an
  // aim can be taken under it): kept folded a moment after one in the rain.
  function fold(player) {
    if (player.umbrella?.open) sim.setUmbrella(id, false);
    if (sim.rainExposed?.(player)) folded = sim.time + 1.2;
  }
  function shelter(player, move) {
    const edge = Math.abs(player.x) > LEVEL.halfWidth - .1 || Math.abs(player.z) > LEVEL.halfDepth - .1; // the eaves reach 8.38 and 6.5
    const ahead = move?.dir && (edge || HAS_SPACE) ? { ...player, x: player.x + move.dir.x * .35, z: player.z + move.dir.z * .35 } : player;
    const wet = Boolean(sim.rainExposed?.(player) || sim.rainExposed?.(ahead)), open = player.umbrella?.open === true;
    if (!wet || sim.time < folded) { if (open) sim.setUmbrella(id, false); return; }
    // Asked only when the simulation will say yes (a refusal is an event).
    const busy = player.throwAfter > sim.time || (!player.pendingMelee && Math.max(player.shotAfter ?? 0, player.meleeAfter ?? 0) > sim.time);
    if (!open && player.umbrella?.remaining > 0 && !busy) sim.setUmbrella(id, true);
  }
  function spin(player, target, stock, hand = 'primary') {
    const state = sim.weaponHandState?.(player, hand) ?? player, at = hand === 'secondary' ? 'secondarySpinAt' : 'spinAt';
    if (target && stock.ammo > 0) { fold(player); aim[at] = sim.time; if (!state.minigunSpinning) sim.setMinigunSpin(id, true, hand); }
    else if (state.minigunSpinning && sim.time - aim[at] > 1.5) sim.setMinigunSpin(id, false, hand);
  }

  // ---- Orders. Each one fills this tick's intent or ends the order.
  function execute(player, intent) {
    const time = sim.time, age = time - run.startedAt;
    switch (order.kind) {
      case 'hold':
        intent.engage = { range: HOLD };
        if (!run.anchor && returning) return; // it holds once back inside
        // Caught on the flight, it holds where that flight ends.
        run.anchor ??= floorOf(player) === 'stair' ? flightEnd(player) : { x: player.x, y: player.y, z: player.z };
        // Never in the acid rain: the terrace's hold is under the roof.
        if (!sheltered(run.anchor)) run.anchor = freeSpot(player, TERRACE_PASSAGE, sheltered);
        if (crowded(run.anchor)) run.anchor = freeSpot(player, run.anchor);
        if (floorOf(player) === 'stair' || flat(player, run.anchor) > .7 || Math.abs(player.y - run.anchor.y) > 1) intent.goal = run.anchor;
        return;
      case 'loft': {
        if (LOFT_POST_EXTERIOR) {
          // The cellar reserve posts: the first companion on this order takes
          // the interior stair foot, the next one the exterior watch (on the
          // hospital: the main and the service stair feet); see loftRank.
          const rank = loftRank(sim, id);
          if (run.loftRank !== rank) { run.loftRank = rank; run.post = null; }
          if (!run.post || crowded(run.post)) run.post = freeSpot(player, rank === 0 ? LOFT_POST : LOFT_POST_EXTERIOR);
          if (sight.size) run.seenAt = time;
          // Blind too long while enemies remain inside: climb and hold the
          // stair head for a look and a few shots (zombies jam at its cheek
          // corners), then back to the post; not again for another 15 s.
          const inside = [...sim.zombies.values()].some(enemy => enemy.hp > 0 && !outside(enemy));
          if (!inside) run.peekUntil = 0;
          if (LOFT_PEEK && rank === 0 && inside && time - (run.seenAt ?? run.startedAt) > LOFT_PEEK_AFTER && time >= (run.peekedAt ?? 0)) {
            run.peekUntil = time + 6; run.peekedAt = time + 6 + LOFT_PEEK_AFTER;
          }
          Object.assign(intent, { goal: (run.peekUntil ?? 0) > time ? LOFT_PEEK : run.post, arrive: .35, face: rank === 0 ? LOFT_WATCH : LOFT_WATCH_EXTERIOR, engage: { range: HOLD } });
          return;
        }
        if (!run.post || crowded(run.post)) run.post = freeSpot(player, LOFT_POST);
        Object.assign(intent, { goal: run.post, arrive: .35, face: LOFT_WATCH, engage: { range: HOLD } });
        return;
      }
      case 'defend': {
        const door = doorOf(order.doorId);
        if (!door || door.sealed) return finish('failed');
        if (run.post && crowded(run.post)) run.post = null; // a teammate took it
        // Hospital: the north door's vestibule kick panels take every spot
        // 2.5-3 m inside it; the next rows (3.5-4 m) stand behind them and still
        // see the threshold through the 2.6 m opening. Tried only after the
        // usual rows, so the other doors keep their posts.
        run.post ??= post(player, door, IS_HOSPITAL ? [2.75, 2.5, 3, 3.5, 4] : [2.75, 2.5, 3], [1.7, 1.9, 1.5, 2.2], true);
        if (!run.post) return finish('failed');
        Object.assign(intent, { goal: run.post, arrive: .35, face: { x: door.x - door.outX * .3, y: 1.5, z: door.z - door.outZ * .3 },
          engage: { range: HOLD, near: door, nearRadius: 5 } });
        return;
      }
      case 'repair': {
        const door = doorOf(order.doorId);
        if (!door || door.sealed || door.sealPending) return finish('failed');
        if (door.hp >= door.maxHp) return finish('done');
        // The supermarket's east door is mended from the open-air terrace: a
        // stale order with no umbrella left stops before the next second of
        // rain could take the body below the outdoor HP floor, counting a
        // second more for the walk back under the roof (with its sheet's rain
        // multiplier, as rainCost and the authority apply it).
        if (wetApproach(door) && sim.rainExposed(player) && !(player.umbrella?.remaining > 0)
          && player.hp - 2 * RAIN.damagePerSecond * difficultyOf(sim.difficulty).damageTaken * (characterStats(player).rainMultiplier ?? 1) <= OUTDOORS.floor) return finish('failed');
        // New orders may arrive while crossing home. Do not board up our own
        // passage from the outside; step() finishes the return before repair.
        if (returning) return;
        if (run.spot && crowded(run.spot)) run.spot = null;
        run.spot ??= post(player, door, [1.2, 1, 1.5], [.9, .6, 1.2]);
        if (!run.spot) return finish('failed');
        Object.assign(intent, { goal: run.spot, face: { x: door.x, y: 1.1, z: door.z }, engage: { range: REFLEX } });
        if (flat(player, door) >= 2.1 || Math.abs(player.y) > .3) { if (age > limit(player, door, 20, 6)) finish('failed'); return; }
        if (door.hp < (run.lastDoorHp ?? door.hp)) run.repairPressureUntil = time + 2;
        run.lastDoorHp = door.hp;
        // Never boards up the way back in of a teammate standing outside.
        if (time < (run.nextAt ?? 0) || player.interactAfter > time || shutOut(sim, door, id).length) return;
        const pressure = time < (run.repairPressureUntil ?? 0) || [...sight.keys()].some(enemyId => {
          const enemy = sim.zombies.get(enemyId);
          return enemy?.hp > 0 && (flat(player, enemy) < REFLEX || flat(door, enemy) < 2.8);
        });
        // A stale repair order must not spend the team's last safe crate
        // window. Give the brain a new choice; immediate defence stays legal.
        if (!pressure && crateAccessAtDoor(sim, door)?.claimants.some(mate => mate.companion === true)) return finish('failed');
        run.nextAt = time + .56;
        // A refusal that sets the cooldown means the passage was occupied.
        if (!sim.repairDoor(id, door.id) && player.interactAfter > time && (run.blocked = (run.blocked ?? 0) + 1) >= 3) finish('failed');
        return;
      }
      case 'revive': case 'kit': {
        const mate = sim.players.get(order.playerId);
        if (!mate || mate.id === id || !mate.alive || mate.waiting) return finish('failed');
        if (!mate.downed) return finish('done');
        if ((order.kind === 'kit' && player.reviveKit !== true) || outside(mate)) return finish('failed');
        // E and the kit go to the teammate the simulation picks (in reach and
        // in sight, first found): it must be this one before either is used.
        const current = player.reviving && sim.players.get(player.reviving.targetId);
        const helped = sim.canReviveTarget(player, current, REVIVE.reach) ? current : sim.reviveTargetFor(player);
        const ready = helped?.id === mate.id, channel = ready && current === mate, gap = flat(player, mate);
        if (ready) Object.assign(run, { reachAt: time, spot: null });
        else if (time - (run.reachAt ?? run.startedAt) > (run.reachBudget ??= IS_HOSPITAL || IS_FUNFAIR ? Math.max(10, walkSeconds(sim, player, mate) + 4) : HAS_SPACE ? Math.max(10, walk(player, mate) / OUTDOORS.pace + 4) : 10)) return finish('failed');
        // Close, but a wall in between or another teammate down nearer: a spot
        // by this one only (another one if that spot did not do).
        else if (gap < REVIVE.startReach + .3 && Math.abs(player.y - mate.y) < REVIVE.heightReach) {
          if (run.spot && flat(player, run.spot) < .2) { (run.tried ??= []).push(run.spot); run.spot = null; }
          if (!run.spot && time >= (run.spotAt ?? 0)) Object.assign(run, { spot: reviveSpot(player, mate, run.tried), spotAt: time + .5 });
        }
        const goal = channel || (ready && gap < 1.6) ? null : ready || !run.spot ? mate : run.spot;
        Object.assign(intent, { goal, arrive: goal === mate ? 1 : .2, face: { x: mate.x, y: mate.y + .4, z: mate.z }, engage: { range: REFLEX } });
        if (!ready || time < (run.nextAt ?? 0)) return;
        run.nextAt = time + .25;
        if (order.kind === 'kit') { if (sim.useReviveKit(id)) finish(mate.downed ? 'failed' : 'done'); }
        else sim.interact(id, { revive: true });
        return;
      }
      case 'self-kit': case 'wait': return finish('done'); // standing: nothing left to do
      case 'follow': {
        const mate = sim.players.get(order.playerId);
        if (!mate || mate.id === id || !mate.alive || mate.waiting) return finish('failed');
        let spot = outside(mate) ? doorwayInside(mate) : mate;
        intent.engage = { range: HOLD, near: mate, nearRadius: 5 };
        if (!spot) return;
        // A human on the open-air terrace is covered from the roofed passage
        // while it sees them; out of its sight, the bot follows into the rain.
        let cover = null;
        if (!sheltered(spot) && floorOf(mate) !== 'stair') {
          cover = PASSAGE_SPOTS.find(item => !crowded(item) && sim.raiderLineClear({ x: item.x, y: 1.55, z: item.z }, eyeOf(mate))) ?? null;
          if (cover) spot = cover;
        }
        const gap = flat(player, spot);
        const visible = !HAS_SPACE || spot !== mate || sim.raiderLineClear(eyeOf(player), eyeOf(mate));
        run.moving = !visible || Math.abs(player.y - spot.y) > 1.2 || gap > (cover ? .5 : run.moving ? 2.8 : 4) || (floorOf(player) === 'stair' && floorOf(spot) !== 'stair');
        if (run.moving) Object.assign(intent, { goal: spot, arrive: spot === mate && visible ? 2.8 : .4 });
        return;
      }
      case 'collect': {
        const pickup = sim.pickups.get(order.pickupId);
        const take = pickup?.kind === 'bonus' ? who => {
          if (!sim.canCollectPickup(who, pickup)) return 'walk';
          if (who.interactAfter > time) return 'walk';
          return sim.takeBonus(id, pickup.id) ? 'done' : 'failed';
        } : undefined;
        if (run.trip || (pickup && outside(pickup))) return trip(player, intent, pickup ? { point: pickup, gone: false, ...(take ? { take } : {}) } : { gone: true }, age);
        if (!pickup) return finish('done');
        if (age > limit(player, pickup, 12, 4)) return finish('failed');
        if (take && sim.canCollectPickup(player, pickup) && player.interactAfter <= time && sim.takeBonus(id, pickup.id)) return finish('done');
        Object.assign(intent, { goal: pickup, arrive: .15, engage: { range: REFLEX } });
        return;
      }
      case 'claim': {
        const crate = sim.supplyCrate;
        // Spent for it in a break before a crate wave (nextCrateWave): it waits
        // inside at the exit, and goes out as soon as the next wave's crate
        // stands (a new id); the trip's own clock starts then.
        if (!run.trip && !run.wait && crate && (crate.active === false || crate.claimed.has(id)) && nextCrateWave(sim, player)) run.wait = crate.id;
        if (run.wait && crate?.id === run.wait) return awaitCrate(player, intent, crate, age);
        if (run.wait) Object.assign(run, { wait: null, resumedAt: time });
        if (!crate || crate.active === false && !run.trip) return finish('failed');
        // Claimed: over at once — unless the trip that claimed it is still
        // walking the body home (trip() ends it back inside).
        if (crate.claimed.has(id) && !run.trip) return finish('done');
        if (!sim.bonusEligible(player, order.bonus)) return finish('failed');
        // Claimed just as the next wave renewed the crate, a step away on the
        // way back: that one too, rather than walk home past it.
        if (run.trip?.stage === 'back' && run.claimed && run.claimed !== crate.id && crate.active !== false && !crate.claimed.has(id)
          && outside(player) && flat(player, crate) < LATE_SUPPLIES.reach + 1.5) Object.assign(run.trip, { stage: 'fetch', since: time });
        // To the crate and back like any trip outside; the bonus itself is
        // claimed at arm's length (supply.mjs reach and line of sight). Done
        // only with a bonus claimed: a crate gone inactive on the way (the
        // wave 19 renewal) leaves it empty-handed, which is a failure.
        return trip(player, intent, {
          point: crate,
          gone: !sim.supplyCrate || sim.supplyCrate.active === false || sim.supplyCrate.claimed.has(id),
          take(who) {
            if (!sim.supplyCrate || !sim.supplyReach(who, sim.supplyCrate, LATE_SUPPLIES.reach)) return 'walk';
            if (sim.claimSupply(id, order.bonus, sim.supplyCrate.id)) return Boolean(run.claimed = sim.supplyCrate.id);
            return sim.supplyCrate && sim.bonusEligible(who, order.bonus) ? 'walk' : 'failed';
          },
        }, time - (run.resumedAt ?? run.startedAt), result => finish(result === 'done' && !run.claimed ? 'failed' : result));
      }
      case 'supply': {
        const item = LATE_SUPPLIES.items[order.service];
        if (!item || age > limit(player, LATE_SUPPLIES.position, 20, 6)) return finish('failed');
        const post = LATE_SUPPLIES.position;
        const stand = { x: post.x + Math.sin(post.facing ?? 0) * .95, y: post.y, z: post.z + Math.cos(post.facing ?? 0) * .95 };
        if (!run.spot || crowded(run.spot)) run.spot = freeSpot(player, stand, spot => flat(spot, post) < LATE_SUPPLIES.reach - .4);
        Object.assign(intent, { goal: run.spot, arrive: .2, face: { x: post.x, y: post.y + 1.5, z: post.z }, engage: { range: REFLEX } });
        if (flat(player, post) >= LATE_SUPPLIES.reach - .15 || Math.abs(player.y - post.y) >= .7 || player.interactAfter > time) return;
        // Refused here (funds, wave, already bought this wave, the post out of
        // sight): the eyes offer it again only once it makes sense once more.
        return finish(sim.buySupply(id, order.service) ? 'done' : 'failed');
      }
      case 'umbrella': {
        // The generator refills the umbrella to UMBRELLA.max: a human's E
        // there reaches 'repair-umbrella' through expeditionInteraction
        // (interact() would return on the revive shortcut first). Calm only.
        if ((player.umbrella?.remaining ?? UMBRELLA.max) >= UMBRELLA.max - 1e-8) return finish('done');
        if (age > limit(player, GENERATOR, 20, 6) || !calm(sim, player)) return finish('failed');
        if (!run.spot || crowded(run.spot)) {
          const yaw = Math.atan2(player.x - GENERATOR.x, player.z - GENERATOR.z);
          run.spot = freeSpot(player, { x: GENERATOR.x + Math.sin(yaw) * 1.2, y: GENERATOR.y, z: GENERATOR.z + Math.cos(yaw) * 1.2 },
            spot => !inRect(spot, GENERATOR_BOUNDS, .35) && flat(spot, GENERATOR) < GENERATOR.reach - .3);
        }
        Object.assign(intent, { goal: run.spot, arrive: .2, face: { x: GENERATOR.x, y: GENERATOR.y + .8, z: GENERATOR.z }, engage: { range: REFLEX } });
        if (flat(player, GENERATOR) >= GENERATOR.reach - .1 || Math.abs(player.y - GENERATOR.y) >= .8 || player.interactAfter > time) return;
        return finish(sim.expeditionInteraction(id) ? 'done' : 'failed');
      }
      case 'coins': return sweep(player, intent, age);
      case 'buy': {
        const rack = ARMORY.find(item => item.id === order.rackId);
        if (!rack || age > limit(player, rack, 20, 6)) return finish('failed');
        const spot = { x: rack.x + Math.sin(rack.facing ?? 0) * .95, y: rack.y, z: rack.z + Math.cos(rack.facing ?? 0) * .95 };
        if (!run.spot || crowded(run.spot)) run.spot = freeSpot(player, spot, item => flat(item, rack) < ARMORY_REACH - .5);
        Object.assign(intent, { goal: run.spot, arrive: .2, face: { x: rack.x, y: rack.y + 1.5, z: rack.z }, engage: { range: REFLEX } });
        if (flat(player, rack) >= ARMORY_REACH - .15 || Math.abs(player.y - rack.y) >= ARMORY_HEIGHT_REACH - .1 || player.interactAfter > time) return;
        // Still worth it here (arsenal.mjs): the break may have refilled the
        // empty gun it was to replace since the order (review of 13 October).
        const held = activeWeaponId(player), owned = weaponEntries(player).some(item => item.weapon === rack.weapon);
        if (!owned && !worthBuying(sim, player, rack.weapon)) return finish('failed');
        // Every slot full: a purchase replaces the weapon in hand, so it takes
        // out the one it can best spare first (owner, 13 October: Max dropped
        // his shotgun for the SMG and kept the pistol). The switch is at once
        // (no delay before a purchase), only with the rack in sight (the
        // purchase's last check before it answers), and never for a purchase
        // the game would refuse (locked, too dear, dropped this wave, unique,
        // no room for the one it drops): the switch costs the weapon in hand
        // its reload.
        const spare = owned ? null : replaced(sim, player);
        if (spare && spare !== held) {
          if (sim.wave < (rack.unlockWave ?? 0) || player.points < rack.price || player.issuedWeapons?.has(rack.weapon)
            || rack.weapon === 'magnum' && !sim.practice && !sim.magnumAvailable() || !sim.groundWeaponPosition(player, weaponType(spare, weaponStock(player, spare)))) return finish('failed');
          if (!sim.interactionVisible(player, rack, `rack-${rack.id}`) || !sim.chooseWeapon(id, spare)) return;
        }
        if (sim.buyWeapon(id, rack.id)) {
          // Bought: the new weapon in hand (it comes full), unless the one it
          // held is still carried and better for the fight.
          if (!owned && held !== activeWeaponId(player) && Object.hasOwn(player.inventory, held) && fightsBetter(sim, player, held, activeWeaponId(player))) sim.chooseWeapon(id, held);
          return finish('done');
        }
        if (activeWeaponId(player) !== held && Object.hasOwn(player.inventory ?? {}, held)) sim.chooseWeapon(id, held);
        if (player.interactAfter > time) finish('failed'); // refused: locked, unique, dropped this wave, too dear or no room
        return;
      }
      case 'weapon': return finish(sim.chooseWeapon(id, order.weapon) ? 'done' : 'failed');
      case 'dual': return finish(sim.setDualWield?.(id, order.weapon !== 'off', order.weapon === 'off' ? undefined : order.weapon) ? 'done' : 'failed');
      case 'reload': {
        const hands = [sim.weaponHandState?.(player) ?? { weaponId: activeWeaponId(player), reloadUntil: player.reloadUntil },
          player.dualWield && sim.weaponHandState?.(player, 'secondary')].filter(Boolean);
        if (!hands.length || hands.some(hand => !sim.weaponProfile(player, hand.weaponId) || sim.weaponProfile(player, hand.weaponId).melee)) return finish('failed');
        if (hands.some(hand => hand.reloadUntil > time)) { run.reloading = true; return; }
        if (run.reloading || hands.every(hand => weaponStock(player, hand.weaponId)?.ammo >= sim.weaponProfile(player, hand.weaponId).magazine)) return finish('done');
        if (sim.reload(id)) run.reloading = true;
        else finish('failed');
        return;
      }
      case 'shoot': {
        const enemy = sim.zombies.get(order.zombieId);
        if (!enemy || !(enemy.hp > 0)) return finish('done');
        const weapon = sim.weaponProfile(player), range = reach(weapon), eye = eyeOf(player);
        run.anchor ??= { x: player.x, y: player.y, z: player.z };
        run.clearAt ??= time;
        Object.assign(intent, { face: { x: enemy.x, y: (enemy.y ?? 0) + 1.1, z: enemy.z }, watch: true, engage: { only: enemy.id, range } });
        const point = aimPoint(enemy);
        if (sight.has(enemy.id) && Math.hypot(point.x - eye.x, point.y - eye.y, point.z - eye.z) <= range && !teammateInLine(eye, point, BERTH) && !spares(player, enemy, weapon)) {
          run.clearAt = time; run.spot = null;
          return;
        }
        if (time - run.clearAt > 6) return finish('failed');
        // A spot is kept until reached; looked for again from there if the line is still not clear.
        if (time >= (run.spotAt ?? 0) && (!run.spot || flat(player, run.spot) < .3)) Object.assign(run, { spot: clearSpot(player, enemy, [.8, 1.6, 2.4, 3.2, 4.2, 5.2, 6], run.anchor, STEP, weapon), spotAt: time + .6 });
        if (run.spot) Object.assign(intent, { goal: run.spot, arrive: .2 });
        return;
      }
      case 'grenade': {
        const enemy = sim.zombies.get(order.zombieId);
        if (!(player.grenades > 0) || !enemy || !(enemy.hp > 0)) return finish('failed');
        run.since ??= time;
        if (time - run.since > 3) return finish('failed');
        const { center } = grenadePack(sim, enemy);
        // Friendly fire: the blast hurts the team too, thrower included —
        // never aim it within its radius of anyone standing, on any floor.
        if (friendly() && packEndangers(sim, player, center)) return finish('failed');
        const { distance, yaw, pitch } = grenadeAim(player, center);
        if (distance < 2.5 || distance > 13) return finish('failed');
        intent.view = { yaw, pitch };
        const ready = Math.abs(wrap(aim.yaw - yaw)) < .04 && Math.abs(aim.pitch - pitch) < .04 && !(player.throwAfter > time);
        // ... nor let it burst there: the throw the hand holds now (that
        // burst is the thrown grenade's own: liveBursts keeps it).
        const burst = ready && friendly() ? sim.predictGrenade(player) : null;
        if (burst && blastEndangers(sim, player, burst)) return finish('failed');
        if (ready && (fold(player), sim.throwGrenade(id))) { if (burst) foretold(sim, id, burst); finish('done'); }
        return;
      }
      default: finish('failed');
    }
  }

  // Waiting for the next crate on the inside step of the exit wayOut() picks:
  // sheltered, out of the doorway, answering a zombie about to bite. Over
  // (failed) if the way closes, the break ends otherwise (the night lost) or
  // it outlasts CRATE_WAIT.
  function awaitCrate(player, intent, crate, age) {
    const way = wayOut(sim, crate);
    if (!way || !nextCrateWave(sim, player) || !sim.bonusEligible(player, order.bonus) || age > CRATE_WAIT) return finish('failed');
    const door = way.door, inner = { x: door.x - door.outX * 1.4, y: 0, z: door.z - door.outZ * 1.4 };
    if (!run.spot || crowded(run.spot)) run.spot = freeSpot(player, inner, spot => inRect(spot, INSIDE));
    Object.assign(intent, { goal: run.spot, arrive: .3, face: { x: door.x + door.outX, y: 1.4, z: door.z + door.outZ }, engage: { range: REFLEX } });
  }

  // A trip outside (DESIGN, "Trips outside"): to the step inside the doorway
  // wayOut() picks, straight through it, onto the target, and back in by the
  // same doorway (another open one if it closes meanwhile). The target is a
  // pickup (the magnet takes it: { point, gone }) or the supply crate, taken
  // at arm's length by `take` (claimSupply). Stages: door, out, fetch, back.
  // The umbrella is step()'s job. `over` ends it (the order itself, or one
  // leg of a sweep for coins).
  function trip(player, intent, target, age, over = finish) {
    const time = sim.time;
    if (!run.trip) {
      const way = !target.gone && wayOut(sim, target.point);
      if (!way) return over('failed'); // intact boards, sealed, or too far
      run.trip = { doorId: way.door.id, stage: outside(player) ? 'fetch' : 'door', since: time, touched: 0 };
    }
    const state = run.trip, stage = next => Object.assign(state, { stage: next, since: time });
    // Over anywhere but inside: the doorway or the yard is no place to stop.
    const end = result => { if (state.stage !== 'door') stray = true; over(result); };
    let door = doorOf(state.doorId);
    intent.engage = { range: REFLEX };
    if (state.stage === 'door' || state.stage === 'out') {
      if (target.gone) return end('done');
      // Boarded up or sealed before it got out: the trip ends inside.
      if ((!doorwayOpen(sim, door) && !outside(player)) || age > OUTDOORS.giveUp) return end('failed');
    }
    const normal = (player.x - door.x) * door.outX + (player.z - door.z) * door.outZ;
    const tangent = Math.abs((player.x - door.x) * door.outZ - (player.z - door.z) * door.outX);
    const inner = { x: door.x - door.outX * 1.4, y: 0, z: door.z - door.outZ * 1.4 };
    if (state.stage === 'door') {
      if (player.y > .3 || (flat(player, inner) >= .45 && !(normal > -1.4 && tangent < .8))) return void Object.assign(intent, { goal: inner, arrive: .3 });
      stage('out');
    }
    if (state.stage === 'out') {
      if (normal < 1) {
        if (time - state.since > 4) return end('failed'); // the doorway stays blocked
        if (tangent > .9 && !outside(player)) return void stage('door');
        return void Object.assign(intent, { goal: { x: door.x + door.outX * 1.2, y: 0, z: door.z + door.outZ * 1.2, through: true, doorId: door.id }, arrive: .1, out: true });
      }
      stage('fetch');
    }
    if (state.stage === 'fetch') {
      // Gone (a pickup taken by someone else, a crate already claimed): home.
      if (target.gone) return void stage('back');
      // A fetch ordered from outside on the far side may have walked the body
      // in through a doorway (the zombie graph's shortest way): inside, that
      // way out is spent — back to the door stage with a fresh one from where
      // it stands.
      if (!outside(player)) {
        const way = wayOut(sim, target.point);
        if (!way) return end('failed');
        state.doorId = way.door.id;
        return void stage('door');
      }
      // The crate: claimed at arm's length once reached (never stood upon).
      if (target.take) {
        const taken = target.take(player);
        if (taken === 'failed') return end('failed');
        if (taken === 'walk') {
          if (age > OUTDOORS.giveUp) return end('failed');
          return void Object.assign(intent, { goal: target.point, arrive: .15, out: true });
        }
        return void stage('back');
      }
      // A pickup: taken: gone, or stood on for two ticks (collectPickups took what it could).
      state.touched = sim.canCollectPickup(player, target.point) ? state.touched + 1 : 0;
      if (state.touched < 2) {
        if (age > OUTDOORS.giveUp) return end('failed');
        return void Object.assign(intent, { goal: target.point, arrive: .15, out: true });
      }
      stage('back');
    }
    if (outside(player) && !doorwayOpen(sim, door)) {
      door = sim.doors.filter(item => doorwayOpen(sim, item)).sort((a, b) => flat(player, a) - flat(player, b))[0];
      if (!door) return end('failed');
      state.doorId = door.id;
    }
    if (!outside(player) && inRect(player, INSIDE, -.6)) {
      if (sheltered(player)) return end('done');
      return void Object.assign(intent, { goal: dryGoal(player), arrive: .3 }); // in by the terrace: under the roof first
    }
    if (time - state.since > 12) return end('failed');
    Object.assign(intent, { goal: homeward(player, door), arrive: .2, out: true });
  }

  // The coins near it (companions/coins.mjs): the nearest pile, then the next
  // one within a few metres of where it stands; the magnet does the rest. A
  // pile just outside an open doorway is a trip (trip()). Failed as soon as it
  // is no longer calm (an enemy within 8 m, someone down), when keep goes too:
  // the brain is asked again while that enemy is still far, never with one in
  // its face. Otherwise over after COINS.seconds or when no pile is left, once
  // back inside: done if a pile it went for is gone, else failed. A pile a
  // human comes near is left to them; one it gets no closer to for
  // COINS.stuck seconds, or a trip out that fails, is given up (giveUp):
  // never offered again and again.
  function sweep(player, intent, age) {
    const time = sim.time;
    const over = result => {
      if (result === 'done' && !run.gone?.size) result = 'failed';
      // Out on the doorstep: step() walks it back in (stray) before it is done.
      if (result === 'done' && (outside(player) || stray) && age <= COINS.seconds + OUTDOORS.giveUp) { stray = true; return; }
      if (outside(player)) stray = true;
      finish(result);
    };
    const leg = result => {
      if (result === 'failed' && sim.pickups.has(run.pileId)) giveUp(sim, player, run.pileId);
      run.trip = null; run.pileId = null;
      if (result === 'failed') finish('failed');
    };
    if (!calm(sim, player)) return over('failed');
    if (run.pileId && !sim.pickups.has(run.pileId)) (run.gone ??= new Set()).add(run.pileId);
    if (age > COINS.seconds) return over('done');
    let pile = run.pileId ? sim.pickups.get(run.pileId) : null;
    if (run.trip) return trip(player, intent, pile ? { point: pile, gone: false } : { gone: true }, age, leg);
    if (!pile) {
      const next = coinPiles(sim, player, run.swept ? COINS.next : COINS.reach)[0];
      if (!next) return over('done');
      pile = next.pickup; Object.assign(run, { pileId: pile.id, swept: true, best: Infinity, bestAt: time });
    }
    if (outside(pile)) return trip(player, intent, { point: pile, gone: false }, age, leg);
    if (theirs(sim, pile)) { run.pileId = null; return; } // a human came for it
    // Closer by 30 cm at least every COINS.stuck seconds (the magnet counts).
    const gap = walk(player, pile);
    if (gap < run.best - .3) Object.assign(run, { best: gap, bestAt: time });
    else if (time - run.bestAt > COINS.stuck) { giveUp(sim, player, pile.id); run.pileId = null; return; }
    Object.assign(intent, { goal: pile, arrive: .15, engage: { range: REFLEX } });
  }

  // A holding order steps aside (≤ 2 m) to shoot past a teammate in the
  // line, or off the line of our own planks, and stays there while it keeps
  // finding targets. A teammate pinned from his far side (pinnedMate) is
  // worth a longer step round him (≤ 5 m, the open side), whatever the
  // order's anchor; the peek ends by itself once the enemy is gone.
  function peek(player, target, intent, weapon) {
    const time = sim.time;
    if (target && run.peek) run.peek.until = time + 1.5;
    else if (!target && aim.hidden && time >= (run.peekAt ?? 0)) {
      run.peekAt = time + .6;
      const pinned = pinnedMate(player, aim.hidden);
      const spot = pinned
        ? clearSpot(player, aim.hidden, [1.5, 2.5, 3.5, 4.5, 5], player, 5, weapon, true)
        : clearSpot(player, aim.hidden, [.7, 1.4, 2.1], player, 2.2, weapon);
      if (spot) run.peek = { ...spot, until: time + 1.5 };
    }
    if (run.peek && time >= run.peek.until) run.peek = null;
    if (run.peek) Object.assign(intent, { goal: run.peek, arrive: .15 });
  }

  // A teammate within 5 m (same floor) with an enemy at their throat.
  function mateBitten(player) {
    return [...sim.players.values()].some(mate => mate.id !== id && mate.alive && !mate.downed && flat(mate, player) < 5 && Math.abs(mate.y - player.y) < 1.2
      && [...sim.zombies.values()].some(enemy => enemy.hp > 0 && flat(enemy, mate) < GUARD + .5 && Math.abs((enemy.y ?? 0) - mate.y) < 1.2));
  }

  // A standing teammate bitten from his far side: an enemy about to bite him
  // (same floor), masked from this body by his own body alone. A holding
  // order then steps round him for a clear line (peek, further out).
  function pinnedMate(player, enemy) {
    const eye = eyeOf(player), point = aimPoint(enemy);
    if (!teammateInLine(eye, point, BERTH)) return null;
    for (const other of sim.players.values()) {
      if (other.id === id || !other.alive || other.downed || other.waiting) continue;
      if (flat(other, enemy) >= GUARD + .5 || Math.abs(other.y - (enemy.y ?? 0)) >= 1.2) continue;
      if (!teammateInLine(eye, point, BERTH, other.id)) return other;
    }
    return null;
  }

  function downed(player) {
    aim.targetId = null;
    if (order?.kind === 'self-kit' && run.status === 'running' && player.alive && player.reviveKit === true && !player.selfReviveAt && sim.time >= (run.kitAt ?? 0)) {
      run.kitAt = sim.time + .5;
      sim.useReviveKit(id);
    }
    if (player.companion === true) player.collectTargetId = null;
    sim.setInput(id, { forward: 0, strafe: 0, yaw: aim.yaw, pitch: aim.pitch, sprint: false, crouch: false, jump: false });
  }

  function step(delta) {
    const player = sim.players.get(id);
    if (!player || player.waiting) return;
    if (aim.yaw === null) { aim.yaw = Number.isFinite(player.yaw) ? player.yaw : 0; aim.pitch = Number.isFinite(player.pitch) ? player.pitch : 0; }
    if (!player.alive || player.downed) return downed(player);
    const health = player.hp + (player.armor ?? 0);
    if (health < aim.health - 1e-6) { aim.flinchUntil = sim.time + aimConfig.flinchFor; tremor(); wounds.push({ at: sim.time, lost: aim.health - health }); }
    aim.health = health;
    wounds = wounds.filter(wound => sim.time - wound.at <= HURT_WINDOW);
    if (inRect(player, INSIDE, -.6) && sheltered(player)) returning = stray = false;
    else if (outside(player) || stray) returning = true;
    // out: the order itself takes the body through a doorway (a trip outside).
    const intent = { goal: null, arrive: .3, face: null, watch: false, engage: null, out: false };
    if (run?.status === 'running' || returning) glance(player, run?.status === 'running' && order.kind === 'shoot' ? order.zombieId : null);
    if (run?.status === 'running') {
      execute(player, intent);
      if (run.status !== 'running') Object.assign(intent, { engage: null, goal: null, out: false });
    }
    // Idle or between orders on the open-air terrace: under the roof (orders
    // that work out there, a repair, a rescue, a pickup, say, stay put).
    if (!intent.goal && !intent.out && !returning && !(run?.status === 'running' && OUT_IN_THE_RAIN.has(order.kind))) {
      const dry = dryGoal(player);
      if (dry) Object.assign(intent, { goal: dry, arrive: .3, engage: intent.engage ?? { range: REFLEX } });
    }
    if (player.companion === true) player.collectTargetId = order?.kind === 'collect' && run?.status === 'running' ? order.pickupId : null;
    // On its way back in, whatever the order, it still answers a zombie about to bite.
    let back = null;
    if (returning && !intent.out) {
      back = comeBackInside(player);
      Object.assign(intent, { goal: back, arrive: .2, face: null, engage: intent.engage ?? { range: REFLEX } });
    }
    // In the rain under the umbrella, only a zombie about to bite is worth
    // folding it for (a little further while it is folded: no flicker), and
    // only with a gun that can fire. It never stops to fight there: a survivor
    // outruns every zombie, and standing still lets them close in.
    const weapon = sim.weaponProfile(player), stock = weaponStock(player);
    const rainy = player.umbrella?.remaining > 0 && Boolean(sim.rainExposed?.(player));
    // On the open-air terrace an explicit shot or grenade, or a teammate
    // being bitten close by, is worth the umbrella: it folds and fires. Asked
    // only there: the teammate scan is not paid on every tick of every map.
    const pressing = () => !outside(player) && !returning && !run?.trip && (run?.status === 'running' && ['shoot', 'grenade'].includes(order.kind) || mateBitten(player));
    if (intent.engage && rainy && !pressing()) intent.engage = weapon?.melee || stock?.ammo > 0
      ? { ...intent.engage, range: Math.min(intent.engage.range, OUTDOORS.guard + (sim.time < folded ? 1 : 0)) } : null;
    const secondaryState = player.dualWield && sim.weaponHandState?.(player, 'secondary');
    const secondaryStock = secondaryState && weaponStock(player, secondaryState.weaponId);
    const secondaryWeapon = secondaryState && sim.weaponProfile(player, secondaryState.weaponId);
    const engagingWeapon = stock && stock.ammo + stock.reserve <= 0 && secondaryStock && secondaryStock.ammo + secondaryStock.reserve > 0 ? secondaryWeapon : weapon;
    let target = intent.engage ? choose(player, intent.engage, engagingWeapon) : null;
    // Shut out, on the step of that doorway: the plank in the way is shot out
    // with a gun (blades, flames and rockets aside), the way in before any
    // zombie but one about to bite.
    const plank = back?.shut && flat(player, back) < .5 && weapon && !weapon.melee && !weapon.fuel && !weapon.explosive ? plankOf(back.shut) : null;
    if (plank && target && flat(player, target) > SELF_GUARD + .3) target = null;
    if (!target) aim.targetId = null;
    if (plank && !target) intent.view = lookAt(eyeOf(player), plank);
    if (!returning && run?.status === 'running' && PEEKERS.has(order.kind)) peek(player, target, intent, weapon);
    // Last word on movement: step back from a zombie about to bite, and fall
    // back to cover when taking hits; held a moment, then back to the order.
    if (fallback && (sim.time > fallback.until || flat(player, fallback.spot) < .2)) fallback = null;
    // A revive or a kit is finished under fire, unless badly hurt: backing
    // off would restart the 5 s or lose the teammate.
    const helping = ['revive', 'kit'].includes(order?.kind) && player.hp >= 35;
    if (!returning && !intent.out && run?.status === 'running' && order.kind !== 'buy' && !helping) {
      // Keep the step under way (no back-and-forth); a new one once reached.
      const away = fallback ? null : backOff(player, weapon);
      if (away) fallback = { spot: away, until: sim.time + KITE_HOLD };
      else if (!fallback && wounds.reduce((sum, wound) => sum + wound.lost, 0) >= HURT) {
        const shelter = takeCover(player);
        if (shelter) { fallback = { spot: shelter, until: sim.time + COVER_HOLD }; wounds = []; }
      }
      if (fallback) Object.assign(intent, { goal: fallback.spot, arrive: .15 });
    } else if (!helping) fallback = null;
    else fallback = null;
    // A nonmovement order can reload or shoot while the body clears a flight;
    // only an actual rescue channel may deliberately stop on the stairs, and
    // a follower near a teammate who stands on this same flight: it closes up
    // to him there, uncommitted. Sent on to the landing past him, it was out
    // of reach and walked back past him to the other one, landing to landing
    // for as long as he stood (audit, 24 October).
    if (HAS_SPACE && !intent.goal && !helping && floorOf(player) === 'stair') {
      const mate = !nav.spaceFlight && run?.status === 'running' && order.kind === 'follow' ? sim.players.get(order.playerId) : null;
      const beside = mate && mate.id !== id && mate.alive && !mate.waiting
        && spaceFlightAt(mate.x, mate.z, mate.y)?.id === spaceFlightAt(player.x, player.z, player.y)?.id;
      if (beside) Object.assign(intent, { goal: { x: mate.x, y: mate.y, z: mate.z }, arrive: 2.8 });
      else { intent.goal = nav.spaceFlight?.end ?? flightEnd(player); intent.arrive = .2; }
    }
    if (!intent.goal) nav.progress = null;
    const move = keepClear(player, intent.goal ? steer(player, intent.goal, intent.arrive) : null, intent.goal?.through === true);
    let view = null;
    if (intent.view) view = intent.view; // a grenade's throw, a plank to shoot out
    else if (target) view = targetView(player, target);
    else if (intent.face && (!move?.dir || intent.watch)) view = lookAt(eyeOf(player), intent.face);
    else if (move?.dir) view = { yaw: Math.atan2(-move.dir.x, -move.dir.z), pitch: 0 };
    rotate(view, delta);
    const { forward, strafe } = move?.dir ? relative(move.dir, aim.yaw, move.scale) : { forward: 0, strafe: 0 };
    sim.setInput(id, { forward, strafe, yaw: aim.yaw, pitch: aim.pitch, sprint: Boolean(move?.dir && (move.clearing || move.far && !target)), crouch: crouchAtDoor(player, intent.goal), jump: false });
    shelter(player, move);
    if (weapon && stock && player.weapon === 'minigun') spin(player, target ?? plank, stock);
    if (secondaryStock && secondaryState.weapon === 'minigun') spin(player, target, secondaryStock, 'secondary');
    if (target) {
      fire(player, target, weapon, stock);
      if (secondaryStock) fire(player, target, secondaryWeapon, secondaryStock, 'secondary');
    }
    else if (plank && stock?.ammo > 0 && aim.error <= aimConfig.settle && sim.time >= aim.nextShotAt && !(player.reloadUntil > sim.time)) {
      // The plank must go for it to get back in — but with friendly fire,
      // never through a teammate in the doorway or past it (piercing rounds).
      const eye = eyeOf(player), aimed = ray(player.yaw, player.pitch);
      const length = Math.hypot(plank.x - eye.x, plank.y - eye.y, plank.z - eye.z);
      if (!(friendly() && (teammateInLine(eye, plank, CLEARANCE + FF_ROOM + (weapon.spread ?? 0) * length, null, weapon.spread ?? 0)
        || !pierceClear(eye, aimed, weapon, length) || !pelletsClear(player, eye, weapon)))) {
        fold(player);
        if (sim.shoot(id, 0)) aim.nextShotAt = sim.time + weapon.interval + between(aimConfig.pause);
      }
    }
    if (weapon && stock && !weapon.melee && stock.ammo <= 0 && stock.reserve > 0 && !(player.reloadUntil > sim.time)) sim.reload(id, 'primary');
    if (secondaryStock && secondaryStock.ammo <= 0 && secondaryStock.reserve > 0 && !(secondaryState.reloadUntil > sim.time)) sim.reload(id, 'secondary');
  }

  return {
    setProfile(next) {
      aimConfig = configuration(next);
      Object.assign(aim, freshAim());
      order = null; run = null; sight = new Map(); cover = new Map(); glanceAt = 0;
      returning = false; stray = false; folded = -Infinity; fallback = null; wounds = []; flameCache = null; flamePoint = null;
      nav.climb = null; nav.spaceFlight = null;
      resetNav();
    },
    setOrder(next) {
      if (next && order && run?.status === 'running' && typeof next === 'object' && sameOrder(next, order)) return;
      if (run?.trip && run.trip.stage !== 'door') stray = true; // a trip cut short: back inside first
      order = next ?? null;
      fallback = null;
      run = order ? { status: typeof order === 'object' && KINDS.has(order.kind) ? 'running' : 'failed', startedAt: sim.time } : null;
      resetNav();
    },
    get order() { return order; },
    get status() { return report(); },
    tick(delta = TICK) {
      try { step(clamp(Number(delta) || 0, 0, .1)); }
      catch {
        finish('failed');
        try { sim.setInput(id, { forward: 0, strafe: 0, yaw: aim.yaw ?? 0, pitch: aim.pitch ?? 0 }); } catch { /* never throw */ }
      }
      return report();
    },
  };
}
