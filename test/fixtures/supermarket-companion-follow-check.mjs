import assert from 'node:assert/strict';
// Papa walks or sprints down and up each supermarket flight (the stock stair
// and the garden stair) to a spot past its landing, Max following a step
// behind. While Papa stood on a flight, routes.mjs returned his own point
// tagged with the flight and waypoint() committed nav.spaceFlight to it: the
// follower kept walking back to where Papa had stood mid-flight and shuttled
// on the treads for good (4-27 vertical reversals in 30 s on main's code).
// A flight is now committed through one of its landings only. Checked: Max
// takes Papa's flight, turns back at most twice in 30 s (the direction kept
// through a landing, so that a shuttle from landing to landing counts),
// stands on Papa's floor within 3.5 m of him 3 s after he stops and at 30 s,
// leaves a flight at most once after Papa stops and walks at most 5 m from
// 3 s after the stop. Papa stopping on the treads:
// space-companion-follow-midflight-check.
// Real RoomSimulation and companion bodies; no brain, server or model API.
// Run with DEADWOOD_LEVEL=supermarket (test/supermarket-companion-follow.test.mjs).
import { RoomSimulation } from '../../simulation.mjs';
import { createCompanionBody } from '../../companions/body.mjs';
import { IS_SUPERMARKET } from '../../public/level-config.js';
import { SPACE, spaceFlightAt } from '../../public/level-space.js';
import { seededRandom } from '../../validation/balance-report.mjs';
import { flightReversals, flightTravel } from './flight-moves.mjs';

assert.equal(IS_SUPERMARKET, true, 'run with DEADWOOD_LEVEL=supermarket');
const DT = 1 / 30;
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const r2 = value => Math.round(value * 100) / 100;
const P = point => `(${r2(point.x)},${r2(point.y ?? 0)},${r2(point.z)})`;
const failures = [], rows = [];
const check = (ok, message) => { if (!ok) failures.push(message); return ok; };

// A quiet wave 16: no spawning, no raids, doors unsealed. Both bodies get
// enough health that the acid rain on the garden stair cannot turn this
// navigation check into a survival check.
function room({ human, bot }) {
  const sim = new RoomSimulation('SMFOLLOW', { random: seededRandom(18), raids: false });
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
  const run = (seconds, { drive, each }) => {
    for (let tick = 0; tick < Math.round(seconds * 30); tick++) {
      drive();
      body.tick(DT);
      sim.spawnTimer = 1e9; sim.tick(DT);
      each();
    }
  };
  return { sim, papa, bot: max, body, run };
}

// Spots past each landing: the sales floor beside the stock stair head and
// the cellar past its foot; the open terrace by the garden stair head and the
// cellar past its foot.
const ends = {
  'stock-stair': { up: { x: 1, y: 0, z: 0 }, down: { x: 6.5, y: -3.4, z: -8.9 } },
  'garden-stair': { up: { x: 9.2, y: 0, z: 9.8 }, down: { x: 9, y: -3.4, z: 0 } },
};
assert.deepEqual(SPACE.flights.map(flight => flight.id), Object.keys(ends), 'the supermarket has the stock stair and the garden stair');
for (const flight of SPACE.flights) for (const way of ['down', 'up']) for (const pace of ['walk', 'sprint']) {
  const start = way === 'down' ? ends[flight.id].up : ends[flight.id].down, finish = way === 'down' ? ends[flight.id].down : ends[flight.id].up;
  const path = way === 'down' ? [flight.upper, flight.lower, finish] : [flight.lower, flight.upper, finish];
  const behind = { x: start.x, y: start.y, z: start.z + Math.sign(start.z - path[0].z || 1) * 1.4 };
  const { sim, papa, bot, body, run } = room({ human: start, bot: behind });
  if (!sim.canOccupy(bot, behind.x, behind.z, behind.y, .32)) Object.assign(bot, { x: start.x + 1, z: start.z });
  assert.ok(sim.canOccupy(papa, papa.x, papa.z, papa.y, .32), `setup: Papa can stand at ${P(papa)}`);
  assert.ok(sim.canOccupy(bot, bot.x, bot.z, bot.y, .32), `setup: Max can stand at ${P(bot)}`);
  body.setOrder({ kind: 'follow', playerId: papa.id });
  const counter = flightReversals(), sinceStop = flightTravel(), settled = flightTravel(), flights = new Set();
  let leg = 0, time = 0, arrivedAt = null, after = null;
  run(30, {
    drive: () => {
      time += DT;
      if (time > 1 && leg < path.length) {
        const goal = path[leg], dx = goal.x - papa.x, dz = goal.z - papa.z;
        if (Math.hypot(dx, dz) < .3 && Math.abs(papa.y - goal.y) < .4) leg++;
        else sim.setInput(papa.id, { forward: 1, strafe: 0, yaw: Math.atan2(-dx, -dz), pitch: 0, sprint: pace === 'sprint' });
        if (leg >= path.length) { arrivedAt = time; sinceStop.start(); }
      } else sim.setInput(papa.id, { forward: 0, strafe: 0, yaw: papa.yaw ?? 0, pitch: 0, sprint: false });
    },
    each: () => {
      if (arrivedAt !== null && time >= arrivedAt + 3) settled.start();
      counter.step(bot); sinceStop.step(bot); settled.step(bot);
      const on = spaceFlightAt(bot.x, bot.z, bot.y);
      if (on) flights.add(on.id);
      if (arrivedAt !== null && after === null && time >= arrivedAt + 3) after = { gap: flat(bot, papa), rise: Math.abs(bot.y - papa.y), at: { x: bot.x, y: bot.y, z: bot.z } };
    },
  });
  const row = {
    case: `${pace} ${way} ${flight.id}`, arrivedAt: arrivedAt === null ? null : r2(arrivedAt), reversals: counter.count, flights: [...flights],
    exitsAfterStop: sinceStop.exits, metresSettled: r2(settled.path),
    after: after && { gap: r2(after.gap), rise: r2(after.rise), at: P(after.at) },
    end: { gap: r2(flat(bot, papa)), rise: r2(Math.abs(bot.y - papa.y)), at: P(bot), papa: P(papa) },
  };
  rows.push(row);
  console.log(`follow case ${JSON.stringify(row)}`);
  assert.ok(arrivedAt !== null && flat(papa, finish) < .3 && Math.abs(papa.y - finish.y) < .1, `setup: Papa went ${way} the ${flight.id} (${pace}), ${P(papa)}`);
  check(flights.has(flight.id), `follow ${row.case}: Max did not take Papa's flight (used ${[...flights].join(', ') || 'none'})`);
  check(row.reversals <= 2, `follow ${row.case}: ${row.reversals} vertical reversals in 30 s (2 at most)`);
  check(after && after.rise < .5 && after.gap < 3.5, `follow ${row.case}: 3 s after Papa stopped, Max is at ${after ? P(after.at) : '-'}, ${after ? r2(after.gap) : '-'} m and ${after ? r2(after.rise) : '-'} m in height from him`);
  check(row.end.rise < .5 && row.end.gap < 3.5, `follow ${row.case}: after 30 s Max is ${row.end.gap} m and ${row.end.rise} m in height from Papa`);
  check(row.exitsAfterStop <= 1, `follow ${row.case}: Max left a flight ${row.exitsAfterStop} times after Papa stopped (once at most)`);
  check(row.metresSettled <= 5, `follow ${row.case}: from 3 s after Papa stopped, Max walked ${row.metresSettled} m (5 at most)`);
}

const worst = values => r2(Math.max(...values.filter(Number.isFinite)));
console.log(`follow metrics ${JSON.stringify({
  cases: rows.length, maxReversals: Math.max(...rows.map(row => row.reversals)), maxExitsAfterStop: Math.max(...rows.map(row => row.exitsAfterStop)), worstMetresSettled: worst(rows.map(row => row.metresSettled)),
  worstGapAfterStop: worst(rows.map(row => row.after?.gap)), worstRiseAfterStop: worst(rows.map(row => row.after?.rise)),
  worstEndGap: worst(rows.map(row => row.end.gap)), worstEndRise: worst(rows.map(row => row.end.rise)),
})}`);
assert.deepEqual(failures, [], `supermarket companion follow:\n  ${failures.join('\n  ')}`);
console.log(`supermarket companion follow verified: ${rows.length} cases; ${rows.map(row => `${row.case} ${row.reversals} reversals, ${row.after.gap} m from Papa 3 s after he stopped`).join('; ')}`);
