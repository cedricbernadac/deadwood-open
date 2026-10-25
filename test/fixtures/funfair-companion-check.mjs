import assert from 'node:assert/strict';
import { RoomSimulation } from '../../simulation.mjs';
import { createCompanionBody, LOFT_POST, LOFT_POST_EXTERIOR } from '../../companions/body.mjs';
import { ARMORY, ARMORY_REACH } from '../../public/rules.js';
import { SPACE, spaceFlightAt, spaceRoute, spaceTreadY } from '../../public/level-space.js';
import { companionWaypoint, routeLength } from '../../companions/routes.mjs';
import { worthBuying } from '../../companions/arsenal.mjs';
import { seededRandom } from '../../validation/balance-report.mjs';

const DT = 1 / 30;
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const events = [];
const walked = (from, points) => points.reduce((sum, point, index) => {
  const last = index ? points[index - 1] : from;
  return sum + Math.hypot(last.x - point.x, (last.y ?? 0) - (point.y ?? 0), last.z - point.z);
}, 0);
for (const [from, to] of [
  [{ x: 0, y: 0, z: 0 }, { ...SPACE.rooms.find(room => room.id === 'machines').target }],
  [{ ...SPACE.rooms.find(room => room.id === 'tir').target }, { ...SPACE.rooms.find(room => room.id === 'confiserie').target }],
]) {
  const metres = routeLength(from, to);
  assert.ok(Math.abs(metres - walked(from, spaceRoute(from, to))) < 1e-6, `companion route length matches spaceRoute: ${metres}`);
  assert.ok(metres > Math.hypot(from.x - to.x, from.y - to.y, from.z - to.z) + 1, 'companion route goes round by a stair');
  const first = companionWaypoint(from, to);
  assert.ok(SPACE.flights.some(flight => [flight.upper, flight.lower].some(end => flat(first, end) < .01 && Math.abs(first.y - end.y) < .01)),
    `first companion waypoint is a stair landing: ${JSON.stringify(first)}`);
}

const sim = new RoomSimulation('FUNBOT', { random: seededRandom(18), raids: false, onEvent: event => events.push(event) });
const flightById = Object.fromEntries(SPACE.flights.map(flight => [flight.id, flight]));
for (const [post, id] of [[LOFT_POST, 'main-stair'], [LOFT_POST_EXTERIOR, 'service-stair']]) {
  const flight = flightById[id], eye = { x: post.x, y: post.y + 1.55, z: post.z };
  assert.equal(post.y, SPACE.minY, `${id} post stands in the cellar`);
  assert.ok(sim.canOccupy({ kind: 'walker', scale: 1 }, post.x, post.z, post.y, .32), `${id} post is free`);
  assert.ok(sim.raiderLineClear(eye, { ...flight.upper, y: flight.upper.y + 1.2 }), `${JSON.stringify(post)} sees the ${id} head`);
  for (let step = 0; step <= 20; step += 5) {
    const z = flight.minZ + (flight.maxZ - flight.minZ) * step / 20;
    assert.ok(sim.raiderLineClear(eye, { x: (flight.minX + flight.maxX) / 2, y: spaceTreadY(flight, z) + 1.2, z }), `${JSON.stringify(post)} sees ${id} at z=${z}`);
  }
}
assert.equal(sim.raiderLineClear({ ...SPACE.refuge, y: SPACE.refuge.y + 1.55 }, { ...flightById['main-stair'].upper, y: 1.2 }), false,
  'setup: the refuge target does not replace either stair-foot watch');

const human = sim.addPlayer('papa', 'Papa');
const bot = sim.addPlayer('bot', 'Max', undefined, { companion: true });
sim.start(human.id);
Object.assign(sim, { phase: 'wave', wave: 16, toSpawn: 1, spawnTimer: 1e9 });
for (const door of sim.doors) {
  door.boards.fill(0);
  door.sealed = false;
  door.sealPending = false;
}
Object.assign(human, { x: 0, y: 0, z: 0, grounded: true, vy: 0 });
Object.assign(bot, { ...SPACE.flights[0].upper, grounded: true, vy: 0, points: 20000, backpack: true, companionSlot: 0 });
assert.equal(worthBuying(sim, bot, 'bat'), false, 'setup: the companion arsenal intentionally rejects a bat over the pistol');
assert.equal(worthBuying(sim, bot, 'shotgun'), true, 'setup: the shotgun is a useful purchase');
const body = createCompanionBody(sim, bot.id, { random: seededRandom(88) });
const trace = [];
function run(seconds, until) {
  for (let tick = 0; tick < seconds * 30; tick++) {
    sim.setInput(human.id, { forward: 0, strafe: 0, yaw: 0, pitch: 0 });
    body.tick(DT);
    sim.spawnTimer = 1e9;
    sim.tick(DT);
    trace.push({ x: bot.x, y: bot.y, z: bot.z, flight: spaceFlightAt(bot.x, bot.z, bot.y)?.id ?? null });
    assert.equal(bot.input?.jump === true, false, 'companion uses stairs rather than jumping across floors');
    assert.ok(bot.y >= SPACE.minY - .01, `companion fell below the funfair: ${JSON.stringify(bot)}`);
    if (until()) return true;
  }
  return false;
}

const route = [
  { id: 'shotgun', floor: 0, expectedFlight: null },
  { id: 'assault', floor: SPACE.minY, expectedFlight: 'main-stair' },
  { id: 'minigun', floor: 0, expectedFlight: 'service-stair' },
  { id: 'magnum', floor: SPACE.minY, expectedFlight: 'service-stair' },
].map(item => ({ ...item, rack: ARMORY.find(rack => rack.id === item.id) }));
assert.ok(route.every(item => item.rack && item.rack.y === item.floor), 'two real racks per funfair floor');
let spent = 0;
for (const item of route) {
  const { rack, expectedFlight } = item, startIndex = trace.length;
  body.setOrder({ kind: 'buy', rackId: rack.id });
  assert.ok(run(45, () => body.status !== 'running'),
    `${rack.id} rack order stuck: ${JSON.stringify({ bot, status: body.status, trace: trace.slice(-30) })}`);
  assert.equal(body.status, 'done', `${rack.id} rack purchase: ${JSON.stringify({ bot, status: body.status, trace: trace.slice(-60), events: events.slice(-10) })}`);
  assert.ok(Object.hasOwn(bot.inventory, rack.weapon), `${rack.id} weapon is carried`);
  assert.ok(flat(bot, rack) < ARMORY_REACH && Math.abs(bot.y - rack.y) < .1, `body really reached the ${rack.id} rack`);
  if (expectedFlight) assert.ok(trace.slice(startIndex).some(point => point.flight === expectedFlight),
    `companion physically used ${expectedFlight} to reach ${rack.id}: ${JSON.stringify(trace.slice(startIndex).filter(point => point.flight))}`);
  assert.ok(events.some(event => event.event === 'purchase' && event.id === bot.id && event.crateId === rack.id), `authoritative purchase event for ${rack.id}`);
  spent += rack.price;
}
assert.equal(bot.points, 20000 - spent, 'all four rack prices were charged exactly once');
console.log(`funfair companion purchases verified: real body commands, two racks per floor (${route.map(item => item.id).join(', ')}), main-stair descent and service-stair ascent/descent, no brain/API/server`);
