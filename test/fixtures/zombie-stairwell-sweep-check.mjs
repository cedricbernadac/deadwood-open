import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { RoomSimulation } from '../../simulation.mjs';
import { LEVEL, HAS_SPACE } from '../../public/level-config.js';
import { SPACE, spaceFlightAt, spaceFloor, spaceRoute, spaceTreadY } from '../../public/level-space.js';

// Systematic stairwell sweep for multi-floor maps. Start points sit on a
// 0.25 m grid in a 3 m band around each stairwell, on the upper floor, on the
// flight itself and on the lower floor; every zombie silhouette walks from
// there to targets spread over both floors. A body stalls when it stays
// within 0.3 m for 3 s while its target is more than 2 m away.
//   SWEEP_MODE=sample (default, the test) | full (every grid point)
//   SWEEP_TARGETS=n   targets per start and body (full mode, default 1)
//   SWEEP_SHARD=i/n   run one deterministic share of the scenarios
//   SWEEP_OUT=file    write every failure (and the counts) as JSON
export const DT = 1 / 30;
export const GRID = .25, BAND = 3, STALL_RADIUS = .3, STALL_SECONDS = 3, TARGET_CLEARANCE = 2;
export const BODIES = [
  { id: 'walker', kind: 'walker', scale: 1, boss: false, speed: 1.5 },
  { id: 'crawler', kind: 'crawler', scale: 1, boss: false, speed: 1.2 },
  { id: 'runner', kind: 'runner', scale: 1, boss: false, speed: 2.3 },
  { id: 'brute', kind: 'brute', scale: 1.22, boss: false, speed: .8 },
  { id: 'colossus', kind: 'brute', scale: 1.32, boss: true, speed: .8 },
];
const FLOORS = ['upper', 'flight', 'lower'];
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const round = value => Math.round(value * 1000) / 1000;
const rectGap = (x, z, r) => Math.hypot(Math.max(0, r.minX - x, x - r.maxX), Math.max(0, r.minZ - z, z - r.maxZ));
const inside = (x, z, margin = .3) => Math.abs(x) < LEVEL.halfWidth - margin && Math.abs(z) < LEVEL.halfDepth - margin;
const lowerY = () => SPACE.minY;

const probe = new RoomSimulation('SWEEPPROBE', { random: () => .5, raids: false });
probe.addPlayer('player', 'Player');
const probePlayer = probe.players.get('player');
const legalBody = (body, x, z, y) => probe.canOccupy({ id: 'probe', kind: body.kind, scale: body.scale, boss: body.boss }, x, z, y, .29 * body.scale);

// Where each body can walk: a flood fill over 0.125 m cells (the start grid
// falls on cells) with the game's own step rule (the feet follow spaceFloor,
// at most 0.3 m up or down, as candidateY) and its own collision test, from
// the first flight's upper landing through both floors and every flight.
// Diagonal steps never cut a corner.
const CELL = GRID / 2;
const reachCache = new Map();
export function reachable(body) {
  // Runners share the walker's silhouette.
  const shape = `${body.kind === 'runner' ? 'walker' : body.kind}:${body.scale}:${body.boss}`;
  if (reachCache.has(shape)) return reachCache.get(shape);
  const spanX = Math.ceil(LEVEL.halfWidth / CELL), spanZ = Math.ceil(LEVEL.halfDepth / CELL), width = 2 * spanX + 1;
  const index = (ix, iz) => (iz + spanZ) * width + ix + spanX;
  const levels = new Map(), seen = new Map();
  const layer = (store, y) => {
    const key = Math.round(y * 1000);
    if (!store.has(key)) store.set(key, new Uint8Array(width * (2 * spanZ + 1)));
    return store.get(key);
  };
  // 0 unknown, 1 free, 2 solid
  const stand = (ix, iz, y) => {
    const cells = layer(levels, y), cell = index(ix, iz);
    if (!cells[cell]) cells[cell] = inside(ix * CELL, iz * CELL) && legalBody(body, ix * CELL, iz * CELL, y) ? 1 : 2;
    return cells[cell] === 1;
  };
  const step = (ix, iz, y) => {
    if (Math.abs(ix) >= spanX || Math.abs(iz) >= spanZ) return null;
    const next = spaceFloor(ix * CELL, iz * CELL, y + .3);
    return Number.isFinite(next) && Math.abs(next - y) <= .3 + 1e-6 && stand(ix, iz, next) ? next : null;
  };
  const visit = (ix, iz, y) => {
    const cells = layer(seen, y), cell = index(ix, iz);
    if (cells[cell]) return false;
    cells[cell] = 1; return true;
  };
  const seed = SPACE.flights[0].upper, queue = [[Math.round(seed.x / CELL), Math.round(seed.z / CELL), 0]];
  visit(...queue[0]);
  for (let head = 0; head < queue.length; head++) {
    const [ix, iz, y] = queue[head];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const next = step(ix + dx, iz + dz, y);
      if (next === null || dx && dz && (step(ix + dx, iz, y) === null || step(ix, iz + dz, y) === null)) continue;
      if (visit(ix + dx, iz + dz, next)) queue.push([ix + dx, iz + dz, next]);
    }
  }
  const at = (x, z, y) => {
    const ix = Math.round(x / CELL), iz = Math.round(z / CELL);
    if (Math.abs(ix) >= spanX || Math.abs(iz) >= spanZ) return false;
    for (const [key, cells] of seen) if (Math.abs(key / 1000 - y) < .3 && cells[index(ix, iz)]) return true;
    return false;
  };
  const near = (point, reach) => {
    for (let dx = -reach; dx <= reach + 1e-9; dx += CELL) for (let dz = -reach; dz <= reach + 1e-9; dz += CELL) {
      if (Math.hypot(dx, dz) <= reach + 1e-9 && at(point.x + dx, point.z + dz, point.y)) return true;
    }
    return false;
  };
  const result = { at, near, cells: queue.length };
  reachCache.set(shape, result);
  return result;
}

// A free player spot as close as possible to the named point, on its floor,
// that even the colossus can walk up to (none when the point has no room,
// e.g. between a cheek and a cellar wall).
function playerSpot(point) {
  const colossus = reachable(BODIES.at(-1));
  for (const reach of [0, .25, .5, .75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5]) {
    for (let index = 0; index < (reach ? 16 : 1); index++) {
      const angle = index / 16 * Math.PI * 2;
      const x = round(point.x + Math.cos(angle) * reach), z = round(point.z + Math.sin(angle) * reach);
      Object.assign(probePlayer, { x, y: point.y, z, grounded: true });
      if (inside(x, z, .5) && Math.abs(spaceFloor(x, z, point.y + .05) - point.y) < 1e-6 && !spaceFlightAt(x, z, point.y, .3)
        && probe.canOccupy(probePlayer, x, z, point.y, .25) && colossus.near({ x, y: point.y, z }, .5)) return { ...point, x, z };
    }
  }
  return null;
}

// Targets: inside each door, the far corners of every floor, each stair foot
// and head, both sides of each well on both floors, the refuge.
export function sweepTargets() {
  const low = lowerY(), named = [];
  for (const door of LEVEL.doors) named.push({ id: `door-${door.id}`, x: door.x - door.outX * .9, y: 0, z: door.z - door.outZ * .9 });
  for (const floor of SPACE.floors) {
    const inset = .7;
    for (const [sx, sz, corner] of [[-1, -1, 'nw'], [1, -1, 'ne'], [-1, 1, 'sw'], [1, 1, 'se']]) {
      named.push({ id: `${floor.id}-${corner}`, x: sx < 0 ? floor.minX + inset : floor.maxX - inset, y: floor.y, z: sz < 0 ? floor.minZ + inset : floor.maxZ - inset });
    }
  }
  for (const f of SPACE.flights) {
    const midZ = (f.minZ + f.maxZ) / 2;
    named.push({ id: `${f.id}-foot`, x: f.lower.x, y: low, z: f.lower.z - .6 });
    named.push({ id: `${f.id}-head`, x: f.upper.x, y: 0, z: f.upper.z + .5 });
    named.push({ id: `${f.id}-upper-west`, x: f.well.minX - 1, y: 0, z: midZ });
    named.push({ id: `${f.id}-upper-east`, x: f.well.maxX + 1, y: 0, z: midZ });
    named.push({ id: `${f.id}-lower-west`, x: f.minX - 1.2, y: low, z: midZ });
    named.push({ id: `${f.id}-lower-east`, x: f.maxX + 1.2, y: low, z: midZ });
  }
  named.push({ id: 'refuge', ...SPACE.refuge });
  if (LEVEL.id === 'supermarket') named.push({ id: 'verifier-cellar', x: 9, y: low, z: 6 });
  return named.map(point => { const spot = playerSpot(point); return spot && { ...spot, id: point.id }; }).filter(Boolean);
}

// Every legal grid point in the band around one flight, for one body, that
// the body can walk away from (a pocket it cannot leave is not a stall).
export function sweepStarts(f, body, floor) {
  const points = [];
  const minX = Math.ceil((f.well.minX - BAND) / GRID) * GRID, maxX = f.well.maxX + BAND;
  const minZ = Math.ceil((f.well.minZ - BAND) / GRID) * GRID, maxZ = f.well.maxZ + BAND;
  for (let x = minX; x <= maxX + 1e-9; x += GRID) for (let z = minZ; z <= maxZ + 1e-9; z += GRID) {
    const px = round(x), pz = round(z);
    if (rectGap(px, pz, f.well) > BAND + 1e-9 || !inside(px, pz)) continue;
    let y;
    if (floor === 'flight') {
      if (px < f.minX || px > f.maxX || pz < f.minZ || pz > f.maxZ) continue;
      y = spaceTreadY(f, pz);
      if (spaceFlightAt(px, pz, y)?.id !== f.id) continue;
    } else {
      y = floor === 'upper' ? 0 : lowerY();
      if (Math.abs(spaceFloor(px, pz, y + .3) - y) > 1e-6 || spaceFlightAt(px, pz, y)) continue;
    }
    if (legalBody(body, px, pz, y) && reachable(body).at(px, pz, y)) points.push({ x: px, y: round(y), z: pz });
  }
  return points;
}

function routeLength(start, target) {
  let from = start, length = 0;
  for (const point of spaceRoute(start, target)) { length += flat(from, point) + Math.abs((point.y ?? 0) - (from.y ?? 0)); from = point; }
  return length;
}

// One body, one target, no other actor: the stall can only come from the
// geometry and the navigation.
export function runScenario({ flightId, floor, body, start, target }, { trace = false } = {}) {
  const sim = new RoomSimulation('SWEEP', { random: () => .5, raids: false });
  const player = sim.addPlayer('player', 'Player');
  sim.start('player');
  sim.phase = 'wave';
  Object.assign(player, { x: target.x, y: target.y, z: target.z, hp: 1e9, alive: true, downed: false });
  const zombie = sim.spawnZombie();
  Object.assign(zombie, {
    x: start.x, y: start.y, z: start.z, kind: body.kind, scale: body.scale, boss: body.boss, speed: body.speed,
    damage: 0, entered: true, navigation: null, portalRoute: null, stairState: null, attackAfter: 0, pushX: 0, pushZ: 0, pushLeft: 0,
  });
  const radius = .29 * body.scale;
  // Generous: a same-floor target behind a partition can need a long detour.
  const limit = Math.min(200, (3 * routeLength(start, target) + 40) / body.speed + 10);
  const result = { flightId, floor, body: body.id, start, target: target.id, outcome: 'timeout', seconds: 0, at: null };
  const points = trace ? [{ x: start.x, y: start.y, z: start.z }] : null;
  let anchor = { ...start }, anchorAt = 0, previousY = start.y;
  for (let tick = 1; tick <= limit / DT; tick++) {
    sim.time += DT;
    sim.updateZombie(zombie, DT, [player]);
    const seconds = tick * DT;
    if (points && tick % 3 === 0) points.push({ x: round(zombie.x), y: round(zombie.y), z: round(zombie.z) });
    const here = { x: round(zombie.x), y: round(zombie.y), z: round(zombie.z) };
    if (!sim.canOccupy(zombie, zombie.x, zombie.z, zombie.y, radius) || Math.abs(zombie.y - previousY) > .4) {
      Object.assign(result, { outcome: 'solid', seconds: round(seconds), at: here }); break;
    }
    previousY = zombie.y;
    const gap = flat(zombie, player), rise = Math.abs(zombie.y - player.y);
    if (gap < 1.2 && rise < .3) { Object.assign(result, { outcome: 'arrived', seconds: round(seconds), at: here }); break; }
    if (Math.hypot(zombie.x - anchor.x, zombie.y - anchor.y, zombie.z - anchor.z) >= STALL_RADIUS) { anchor = { x: zombie.x, y: zombie.y, z: zombie.z }; anchorAt = seconds; }
    else if (seconds - anchorAt >= STALL_SECONDS - 1e-9 && Math.hypot(gap, rise) > TARGET_CLEARANCE) {
      Object.assign(result, { outcome: 'stall', seconds: round(seconds), at: here }); break;
    }
    result.seconds = round(seconds); result.at = here;
  }
  if (points) result.trace = points;
  return result;
}

// Deterministic spread of a list: k items, evenly spaced, offset by a salt.
const spread = (list, k, salt) => {
  if (list.length <= k) return list;
  const out = [];
  for (let index = 0; index < k; index++) out.push(list[Math.floor((index + (salt % 7) / 7) * list.length / k) % list.length]);
  return out;
};

// Former stalls (validation/kimi-zombie-stairs2/REPORT.md), always part of
// the sampled test: the verifier's east-cheek starts with a cellar player,
// a shuttle at each landing, a start against a hole's edge, a lane narrower
// than the graph's padding (as a start and as a target), a colossus against
// the facade.
const pin = (flightId, floor, body, x, y, z, target) => ({ flightId, floor, body, start: { x, y, z }, target });
export const PINNED = {
  supermarket: [
    ...['walker', 'crawler', 'runner'].flatMap(body => [[5.95, -.8], [5.92, -.77], [5.94, -.94]]
      .map(([x, z]) => pin('stock-stair', 'upper', body, x, 0, z, 'verifier-cellar'))),
    pin('stock-stair', 'upper', 'walker', -.25, 0, -5.75, 'garden-stair-lower-west'),
    pin('stock-stair', 'flight', 'walker', 3.5, -1.19, -3.75, 'terrace-ne'),
    pin('garden-stair', 'upper', 'colossus', 11.25, 0, 1.25, 'cellar-se'),
    pin('garden-stair', 'lower', 'colossus', 10.25, -3.4, .25, 'garden-stair-upper-west'),
    pin('stock-stair', 'upper', 'walker', 6, 0, -6, 'cellar-se'),
    pin('stock-stair', 'lower', 'colossus', 1.75, -3.4, -.75, 'stock-stair-lower-east'),
  ],
  hospital: [
    pin('main-stair', 'upper', 'crawler', -13, 0, -4, 'cellar-sw'),
    pin('service-stair', 'lower', 'walker', 17.75, -3.4, 9.75, 'service-stair-upper-east'),
    pin('main-stair', 'upper', 'brute', -13, 0, -2, 'door-east'),
    pin('service-stair', 'upper', 'walker', 16.75, 0, 10.75, 'ground-nw'),
    pin('main-stair', 'upper', 'colossus', -13.5, 0, -11, 'door-north'),
  ],
  funfair: [
    pin('service-stair', 'upper', 'walker', 10.2, 0, 11.65, 'cellar-se'),
    pin('service-stair', 'upper', 'runner', 10.25, 0, 12.25, 'cellar-se'),
  ],
};

export function sweepScenarios(mode = 'sample', targetsPerStart = 1) {
  const targets = sweepTargets(), scenarios = [];
  let serial = 0;
  SPACE.flights.forEach((f, flightIndex) => BODIES.forEach((body, bodyIndex) => FLOORS.forEach((floor, floorIndex) => {
    const all = sweepStarts(f, body, floor);
    const starts = mode === 'full' ? all : spread(all, floor === 'flight' ? 3 : 8, flightIndex * 5 + bodyIndex * 3 + floorIndex);
    starts.forEach((start, index) => {
      for (let k = 0; k < (mode === 'full' ? targetsPerStart : 1); k++) {
        const target = targets[(index * 7 + k * 11 + bodyIndex * 3 + floorIndex * 5 + flightIndex * 2 + serial) % targets.length];
        scenarios.push({ flightId: f.id, floor, body, start, target });
      }
    });
    serial++;
  })));
  if (mode !== 'full') for (const pin of PINNED[LEVEL.id] ?? []) {
    const body = BODIES.find(item => item.id === pin.body), target = targets.find(item => item.id === pin.target);
    const { x, y, z } = pin.start;
    if (!body || !target || !legalBody(body, x, z, y) || !reachable(body).near(pin.start, CELL)) throw new Error(`invalid pinned scenario ${JSON.stringify(pin)}`);
    scenarios.push({ ...pin, body, target, pinned: true });
  }
  return { targets, scenarios };
}

function main() {
  if (!HAS_SPACE) throw new Error('the stairwell sweep needs a multi-floor map (DEADWOOD_LEVEL=supermarket, hospital or funfair)');
  const mode = process.env.SWEEP_MODE === 'full' ? 'full' : 'sample';
  const [shard, shards] = (process.env.SWEEP_SHARD ?? '0/1').split('/').map(Number);
  const { targets, scenarios } = sweepScenarios(mode, Number(process.env.SWEEP_TARGETS ?? 1));
  const mine = scenarios.filter((_, index) => index % shards === shard);
  const started = performance.now();
  const results = mine.map(scenario => runScenario(scenario));
  const failures = results.filter(result => result.outcome !== 'arrived');
  const coverage = {};
  for (const result of results) {
    const key = `${result.flightId}/${result.floor}/${result.body}`;
    coverage[key] ??= { runs: 0, stall: 0, timeout: 0, solid: 0 };
    coverage[key].runs++;
    if (result.outcome !== 'arrived') coverage[key][result.outcome]++;
  }
  const counts = { stall: 0, timeout: 0, solid: 0 };
  for (const failure of failures) counts[failure.outcome]++;
  const summary = {
    level: LEVEL.id, mode, shard: `${shard}/${shards}`, scenarios: results.length, targets: targets.length,
    flights: SPACE.flights.length, bodies: BODIES.length, floors: FLOORS.length, ...counts,
    slowest: Math.max(0, ...results.filter(result => result.outcome === 'arrived').map(result => result.seconds)),
    ms: Math.round(performance.now() - started),
  };
  if (process.env.SWEEP_OUT) writeFileSync(process.env.SWEEP_OUT, JSON.stringify({ summary, targets, coverage, failures }, null, 1) + '\n');
  console.log(JSON.stringify(summary));
  for (const failure of failures.slice(0, 40)) {
    console.log(`${failure.outcome}: ${LEVEL.id}/${failure.flightId}/${failure.floor}/${failure.body} from ${failure.start.x},${failure.start.y},${failure.start.z} to ${failure.target} at ${JSON.stringify(failure.at)} after ${failure.seconds} s`);
  }
  if (failures.length > 40) console.log(`... ${failures.length - 40} more`);
  const missing = SPACE.flights.flatMap(f => BODIES.flatMap(body => FLOORS.map(floor => `${f.id}/${floor}/${body.id}`))).filter(key => !coverage[key]);
  if (shards === 1 && missing.length) { console.log(`uncovered: ${missing.join(', ')}`); process.exitCode = 1; }
  if (failures.length) process.exitCode = 1;
  else console.log(`${LEVEL.id} zombie stairwell sweep verified: ${results.length} routes, 0 stalls`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
