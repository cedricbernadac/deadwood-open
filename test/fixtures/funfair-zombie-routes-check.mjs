import assert from 'node:assert/strict';
import { RoomSimulation } from '../../simulation.mjs';
import { IS_FUNFAIR } from '../../public/level-config.js';
import { SPACE, spaceFlightAt } from '../../public/level-space.js';

const DT = 1 / 30;
const ID = '0123456789abcdef';
const MODE = process.argv[2] ?? 'doors';
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
assert.equal(IS_FUNFAIR, true, 'run with DEADWOOD_LEVEL=funfair');

function setup(code, target) {
  const sim = new RoomSimulation(code, { random: () => .5, raids: false });
  const player = sim.addPlayer(ID, 'Jules');
  sim.start(ID);
  Object.assign(sim, { phase: 'wave', wave: 1, toSpawn: 100, spawnTimer: 1e9 });
  for (const door of sim.doors) {
    door.boards.fill(0);
    door.sealed = false;
    door.sealPending = false;
  }
  Object.assign(player, { ...target, hp: 100, alive: true, downed: false, grounded: true, vy: 0 });
  assert.equal(sim.canOccupy(player, player.x, player.z, player.y, .25), true, `target is free: ${JSON.stringify(target)}`);
  return { sim, player };
}

function drive({ label, start, target, kind, boss = false, requiredFlight = null }) {
  const { sim, player } = setup('FUNNAV', target);
  const enemy = sim.spawnZombie();
  assert.ok(enemy, `${label} spawned through RoomSimulation`);
  Object.assign(enemy, start, {
    kind, boss, scale: boss ? 1.32 : 1, speed: 2.2, entered: start.entered ?? false,
    doorId: start.doorId ?? 'north', navigation: null, portalRoute: null, stairState: null,
    attackAfter: 0, pushX: 0, pushZ: 0, pushLeft: 0,
  });
  const radius = .29 * enemy.scale, flights = new Set(), trace = [];
  let best = flat(enemy, player) + Math.abs(enemy.y - player.y), bestFlat = flat(enemy, player);
  let minY = enemy.y, maxY = enemy.y, traveled = 0, previous = { x: enemy.x, y: enemy.y, z: enemy.z };
  let activeAt = 0, maxStall = 0, arrived = false, tick = 0;
  const diagnostic = () => JSON.stringify({
    label, tick, simulatedSeconds: Number((tick * DT).toFixed(1)), best: Number(best.toFixed(3)), bestFlat: Number(bestFlat.toFixed(3)),
    traveled: Number(traveled.toFixed(3)), maxStallTicks: maxStall, flights: [...flights], minY, maxY,
    enemy: { x: enemy.x, y: enemy.y, z: enemy.z, entered: enemy.entered, stairState: enemy.stairState, navigation: enemy.navigation, portalRoute: enemy.portalRoute },
    player: { x: player.x, y: player.y, z: player.z, hp: player.hp }, trace,
  });

  for (; tick < 3600 && !arrived; tick++) {
    const hpBefore = player.hp;
    sim.time += DT;
    sim.updateZombie(enemy, DT, [player]);
    const movement = Math.hypot(enemy.x - previous.x, enemy.y - previous.y, enemy.z - previous.z);
    traveled += movement;
    previous = { x: enemy.x, y: enemy.y, z: enemy.z };
    const flight = spaceFlightAt(enemy.x, enemy.z, enemy.y);
    if (flight) flights.add(flight.id);
    minY = Math.min(minY, enemy.y);
    maxY = Math.max(maxY, enemy.y);
    const horizontal = flat(enemy, player), vertical = Math.abs(enemy.y - player.y), progress = horizontal + vertical;
    bestFlat = Math.min(bestFlat, horizontal);
    const improved = progress < best - .02;
    if (improved) best = progress;
    if (movement > .002 || improved || player.hp < hpBefore) activeAt = tick;
    maxStall = Math.max(maxStall, tick - activeAt);
    if (tick % 300 === 0) trace.push({ tick, x: Number(enemy.x.toFixed(2)), y: Number(enemy.y.toFixed(2)), z: Number(enemy.z.toFixed(2)), flight: flight?.id ?? null });
    assert.ok(tick - activeAt <= 300, `${label} made no positional progress for ten simulated seconds: ${diagnostic()}`);
    assert.equal(sim.canOccupy(enemy, enemy.x, enemy.z, enemy.y, radius), true, `${label} illegal enemy body: ${diagnostic()}`);
    arrived = horizontal < 1.5 && vertical < .3 || player.hp < hpBefore && vertical < .6;
  }
  assert.ok(arrived, `${label} did not reach the player: ${diagnostic()}`);
  if (requiredFlight) assert.ok(flights.has(requiredFlight), `${label} did not traverse ${requiredFlight}: ${diagnostic()}`);
  return { flights, minY, maxY, tick, diagnostic };
}

const profiles = [
  { name: 'walker', kind: 'walker' },
  { name: 'crawler', kind: 'crawler' },
  { name: 'boss', kind: 'brute', boss: true },
];
const REQUIRED_ROOMS = ['caisse', 'jeux', 'lots', 'confiserie', 'arcade', 'refuge', 'tir', 'miroirs', 'machines'];
assert.ok(Array.isArray(SPACE.rooms), 'SPACE.rooms exposes the real room targets');
const roomTargets = REQUIRED_ROOMS.map(id => {
  const room = SPACE.rooms.find(item => item.id === id);
  assert.ok(room, `SPACE.rooms lists the ${id} room`);
  return { name: `room-${id}`, ...room.target };
});
const stairTargets = [
  { name: 'main-stair-foot-hall', x: -16, y: SPACE.minY, z: -9.2 },
  { name: 'main-stair-head-hall', x: -13.1, y: 0, z: 1.2 },
  { name: 'service-stair-foot-hall', x: 15.8, y: SPACE.minY, z: .8 },
  { name: 'service-stair-head-hall', x: 15.8, y: 0, z: 11 },
];
const targets = [...roomTargets, ...stairTargets];
assert.ok(targets.some(target => target.y === 0) && targets.some(target => target.y === SPACE.minY), 'targets cover both floors and every stairwell');

if (MODE === 'floors') {
  const rooms = floor => roomTargets.filter(target => (target.y < -1) === (floor === 'cellar'));
  const cellar = [...rooms('cellar'), stairTargets[0], stairTargets[2], { name: 'cellar-corridor-west', x: -10, y: SPACE.minY, z: 0 }];
  const ground = [...rooms('ground'), stairTargets[1], stairTargets[3], { name: 'corridor-west', x: -8, y: 0, z: 0 }];
  let floorRoutes = 0;
  for (const [starts, ends] of [[cellar, ground], [ground, cellar]]) {
    for (const start of starts) for (const target of ends) for (const profile of profiles) {
      const label = `${profile.name} ${start.name} to ${target.name}`;
      const result = drive({ label, start: { x: start.x, y: start.y, z: start.z, entered: true }, target, kind: profile.kind, boss: profile.boss });
      assert.ok(result.flights.size > 0, `${label} used a real stair route: ${result.diagnostic()}`);
      floorRoutes++;
    }
  }
  console.log(`funfair zombie floor routes verified: ${floorRoutes} cellar-to-ground and ground-to-cellar routes (walker/crawler/boss between every room and the stair halls)`);
  process.exit(0);
}
assert.equal(MODE, 'doors', `unknown mode ${MODE}`);

const sim = new RoomSimulation('FUNDOORS', { random: () => .5, raids: false });
let doorRoutes = 0;
for (const target of targets) for (const door of sim.doors) for (const profile of profiles) {
  const result = drive({
    label: `${profile.name}/${door.id} to ${target.name}`,
    start: { x: door.x + door.outX * 3, y: 0, z: door.z + door.outZ * 3, doorId: door.id, entered: false },
    target, kind: profile.kind, boss: profile.boss,
  });
  if (target.y < -1) {
    assert.ok(result.minY <= SPACE.minY + .01, `${profile.name}/${door.id} reached the cellar elevation`);
    assert.ok(result.flights.size > 0, `${profile.name}/${door.id} used a real stair route`);
  }
  doorRoutes++;
}

let stairRoutes = 0;
for (const flight of SPACE.flights) for (const up of [false, true]) for (const profile of profiles.filter(item => item.name !== 'walker')) {
  const start = up ? flight.lower : flight.upper, target = up ? flight.upper : flight.lower;
  const result = drive({
    label: `${profile.name}/${flight.id} ${up ? 'ascent' : 'descent'}`,
    start: { ...start, entered: true }, target, kind: profile.kind, boss: profile.boss, requiredFlight: flight.id,
  });
  if (up) assert.ok(result.maxY >= -.3, `${flight.id} ascent reached the upper landing: ${result.diagnostic()}`);
  else assert.ok(result.minY <= SPACE.minY + .3, `${flight.id} descent reached the lower landing: ${result.diagnostic()}`);
  stairRoutes++;
}
console.log(`funfair zombie routes verified: ${doorRoutes} real door-to-room/stair-hall routes (walker/crawler/boss from every exterior door) and ${stairRoutes} explicit two-way stair routes with progress diagnostics`);
