import assert from 'node:assert/strict';
// Papa walks or sprints onto each flight of a SPACE map, from either floor,
// and stops on the treads a quarter, half or three quarters of the way, Max
// following a step behind (supermarket: stock and garden stairs; hospital:
// main and service stairs). Close enough for the follow order to hold, Max
// had no goal on the flight, and the stairs rule sent him on to the landing
// in his climb direction, past Papa: out of range there, he walked back past
// him to the other landing, landing to landing for as long as Papa stood
// (stopped half way: 146-147 m in 30 s and 16-17 flight exits, on both
// flights of both maps, once flights were committed through their landings
// only). Checked: from 5 s after Papa stops, Max walks at
// most 5 m in 30 s, leaves a flight at most once after the stop, turns back
// at most twice (direction kept through a landing), and ends within the
// follow order's reach of Papa (3.5 m, 1.2 m in height).
// Real RoomSimulation and companion bodies; no brain, server or model API.
// Run with DEADWOOD_LEVEL=supermarket or hospital
// (test/space-companion-follow-midflight.test.mjs).
import { RoomSimulation } from '../../simulation.mjs';
import { createCompanionBody } from '../../companions/body.mjs';
import { LEVEL, HAS_SPACE } from '../../public/level-config.js';
import { SPACE, spaceFlightAt, spaceTreadY } from '../../public/level-space.js';
import { seededRandom } from '../../validation/balance-report.mjs';
import { flightReversals, flightTravel } from './flight-moves.mjs';

assert.equal(HAS_SPACE, true, 'run with DEADWOOD_LEVEL=supermarket or hospital');
const DT = 1 / 30;
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const r2 = value => Math.round(value * 100) / 100;
const P = point => `(${r2(point.x)},${r2(point.y ?? 0)},${r2(point.z)})`;
const failures = [], rows = [];
const check = (ok, message) => { if (!ok) failures.push(message); return ok; };

// Spots past each landing, as in supermarket-companion-follow-check and the
// hospital orders fixture's follow block.
const ENDS = {
  supermarket: {
    'stock-stair': { up: { x: 1, y: 0, z: 0 }, down: { x: 6.5, y: -3.4, z: -8.9 } },
    'garden-stair': { up: { x: 9.2, y: 0, z: 9.8 }, down: { x: 9, y: -3.4, z: 0 } },
  },
  hospital: {
    'main-stair': { up: { x: -15.1, y: 0, z: .6 }, down: { x: -15.6, y: -3.4, z: -12 } },
    'service-stair': { up: { x: 14.7, y: 0, z: 13.4 }, down: { x: 14.7, y: -3.4, z: 0 } },
  },
};
const ends = ENDS[LEVEL.id];
assert.ok(ends, `no follow spots for ${LEVEL.id}`);
assert.deepEqual(SPACE.flights.map(flight => flight.id), Object.keys(ends), `the ${LEVEL.id} flights`);

// A quiet wave 16: no spawning, no raids, doors unsealed. Health enough that
// the acid rain on the supermarket garden stair stays out of a navigation check.
function room({ human, bot }) {
  const sim = new RoomSimulation('MIDFLIGHT', { random: seededRandom(18), raids: false });
  const papa = sim.addPlayer('papa', 'Papa');
  const max = sim.addPlayer('bot', 'Max', undefined, { companion: true });
  sim.start(papa.id);
  Object.assign(sim, { phase: 'wave', wave: 16, toSpawn: 1, spawnTimer: 1e9 });
  sim.zombies.clear();
  for (const door of sim.doors) { door.sealed = false; door.sealPending = false; }
  Object.assign(papa, human, { grounded: true, vy: 0, hp: 1e6, maxHp: 1e6 });
  Object.assign(max, bot, { grounded: true, vy: 0, hp: 1e6, maxHp: 1e6, companionSlot: 0 });
  sim.companionOrders = new Map();
  const body = createCompanionBody(sim, max.id, { random: seededRandom(88) });
  return { sim, papa, bot: max, body };
}

for (const flight of SPACE.flights) for (const share of [.25, .5, .75]) for (const way of ['down', 'up']) for (const pace of ['walk', 'sprint']) {
  const start = way === 'down' ? ends[flight.id].up : ends[flight.id].down;
  // `share` of the way down from the head (the same tread either way).
  const z = flight.maxZ - share * (flight.maxZ - flight.minZ), stop = { x: (flight.minX + flight.maxX) / 2, z, y: spaceTreadY(flight, z) };
  const path = [way === 'down' ? flight.upper : flight.lower, stop];
  const behind = { x: start.x, y: start.y, z: start.z + Math.sign(start.z - path[0].z || 1) * 1.4 };
  const { sim, papa, bot, body } = room({ human: start, bot: behind });
  if (!sim.canOccupy(bot, behind.x, behind.z, behind.y, .32)) Object.assign(bot, { x: start.x + 1, z: start.z });
  assert.ok(sim.canOccupy(papa, papa.x, papa.z, papa.y, .32), `setup: Papa can stand at ${P(papa)}`);
  assert.ok(sim.canOccupy(bot, bot.x, bot.z, bot.y, .32), `setup: Max can stand at ${P(bot)}`);
  body.setOrder({ kind: 'follow', playerId: papa.id });
  const turns = flightReversals(), sinceStop = flightTravel(), settled = flightTravel();
  let leg = 0, time = 0, stoppedAt = null;
  for (let tick = 0; tick < 45 * 30 && !(stoppedAt !== null && time >= stoppedAt + 35); tick++) {
    time += DT;
    if (time > 1 && leg < path.length) {
      const goal = path[leg], dx = goal.x - papa.x, dz = goal.z - papa.z;
      if (Math.hypot(dx, dz) < .3) { leg++; if (leg >= path.length) { stoppedAt = time; sinceStop.start(); } }
      else sim.setInput(papa.id, { forward: 1, strafe: 0, yaw: Math.atan2(-dx, -dz), pitch: 0, sprint: pace === 'sprint' });
    }
    if (time <= 1 || leg >= path.length) sim.setInput(papa.id, { forward: 0, strafe: 0, yaw: papa.yaw ?? 0, pitch: 0, sprint: false });
    if (stoppedAt !== null && time >= stoppedAt + 5) settled.start();
    body.tick(DT);
    sim.spawnTimer = 1e9; sim.tick(DT);
    turns.step(bot); sinceStop.step(bot); settled.step(bot);
  }
  const papaFlight = spaceFlightAt(papa.x, papa.z, papa.y)?.id ?? null;
  const row = {
    case: `${pace} ${way} ${flight.id} stop at ${share * 100}%`, stoppedAt: stoppedAt === null ? null : r2(stoppedAt), papa: P(papa),
    reversals: turns.count, exitsAfterStop: sinceStop.exits, metresSettled: r2(settled.path),
    end: { gap: r2(flat(bot, papa)), rise: r2(Math.abs(bot.y - papa.y)), at: P(bot), onFlight: spaceFlightAt(bot.x, bot.z, bot.y)?.id ?? null },
  };
  rows.push(row);
  console.log(`midflight case ${JSON.stringify(row)}`);
  assert.ok(stoppedAt !== null && papaFlight === flight.id && flat(papa, stop) < .3, `setup: Papa stopped on the ${flight.id} (${row.case}), ${P(papa)}`);
  check(row.metresSettled <= 5, `follow ${row.case}: from 5 s after Papa stopped, Max walked ${row.metresSettled} m in 30 s (5 at most)`);
  check(row.exitsAfterStop <= 1, `follow ${row.case}: Max left a flight ${row.exitsAfterStop} times after Papa stopped (once at most)`);
  check(row.reversals <= 2, `follow ${row.case}: ${row.reversals} vertical reversals (2 at most, kept through the landings)`);
  check(row.end.gap < 3.5 && row.end.rise < 1.2, `follow ${row.case}: Max ends at ${row.end.at}, ${row.end.gap} m and ${row.end.rise} m in height from Papa`);
}

const worst = values => r2(Math.max(...values));
console.log(`midflight metrics ${JSON.stringify({
  level: LEVEL.id, cases: rows.length, maxReversals: Math.max(...rows.map(row => row.reversals)), maxExitsAfterStop: Math.max(...rows.map(row => row.exitsAfterStop)),
  worstMetresSettled: worst(rows.map(row => row.metresSettled)), worstEndGap: worst(rows.map(row => row.end.gap)), worstEndRise: worst(rows.map(row => row.end.rise)),
})}`);
assert.deepEqual(failures, [], `${LEVEL.id} companion follow, Papa stopped on a flight:\n  ${failures.join('\n  ')}`);
console.log(`${LEVEL.id} companion follow mid-flight verified: ${rows.length} cases; worst ${worst(rows.map(row => row.metresSettled))} m walked once settled, ${Math.max(...rows.map(row => row.exitsAfterStop))} flight exits after the stop, ${worst(rows.map(row => row.end.gap))} m from Papa at the end`);
