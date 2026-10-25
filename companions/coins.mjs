import { IS_SUPERMARKET, IS_HOSPITAL, IS_FUNFAIR, HAS_SPACE, LEVEL } from '../public/level-config.js';
import { SPACE, spaceFloor, spaceFlightAt } from '../public/level-space.js';
import { routeLength } from './routes.mjs';
// Coins for the companions (owner, 13 October: "ils ont le droit de ramasser
// de l'argent"): they buy their guns with them. A simple rule, shared by the
// eyes (the 'coins' action) and the body (the sweep): when it is calm, the
// piles near it. Reads the simulation only; remembers the piles a body gave up.
import { LOFT, STAIRS } from '../public/rules.js';
import { outdoors, wayOut, rainCost } from './outdoors.mjs';

// reach: metres walked to the first pile (18 on the supermarket's wider
// floors: a terrace pile past the garden partition is a 16 m walk); next: to
// each further one, from where the body stands; doorstep: how far outside an
// open doorway a pile may lie; calm: no enemy this close to the companion;
// clear: nor this close to a pile (zombies outside go for anyone within 5 m);
// human: a pile this close to a standing human is theirs (never race a child
// for it); seconds: a sweep's length; stuck: a pile it gets no closer to for
// this long is given up, and left alone for `forget` seconds.
export const COINS = Object.freeze({ reach: IS_SUPERMARKET ? 18 : 10, next: 5, doorstep: 3, calm: 8, clear: 5, human: 3, seconds: 8, stuck: 3, forget: 60 });

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const STAIR_X = (STAIRS.minX + STAIRS.maxX) / 2;
const LOWER = Object.freeze({ x: STAIR_X, z: STAIRS.maxZ + .5 }), UPPER = Object.freeze({ x: STAIR_X, z: STAIRS.minZ - .5 });
const FLIGHT = Math.hypot(UPPER.z - LOWER.z, LOFT.y);
const onStairs = p => p.x >= STAIRS.minX && p.x <= STAIRS.maxX && p.z >= STAIRS.minZ && p.z <= STAIRS.maxZ;
// A floor a survivor walks on: the ground, the loft or a tread (not a table top).
const floored = p => HAS_SPACE ? Math.abs(spaceFloor(p.x, p.z, (p.y ?? 0) + .35) - (p.y ?? 0)) < .35 : Math.abs(p.y ?? 0) < .35 || Math.abs((p.y ?? 0) - LOFT.y) < .35 || onStairs(p) && p.y > 0;
// Metres walked between two points inside, by the staircase between floors.
// On the supermarket the companion route counts the garden partition's detour
// through its opening (routes.mjs), so budgets and sweep progress are real.
export function walk(a, b) {
  if (HAS_SPACE) return routeLength(a, b);
  if (Math.abs((a.y ?? 0) - (b.y ?? 0)) < 1) return flat(a, b);
  const [low, high] = (a.y ?? 0) < (b.y ?? 0) ? [a, b] : [b, a];
  return flat(low, LOWER) + FLIGHT + flat(UPPER, high);
}

// The hospital's rooms are walled: a pile behind a partition is a walk round
// through a doorway that walk()'s straight metres do not see (7 of 62 such
// piles were never reached, audit of 24 October). There a sweep is priced on
// the shortest path round the walls and stair rails standing at knee height
// on that floor, and the stair wells (ground) or flights (basement): over
// their corners, padded by a body's width, and the doorway centres, the
// corner links built once per floor like the zombies' visibility graph.
// Furniture stays the body's own routing, as on every map.
// Same floor and off the flights only; any other walk keeps walk().
const KNEE = .5, PAD = .4, GRAZE = .1;
const lowerFloor = p => (p.y ?? 0) < -1.7;
const solidsOf = new Map(), cornersOf = new Map();
function solids(cellar) {
  if (!solidsOf.has(cellar)) {
    const knee = (cellar ? SPACE.minY : 0) + KNEE;
    solidsOf.set(cellar, [...SPACE.walls, ...SPACE.rails].filter(box => box.baseY <= knee && box.baseY + box.height >= knee)
      .concat(SPACE.flights.map(flight => cellar ? flight : flight.well)));
  }
  return solidsOf.get(cellar);
}
// The stretch a→b passes within `graze` of the box (x, z)?
function meets(a, b, box, graze) {
  let low = 0, high = 1;
  for (const [from, to, min, max] of [[a.x, b.x, box.minX - graze, box.maxX + graze], [a.z, b.z, box.minZ - graze, box.maxZ + graze]]) {
    const span = to - from;
    if (Math.abs(span) < 1e-9) { if (from < min || from > max) return false; continue; }
    const first = (min - from) / span, second = (max - from) / span;
    low = Math.max(low, Math.min(first, second)); high = Math.min(high, Math.max(first, second));
    if (low > high) return false;
  }
  return true;
}
// No solid across a→b (GRAZE clear of it, unless an end stands that close).
const hugs = (p, box) => p.x >= box.minX - GRAZE && p.x <= box.maxX + GRAZE && p.z >= box.minZ - GRAZE && p.z <= box.maxZ + GRAZE;
const open = (cellar, a, b) => !solids(cellar).some(box => meets(a, b, box, hugs(a, box) || hugs(b, box) ? 0 : GRAZE));
function corners(cellar) {
  if (cornersOf.has(cellar)) return cornersOf.get(cellar);
  const boxes = solids(cellar), bounds = LEVEL.companionBounds;
  const padded = (p, box) => p.x > box.minX - PAD + 1e-6 && p.x < box.maxX + PAD - 1e-6 && p.z > box.minZ - PAD + 1e-6 && p.z < box.maxZ + PAD - 1e-6;
  const points = [
    ...boxes.flatMap(box => [[box.minX - PAD, box.minZ - PAD], [box.maxX + PAD, box.minZ - PAD], [box.minX - PAD, box.maxZ + PAD], [box.maxX + PAD, box.maxZ + PAD]])
      .map(([x, z]) => ({ x, z })).filter(p => p.x > bounds.minX && p.x < bounds.maxX && p.z > bounds.minZ && p.z < bounds.maxZ && !boxes.some(box => padded(p, box))),
    ...SPACE.rooms.filter(room => (room.floor === 'cellar') === cellar).flatMap(room => room.doors.map(door => ({ x: door.x, z: door.z }))),
  ];
  const links = points.map(() => points.map(() => Infinity));
  for (let from = 0; from < points.length; from++) for (let to = from + 1; to < points.length; to++) {
    if (open(cellar, points[from], points[to])) links[from][to] = links[to][from] = flat(points[from], points[to]);
  }
  const graph = { points, links };
  cornersOf.set(cellar, graph);
  return graph;
}
// Metres from `from` to every corner round the walls (one Dijkstra), kept
// for the last spot asked: the eyes ask twice a turn, the body once per pile.
let last = null;
function fromSpot(from, cellar) {
  if (last?.cellar === cellar && last.x === from.x && last.z === from.z) return last.cost;
  const { points, links } = corners(cellar);
  const cost = points.map(point => open(cellar, from, point) ? flat(from, point) : Infinity), done = points.map(() => false);
  for (;;) {
    let next = -1;
    for (let index = 0; index < points.length; index++) if (!done[index] && cost[index] < Infinity && (next < 0 || cost[index] < cost[next])) next = index;
    if (next < 0) break;
    done[next] = true;
    for (let index = 0; index < points.length; index++) if (!done[index] && cost[next] + links[next][index] < cost[index]) cost[index] = cost[next] + links[next][index];
  }
  last = { cellar, x: from.x, z: from.z, cost };
  return cost;
}
// The shortest a→corner→b, trying the corners in order of that total: the
// first one with a clear last stretch to b.
function roundWalls(a, b, cellar) {
  const { points } = corners(cellar), cost = fromSpot(a, cellar);
  const order = points.map((point, index) => ({ point, total: cost[index] + flat(point, b) })).filter(item => item.total < Infinity).sort((p, q) => p.total - q.total);
  return order.find(item => open(cellar, item.point, b))?.total ?? Infinity;
}
// Metres a sweep walks inside: walk(), round the walls on the hospital and
// funfair (only for a walk within `reach`: round the walls is never shorter).
function sweepWalk(a, b, reach) {
  const straight = walk(a, b), cellar = lowerFloor(a);
  if (!(IS_HOSPITAL || IS_FUNFAIR) || straight > reach || cellar !== lowerFloor(b) || spaceFlightAt(a.x, a.z, a.y ?? 0) || spaceFlightAt(b.x, b.z, b.y ?? 0) || open(cellar, a, b)) return straight;
  return roundWalls(a, b, cellar);
}

// Calm (the shop's calm moment too): no living enemy within COINS.calm of
// the companion, nobody down.
export function calm(sim, player) {
  return ![...sim.zombies.values()].some(zombie => zombie.hp > 0 && flat(zombie, player) <= COINS.calm)
    && ![...sim.players.values()].some(other => other.alive && other.downed && !other.waiting);
}

// Piles a sweep could not reach (under the low end of the flight, behind
// something), per companion: the body gives them up, and neither it nor the
// eyes offer them again for COINS.forget seconds.
const missed = new WeakMap();
export function giveUp(sim, player, pickupId) {
  const piles = missed.get(player) ?? new Map();
  for (const [id, until] of piles) if (until <= sim.time) piles.delete(id);
  missed.set(player, piles.set(pickupId, sim.time + COINS.forget));
}
const givenUp = (sim, player, pickup) => (missed.get(player)?.get(pickup.id) ?? -Infinity) > sim.time;
const near = (others, pickup, within) => others.some(other => flat(other, pickup) <= within && Math.abs((other.y ?? 0) - (pickup.y ?? 0)) < 2);
// A standing human within COINS.human: the pile is theirs.
export const theirs = (sim, pickup) => near([...sim.players.values()].filter(other => other.companion !== true && other.alive && !other.downed && !other.waiting), pickup, COINS.human);

// The coin piles this companion could sweep now, nearest first: inside, on a
// floor it walks, or within COINS.doorstep outside an open doorway with an
// umbrella that lasts the trip (wayOut, rainCost); within `reach` metres
// walked, no enemy within COINS.clear of it, no standing human within
// COINS.human, never a gift (it is meant for someone: the magnet still gives
// it to whoever stands nearest, so a human pays a companion by dropping coins
// at its feet), nor a pile it gave up. On the hospital the metres go round
// its walls (sweepWalk): a pile behind a partition counts its walk round
// through a doorway, and one that walk takes out of reach is not offered.
// → [{ pickup, distance, door }] (door: the way out to one outside, else null)
export function coinPiles(sim, player, reach = COINS.reach) {
  const enemies = [...sim.zombies.values()].filter(zombie => zombie.hp > 0);
  const piles = [];
  for (const pickup of sim.pickups.values()) {
    if (pickup.kind !== 'points' || pickup.droppedBy != null || !((pickup.expiresAt ?? Infinity) > sim.time + 1) || givenUp(sim, player, pickup)) continue;
    if (near(enemies, pickup, COINS.clear) || theirs(sim, pickup)) continue;
    let distance, door = null;
    if (!outdoors(pickup)) {
      if (!floored(pickup)) continue;
      distance = sweepWalk(player, pickup, reach);
    } else {
      const way = wayOut(sim, pickup);
      if (!way || flat(pickup, way.door) > COINS.doorstep || rainCost(sim, player, way.distance, way).burn > 0) continue;
      door = way.door;
      const step = { x: door.x - door.outX * 1.4, y: 0, z: door.z - door.outZ * 1.4 };
      distance = (outdoors(player) ? flat(player, step) : sweepWalk(player, step, reach)) + flat(step, pickup);
    }
    if (distance <= reach) piles.push({ pickup, distance, door });
  }
  return piles.sort((a, b) => a.distance - b.distance || (a.pickup.id < b.pickup.id ? -1 : a.pickup.id > b.pickup.id ? 1 : 0));
}

// The sweep the brain may order: calm, and at least one pile (or null).
export function coinSweep(sim, player) {
  if (!player?.alive || player.downed || player.waiting || !calm(sim, player)) return null;
  const piles = coinPiles(sim, player);
  return piles.length ? { piles, amount: piles.reduce((sum, item) => sum + item.pickup.amount, 0), farthest: piles.at(-1).distance } : null;
}
