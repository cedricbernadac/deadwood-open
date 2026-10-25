import { IS_SUPERMARKET, HAS_SPACE } from '../public/level-config.js';
import { SPACE, spaceFlightAt, spaceFlightHolding } from '../public/level-space.js';
import { PLAYER_POSTURE } from '../public/rules.js';
// Companion routing on the supermarket map (companions/DESIGN.md, lot 2). The
// zombies keep level-space's spaceRoute, which compares straight lines; a
// companion's route crosses the garden partition through its only opening at
// (8, 0) and counts the metres in the acid rain (the open-air terrace and the
// exterior stair) threefold when it chooses a flight. The hospital has no
// partition and no rain indoors: the same stair-aware route between its two
// flights, every leg straight and dry. On the cabin every helper degrades to
// the old straight line.
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const lower = p => (p.y ?? 0) < -1.7;
// The partition's only ground-level gap (its walls stand at x ≈ 8 for
// |z| > 1.6); east of it the terrace and the exterior stair stand in the rain.
const OPENING = Object.freeze({ x: 8, y: 0, z: 0 });
const RAIN = 3;
const FLIGHT_NAME = Object.freeze({ 'stock-stair': 'interior', 'garden-stair': 'exterior', 'main-stair': 'main', 'service-stair': 'service' });
// Ground level inside the building: the only place the partition stands.
const ground = p => !lower(p) && Math.abs(p.x) <= 14 && Math.abs(p.z) <= 11;
// The straight leg a→b meets the partition wall (x = 8 beyond the opening)?
export const crossesPartition = (a, b) => IS_SUPERMARKET && ground(a) && ground(b)
  && (a.x - OPENING.x) * (b.x - OPENING.x) < 0
  && Math.abs(a.z + (b.z - a.z) * (OPENING.x - a.x) / (b.x - a.x)) > 1.6;
// The share of the straight stretch a→b that is dry: under the sales roof or
// under a ground slab (the cellar), with a standing body's head below it —
// the boxes and the test spaceRainShelter (the simulation's rain) uses,
// clipped exactly. Each box keeps one interval of the stretch.
function dryShare(a, b) {
  const spans = [], ay = a.y ?? 0, rise = (b.y ?? 0) - ay;
  for (const shelter of SPACE.shelters) {
    let low = 0, high = 1;
    const room = shelter.minY + 1e-6 - PLAYER_POSTURE.standingHeight - ay;
    if (Math.abs(rise) < 1e-9) { if (room < 0) continue; }
    else if (rise > 0) high = Math.min(1, room / rise);
    else low = Math.max(0, room / rise);
    [low, high] = clip(a.x, b.x, shelter.minX, shelter.maxX, low, high);
    [low, high] = clip(a.z, b.z, shelter.minZ, shelter.maxZ, low, high);
    if (high > low) spans.push([low, high]);
  }
  spans.sort((p, q) => p[0] - q[0]);
  let dry = 0, reached = 0;
  for (const [low, high] of spans) if (high > reached) { dry += high - Math.max(low, reached); reached = high; }
  return dry;
}
// The part of [low, high] where the coordinate going from → to stays within
// [min, max].
function clip(from, to, min, max, low, high) {
  const span = to - from;
  if (Math.abs(span) < 1e-9) return from < min || from > max ? [1, 0] : [low, high];
  const first = (min - from) / span, second = (max - from) / span;
  return [Math.max(low, Math.min(first, second)), Math.min(high, Math.max(first, second))];
}
// A leg's real metres (through the opening when the wall is in between), its
// metres in the rain, measured stretch by stretch against the real shelter,
// and what it costs while choosing a route (rain threefold).
function leg(a, b) {
  const split = crossesPartition(a, b), points = split ? [a, OPENING, b] : [a, b];
  let metres = 0, rain = 0;
  for (let index = 0; index + 1 < points.length; index++) {
    const start = points[index], end = points[index + 1];
    const length = split ? flat(start, end) : Math.hypot(end.x - start.x, (end.y ?? 0) - (start.y ?? 0), end.z - start.z);
    metres += length;
    if (IS_SUPERMARKET) rain += length * Math.max(0, 1 - dryShare(start, end));
  }
  return { metres, cost: metres + (RAIN - 1) * rain, rain };
}
// The waypoints of a companion's route: spaceRoute's shape and commitment
// rules, but a flight between floors is chosen on the real cost, not on two
// straight lines — the dry interior stair beats a shorter walk in the rain.
function route(from, to) {
  const on = spaceFlightAt(from.x, from.z, from.y ?? 0), onto = spaceFlightAt(to.x, to.z, to.y ?? 0);
  if (on) {
    if (onto?.id === on.id) return [{ ...to, flightId: on.id }];
    // As the zombies' spaceRoute: a holdLanding flight (the hospital's) lets
    // go of a body past its head rails bound for the upper floor, which the
    // visibility graph routes from there. Handed back to the landing, a slow
    // body leaving the main stair head eastward turned at its corner.
    if (spaceFlightHolding(from, to)) {
      const landing = lower(to) ? on.lower : on.upper;
      return [{ ...landing, flightId: on.id }, ...route(landing, to)];
    }
  }
  if (onto) {
    const landing = lower(from) ? onto.lower : onto.upper;
    return [{ ...landing }, { ...to, flightId: onto.id }];
  }
  if (lower(from) === lower(to)) return [{ ...to }];
  const choice = SPACE.flights.reduce((best, candidate) => {
    const near = lower(from) ? candidate.lower : candidate.upper, far = lower(from) ? candidate.upper : candidate.lower;
    const cost = leg(from, near).cost + leg(near, far).cost + leg(far, to).cost;
    return !best || cost < best.cost ? { candidate, cost } : best;
  }, null).candidate;
  const near = lower(from) ? choice.lower : choice.upper, far = lower(from) ? choice.upper : choice.lower;
  return [{ ...near }, { ...far, flightId: choice.id }, { ...to }];
}
// The first waypoint, as spaceWaypoint: close ones behind the feet are spent.
export function companionWaypoint(from, to) {
  if (!HAS_SPACE) return { ...to };
  const points = route(from, to);
  while (points.length > 1 && flat(from, points[0]) < .35 && Math.abs((from.y ?? 0) - points[0].y) < .3) points.shift();
  return points[0];
}
// What a route amounts to: real metres along it (the opening's detour
// included, penalties excluded), the flight it uses ('interior' /
// 'exterior'; on the hospital 'main' / 'service'), its metres in the rain,
// and whether it crosses the partition.
export function routeInfo(from, to) {
  if (!HAS_SPACE) return { metres: flat(from, to), flight: null, rain: 0, crosses: false };
  let last = from, metres = 0, rain = 0, flight = null, crosses = false;
  for (const point of route(from, to)) {
    const part = leg(last, point);
    metres += part.metres; rain += part.rain;
    crosses = crosses || crossesPartition(last, point);
    flight ??= FLIGHT_NAME[point.flightId] ?? null;
    last = point;
  }
  return { metres, flight, rain, crosses };
}
// Metres along the chosen route, for budgets and reach (coins, revives).
export const routeLength = (from, to) => routeInfo(from, to).metres;
// 'interior' / 'exterior' ('main' / 'service') when the route takes a flight, else null.
export const routeFlight = (from, to) => routeInfo(from, to).flight;
