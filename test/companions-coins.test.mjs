import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation } from '../simulation.mjs';
import { seededRandom } from '../validation/balance-report.mjs';
import { describeSituation, orderFromValue, orderValue, ORDER_KINDS } from '../companions/situation.mjs';
import { createCompanionBody } from '../companions/body.mjs';
import { CompanionDirector, COMPANION_TIMING } from '../companions/director.mjs';
import { COINS, coinPiles, coinSweep } from '../companions/coins.mjs';

// Coins for the companions (owner, 13 October: "ils ont le droit de ramasser
// de l'argent ... une règle simple pour qu'ils ramassent quand même de
// l'argent"): the 'coins' order, offered when it is calm, and its sweep.
const TICK = 1 / 30;
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const inside = player => Math.abs(player.x) < 7.9 && Math.abs(player.z) < 5.9;
const values = result => result.actions.map(action => action.value);
const coinsLine = result => result.actions.find(action => action.value === 'coins')?.description ?? null;

function room({ humans = ['papa'], seed = 3, phase = 'quiet' } = {}) {
  const events = [];
  const sim = new RoomSimulation('COINS1', { random: seededRandom(seed), onEvent: event => events.push(event) });
  for (const id of humans) sim.addPlayer(id, id[0].toUpperCase() + id.slice(1));
  const max = sim.addPlayer('max', 'Max', undefined, { companion: true });
  sim.start(humans[0]);
  // One human and Max (1.5): the solo two doors, west and east.
  if (phase === 'quiet') { sim.beginWave(); Object.assign(sim, { toSpawn: 1, spawnTimer: 1e9 }); sim.zombies.clear(); sim.spawnWarnings.clear(); }
  if (phase === 'intermission') Object.assign(sim, { phase: 'intermission', wave: 1, timeLeft: 1e9 });
  return { sim, events, max, get: id => sim.players.get(id) };
}
const pile = (sim, id, x, z, amount = 30, extra = {}) => sim.pickups.set(id, { id, kind: 'points', x, y: 0, z, amount, special: false, expiresAt: sim.time + 90, ...extra }).get(id);
const zombieAt = (sim, id, x, z) => sim.zombies.set(id, { id, x, y: 0, z, yaw: 0, hp: 80, maxHp: 80, kind: 'walker', scale: 1, boss: false, speed: 0,
  attackAfter: Infinity, entered: false, doorId: 'west', stairState: null, pushX: 0, pushZ: 0, pushLeft: 0 }).get(id);

test('the coins order: a value without a parameter, and its body order', () => {
  assert.ok(ORDER_KINDS.includes('coins'));
  assert.deepEqual(orderFromValue('coins'), { kind: 'coins' });
  assert.equal(orderValue({ kind: 'coins' }), 'coins');
  assert.equal(orderFromValue('coins:p1'), null);
});

test('offered when calm with coins near it: how much, how far, and its coins next to the richest human', () => {
  const { sim, max, get } = room({ humans: ['papa', 'jules'] });
  Object.assign(max, { x: -3, z: 0, points: 40 });
  Object.assign(get('papa'), { x: 5, z: 4, points: 1450 }); Object.assign(get('jules'), { x: 6, z: -4, points: 300 });
  pile(sim, 'c1', -1, 0); pile(sim, 'c2', -3, -3, 25); pile(sim, 'c3', 2, -4.5);
  let result = describeSituation(sim, 'max');
  assert.equal(coinsLine(result), 'Pick up 3 coin piles (85 coins) within 7 m; you have 40 coins, Papa has 1,450.');
  assert.deepEqual(result.orders.coins, { kind: 'coins' });
  assert.match(result.text, /PICKUPS: .*3 coin piles inside \(85 coins\)/);
  assert.doesNotMatch(result.text, /never yours/);
  assert.equal(values(result).some(value => value.startsWith('collect:')), false, 'never a collect order for coins');
  // A zombie within 8 m of it: not calm, no sweep.
  zombieAt(sim, 'near', 4.5, 0);
  assert.equal(coinsLine(describeSituation(sim, 'max')), null);
  // Further away, but within 5 m of a pile: that pile is left.
  sim.zombies.clear(); zombieAt(sim, 'far', 5.2, -2);
  assert.equal(coinsLine(describeSituation(sim, 'max')), 'Pick up 2 coin piles (55 coins) within 3 m; you have 40 coins, Papa has 1,450.');
  sim.zombies.clear();
  // A pile within 3 m of a standing human is theirs: never race a child for it.
  Object.assign(get('jules'), { x: -1.5, z: 2.5 });
  assert.equal(coinsLine(describeSituation(sim, 'max')), 'Pick up 2 coin piles (55 coins) within 7 m; you have 40 coins, Papa has 1,450.');
  Object.assign(get('jules'), { x: 6, z: -4 });
  // A teammate down: never.
  sim.damagePlayer(get('jules'), 1000, { id: 'test' });
  assert.equal(coinsLine(describeSituation(sim, 'max')), null);
  get('jules').downed = false; get('jules').hp = 100;
  assert.ok(coinsLine(describeSituation(sim, 'max')));
  // Downed itself: only its kit or wait.
  sim.damagePlayer(max, 1000, { id: 'test' });
  assert.deepEqual(values(describeSituation(sim, 'max')), ['wait']);
});

test('which piles: on a floor it walks, within 10 m walked, never a gift', () => {
  const { sim, max, get } = room({ phase: 'intermission' });
  Object.assign(max, { x: -3, y: 0, z: 0, points: 0 });
  Object.assign(get('papa'), { x: 5, z: 4 });
  pile(sim, 'table', -1, 0, 30, { y: .8 }); // on a table top
  pile(sim, 'loft', 6, -4, 30, { y: 3.4 }); // 2 m up the staircase is about 17 m walked
  pile(sim, 'own', -2, 1, 100, { droppedBy: 'max', giftAt: 0, expiresAt: Infinity });
  assert.equal(coinSweep(sim, max), null);
  assert.equal(coinsLine(describeSituation(sim, 'max')), null, 'nothing it may sweep');
  // A human's gift is meant for someone: never swept (review of 13 October:
  // Papa's gift for Jules), but the magnet gives it to whoever stands nearest,
  // so Papa pays Max by dropping coins at his feet.
  pile(sim, 'gift', -4, -1, 100, { droppedBy: 'papa', giftAt: 0, expiresAt: Infinity });
  assert.deepEqual(coinPiles(sim, max), []);
  assert.equal(coinsLine(describeSituation(sim, 'max')), null);
  pile(sim, 'kill', -.5, 1.5, 24); // beyond the magnet's 2.6 m
  assert.match(coinsLine(describeSituation(sim, 'max')), /^Pick up 1 coin pile \(24 coins\) within 3 m; you have 0 coins, Papa has 0\.$/);
  for (let index = 0; index < 60 && sim.pickups.has('gift'); index++) { sim.setInput('papa', { forward: 0, strafe: 0, yaw: 0, pitch: 0 }); sim.tick(TICK); }
  assert.equal(sim.pickups.has('gift'), false);
  assert.equal(max.points, 100, 'the gift at its feet');
  // On the loft, the same pile is near.
  Object.assign(max, { x: 5, y: 3.4, z: -3 });
  assert.deepEqual(coinPiles(sim, max).map(item => item.pickup.id), ['loft']);
});

test('just outside an open doorway, with an umbrella that lasts the trip; the repair says to grab them first', () => {
  const { sim, max } = room();
  const west = sim.doors.find(door => door.id === 'west');
  Object.assign(max, { x: -4, z: 1, points: 0 });
  pile(sim, 'step', -10.2, .5, 30);
  assert.equal(coinsLine(describeSituation(sim, 'max')), null, 'never through intact boards');
  west.boards = [0, 0, 0, 0, 60];
  let result = describeSituation(sim, 'max');
  assert.equal(coinsLine(result), 'Pick up 1 coin pile (30 coins) within 7 m, 1 just outside the west door; you have 0 coins, Papa has 0.');
  assert.match(result.actions.find(action => action.value === 'repair:west').description, /30 coins lie just outside it: pick them up first \(coins\)/);
  pile(sim, 'yard', -11.5, 0, 30);
  assert.deepEqual(coinPiles(sim, max).map(item => item.pickup.id), ['step'], 'more than 3 m out is no doorstep');
  max.umbrella.remaining = 2;
  result = describeSituation(sim, 'max');
  assert.equal(coinsLine(result), null, 'no umbrella left for the rain out there');
  // The repair says so only when the coins action is there (review of 13 October).
  assert.doesNotMatch(result.actions.find(action => action.value === 'repair:west').description, /coins/);
  max.umbrella.remaining = 100;
  west.boards = [60, 0, 0, 0, 60]; // a standing survivor no longer gets through
  result = describeSituation(sim, 'max');
  assert.equal(coinsLine(result), null);
  assert.equal(result.actions.find(action => action.value === 'repair:west').description, 'Rebuild the west door boards (2/5 left); 4.1 m W.');
  west.boards = [0, 0, 0, 0, 60];
  for (const key of ['sealPending', 'sealed']) {
    west[key] = true;
    assert.equal(coinsLine(describeSituation(sim, 'max')), null, key);
    west[key] = false;
  }
});

test('keep while there are coins to sweep; the order is described', () => {
  const { sim, max, get } = room();
  Object.assign(max, { x: -3, z: 0 }); Object.assign(get('papa'), { x: 5, z: 4 });
  pile(sim, 'c1', -1, 0);
  let result = describeSituation(sim, 'max', { order: { kind: 'coins' }, orderSince: sim.time - 2 });
  assert.equal(values(result)[0], 'keep');
  assert.match(result.actions[0].description, /pick up the coins near you \(2 s so far\)/);
  assert.match(result.text, /ORDER: pick up the coins near you, for 2 s\./);
  sim.pickups.clear();
  result = describeSituation(sim, 'max', { order: { kind: 'coins' }, orderSince: sim.time - 2 });
  assert.equal(values(result).includes('keep'), false, 'nothing left: no keep');
});

// The body, in a real RoomSimulation at 30 Hz, ticked before sim.tick().
function sweepRoom({ seed = 7, phase = 'quiet' } = {}) {
  const { sim, events, max, get } = room({ seed, phase });
  Object.assign(get('papa'), { x: 5, z: 4 });
  const body = createCompanionBody(sim, 'max', { random: seededRandom(seed + 1000) });
  const run = (seconds, until = () => false, each = () => {}) => {
    for (let index = 0; index < Math.round(seconds * 30); index++) {
      sim.setInput('papa', { forward: 0, strafe: 0, yaw: 0, pitch: 0 });
      body.tick(TICK); sim.tick(TICK); each();
      if (until()) return true;
    }
    return false;
  };
  return { sim, events, max, body, run };
}
const takenBy = (events, id) => events.filter(event => event.event === 'pickup' && event.id === id).map(event => event.pickupId);

test('the sweep: the nearest pile, then the next within a few metres, and done', () => {
  for (const phase of ['quiet', 'intermission']) {
    const { sim, events, max, body, run } = sweepRoom({ phase });
    Object.assign(max, { x: -1.7, z: 1.7, points: 0 });
    pile(sim, 'a', -5, 1.5, 18); pile(sim, 'b', -6, -1.5, 24); pile(sim, 'c', 4.5, -4, 60);
    body.setOrder({ kind: 'coins' });
    const start = sim.time;
    assert.ok(run(COINS.seconds + 1, () => body.status !== 'running'), phase);
    assert.equal(body.status, 'done', phase);
    assert.deepEqual(takenBy(events, 'max'), ['a', 'b'], `${phase}: the magnet does the rest`);
    assert.equal(max.points, 42);
    assert.ok(sim.pickups.has('c'), `${phase}: the far one is left`);
    assert.ok(sim.time - start < 3, `${phase}: a short sweep (${(sim.time - start).toFixed(2)} s)`);
  }
});

test('the sweep leaves a pile to a human who comes for it', () => {
  const { sim, events, max, body, run } = sweepRoom();
  Object.assign(max, { x: -5, z: 0, points: 0 });
  pile(sim, 'p', -1, 3);
  body.setOrder({ kind: 'coins' });
  run(.3);
  assert.equal(body.status, 'running');
  Object.assign(sim.players.get('papa'), { x: -1, z: .8 }); // Jules, say, 2.2 m from it
  assert.ok(run(COINS.seconds + 1, () => body.status !== 'running'));
  assert.equal(body.status, 'failed', 'it picked nothing up');
  run(1);
  assert.deepEqual(takenBy(events, 'max'), []);
  assert.deepEqual(takenBy(events, 'papa'), ['p']);
});

test('the sweep ends after about 8 s, and fails as soon as a zombie comes within 8 m', () => {
  const { sim, max, body, run } = sweepRoom();
  Object.assign(max, { x: -5, z: 0 });
  // Coins keep coming a few metres away: it stops all the same.
  const spots = [{ x: -6.5, z: -1 }, { x: -4, z: 1.5 }];
  let turn = 0;
  const feed = () => { if (![...sim.pickups.values()].some(pickup => pickup.kind === 'points')) pile(sim, `f${turn}`, spots[turn % 2].x, spots[turn++ % 2].z, 5); };
  feed();
  body.setOrder({ kind: 'coins' });
  const start = sim.time;
  assert.ok(run(12, () => body.status !== 'running', feed));
  assert.equal(body.status, 'done');
  assert.ok(Math.abs(sim.time - start - COINS.seconds) < .1, `${(sim.time - start).toFixed(2)} s`);
  assert.ok(turn >= 3, `${turn} piles in the meantime`);
  // A zombie coming: failed once it is within 8 m (when keep goes too), so
  // the brain is asked again while it is still far. Review of 13 October: it
  // failed at 2 m, and the body then stood there without shooting until the
  // brain answered, bitten meanwhile.
  sim.pickups.clear();
  Object.assign(max, { x: -5, z: 0 });
  pile(sim, 'far', 4, 0); // 9 m east: it walks away from the zombie
  body.setOrder({ kind: 'coins' });
  run(.2);
  assert.equal(body.status, 'running');
  const runner = zombieAt(sim, 'runner', max.x - 8.3, max.z); // from the west, faster than it runs
  assert.ok(run(4, () => body.status !== 'running', () => { runner.x += .3; }));
  assert.equal(body.status, 'failed');
  assert.ok(flat(runner, max) > 7.5, `failed with the zombie ${flat(runner, max).toFixed(1)} m away`);
  assert.ok(sim.pickups.has('far'));
});

// Review of 13 October: from in front of the stair foot, the straight way to
// coins under the flight climbed its first tread and stuck there for 8 s, and
// the same pile was offered again and again.
test('coins under the staircase, from in front of its foot: round the flight, never up it', () => {
  for (const start of [{ x: 3, z: 3 }, { x: 3.8, z: 3.6 }, { x: 4.4, z: 3 }]) for (const at of [{ x: 3.8, z: -1.2 }, { x: 4.27, z: -1.81 }, { x: 3.4, z: -.6 }]) {
    const { sim, events, max, body, run } = sweepRoom();
    Object.assign(max, { ...start, y: 0, points: 0 });
    pile(sim, 'under', at.x, at.z);
    assert.deepEqual(coinSweep(sim, max)?.piles.map(item => item.pickup.id), ['under']);
    body.setOrder({ kind: 'coins' });
    let climbed = 0;
    run(COINS.seconds + 1, () => body.status !== 'running', () => { climbed = Math.max(climbed, max.y); });
    const label = `from (${start.x}, ${start.z}) to (${at.x}, ${at.z})`;
    assert.equal(body.status, 'done', label);
    assert.deepEqual(takenBy(events, 'max'), ['under'], label);
    assert.ok(climbed < .1, `${label}: up to ${climbed.toFixed(2)} m`);
  }
});

test('a pile it cannot reach is given up for a while: failed, and offered no more', () => {
  const { sim, max, body, run } = sweepRoom();
  Object.assign(max, { x: -4.6, z: .6, points: 0 });
  pile(sim, 'sofa', -4.6, 2.8); // inside the sofa seat: no way to it, no magnet through it
  assert.deepEqual(coinSweep(sim, max)?.piles.map(item => item.pickup.id), ['sofa']);
  body.setOrder({ kind: 'coins' });
  const start = sim.time;
  assert.ok(run(COINS.seconds + 1, () => body.status !== 'running'));
  assert.equal(body.status, 'failed', 'nothing picked up');
  assert.ok(sim.time - start < COINS.stuck + 2, `given up after ${(sim.time - start).toFixed(1)} s`);
  assert.equal(coinsLine(describeSituation(sim, 'max')), null, 'not offered again');
  pile(sim, 'other', -2.5, 3.8, 20);
  assert.deepEqual(coinSweep(sim, max)?.piles.map(item => item.pickup.id), ['other'], 'another one is');
  sim.pickups.delete('other');
  sim.time += COINS.forget;
  assert.deepEqual(coinSweep(sim, max)?.piles.map(item => item.pickup.id), ['sofa'], `again after ${COINS.forget} s`);
});

test('a pile just outside a broken door: out through the doorway, back in, done', () => {
  const { sim, events, max, body, run } = sweepRoom();
  sim.doors.find(door => door.id === 'west').boards.fill(0);
  Object.assign(max, { x: -4, z: 1, points: 0 });
  pile(sim, 'step', -10.5, .5, 30);
  assert.deepEqual(coinSweep(sim, max).piles.map(item => item.pickup.id), ['step']);
  body.setOrder({ kind: 'coins' });
  let out = false;
  assert.ok(run(COINS.seconds + 1, () => body.status !== 'running', () => { out ||= !inside(max); }));
  assert.equal(body.status, 'done');
  assert.deepEqual(takenBy(events, 'max'), ['step']); assert.equal(max.points, 30);
  assert.ok(out, 'it stepped out for it');
  assert.ok(inside(max), `back inside (${max.x.toFixed(2)}, ${max.z.toFixed(2)})`);
  assert.equal(max.hp, 100, 'the umbrella took the rain');
});

test('the director asks again right after a sweep ends', async () => {
  let director = null;
  const sim = new RoomSimulation('COINS2', { random: seededRandom(5), onEvent: message => director?.onEvent(message) });
  sim.addPlayer('papa', 'Papa');
  const hub = { connected: true, requests: [] };
  hub.request = payload => new Promise(resolve => hub.requests.push({ payload, resolve, at: sim.time }));
  director = new CompanionDirector(sim, hub, { createBody: createCompanionBody, describe: describeSituation, random: seededRandom(9) });
  assert.equal(director.setCount(1, 'papa'), true);
  sim.start('papa');
  Object.assign(sim, { phase: 'wave', wave: 1, toSpawn: 1, spawnTimer: 1e9 });
  const [entry] = director.entries.values(), max = sim.players.get(entry.id);
  Object.assign(sim.players.get('papa'), { x: 5, z: 4 }); Object.assign(max, { x: -1.7, z: 1.7 });
  pile(sim, 'a', -6, 1.5, 18);
  let answered = 0, doneAt = null;
  for (let index = 0; index < 30 * 6 && doneAt === null; index++) {
    const now = sim.time;
    director.step(TICK); sim.setInput('papa', { forward: 0, strafe: 0, yaw: 0, pitch: 0 }); sim.tick(TICK);
    for (const request of hub.requests.slice(answered)) {
      answered++;
      if (answered === 1) { assert.ok(request.payload.actions.some(action => action.value === 'coins')); request.resolve({ type: 'decision', action: 'coins', confidence: .8 }); }
      else request.resolve({ type: 'decision', action: 'keep', confidence: .8 });
    }
    await new Promise(resolve => setImmediate(resolve));
    if (answered && entry.value === null && entry.body.status === 'done') doneAt = now; // the director saw it in that step
  }
  assert.ok(doneAt !== null, 'the sweep ended');
  assert.equal(max.points, 18);
  for (let index = 0; index < 30 && !hub.requests.some(request => request.at >= doneAt); index++) { director.step(TICK); sim.tick(TICK); }
  const next = hub.requests.find(request => request.at >= doneAt);
  assert.ok(next, 'asked again');
  assert.ok(next.at - doneAt <= COMPANION_TIMING.trigger + TICK + 1e-9, `${(next.at - doneAt).toFixed(2)} s after the sweep`);
  assert.equal(next.payload.current, null);
  assert.match(next.payload.situation, /RECENT: .*your order coins is done/);
});
