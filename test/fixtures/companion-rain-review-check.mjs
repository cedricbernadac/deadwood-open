// Supermarket companions in the rain: regressions from the review of 24
// October (validation/kimi-companion-rain/REPORT.md). One mode per check, on
// the real simulation, bodies and eyes; no server, no brain, no model API.
import assert from 'node:assert/strict';
import { RoomSimulation } from '../../simulation.mjs';
import { createCompanionBody } from '../../companions/body.mjs';
import { describeSituation } from '../../companions/situation.mjs';
import { rainCost, sheltered } from '../../companions/outdoors.mjs';
import { IS_SUPERMARKET } from '../../public/level-config.js';
import { seededRandom } from '../../validation/balance-report.mjs';

assert.equal(IS_SUPERMARKET, true);
const mode = process.argv[2];
const DT = 1 / 30;

function repairScenario(hp, umbrella) {
  const sim = new RoomSimulation('RAINREVIEW', { random: seededRandom(18), raids: false });
  const human = sim.addPlayer('papa', 'Papa');
  const max = sim.addPlayer('bot', 'Max', undefined, { companion: true });
  sim.start(human.id);
  Object.assign(sim, { phase: 'wave', wave: 16, toSpawn: 1, spawnTimer: 1e9 });
  sim.zombies.clear();
  for (const door of sim.doors) Object.assign(door, { sealed: false, sealPending: false });
  Object.assign(human, { x: -12, y: 0, z: -5, grounded: true, vy: 0 });
  Object.assign(max, { x: 7.4, y: 0, z: 0, grounded: true, vy: 0, hp });
  max.umbrella.remaining = umbrella;
  max.umbrella.open = false;
  const east = sim.doors.find(door => door.id === 'east');
  east.boards.fill(0);
  const body = createCompanionBody(sim, max.id, { random: seededRandom(88) });
  let rainHp = 0, repairs = 0, inRainSeconds = 0;
  const damage = sim.damagePlayer.bind(sim);
  sim.damagePlayer = (player, amount, source = {}) => {
    if (player.id === max.id && source?.source === 'outside') rainHp += amount;
    return damage(player, amount, source);
  };
  const repair = sim.repairDoor.bind(sim);
  sim.repairDoor = (...args) => {
    const ok = repair(...args);
    if (ok && args[0] === max.id) repairs++;
    return ok;
  };
  const offer = () => describeSituation(sim, max.id).actions.find(action => action.value === 'repair:east');
  // Until the order ends (or for the whole time with untilDone false: the
  // body keeps ticking after a failed order, as it does between decisions).
  const run = (seconds, untilDone = true) => {
    const startedAt = sim.time;
    for (let tick = 0; tick < seconds * 30 && (!untilDone || body.status === 'running') && !max.downed; tick++) {
      sim.setInput(human.id, { forward: 0, strafe: 0, yaw: 0, pitch: 0 });
      body.tick(DT);
      sim.spawnTimer = 1e9;
      sim.tick(DT);
      if (sim.rainExposed(max)) inRainSeconds += DT;
    }
    return { elapsed: +(sim.time - startedAt).toFixed(2), status: body.status, downed: max.downed,
      hp: +max.hp.toFixed(2), umbrellaLeft: +max.umbrella.remaining.toFixed(2), rainHp: +rainHp.toFixed(2),
      repairs, inRainSeconds: +inRainSeconds.toFixed(2), doorHp: east.hp, doorMaxHp: east.maxHp, sheltered: sheltered(max) };
  };
  return { sim, max, east, body, offer, run };
}

if (mode === 'repair-offer') {
  const lethal = repairScenario(20, 0);
  console.log(JSON.stringify({ mode, hp: 20, umbrella: 0, offer: lethal.offer() }));
  assert.equal(lethal.offer(), undefined, 'HP 20 with an empty umbrella must not offer the lethal repair');
  const priced = repairScenario(100, 0);
  const description = priced.offer()?.description;
  const cost = rainCost(priced.sim, priced.max, 0, { door: priced.east }, 12 * .56);
  console.log(JSON.stringify({ mode, hp: 100, umbrella: 0, description, cost }));
  assert.match(description ?? '', /in the terrace rain \(~12 s, ~45 HP\)/);
  assert.equal(cost.seconds, 12);
  assert.equal(cost.burn, 45);
  assert.equal(cost.affordable, true);
} else if (mode === 'repair-stale-order') {
  // A repair order given while the umbrella still had seconds left, carried
  // out once it is empty (normal difficulty: 3 HP per second of rain).
  for (const hp of [20, 40]) {
    const c = repairScenario(hp, 0);
    c.body.setOrder({ kind: 'repair', doorId: 'east' });
    const result = c.run(15);
    const after = c.run(6, false);
    console.log(JSON.stringify({ mode, startHp: hp, ...result, after }));
    assert.equal(result.status, 'failed', 'the stale order must fail instead of finishing the lethal trip');
    assert.equal(result.downed, false);
    // It stops one second of rain (the walk back under the roof) before the
    // outdoor HP floor: never later, at most about two rain seconds early.
    assert.ok(result.hp - 6 <= 20 && result.hp > 20 - 3, `it stops just before the outdoor HP floor: ${result.hp}`);
    if (hp > 23) assert.ok(result.repairs > 0, 'with HP to spare it repairs until the floor');
    assert.equal(after.downed, false, 'never downed on the terrace');
    assert.ok(after.sheltered && after.hp > 0, 'back under the roof after the failed order');
    if (hp > 23) assert.ok(after.hp >= 20 - 1, `back under the roof at or near the floor, not below it: ${after.hp}`);
  }
} else if (mode === 'repair-full-umbrella') {
  const c = repairScenario(20, 100);
  const description = c.offer()?.description;
  console.log(JSON.stringify({ mode, description }));
  assert.match(description ?? '', /in the terrace rain \(~12 s, umbrella 100 s left\)/);
  c.body.setOrder({ kind: 'repair', doorId: 'east' });
  const result = c.run(15);
  console.log(JSON.stringify({ mode, ...result }));
  assert.equal(result.status, 'done');
  assert.equal(result.doorHp, result.doorMaxHp);
  assert.equal(result.hp, 20);
  assert.equal(result.rainHp, 0);
} else if (mode === 'routes') {
  const { routeInfo } = await import('../../companions/routes.mjs');
  const { SPACE, spaceTreadY } = await import('../../public/level-space.js');
  const revive = routeInfo({ x: 9, y: 0, z: 6 }, { x: 0, y: -3.4, z: 6 });
  const garden = SPACE.flights.find(flight => flight.id === 'garden-stair');
  const tread = routeInfo({ x: 11.2, y: spaceTreadY(garden, 5), z: 5 }, { x: 11.2, y: -3.4, z: 0 });
  const pile = routeInfo({ x: 6.3, y: 0, z: -9.3 }, { x: 11, y: 0, z: -6.5 });
  console.log(JSON.stringify({ mode, revive, tread, pile }));
  assert.equal(revive.flight, 'interior', 'the dry stock stair must beat the shorter rainy exterior flight');
  assert.ok(revive.rain > 2 && revive.rain < 6, `revive rain metres: ${revive.rain}`);
  assert.ok(tread.rain > 3, `the lower exterior tread is wet: ${tread.rain}`);
  assert.ok(pile.rain > 4 && pile.rain < pile.metres / 2, `the roofed opening leg stays dry: ${pile.rain} of ${pile.metres}`);
  // Sloped legs: a shelter beyond the end of the stretch must not count as dry
  // (a diagonal leg on the garden flight; the cellar to the lower exterior tread).
  const diagonal = routeInfo({ x: 11.84, y: -3.06, z: 2.55 }, { x: 10.31, y: -1.7, z: 5.27 });
  const lowTread = routeInfo({ x: -3.54, y: -3.4, z: -9.02 }, { x: 10.72, y: -3.23, z: 2.2 });
  console.log(JSON.stringify({ diagonal, lowTread }));
  assert.ok(diagonal.rain > 2.5, `the open garden flight is wet: ${diagonal.rain}`);
  assert.ok(lowTread.rain > .3, `the last steps onto the lower exterior tread are wet: ${lowTread.rain}`);
} else if (mode === 'loft-downed' || mode === 'loft-eliminated') {
  const { LOFT_POST, LOFT_POST_EXTERIOR } = await import('../../companions/body.mjs');
  const sim = new RoomSimulation('RAINLOFT', { random: seededRandom(7), raids: false });
  const human = sim.addPlayer('papa', 'Papa');
  const max = sim.addPlayer('max', 'Max', undefined, { companion: true });
  const lea = sim.addPlayer('lea', 'Léa', undefined, { companion: true });
  max.companionSlot = 0; lea.companionSlot = 1;
  sim.companionOrders = new Map();
  sim.start(human.id);
  Object.assign(sim, { phase: 'wave', wave: 6, toSpawn: 1, spawnTimer: 1e9 });
  sim.zombies.clear();
  Object.assign(human, { x: -10, y: 0, z: 3, grounded: true, vy: 0 });
  Object.assign(max, { x: 0, y: 0, z: 0, grounded: true, vy: 0 });
  Object.assign(lea, { ...LOFT_POST_EXTERIOR, grounded: true, vy: 0 });
  for (const bot of [max, lea]) sim.companionOrders.set(bot.id, { kind: 'loft' });
  if (mode === 'loft-downed') sim.damagePlayer(max, 1000, { id: 'test' });
  else Object.assign(max, { hp: 0, alive: false, downed: true });
  const body = createCompanionBody(sim, lea.id, { random: seededRandom(88) });
  body.setOrder({ kind: 'loft' });
  const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  let reached = false;
  for (let tick = 0; tick < 12 * 30 && !reached; tick++) {
    sim.setInput(human.id, { forward: 0, strafe: 0, yaw: 0, pitch: 0 });
    body.tick(DT); sim.spawnTimer = 1e9; sim.tick(DT);
    reached = flat(lea, LOFT_POST) < .45;
  }
  console.log(JSON.stringify({ mode, reached, firstAlive: max.alive, firstDowned: max.downed,
    distanceToInterior: +flat(lea, LOFT_POST).toFixed(2), distanceToExterior: +flat(lea, LOFT_POST_EXTERIOR).toFixed(2) }));
  assert.ok(reached, 'the surviving bot must take over the interior watch');
} else if (mode === 'follow-stairs') {
  const { SPACE, spaceTreadY } = await import('../../public/level-space.js');
  const followText = at => {
    const sim = new RoomSimulation('RAINFOLLOW', { random: seededRandom(18), raids: false });
    const human = sim.addPlayer('papa', 'Papa');
    const max = sim.addPlayer('bot', 'Max', undefined, { companion: true });
    sim.start(human.id);
    Object.assign(sim, { phase: 'wave', wave: 16, toSpawn: 1, spawnTimer: 1e9 });
    sim.zombies.clear();
    Object.assign(human, at, { grounded: true, vy: 0 });
    Object.assign(max, { x: 1, y: 0, z: 0, grounded: true, vy: 0 });
    return describeSituation(sim, max.id).actions.find(action => action.value === 'follow:papa')?.description;
  };
  const garden = SPACE.flights.find(flight => flight.id === 'garden-stair');
  const flight = followText({ x: 11.2, y: spaceTreadY(garden, 5), z: 5 });
  const terrace = followText({ x: 11.5, y: 0, z: -.5 });
  console.log(JSON.stringify({ mode, flight, terrace }));
  // The rain clause comes before the distance (which leaves the rain out),
  // so the whole line fits and the clause is never the part cut off.
  assert.match(flight ?? '', /; on the exterior stairs \(acid rain\): you follow them into the rain; \d+ m via the exterior stairs \(below you\)\.$/);
  assert.doesNotMatch(flight ?? '', /covered from the roofed passage/);
  assert.match(terrace ?? '', /; on the rainy terrace: covered from the roofed passage while in sight; \d+ m E\.$/);
} else if (mode === 'rainy-engagement') {
  const sim = new RoomSimulation('RAINENGAGE', { random: seededRandom(18), raids: false });
  const human = sim.addPlayer('papa', 'Papa');
  const max = sim.addPlayer('bot', 'Max', undefined, { companion: true });
  sim.start(human.id);
  Object.assign(sim, { phase: 'wave', wave: 16, toSpawn: 1, spawnTimer: 1e9 });
  sim.zombies.clear();
  Object.assign(human, { x: 9, y: 0, z: 1.2, grounded: true, vy: 0 });
  Object.assign(max, { x: 11, y: 0, z: -2, grounded: true, vy: 0 });
  const zombie = Object.assign(sim.spawnZombie(), { kind: 'walker', x: 9, y: 0, z: .5, hp: 30, maxHp: 30, speed: 0, attackAfter: Infinity, entered: true });
  let playerScans = 0, zombieScans = 0;
  const players = sim.players.values.bind(sim.players), zombies = sim.zombies.values.bind(sim.zombies);
  sim.players.values = () => { if (new Error().stack.includes('mateBitten')) playerScans++; return players(); };
  sim.zombies.values = () => { if (new Error().stack.includes('mateBitten')) zombieScans++; return zombies(); };
  const body = createCompanionBody(sim, max.id, { random: seededRandom(88) });
  body.setOrder({ kind: 'hold' });
  for (let tick = 0; tick < 4 * 30 && zombie.hp > 0; tick++) {
    sim.setInput(human.id, { forward: 0, strafe: 0, yaw: 0, pitch: 0 });
    body.tick(DT); sim.spawnTimer = 1e9; sim.tick(DT);
  }
  console.log(JSON.stringify({ mode, zombieHp: zombie.hp, playerScans, zombieScans, rainExposed: sim.rainExposed(max) }));
  assert.ok(playerScans > 0 && zombieScans > 0, 'the rainy-engagement branch still calls mateBitten');
  assert.ok(!(zombie.hp > 0), 'the companion still protects its bitten teammate');
} else if (mode === 'loft-text') {
  // The 'loft' action names the post the body takes (loftRank) and fits the
  // 170-character cap, unarmed and from the rain included.
  const { LOFT_POST_EXTERIOR } = await import('../../companions/body.mjs');
  const { SPACE, spaceTreadY } = await import('../../public/level-space.js');
  const sim = new RoomSimulation('RAINLOFTTEXT', { random: seededRandom(7), raids: false });
  const human = sim.addPlayer('papa', 'Papa');
  const max = sim.addPlayer('max', 'Max', undefined, { companion: true });
  const lea = sim.addPlayer('lea', 'Léa', undefined, { companion: true });
  max.companionSlot = 0; lea.companionSlot = 1;
  sim.companionOrders = new Map();
  sim.start(human.id);
  Object.assign(sim, { phase: 'wave', wave: 6, toSpawn: 1, spawnTimer: 1e9 });
  sim.zombies.clear();
  Object.assign(human, { x: -10, y: 0, z: 3, grounded: true, vy: 0 });
  Object.assign(max, { x: 4.6, y: -3.4, z: -9.5, grounded: true, vy: 0 });
  const loft = bot => describeSituation(sim, bot.id).actions.find(action => action.value === 'loft')?.description ?? '';
  // Max holds the first post: Léa's line is about the second one.
  sim.companionOrders.set(max.id, { kind: 'loft' });
  Object.assign(lea, { ...LOFT_POST_EXTERIOR, grounded: true, vy: 0 });
  const second = loft(lea);
  console.log(JSON.stringify({ mode, second }));
  assert.equal(second, 'Hold the second cellar post, watching the exterior stairs (right here).');
  // Max goes down: the first post is Léa's again.
  max.downed = true;
  assert.match(loft(lea), /^Hold the cellar post at the interior stair foot \(.+\); second exit: exterior stairs\.$/);
  max.downed = false;
  // Unarmed, on the terrace, in the rain (the case cut at 170 before).
  for (const stock of Object.values(lea.inventory)) if (stock && typeof stock === 'object') { stock.ammo = 0; stock.reserve = 0; }
  sim.companionOrders.clear();
  Object.assign(lea, { x: 11, y: 0, z: -5, grounded: true, vy: 0 });
  const unarmed = loft(lea);
  console.log(JSON.stringify({ mode, unarmedInRain: unarmed, length: unarmed.length }));
  assert.match(unarmed, /^No ammo: take cover\. Hold the cellar post at the interior stair foot \(.+through the terrace rain.+\); second exit: exterior stairs\.$/);
  // Every spot of the terrace and both flights, first and second post: a
  // complete sentence within the cap (the longest routes start there).
  const spots = [];
  for (let x = 8.5; x <= 14; x += 1) for (let z = -11; z <= 11; z += 1) spots.push({ x, y: 0, z });
  for (const flight of SPACE.flights) for (let z = flight.minZ; z <= flight.maxZ; z += .5) spots.push({ x: (flight.minX + flight.maxX) / 2, y: spaceTreadY(flight, z), z });
  let longest = '';
  for (const rank of [0, 1]) {
    sim.companionOrders.clear();
    if (rank) sim.companionOrders.set(max.id, { kind: 'loft' });
    for (const spot of spots) {
      Object.assign(lea, { ...spot, grounded: true, vy: 0 });
      const text = loft(lea);
      assert.ok(text.endsWith('.') && text.length < 170, `complete loft line: ${text}`);
      if (text.length > longest.length) longest = text;
    }
  }
  console.log(JSON.stringify({ mode, spots: spots.length * 2, longest, length: longest.length }));
} else {
  throw new Error(`unknown check: ${mode}`);
}

console.log(`${mode} verified`);
