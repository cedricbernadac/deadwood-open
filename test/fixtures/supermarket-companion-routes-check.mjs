import assert from 'node:assert/strict';
import { RoomSimulation } from '../../simulation.mjs';
import { createCompanionBody } from '../../companions/body.mjs';
import { describeSituation } from '../../companions/situation.mjs';
import { routeLength, routeFlight, routeInfo, crossesPartition } from '../../companions/routes.mjs';
import { IS_SUPERMARKET } from '../../public/level-config.js';
import { SPACE, spaceFlightAt } from '../../public/level-space.js';
import { seededRandom } from '../../validation/balance-report.mjs';
// Supermarket companion routes (lot 2): the stair landings no longer
// flip-flop, the dry interior stair beats the rainy exterior one, and budgets
// count the garden partition's detour. Real simulation, no model API.
assert.equal(IS_SUPERMARKET, true, 'fixture runs the supermarket level');
const DT = 1 / 30, flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// A quiet wave: no spawns, no raids, doors as requested. Rain exposure of the
// companion is totalled per tick (acid rain on the terrace/exterior stair).
function makeRoom({ seed = 18, wave = 16, doors = 'intact', humanAt, botAt } = {}) {
  const sim = new RoomSimulation('ROUTES', { random: seededRandom(seed), raids: false });
  const papa = sim.addPlayer('papa', 'Papa');
  const bot = sim.addPlayer('bot', 'Max', undefined, { companion: true });
  sim.start(papa.id);
  Object.assign(sim, { phase: 'wave', wave, toSpawn: 1, spawnTimer: 1e9 });
  sim.zombies.clear(); sim.spawnWarnings?.clear?.();
  for (const d of sim.doors) { d.sealed = false; d.sealPending = false; }
  if (doors === 'open') for (const d of sim.doors) d.boards.fill(0);
  Object.assign(papa, humanAt ?? { x: -3.5, y: 0, z: 0 }, { grounded: true, vy: 0 });
  Object.assign(bot, botAt ?? { x: 1, y: 0, z: 0 }, { grounded: true, vy: 0 });
  bot.points = 50000;
  const body = createCompanionBody(sim, bot.id, { random: seededRandom(88) });
  return { sim, papa, bot, body, rainExposedS: 0 };
}
// Run one order; success(ctx) ends it. Returns timings, the flights touched
// and the vertical reversals at a landing (the flip-flop of lot 1).
function runOrder(ctx, order, { seconds = 30, success, each } = {}) {
  const { sim, bot, body } = ctx;
  body.setOrder(order);
  let t = 0, succeededAt = null, status = 'running', bounces = 0, lastY = bot.y, dir = 0;
  const flights = new Set(), rainStart = ctx.rainExposedS;
  for (const ticks = Math.round(seconds * 30); t < seconds && succeededAt === null; t += DT) {
    for (const human of sim.players.values()) if (human.companion !== true && human.alive && !human.downed) sim.setInput(human.id, { forward: 0, strafe: 0, yaw: human.yaw ?? 0, pitch: 0 });
    status = body.tick(DT);
    sim.spawnTimer = 1e9;
    sim.tick(DT);
    if (sim.rainExposed(bot)) ctx.rainExposedS += DT;
    const flight = spaceFlightAt(bot.x, bot.z, bot.y); if (flight) flights.add(flight.id);
    const d = Math.sign(Math.round((bot.y - lastY) * 100)); if (d && dir && d !== dir) bounces++; if (d) dir = d; lastY = bot.y;
    each?.(ctx);
    if (success?.(ctx)) succeededAt = t + DT;
    if (status !== 'running' && succeededAt === null) break;
  }
  return { ok: succeededAt !== null, time: succeededAt === null ? null : +succeededAt.toFixed(2), status, reversals: bounces, flights: [...flights], rainS: +(ctx.rainExposedS - rainStart).toFixed(2) };
}
const empty = ctx => { for (const s of Object.values(ctx.bot.inventory)) { s.ammo = 0; s.reserve = 0; } };

// 1. The eight landing cases: no more flip-flop at either flight's ends.
{
  const cases = [
    { name: 'buy flamethrower from sales centre', bot: { x: 1, y: 0, z: 0 }, order: { kind: 'buy', rackId: 'flamethrower' }, ok: c => Object.hasOwn(c.bot.inventory, 'flamethrower') },
    { name: 'buy katana from sales NE', bot: { x: 6.3, y: 0, z: -9.3 }, prep: empty, order: { kind: 'buy', rackId: 'katana' }, ok: c => Object.hasOwn(c.bot.inventory, 'katana') },
    { name: 'buy fire axe from cellar N', bot: { x: 2, y: -3.4, z: -8.5 }, prep: empty, order: { kind: 'buy', rackId: 'fireaxe' }, ok: c => Object.hasOwn(c.bot.inventory, 'fireaxe') },
    { name: 'repair north door from cellar E', bot: { x: 11.5, y: -3.4, z: -1.5 }, prep: c => { const d = c.sim.doors.find(d => d.id === 'north'); d.boards[3] = d.boards[4] = 0; }, order: { kind: 'repair', doorId: 'north' }, ok: c => c.sim.doors.find(d => d.id === 'north').hp >= 300 },
    { name: 'revive human on terrace N from cellar S', bot: { x: 5, y: -3.4, z: 8.5 }, human: { x: 11, y: 0, z: -6 }, down: true, order: { kind: 'revive', playerId: 'papa' }, ok: c => !c.papa.downed },
    { name: 'revive human in cellar S from sales centre', bot: { x: 1, y: 0, z: 0 }, human: { x: 4, y: -3.4, z: 8.6 }, down: true, order: { kind: 'revive', playerId: 'papa' }, ok: c => !c.papa.downed },
    // post() is owned by another branch: arrival where it currently puts the
    // post, without bouncing, is all this case pins down.
    { name: 'defend east from cellar E', bot: { x: 11.5, y: -3.4, z: -1.5 }, order: { kind: 'defend', doorId: 'east' }, ok: c => c.bot.x < 8.3 && Math.abs(c.bot.y) < .1 && c.bot.input.forward === 0 }, // the east door's dry post, in the roofed terrace passage
    { name: 'collect ammo outside east from cellar S', bot: { x: 5, y: -3.4, z: 8.5 }, doors: 'open', prep: c => { c.bot.inventory.pistol.reserve = 0; c.sim.pickups.set('p', { id: 'p', kind: 'ammo', x: 18, y: 0, z: 3, amount: 1, special: false, expiresAt: 999, charge: 780 }); }, order: { kind: 'collect', pickupId: 'p' }, ok: c => !c.sim.pickups.has('p') },
  ];
  for (const k of cases) {
    const ctx = makeRoom({ botAt: k.bot, humanAt: k.human, doors: k.doors ?? 'intact' });
    k.prep?.(ctx);
    if (k.down) ctx.sim.damagePlayer(ctx.papa, 1000, { id: 'test' });
    const r = runOrder(ctx, k.order, { seconds: 30, success: k.ok });
    assert.ok(r.ok, `${k.name}: succeeds (${JSON.stringify(r)})`);
    assert.ok(r.reversals <= 2, `${k.name}: at most 2 vertical reversals, got ${r.reversals}`);
    assert.ok(r.time <= 12, `${k.name}: within about 12 s, got ${r.time}`);
    console.log(`landing case "${k.name}": ${r.time} s, ${r.reversals} reversals`);
  }
}
// 2. The south-cellar revive from the sales centre: the human survives its
// 25 s bleed-out, with the brain re-issuing the order 0.35 s after a failure.
{
  const ctx = makeRoom({ botAt: { x: 1, y: 0, z: 0 }, humanAt: { x: 4, y: -3.4, z: 8.6 }, doors: 'open' });
  const { sim, body, papa } = ctx;
  sim.damagePlayer(papa, 1000, { id: 'test' });
  body.setOrder({ kind: 'revive', playerId: 'papa' });
  let t = 0, reissue = 0, failures = 0;
  for (; t < 25 && papa.alive && papa.downed; t += DT) {
    const st = body.tick(DT); sim.spawnTimer = 1e9; sim.tick(DT);
    if (st === 'failed') { failures++; reissue = .35; body.setOrder(null); }
    if (reissue > 0 && (reissue -= DT) <= 0) body.setOrder({ kind: 'revive', playerId: 'papa' });
  }
  assert.ok(papa.alive && !papa.downed, `revived inside the bleed-out (${t.toFixed(2)} s, ${failures} failures)`);
  assert.ok(t < 12, `revive finished in ${t.toFixed(2)} s`);
  console.log(`south-cellar revive under bleed-out: ${t.toFixed(2)} s, ${failures} failures`);
}
// 3. Flight choice: the dry interior stair, no rain on either errand.
{
  for (const [name, at, rackId] of [['smg from cellar S', { x: 5, y: -3.4, z: 8.5 }, 'smg'], ['rocket from sales centre north', { x: 0, y: 0, z: 5 }, 'rocket']]) {
    const ctx = makeRoom({ botAt: at });
    const r = runOrder(ctx, { kind: 'buy', rackId }, { seconds: 30, success: c => Object.hasOwn(c.bot.inventory, rackId) });
    assert.ok(r.ok, `${name}: bought (${JSON.stringify(r)})`);
    assert.equal(r.rainS, 0, `${name}: no rain on the way (${r.rainS} s)`);
    assert.deepEqual(r.flights, ['stock-stair'], `${name}: the interior stair`);
    console.log(`${name}: ${r.time} s via ${r.flights}, ${r.rainS} s of rain`);
  }
  assert.equal(routeFlight({ x: 5, y: -3.4, z: 8.5 }, { x: 7.7, y: 0, z: 9.65 }), 'interior');
  assert.equal(routeFlight({ x: 0, y: 0, z: 5 }, { x: 12.82, y: -3.4, z: 0.2 }), 'interior');
}
// 4. The terrace coin pile from sales NE: swept through the partition
// opening (a 16.6 m route, not 5.5 m straight), not blacklisted.
{
  const ctx = makeRoom({ botAt: { x: 6.3, y: 0, z: -9.3 }, humanAt: { x: -12, y: 0, z: -9.8 } });
  ctx.sim.pickups.set('c', { id: 'c', kind: 'points', x: 11, y: 0, z: -6.5, amount: 100, expiresAt: ctx.sim.time + 60 });
  assert.ok(Math.abs(routeLength(ctx.bot, ctx.sim.pickups.get('c')) - 16.6) < .2, 'the route through the opening is 16.6 m');
  assert.ok(crossesPartition(ctx.bot, ctx.sim.pickups.get('c')), 'the straight line meets the partition');
  const offer = describeSituation(ctx.sim, 'bot').actions.find(a => a.value === 'coins')?.description;
  assert.match(offer ?? '', /within 17 m/, `offered with its real walked distance (${offer})`);
  const r = runOrder(ctx, { kind: 'coins' }, { seconds: 15, success: c => !c.sim.pickups.has('c') });
  assert.ok(r.ok, `terrace pile swept (${JSON.stringify(r)})`);
  // Given up piles are refused for 60 s: a fresh pile with the same id must
  // be offered again at once when the sweep really took the first one.
  ctx.sim.pickups.set('c', { id: 'c', kind: 'points', x: 11, y: 0, z: -6.5, amount: 100, expiresAt: ctx.sim.time + 60 });
  assert.ok(describeSituation(ctx.sim, 'bot').actions.some(a => a.value === 'coins'), 'the pile was never blacklisted');
  console.log(`terrace coins from sales NE: swept in ${r.time} s, offered again after`);
}
// 5. Cross-building trips ordered from outside: claim the crate, and collect
// a pickup, both on the far side from where the body stands outside.
{
  const ctx = makeRoom({ botAt: { x: 18, y: 0, z: -2 }, wave: 4 });
  ctx.sim.beginSupplyWave(); for (const d of ctx.sim.doors) d.boards.fill(0);
  const value = describeSituation(ctx.sim, 'bot').actions.find(a => a.value.startsWith('claim:'))?.value;
  assert.ok(value, 'a crate claim is offered from outside east');
  const r = runOrder(ctx, { kind: 'claim', bonus: value.slice(6) }, { seconds: 30, success: c => c.sim.supplyCrate.claimed.has('bot') });
  assert.ok(r.ok, `crate claimed from outside east (${JSON.stringify(r)})`);
  console.log(`claim from outside east: claimed in ${r.time} s`);
}
{
  const ctx = makeRoom({ botAt: { x: 18, y: 0, z: -2 }, doors: 'open' });
  ctx.bot.inventory.pistol.reserve = 0;
  ctx.sim.pickups.set('p', { id: 'p', kind: 'ammo', x: -17, y: 0, z: 2, amount: 1, special: false, expiresAt: 999, charge: 780 });
  const r = runOrder(ctx, { kind: 'collect', pickupId: 'p' }, { seconds: 30, success: c => !c.sim.pickups.has('p') });
  assert.ok(r.ok, `ammo collected from outside east (${JSON.stringify(r)})`);
  console.log(`collect from outside east: taken in ${r.time} s`);
}
// 6. relative(): a cellar target is priced in walked metres, staircase named.
{
  const ctx = makeRoom({ botAt: { x: 3, y: 0, z: 5 }, wave: 16 });
  ctx.bot.points = 6000;
  const action = describeSituation(ctx.sim, 'bot').actions.find(a => a.value === 'buy:flamethrower');
  assert.match(action?.description ?? '', /3[23] m via the interior stairs \(below you\)/, `cellar rack: ${action?.description}`);
  const info = routeInfo(ctx.bot, { x: 3, y: -3.4, z: 9.82 });
  assert.equal(info.flight, 'interior');
  assert.ok(info.metres > 31 && info.metres < 34, `route metres (${info.metres.toFixed(1)})`);
  console.log(`cellar rack described as: ${action.description}`);
}
console.log('supermarket companion routes verified');
