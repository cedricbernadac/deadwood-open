import { LEVEL, IS_SUPERMARKET, HAS_SPACE } from '../public/level-config.js';
// Trips outside (owner, 13 October: "il ne faut pas leur interdire d'aller
// dehors"). A companion may step out through a broken door for an ammo box or
// a medkit it needs, and come straight back. Shared by the eyes (what the
// brain is offered) and the body (which doorway it takes). Reads only.
import { PLAYER_POSTURE, RAIN, difficultyOf } from '../public/rules.js';
import { characterStats } from '../public/character-bonuses.js';
import { SPACE, spaceInRect, spaceRainShelter } from '../public/level-space.js';

// reach: walking metres from the doorway; pace: m/s behind the promised rain
// seconds (a walk; the body sprints long stretches); spare: umbrella seconds
// kept in hand; floor: HP the rain must leave; guard: a zombie this close is
// shot with the umbrella folded; giveUp: seconds to reach the pickup.
export const OUTDOORS = Object.freeze({ reach: 14, pace: 3.5, spare: 3, floor: 20, guard: 3, giveUp: 15 });
// The cabin and its eaves, as the walk outside goes round them.
const CABIN = Object.freeze({ minX: -LEVEL.halfWidth - .6, maxX: LEVEL.halfWidth + .6, minZ: -LEVEL.halfDepth - .6, maxZ: LEVEL.halfDepth + .6 });
const CORNERS = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => Object.freeze({ x: x * (CABIN.maxX + .2), z: z * (CABIN.maxZ + .2) }));
// Multi-floor parking props, padded with a body's clearance, as the walk
// outside goes round them too.
const PROPS = HAS_SPACE ? SPACE.props.map(prop => Object.freeze({ minX: prop.minX - .55, maxX: prop.maxX + .55, minZ: prop.minZ - .55, maxZ: prop.maxZ + .55 })) : [];

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const outdoors = point => Math.abs(point.x) > LEVEL.halfWidth || Math.abs(point.z) > LEVEL.halfDepth;
// The supermarket's open-air terrace and exterior stairs lie inside the walls
// but under the acid rain: only the roof is shelter. The roofed passage
// through the terrace partition is the dry place that watches the east door,
// which opens from that terrace (about 6 m away).
export const sheltered = point => !IS_SUPERMARKET || spaceRainShelter({ x: point.x, y: point.y ?? 0, z: point.z }, PLAYER_POSTURE.standingHeight);
export const TERRACE_PASSAGE = IS_SUPERMARKET ? Object.freeze({ x: 7.4, y: 0, z: 0 }) : null;
// Metres of open-air terrace between this door and the roof's edge, each way.
export const wetApproach = door => IS_SUPERMARKET && door && !sheltered({ x: door.x - door.outX * 1.4, y: 0, z: door.z - door.outZ * 1.4 }) ? flat(door, TERRACE_PASSAGE) : 0;
// Metres straight out of this doorway that stay under a canopy slab (the
// hospital's entrance canopy over the north door, 2.75 m, and the
// ambulance-bay canopy over the west door, 2.8 m): dry on a trip out. 0 on
// every other door, and on the cabin and the supermarket (no canopy).
const CANOPIES = HAS_SPACE ? SPACE.shelters.filter(shelter => /canopy/.test(shelter.id)) : [];
export function canopyMetres(door) {
  let dry = 0;
  if (!door) return dry;
  for (const canopy of CANOPIES) {
    const out = door.outZ || door.outX, at = door.outZ ? door.z : door.x;
    if (!out || !(door.outZ ? door.x >= canopy.minX && door.x <= canopy.maxX : door.z >= canopy.minZ && door.z <= canopy.maxZ)) continue;
    const [low, high] = door.outZ ? [canopy.minZ, canopy.maxZ] : [canopy.minX, canopy.maxX];
    const near = Math.min((low - at) / out, (high - at) / out), far = Math.max((low - at) / out, (high - at) / out);
    // From the doorway itself (the wall's thickness aside) out to its edge.
    if (near <= .5 && far > 0) dry = Math.max(dry, far);
  }
  return dry;
}
// Roofs standing on their own outside, high enough for a standing body (the
// hospital car park's bus shelter): the metres a trip walks under one are
// dry. The door canopies are canopyMetres'; the floor slabs and the
// building's roof are not outdoors. None on the cabin and the supermarket.
const OPEN_SHELTERS = HAS_SPACE ? SPACE.shelters.filter(shelter => !/canopy/.test(shelter.id) && shelter.minY >= PLAYER_POSTURE.standingHeight
  && (shelter.minX >= LEVEL.halfWidth || shelter.maxX <= -LEVEL.halfWidth || shelter.minZ >= LEVEL.halfDepth || shelter.maxZ <= -LEVEL.halfDepth)) : [];
// Metres of the straight leg a-b under one of them.
export function shelterMetres(a, b) {
  if (!OPEN_SHELTERS.length) return 0;
  let dry = 0;
  for (const shelter of OPEN_SHELTERS) {
    let low = 0, high = 1;
    for (const [axis, min, max] of [['x', shelter.minX, shelter.maxX], ['z', shelter.minZ, shelter.maxZ]]) {
      const span = b[axis] - a[axis];
      if (Math.abs(span) < 1e-9) { if (a[axis] < min || a[axis] > max) high = 0; continue; }
      const first = (min - a[axis]) / span, second = (max - a[axis]) / span;
      low = Math.max(low, Math.min(first, second)); high = Math.min(high, Math.max(first, second));
    }
    if (high > low) dry += (high - low) * flat(a, b);
  }
  return dry;
}
const underOpenShelter = point => OPEN_SHELTERS.some(shelter => spaceInRect(point.x, point.z, shelter));
// Does the segment a-b cut through the box?
function cuts(a, b, box = CABIN) {
  let near = 0, far = 1;
  for (const [axis, low, high] of [['x', box.minX, box.maxX], ['z', box.minZ, box.maxZ]]) {
    const span = b[axis] - a[axis];
    if (Math.abs(span) < 1e-9) { if (a[axis] <= low || a[axis] >= high) return false; continue; }
    const first = (low - a[axis]) / span, second = (high - a[axis]) / span;
    near = Math.max(near, Math.min(first, second)); far = Math.min(far, Math.max(first, second));
    if (near >= far) return false;
  }
  return true;
}
// A point on the doorstep, between the walls and the edge of that box, is
// walked to from the edge straight out from it.
function rim(point) {
  if (point.x <= CABIN.minX || point.x >= CABIN.maxX || point.z <= CABIN.minZ || point.z >= CABIN.maxZ) return point;
  const faces = [{ x: CABIN.minX, z: point.z }, { x: CABIN.maxX, z: point.z }, { x: point.x, z: CABIN.minZ }, { x: point.x, z: CABIN.maxZ }];
  return faces.sort((a, b) => flat(a, point) - flat(b, point))[0];
}
// Straight metres, or round the nearest prop corner when the line crosses
// one. Beyond the recursion a flat surcharge stays on the safe side.
function around(a, b, depth = 4) {
  const hit = PROPS.find(prop => cuts(a, b, prop));
  if (!hit) return flat(a, b);
  if (depth <= 0) return flat(a, b) * 1.6;
  const corners = [{ x: hit.minX, z: hit.minZ }, { x: hit.maxX, z: hit.minZ }, { x: hit.minX, z: hit.maxZ }, { x: hit.maxX, z: hit.maxZ }];
  return Math.min(...corners.map(corner => around(a, corner, depth - 1) + around(corner, b, depth - 1)));
}
// Metres walked outside from a to b: straight, or round one corner.
function walk(a, b) {
  const edge = rim(b), last = around(edge, b);
  if (!cuts(a, edge)) return around(a, edge) + last;
  return last + Math.min(Infinity, ...CORNERS.filter(corner => !cuts(a, corner) && !cuts(corner, edge)).map(corner => around(a, corner) + around(corner, edge)));
}
// Prefer standing, but a low opening is usable with the same crouched body as
// a human. The simulation remains the authority on the actual rotated planks.
export function doorwayPassage(sim, door) {
  if (!door || door.sealed || door.sealPending) return null;
  if (sim.doorPassable(door, 0, PLAYER_POSTURE.standingHeight)) return { crouch: false, height: PLAYER_POSTURE.standingHeight };
  return sim.doorPassable(door, 0, PLAYER_POSTURE.crouchedHeight)
    ? { crouch: true, height: PLAYER_POSTURE.crouchedHeight } : null;
}
export const doorwayOpen = (sim, door) => Boolean(doorwayPassage(sim, door));
// Survivors standing outside near this open doorway, for whom it is the
// nearest way back in: boarding it up now would shut them out in the rain.
export function shutOut(sim, door, exceptId = null) {
  if (!doorwayOpen(sim, door)) return [];
  const open = sim.doors.filter(item => doorwayOpen(sim, item));
  return [...sim.players.values()].filter(player => player.id !== exceptId && player.alive && !player.downed && !player.waiting && outdoors(player)
    && flat(player, door) <= OUTDOORS.reach + 2 && open.sort((a, b) => flat(player, a) - flat(player, b))[0] === door);
}
// The doorway for a trip to this point on the ground outside: the open one
// with the shortest walk, within reach. → { door, distance, crouch, dry } or
// null. dry: metres of it under an open shelter (shelterMetres) on the
// straight leg from the doorstep, when that leg is the walk or the point
// itself is under the roof (the last metres to it are); 0 when the walk
// bends round a prop to a point in the open.
export function wayOut(sim, point, doors = sim.doors) {
  if (!point || !outdoors(point) || Math.abs(point.y ?? 0) > .35) return null;
  // A point inside a parking prop is never a trip's target.
  if (HAS_SPACE && SPACE.props.some(prop => spaceInRect(point.x, point.z, prop))) return null;
  let best = null;
  for (const door of doors) {
    const passage = doorwayPassage(sim, door);
    if (!passage) continue;
    const step = { x: door.x + door.outX, z: door.z + door.outZ }, walked = walk(step, point), distance = 1 + walked;
    if (distance > OUTDOORS.reach || (best && distance >= best.distance)) continue;
    best = { door, distance, crouch: passage.crouch };
    if (OPEN_SHELTERS.length) best.dry = walked - flat(step, point) < 1e-6 || underOpenShelter(point) ? shelterMetres(step, point) : 0;
  }
  return best;
}
// The round trip's seconds in the rain plus any work there, the umbrella left,
// and the HP the rain would take past it (difficulty included). The metres
// under a door's canopy are dry: a trip that never leaves it costs nothing.
// So are the metres under an open shelter on the way (way.dry, wayOut).
export function rainCost(sim, player, distance, way = null, extraSeconds = 0) {
  const stats = characterStats(player), mobility = sim.playerMovementMultiplier?.(player) ?? stats.speedMultiplier;
  const umbrella = Math.max(0, Math.floor(player.umbrella?.remaining ?? 0)), dry = canopyMetres(way?.door) + (way?.dry ?? 0), wet = Math.max(0, distance - dry);
  if (dry > 0 && wet <= 0) return { seconds: 0, umbrella, burn: 0, affordable: player.hp >= OUTDOORS.floor };
  // Approach and clear the threshold while low, in both directions. Keep the
  // reported walking distance real; only the time/rain estimate grows.
  const crouchExtra = way?.crouch ? 2 * 2.8 / (OUTDOORS.pace * mobility) * (1 / PLAYER_POSTURE.crouchSpeed - 1) : 0;
  const seconds = Math.ceil(2 * ((dry > 0 ? wet : distance) + wetApproach(way?.door)) / (OUTDOORS.pace * mobility) + 1 + crouchExtra + extraSeconds);
  const burn = Math.ceil(Math.max(0, seconds + OUTDOORS.spare - umbrella) * RAIN.damagePerSecond * difficultyOf(sim.difficulty).damageTaken * stats.rainMultiplier);
  return { seconds, umbrella, burn, affordable: player.hp - burn >= OUTDOORS.floor };
}
