import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WEAPONS } from '../simulation.mjs';
import { seededRandom } from '../validation/balance-report.mjs';
import { createCompanionBody, LOFT_POST, AIM } from '../companions/body.mjs';
import { rollCompanionProfile } from '../companions/profiles.mjs';
import { describeSituation } from '../companions/situation.mjs';
import { ARMORY, LOFT, REVIVE, STAIRS, stairTreadY } from '../public/rules.js';

// The companion body (companions/DESIGN.md, "Orders"): a real RoomSimulation
// at 30 Hz, the body ticked before sim.tick() as the director will do.
const TICK = 1 / 30;
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const inside = player => Math.abs(player.x) < 7.9 && Math.abs(player.z) < 5.9;
const onFlight = player => player.x > STAIRS.minX - .1 && player.x < STAIRS.maxX + .1 && player.z > STAIRS.minZ && player.z < STAIRS.maxZ
  && player.y > .3 && player.y < LOFT.y - .1;

function room({ seed = 7, phase = 'quiet', wave = 1, others = [], mates = [], profile, playerProfile } = {}) {
  const events = [];
  const sim = new RoomSimulation('BODY01', { random: seededRandom(seed), onEvent: event => events.push(event) });
  const humans = ['papa', ...others].map(id => sim.addPlayer(id, id[0].toUpperCase() + id.slice(1)));
  const [papa] = humans;
  const max = sim.addPlayer('max', 'Max', undefined, { companion: true });
  if (playerProfile) max.companionProfile = playerProfile;
  for (const id of mates) sim.addPlayer(id, id[0].toUpperCase() + id.slice(1), undefined, { companion: true }); // bodies of their own
  sim.start('papa');
  if (phase === 'quiet') Object.assign(sim, { phase: 'wave', wave, toSpawn: 1, spawnTimer: 1e9 }); // a wave that never spawns nor ends
  if (phase === 'intermission') Object.assign(sim, { phase: 'intermission', wave, timeLeft: 1e9 });
  const body = createCompanionBody(sim, 'max', { random: seededRandom(seed + 1000), profile });
  const trace = { left: false, jumped: false, fastestFall: 0, statuses: new Set() };
  const run = (seconds, until = () => false, each = () => {}) => {
    for (let index = 0; index < Math.round(seconds * 30); index++) {
      for (const human of humans) if (human.alive && !human.downed) sim.setInput(human.id, { forward: 0, strafe: 0, yaw: 0, pitch: 0 });
      trace.statuses.add(body.tick(TICK));
      sim.tick(TICK);
      if (!inside(max)) trace.left = true;
      if (max.vy > 1e-6) trace.jumped = true;
      trace.fastestFall = Math.max(trace.fastestFall, -(max.vy ?? 0));
      each();
      if (until()) return true;
    }
    return false;
  };
  return { sim, events, papa, humans, max, body, run, trace };
}
const statue = (sim, point, extra = {}) => Object.assign(sim.spawnZombie(), { y: 0, speed: 0, ...point, ...extra });
const ofMax = (events, name) => events.filter(event => event.event === name && event.id === 'max');
// Physical launches carry no hits: count their actual later contacts, matched
// by projectile id, while melee/explosive events retain immediate results.
const landedHits = (events, shots) => {
  const ids = new Set(shots.flatMap(shot => (shot.projectiles ?? []).map(projectile => projectile.id)));
  return shots.reduce((sum, shot) => sum + (shot.ballistic ? 0 : shot.hits), 0)
    + ofMax(events, 'bullet-impact').filter(impact => impact.stop === 'zombie' && ids.has(impact.projectileId)).length;
};
const boardDamage = events => events.filter(event => (event.event === 'board' || event.event === 'door') && event.id === 'max');

test('walks the cabin, up to the loft and back down, with player physics only', () => {
  const { sim, events, papa, max, body, run, trace } = room({ phase: 'intermission', wave: 3 });
  body.setOrder({ kind: 'loft' });
  assert.ok(run(12, () => flat(max, LOFT_POST) < .45 && Math.abs(max.y - LOFT.y) < .05), 'reaches the loft post');
  for (const doorId of ['west', 'east', 'north', 'south']) {
    body.setOrder({ kind: 'defend', doorId });
    const door = sim.doors.find(item => item.id === doorId);
    const posted = () => {
      const depth = -((max.x - door.x) * door.outX + (max.z - door.z) * door.outZ), lateral = Math.abs((max.x - door.x) * door.outZ - (max.z - door.z) * door.outX);
      return max.y < .05 && depth > 2.1 && depth < 3.4 && lateral > 1.3;
    };
    assert.ok(run(15, posted), `reaches a post inside the ${doorId} door, out of its passage`);
    assert.equal(body.status, 'running');
  }
  // Following a human up the stairs, then back down.
  Object.assign(papa, { x: 6, y: LOFT.y, z: 4 });
  body.setOrder({ kind: 'follow', playerId: 'papa' });
  assert.ok(run(15, () => Math.abs(max.y - LOFT.y) < .05 && flat(max, papa) <= 4), 'follows onto the loft');
  run(2);
  assert.ok(flat(max, papa) >= 1.5 && flat(max, papa) <= 4.2 && Math.abs(max.y - LOFT.y) < .05, 'keeps its distance');
  Object.assign(papa, { x: -5, y: 0, z: -4 });
  assert.ok(run(15, () => max.y < .05 && flat(max, papa) <= 4), 'follows back down the stairs');
  assert.equal(body.status, 'running');
  assert.equal(trace.left, false, 'never outside the cabin');
  assert.equal(trace.jumped, false, 'never jumps');
  assert.equal(events.some(event => event.event === 'hit' && event.id === 'max'), false, 'no fall, no damage');
});

test('revives a teammate downed on the loft from the ground floor', () => {
  const { sim, events, papa, max, body, run, trace } = room();
  Object.assign(papa, { x: 5.5, y: LOFT.y, z: 3 });
  sim.damagePlayer(papa, 1000, { id: 'test' });
  assert.equal(papa.downed, true);
  assert.equal(max.y, 0);
  body.setOrder({ kind: 'revive', playerId: 'papa' });
  assert.ok(run(REVIVE.bleedOut, () => body.status !== 'running'));
  assert.equal(body.status, 'done');
  assert.equal(papa.downed, false); assert.equal(papa.alive, true);
  assert.ok(ofMax(events, 'revive').some(event => event.targetId === 'papa' && !event.kit));
  assert.ok(Math.abs(max.y - LOFT.y) < .05, 'climbed the stairs');
  assert.equal(trace.left, false);
});

test('repairs the west door next to the bat rack without buying anything', () => {
  const { sim, events, max, body, run } = room({ wave: 4 });
  sim.configureDefendedDoors(2);
  const west = sim.doors.find(door => door.id === 'west');
  west.hp = 50;
  Object.assign(max, { x: -6.9, z: -3.6, points: 1000 }); // within reach of the bat rack
  let interacts = 0;
  const interact = sim.interact.bind(sim);
  sim.interact = (...args) => { interacts++; return interact(...args); };
  body.setOrder({ kind: 'repair', doorId: 'west' });
  assert.ok(run(20, () => body.status !== 'running'));
  assert.equal(body.status, 'done');
  assert.equal(west.hp, west.maxHp);
  assert.ok(ofMax(events, 'repair').length >= 10);
  assert.equal(events.some(event => event.event === 'purchase'), false);
  assert.deepEqual(Object.keys(max.inventory), ['pistol']);
  assert.ok(max.points >= 1000);
  assert.equal(interacts, 0, 'repairs never go through interact()');
  // A sealed door cannot be repaired.
  const south = sim.doors.find(door => door.id === 'south');
  Object.assign(south, { sealed: true, sealPending: false });
  body.setOrder({ kind: 'repair', doorId: 'south' });
  assert.equal(body.tick(TICK), 'failed');
});

test('a protector defends a door through a short wave next to an idle human: kills, a human hit rate, a light tick', t => {
  let shots = 0, hits = 0, cost = 0, ticks = 0;
  for (const seed of [1, 2, 3]) {
    const { sim, events, papa, max, body, run } = room({ seed, phase: 'countdown', profile: rollCompanionProfile('protector', () => .5) });
    papa.reviveShieldUntil = Infinity; // the idle human cannot fall
    max.inventory.pistol.reserve = 500; // keeps firing the whole wave
    const saving = []; // per tick: a zombie was on the human (an urgent save)
    body.setOrder({ kind: 'defend', doorId: 'west' });
    for (let index = 0; index < 30 * 90 && sim.phase !== 'intermission'; index++) {
      sim.setInput('papa', { forward: 0, strafe: 0, yaw: 0, pitch: 0 });
      const start = performance.now();
      body.tick(TICK);
      cost += performance.now() - start; ticks++;
      sim.tick(TICK);
      saving.push([...sim.zombies.values()].some(zombie => zombie.hp > 0 && flat(zombie, papa) < 2));
    }
    const fired = ofMax(events, 'shot');
    shots += fired.length; hits += landedHits(events, fired);
    assert.ok(ofMax(events, 'kill').length >= 4, 'kills');
    // Never a board of ours — bar a round gone wide while shooting a zombie
    // that was biting the idle human (DESIGN: protect first, planks or not).
    for (const event of boardDamage(events)) {
      const at = Math.round(event.time * 30);
      assert.ok(saving.some((flag, index) => flag && Math.abs(index - at) <= 3),
        `seed ${seed}: board damage at t=${event.time.toFixed(1)} without a biter on the human`);
    }
    run(3); // after a peek past the human, back to its post
    assert.ok(max.x + 8 > 2.1 && max.x + 8 < 3.4 && Math.abs(max.z) > 1.3,
      `holds its post by the west door: seed ${seed}, at (${max.x.toFixed(2)}, ${max.y.toFixed(2)}, ${max.z.toFixed(2)}), phase ${sim.phase}`);
  }
  const rate = hits / shots;
  assert.ok(shots >= 60);
  assert.ok(rate >= .25 && rate <= .85, `hit rate ${(rate * 100).toFixed(0)} %`);
  assert.ok(cost / ticks < .5, `${(cost / ticks).toFixed(3)} ms per tick`);
  t.diagnostic(`${shots} shots, hit rate ${(rate * 100).toFixed(0)} %, ${(cost / ticks).toFixed(3)} ms per body tick over ${ticks} ticks`);
});

test('mateBitten stays lazy outside rainy engagement on the cabin', t => {
  const { sim, max, body } = room({ others: ['jules', 'lea'], wave: 6 });
  sim.zombies.clear();
  for (const [player, x] of [[max, 0], [sim.players.get('papa'), 1], [sim.players.get('jules'), 2], [sim.players.get('lea'), 3]])
    Object.assign(player, { x, y: 0, z: 0, grounded: true, vy: 0 });
  for (let index = 0; index < 50; index++) statue(sim, { x: 20 + index * .1, z: 20 }, { hp: 30, maxHp: 30, attackAfter: Infinity, entered: true });
  let playerScans = 0, zombieScans = 0;
  const players = sim.players.values.bind(sim.players), zombies = sim.zombies.values.bind(sim.zombies);
  sim.players.values = () => { if (new Error().stack.includes('mateBitten')) playerScans++; return players(); };
  sim.zombies.values = () => { if (new Error().stack.includes('mateBitten')) zombieScans++; return zombies(); };
  body.setOrder({ kind: 'hold' });
  for (let tick = 0; tick < 30; tick++) { sim.time += TICK; body.tick(TICK); }
  t.diagnostic(`${playerScans} player scans and ${zombieScans} zombie scans from mateBitten in 30 cabin ticks`);
  assert.deepEqual({ playerScans, zombieScans }, { playerScans: 0, zombieScans: 0 });
});

test('a shoot order steps round cover, kills its zombie and reports done', () => {
  const { sim, events, max, body, run, trace } = room();
  Object.assign(max, { x: 1, z: 1 });
  const zombie = statue(sim, { x: 0, z: -4 }); // behind the partition
  const decoy = statue(sim, { x: -5, z: 3.5 }); // in plain view, but not ordered
  body.setOrder({ kind: 'shoot', zombieId: zombie.id });
  assert.ok(run(10, () => body.status !== 'running'));
  assert.equal(body.status, 'done');
  assert.ok(ofMax(events, 'kill').some(event => event.zombieId === zombie.id));
  assert.ok(sim.zombies.has(decoy.id), 'only the named enemy');
  assert.ok(flat(max, { x: 1, z: 1 }) > .5 && flat(max, { x: 1, z: 1 }) <= 6.3, 'stepped aside, at most 6 m');
  assert.equal(trace.left, false);
  // Out of reach and out of sight: the order fails after 6 s without a line.
  const far = statue(sim, { x: 0, z: -45 });
  body.setOrder({ kind: 'shoot', zombieId: far.id });
  const start = sim.time;
  assert.ok(run(9, () => body.status !== 'running'));
  assert.equal(body.status, 'failed');
  assert.ok(sim.time - start >= 6 && sim.time - start < 7);
});

test('buys a weapon at a rack during the intermission, and fails a refused purchase', () => {
  const { sim, events, max, body, run } = room({ phase: 'intermission', wave: 2 });
  max.points = 500;
  body.setOrder({ kind: 'buy', rackId: 'shotgun' });
  assert.ok(run(15, () => body.status !== 'running'));
  assert.equal(body.status, 'done');
  assert.ok(Object.hasOwn(max.inventory, 'shotgun'));
  assert.equal(max.weapon, 'shotgun'); assert.equal(max.points, 150);
  assert.ok(ofMax(events, 'purchase').some(event => event.crateId === 'shotgun'));
  body.setOrder({ kind: 'buy', rackId: 'smg' }); // locked until wave 4, and too dear
  assert.ok(run(15, () => body.status !== 'running'));
  assert.equal(body.status, 'failed');
  assert.equal(max.points, 150);
  sim.wave = 6; max.points = 1500;
  body.setOrder({ kind: 'buy', rackId: 'assault' }); // on the loft
  assert.ok(run(15, () => body.status !== 'running'));
  assert.equal(body.status, 'done'); assert.equal(max.weapon, 'assault');
});

// Owner, 13 October: Max bought the SMG holding his shotgun, and the purchase
// (it replaces the weapon in hand) dropped the shotgun, not the pistol. "Le
// katana ... il n'y a pas besoin de munitions": a blade keeps its price.
test('with every slot full, a purchase drops the weapon it can best spare and keeps its best ones', () => {
  const buy = ({ wave = 4, inventory, weapon, rackId, backpack = false, points = 5000 }) => {
    const { sim, events, papa, max, body, run } = room({ phase: 'intermission', wave });
    Object.assign(max, { inventory: structuredClone(inventory), weapon, points, backpack });
    body.setOrder({ kind: 'buy', rackId });
    assert.ok(run(15, () => body.status !== 'running'));
    return { sim, events, papa, max, body, dropped: ofMax(events, 'weapon-drop').map(event => event.weapon) };
  };
  const owned = max => Object.keys(max.inventory).sort();
  const pair = { pistol: { ammo: 12, reserve: 36 }, shotgun: { ammo: 5, reserve: 20 } };
  for (const weapon of ['shotgun', 'pistol']) {
    const { sim, max, body, dropped } = buy({ inventory: pair, weapon, rackId: 'smg' });
    assert.equal(body.status, 'done', `holding the ${weapon}`);
    assert.deepEqual(owned(max), ['shotgun', 'smg'], `holding the ${weapon}: it keeps the shotgun and the SMG`);
    assert.deepEqual(dropped, ['pistol']);
    assert.ok([...sim.pickups.values()].some(pickup => pickup.kind === 'weapon' && pickup.weapon === 'pistol'), 'the pistol lies by the rack');
    assert.deepEqual(max.inventory.shotgun, { ammo: 5, reserve: 20 }, 'its shotgun as it was');
    assert.equal(max.weapon, 'smg', 'the SMG it bought in hand, better than its shotgun');
    assert.equal(max.points, 5000 - 900);
  }
  // A backpack: three weapons leave a slot free (nothing goes); four fill it.
  const three = { pistol: { ammo: 12, reserve: 36 }, shotgun: { ammo: 8, reserve: 24 }, katana: { ammo: 0, reserve: 0 } };
  let result = buy({ inventory: three, weapon: 'shotgun', rackId: 'smg', backpack: true });
  assert.deepEqual(owned(result.max), ['katana', 'pistol', 'shotgun', 'smg']);
  assert.deepEqual(result.dropped, []);
  result = buy({ wave: 6, inventory: { ...three, smg: { ammo: 40, reserve: 120 } }, weapon: 'smg', rackId: 'assault', backpack: true });
  assert.equal(result.body.status, 'done');
  assert.deepEqual(owned(result.max), ['assault', 'katana', 'shotgun', 'smg'], 'the pistol goes, the katana stays');
  assert.deepEqual(result.dropped, ['pistol']);
  assert.equal(result.max.weapon, 'assault');
  // A katana outranks a shotgun: with a katana and a pistol, the pistol goes;
  // the shotgun is in hand (a gun with ammo before a blade).
  result = buy({ inventory: { katana: { ammo: 0, reserve: 0 }, pistol: { ammo: 12, reserve: 36 } }, weapon: 'katana', rackId: 'shotgun' });
  assert.deepEqual(owned(result.max), ['katana', 'shotgun']);
  assert.deepEqual(result.dropped, ['pistol']);
  assert.equal(result.max.weapon, 'shotgun');
  // A gun with no ammo at all goes first, even a dearer one.
  result = buy({ inventory: { rifle: { ammo: 0, reserve: 0 }, shotgun: { ammo: 8, reserve: 24 } }, weapon: 'shotgun', rackId: 'smg' });
  assert.deepEqual(owned(result.max), ['shotgun', 'smg']);
  assert.deepEqual(result.dropped, ['rifle']);
  assert.equal(result.max.weapon, 'smg');
  // In hand after: the weapon bought (it comes full), unless the one it held
  // is better for the fight; never a dearer one it was not holding (review of
  // 13 October: back to a rocket launcher with three rockets).
  result = buy({ inventory: { pistol: { ammo: 12, reserve: 36 }, rifle: { ammo: 30, reserve: 90 } }, weapon: 'rifle', rackId: 'smg' });
  assert.deepEqual(owned(result.max), ['rifle', 'smg']);
  assert.deepEqual(result.dropped, ['pistol']);
  assert.equal(result.max.weapon, 'rifle', 'the machine gun back in hand');
  result = buy({ wave: 12, inventory: { minigun: { ammo: 100, reserve: 200 }, pistol: { ammo: 12, reserve: 36 } }, weapon: 'minigun', rackId: 'shotgun' });
  assert.deepEqual(owned(result.max), ['minigun', 'shotgun']);
  assert.equal(result.max.weapon, 'minigun', 'not a shotgun over its minigun');
  result = buy({ wave: 16, inventory: { rocket: { ammo: 1, reserve: 2 }, smg: { ammo: 40, reserve: 120 } }, weapon: 'smg', rackId: 'minigun' });
  assert.deepEqual(owned(result.max), ['minigun', 'rocket']);
  assert.deepEqual(result.dropped, ['smg']);
  assert.equal(result.max.weapon, 'minigun', 'the minigun it bought, not the rocket launcher');
  // A purchase refused (too dear): nothing goes, and the weapon in hand is back.
  result = buy({ inventory: pair, weapon: 'shotgun', rackId: 'smg', points: 500 });
  assert.equal(result.body.status, 'failed');
  assert.deepEqual(owned(result.max), ['pistol', 'shotgun']);
  assert.deepEqual(result.dropped, []);
  assert.equal(result.max.weapon, 'shotgun');
  // Humans keep the rule of the game: a purchase replaces the weapon in hand.
  const { sim, events, papa } = room({ phase: 'intermission', wave: 4 });
  const rack = ARMORY.find(item => item.id === 'smg');
  Object.assign(papa, { x: rack.x + Math.sin(rack.facing) * .95, z: rack.z + Math.cos(rack.facing) * .95, points: 5000, weapon: 'shotgun', inventory: structuredClone(pair) });
  assert.ok(sim.buyWeapon('papa', 'smg'));
  assert.deepEqual(Object.keys(papa.inventory).sort(), ['pistol', 'smg']);
  assert.ok(events.some(event => event.event === 'weapon-drop' && event.id === 'papa' && event.weapon === 'shotgun'));
});

// Review of 13 October: the purchase is weighed when the brain orders it, but
// the break refills every gun before the companion reaches the rack. And a
// purchase the game refuses must not cost the weapon in hand its reload.
test('at the rack, a purchase no longer worth it, or one the game would refuse, drops nothing', () => {
  // Wave 8, calm: an empty machine gun and a loaded SMG; the shotgun is
  // offered in place of the machine gun, then the wave ends on the way.
  const walk = ({ wave, inventory, weapon, rackId }) => {
    const { sim, events, max, body, run } = room({ wave });
    Object.assign(max, { inventory: structuredClone(inventory), weapon, points: 5000 });
    const offer = describeSituation(sim, 'max').actions.find(action => action.value === `buy:${rackId}`);
    body.setOrder({ kind: 'buy', rackId });
    let ticks = 0;
    assert.ok(run(15, () => body.status !== 'running', () => {
      if (++ticks !== 10) return;
      sim.toSpawn = 0;
      sim.finishWave();
      sim.timeLeft = 1e9;
    }));
    assert.equal(sim.phase, 'intermission');
    return { max, body, offer, dropped: ofMax(events, 'weapon-drop').map(event => event.weapon), bought: ofMax(events, 'purchase') };
  };
  let result = walk({ wave: 8, inventory: { rifle: { ammo: 0, reserve: 0 }, smg: { ammo: 40, reserve: 120 } }, weapon: 'smg', rackId: 'shotgun' });
  assert.match(result.offer.description, /replaces your machine gun/);
  assert.equal(result.body.status, 'failed', 'refilled, the machine gun is worth more than a shotgun, and so is the SMG');
  assert.deepEqual(Object.keys(result.max.inventory).sort(), ['rifle', 'smg']);
  assert.deepEqual([result.dropped, result.bought, result.max.points, result.max.weapon], [[], [], 5000, 'smg']);
  // Every gun empty, a bat offered: refilled, no blade while a gun has ammo.
  result = walk({ wave: 3, inventory: { pistol: { ammo: 0, reserve: 0 }, shotgun: { ammo: 0, reserve: 0 } }, weapon: 'shotgun', rackId: 'bat' });
  assert.ok(result.offer, 'the bat is offered while every gun is empty');
  assert.equal(result.body.status, 'failed');
  assert.deepEqual(Object.keys(result.max.inventory).sort(), ['pistol', 'shotgun']);
  assert.deepEqual([result.dropped, result.bought], [[], []]);
  // At the rack, reloading its shotgun: too dear, or the SMG already dropped
  // this wave. Nothing goes, the shotgun stays in hand and its reload ends.
  for (const refusal of [{ points: 100 }, { issuedWeapons: new Set(['pistol', 'shotgun', 'smg']) }]) {
    const { sim, events, max, body, run } = room({ phase: 'intermission', wave: 4 });
    const rack = ARMORY.find(item => item.id === 'smg');
    Object.assign(max, { x: rack.x + Math.sin(rack.facing) * .95, z: rack.z + Math.cos(rack.facing) * .95, yaw: rack.facing, points: 5000, weapon: 'shotgun',
      inventory: { pistol: { ammo: 12, reserve: 36 }, shotgun: { ammo: 1, reserve: 20 } } }, refusal);
    assert.ok(sim.reload('max'));
    const reloadUntil = max.reloadUntil;
    body.setOrder({ kind: 'buy', rackId: 'smg' });
    assert.ok(run(2, () => body.status !== 'running'));
    assert.equal(body.status, 'failed');
    assert.equal(max.weapon, 'shotgun');
    assert.equal(max.reloadUntil, reloadUntil, 'its reload goes on');
    assert.deepEqual(ofMax(events, 'weapon-drop'), []);
    assert.ok(run(4, () => max.inventory.shotgun.ammo > 1), 'the shotgun reloaded');
  }
});

test('collects the ammo box its order names, through collectTargetId, and nothing else but coins', () => {
  const { sim, events, max, body, run } = room();
  max.inventory.pistol.reserve = 0;
  const add = (id, kind, point, extra = {}) => sim.pickups.set(id, { id, kind, y: 0, ...point, amount: kind === 'points' ? 50 : 1, special: false, expiresAt: sim.time + 90, ...extra });
  add('box', 'ammo', { x: -5, z: -4 }, { charge: 780 });
  add('kit', 'revive', { x: -4.6, z: -3.6 });
  add('coins', 'points', { x: -4.4, z: -3.2 });
  assert.equal(max.collectTargetId, null);
  body.setOrder({ kind: 'collect', pickupId: 'box' });
  body.tick(TICK);
  assert.equal(max.collectTargetId, 'box');
  sim.tick(TICK);
  assert.ok(run(12, () => body.status !== 'running'));
  assert.equal(body.status, 'done');
  assert.ok(max.inventory.pistol.reserve > 0);
  assert.ok(events.some(event => event.event === 'pickup' && event.id === 'max' && event.pickupId === 'box'));
  assert.ok(sim.pickups.has('kit'), 'never a pickup its order does not name');
  assert.equal(sim.pickups.has('coins'), false, 'coins on its way, like anyone (owner, 13 October)');
  assert.equal(max.points, 50);
  assert.equal(max.collectTargetId, null, 'cleared once the order is over');
  // Never out through intact boards (trips outside: see below).
  add('outdoors', 'ammo', { x: -11, z: 0 });
  body.setOrder({ kind: 'collect', pickupId: 'outdoors' });
  assert.equal(body.tick(TICK), 'failed');
  assert.equal(max.collectTargetId, null);
});

test('uses its revive kit on a downed teammate', () => {
  const { sim, events, papa, max, body, run } = room({ wave: 3 });
  Object.assign(papa, { x: 5, z: 4 });
  sim.damagePlayer(papa, 1000, { id: 'test' });
  body.setOrder({ kind: 'kit', playerId: 'papa' });
  assert.equal(body.tick(TICK), 'failed', 'no kit, no kit order');
  max.reviveKit = true;
  body.setOrder({ kind: 'kit', playerId: 'papa' });
  assert.ok(run(10, () => body.status !== 'running'));
  assert.equal(body.status, 'done');
  assert.ok(ofMax(events, 'revive').some(event => event.targetId === 'papa' && event.kit === true));
  assert.equal(max.reviveKit, false);
  assert.equal(papa.downed, false); assert.equal(papa.hp, REVIVE.kitHp);
  // A revive order on someone outside fails: bodies never leave the cabin.
  Object.assign(papa, { x: -11, z: 0 });
  papa.reviveShieldUntil = 0;
  sim.damagePlayer(papa, 1000, { id: 'test' });
  body.setOrder({ kind: 'revive', playerId: 'papa' });
  assert.equal(body.tick(TICK), 'failed');
});

test('gets itself up with its own kit when downed, and obeys nothing else meanwhile', () => {
  const { sim, max, body, run } = room({ wave: 3 });
  sim.damagePlayer(max, 1000, { id: 'test' });
  body.setOrder({ kind: 'defend', doorId: 'west' });
  const where = { x: max.x, z: max.z };
  run(1);
  assert.equal(body.status, 'down');
  assert.deepEqual({ x: max.x, z: max.z }, where, 'a downed body does not walk');
  max.reviveKit = true;
  body.setOrder({ kind: 'self-kit' });
  assert.equal(body.tick(TICK), 'down');
  assert.ok(max.selfReviveAt > sim.time, 'the kit revive is under way');
  sim.tick(TICK);
  assert.ok(run(REVIVE.kitDuration + 1, () => body.status === 'done'));
  assert.equal(max.downed, false); assert.equal(max.hp, REVIVE.kitHp);
  // A wait order ends once standing.
  body.setOrder({ kind: 'wait' });
  assert.equal(body.tick(TICK), 'done');
});

test('shoots zombies outside through the gaps of intact planks without ever hitting a plank', () => {
  for (const seed of [1, 2]) {
    const { sim, events, papa, body } = room({ seed });
    sim.configureDefendedDoors(2);
    Object.assign(papa, { x: 5, z: 4 });
    const west = sim.doors.find(door => door.id === 'west');
    for (const point of [{ x: -9.5, z: 0 }, { x: -10.5, z: .6 }, { x: -11.5, z: -.6 }, { x: -12.5, z: .2 }, { x: -9.2, z: -.8 }]) statue(sim, point);
    // The body never draws from the simulation's random numbers; only the
    // pellets of the shots it fires do, inside sim.shoot().
    let inBody = false, inShoot = false, stray = 0, pellets = 0;
    const random = sim.random;
    sim.random = () => { if (inBody) { if (inShoot) pellets++; else stray++; } return random(); };
    const shoot = sim.shoot.bind(sim);
    sim.shoot = (...args) => { inShoot = true; try { return shoot(...args); } finally { inShoot = false; } };
    body.setOrder({ kind: 'defend', doorId: 'west' });
    for (let index = 0; index < 30 * 40; index++) {
      inBody = true; body.tick(TICK); inBody = false;
      sim.tick(TICK);
    }
    assert.ok(ofMax(events, 'kill').length >= 2, 'kills through the gaps');
    assert.deepEqual(boardDamage(events), []);
    assert.deepEqual(west.boards, [60, 60, 60, 60, 60]);
    assert.equal(stray, 0, 'sim.random is never called by the body');
    assert.ok(pellets > 0);
  }
});

test('never shoots through a teammate in the line, and steps aside to shoot past them', () => {
  const { sim, events, papa, max, body, run } = room();
  Object.assign(max, { x: -1, z: 3 });
  Object.assign(papa, { x: -3, z: 1.8 });
  const zombie = statue(sim, { x: -5, z: .6 }); // right behind papa
  sim.doors.find(door => door.id === 'west').boards.fill(0); // and no plank of ours behind it: only papa is in the way
  body.setOrder({ kind: 'hold' });
  const unsafe = [];
  for (let index = 0; index < 30 * 8 && sim.zombies.has(zombie.id); index++) {
    const before = ofMax(events, 'shot').length;
    run(TICK);
    for (const shot of ofMax(events, 'shot').slice(before)) {
      const dx = -Math.sin(shot.yaw), dz = -Math.cos(shot.yaw), along = (papa.x - shot.x) * dx + (papa.z - shot.z) * dz;
      if (along > 0 && Math.abs((papa.x - shot.x) * dz - (papa.z - shot.z) * dx) < .3) unsafe.push(shot);
    }
  }
  assert.equal(sim.zombies.has(zombie.id), false, 'killed it from a clear spot');
  assert.deepEqual(unsafe, []);
  assert.ok(flat(max, { x: -1, z: 3 }) > .3 && flat(max, { x: -1, z: 3 }) < 2.5, 'a short step aside');
});

test('fights with melee, automatic, spinning, spread and explosive weapons, never hitting a plank', () => {
  // The duo wave these fights were tuned on (seed 4: three doors, twelve
  // zombies), then the real one of Papa and Max (1.5: the solo two doors, ten
  // zombies; on seeds 4 and 6 they all come east for Papa and the bat never
  // reaches one: seeds 5 and 7).
  for (const [seed, duo] of [[4, true], [5, false], [7, false]]) for (const weapon of ['bat', 'smg', 'minigun', 'shotgun', 'rocket']) {
    const { sim, events, papa, max, body } = room({ seed, phase: 'countdown' });
    if (duo) sim.participantWeight = () => 1;
    papa.reviveShieldUntil = max.reviveShieldUntil = Infinity;
    Object.assign(papa, { x: 6, z: 4 });
    max.inventory = { [weapon]: { ammo: WEAPONS[weapon].magazine, reserve: 400 } }; max.weapon = weapon;
    body.setOrder({ kind: 'hold' });
    for (let index = 0; index < 30 * 70 && sim.phase !== 'intermission'; index++) {
      sim.setInput('papa', { forward: 0, strafe: 0, yaw: 0, pitch: 0 });
      body.tick(TICK); sim.tick(TICK);
    }
    assert.ok(ofMax(events, 'kill').length >= 6, `seed ${seed}, ${weapon}: kills`);
    assert.deepEqual(boardDamage(events), [], `seed ${seed}, ${weapon}: planks`);
    if (weapon === 'bat') assert.ok(ofMax(events, 'melee-start').length >= 6);
    if (weapon === 'minigun') assert.ok(ofMax(events, 'minigun-spin').some(event => event.spinning));
  }
});

test('the protector lands useful fire at cabin distances while retaining genuine misses', t => {
  for (const [distance, minimum] of [[3, .65], [5, .45]]) {
    let launched = 0, hit = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const { sim, events, papa, max, body, run } = room({ seed, profile: rollCompanionProfile('protector', () => .5) });
      Object.assign(papa, { x: 6, z: 4 });
      Object.assign(max, { x: -5, y: 0, z: 3, yaw: 0, pitch: 0, weapon: 'pistol', weaponId: 'pistol',
        inventory: { pistol: { ammo: WEAPONS.pistol.magazine, reserve: 10000 } } });
      const at = { x: -5, y: 0, z: 3 - distance };
      const target = statue(sim, at, { kind: 'walker', scale: 1, entered: true,
        hp: 1e9, maxHp: 1e9, attackAfter: Infinity });
      // Physical impacts push survivors' targets. Pin this isolated target
      // each tick so the asserted distance does not drift as it is hit.
      const pin = () => Object.assign(target, at, { hp: 1e9 });
      body.setOrder({ kind: 'hold' });
      run(20, () => false, pin);
      body.setOrder({ kind: 'wait' }); run(1, () => false, pin);
      const shots = ofMax(events, 'shot');
      launched += shots.reduce((sum, shot) => sum + (shot.projectiles?.length ?? 0), 0);
      const contacts = ofMax(events, 'bullet-impact').filter(event => event.stop === 'zombie' && !event.visualOnly);
      hit += new Set(contacts.map(event => event.projectileId)).size;
      assert.deepEqual(boardDamage(events), [], 'calibrated aim still respects barricades');
    }
    const rate = hit / launched;
    assert.ok(launched >= 250, 'enough actual projectiles for the seeded regression sample');
    assert.ok(rate >= minimum && rate < .95, `${distance} m: ${(rate * 100).toFixed(1)} %`);
    t.diagnostic(`${distance} m: ${hit}/${launched} projectiles hit (${(rate * 100).toFixed(1)} %)`);
  }
});

// A fixed, durable target and real ballistics isolate body handling from
// navigation, lethal damage, hit recoil and the model's tactical decisions.
function aimScene(profile, seed = 7, playerProfile) {
  const scene = room({ seed, profile, playerProfile });
  const { sim, papa, max, body, run, events } = scene;
  Object.assign(papa, { x: 6, z: 4 });
  Object.assign(max, { x: -5, y: 0, z: 3, yaw: 0, pitch: 0, weapon: 'pistol', weaponId: 'pistol',
    inventory: { pistol: { ammo: WEAPONS.pistol.magazine, reserve: 10000 } } });
  const at = { x: -5, y: 0, z: -2 };
  const target = statue(sim, at, { kind: 'walker', scale: 1, entered: true, hp: 1e9, maxHp: 1e9, attackAfter: Infinity });
  const pin = () => Object.assign(target, at, { hp: 1e9 });
  return { ...scene, play(seconds = 12) {
    body.setOrder({ kind: 'hold' }); run(seconds, () => false, pin);
    body.setOrder({ kind: 'wait' }); run(1, () => false, pin);
    const shots = ofMax(events, 'shot');
    const impacts = ofMax(events, 'bullet-impact').filter(event => event.stop === 'zombie' && !event.visualOnly);
    return { shots, launched: shots.reduce((sum, shot) => sum + (shot.projectiles?.length ?? 0), 0),
      hit: new Set(impacts.map(event => event.projectileId)).size };
  } };
}

test('archetypes produce different real hit rates and keep the weapon cadence legal', t => {
  const rates = {};
  for (const id of ['veteran', 'sharpshooter', 'protector', 'rusher', 'timid']) {
    let launched = 0, hit = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const profile = rollCompanionProfile(id, () => .5);
      const { shots, launched: rounds, hit: contacts } = aimScene(profile, seed).play();
      launched += rounds; hit += contacts;
      for (let index = 1; index < shots.length; index++) {
        assert.ok(shots[index].time - shots[index - 1].time >= WEAPONS.pistol.interval - 1e-9, `${id}: the pistol never exceeds its legal cadence`);
      }
    }
    assert.ok(launched >= 100, `${id}: sufficient real launches`);
    rates[id] = hit / launched;
  }
  assert.ok(rates.veteran > rates.protector + .2 && rates.sharpshooter > rates.protector + .12);
  assert.ok(rates.protector > rates.timid + .1 && rates.rusher < rates.sharpshooter);
  assert.ok(rates.veteran < 1 && rates.timid > 0, 'no perfect aimbot or artificial forced misses');
  t.diagnostic(JSON.stringify(rates));
});

test('profile configuration is local, immutable between explicit changes, and preserves legacy fallback', () => {
  assert.equal(AIM.tremorYaw, .11); assert.equal(AIM.tremorPitch, .065);
  const mutable = structuredClone(rollCompanionProfile('protector', () => .5));
  const scene = aimScene(mutable);
  mutable.aim.tremorYaw = .5; mutable.aim.reaction[0] = 10;
  const other = scene.sim.addPlayer('lea', 'Léa', undefined, { companion: true });
  other.companionProfile = rollCompanionProfile('veteran', () => .5);
  const otherBody = createCompanionBody(scene.sim, 'lea');
  otherBody.setProfile(rollCompanionProfile('timid', () => .5));
  scene.sim.removePlayer('lea');
  const actual = scene.play(), control = aimScene(rollCompanionProfile('protector', () => .5)).play();
  assert.deepEqual(actual.shots.map(shot => [shot.time, shot.yaw, shot.pitch]), control.shots.map(shot => [shot.time, shot.yaw, shot.pitch]));
  assert.equal(actual.hit, control.hit);
  assert.equal(AIM.tremorYaw, .11); assert.equal(AIM.tremorPitch, .065);
  scene.body.setOrder({ kind: 'hold' });
  scene.body.setProfile(rollCompanionProfile('veteran', () => .5));
  assert.equal(scene.body.order, null); assert.equal(scene.body.status, 'idle');
  scene.body.setProfile(null);
  assert.equal(scene.body.order, null);
});

test('a veteran reacts faster than a timid bot to the same fresh target', t => {
  const delays = {};
  for (const id of ['veteran', 'timid']) {
    const times = [];
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const scene = aimScene(rollCompanionProfile(id, () => .5), seed);
      const result = scene.play(3);
      assert.ok(result.shots.length > 0);
      times.push(result.shots[0].time);
    }
    delays[id] = times.reduce((sum, value) => sum + value, 0) / times.length;
  }
  assert.ok(delays.timid > delays.veteran + .25, JSON.stringify(delays));
  t.diagnostic(JSON.stringify(delays));
});

test('the player profile is read once, explicit options win, and setProfile updates the same body', () => {
  const veteran = rollCompanionProfile('veteran', () => .5), timid = rollCompanionProfile('timid', () => .5);
  const sample = scene => scene.play(3).shots.map(shot => [shot.time, shot.yaw, shot.pitch]);
  const fallback = aimScene(undefined, 17, veteran);
  fallback.max.companionProfile = timid;
  const expected = sample(aimScene(veteran, 17));
  assert.deepEqual(sample(fallback), expected, 'no reroll or automatic profile mutation while playing');
  assert.deepEqual(sample(aimScene(timid, 17, veteran)), sample(aimScene(timid, 17)), 'explicit body option wins over player field');
  const changed = aimScene(timid, 17);
  const identity = changed.body;
  changed.body.setProfile(veteran);
  assert.equal(changed.body, identity);
  assert.deepEqual(sample(changed), expected, 'new-night handling can change without replacing the body instance');
});

test('reacts like a person: its first shot comes a reaction time after it starts turning to a fresh enemy', t => {
  // Already facing the spot where the enemy appears, so the turn itself is
  // short: the delay from the first move of its aim to the first shot is the
  // reaction time, plus at most a short settle.
  const delays = [];
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const { sim, events, papa, max, body, run } = room({ seed });
    Object.assign(papa, { x: 5, z: 4 });
    const at = { x: -4.6 - seed * .1, z: -1 - seed * .1 }; // a wall behind it, no door
    Object.assign(max, { x: -1, z: 1.5, yaw: Math.atan2(-(at.x + 1), -(at.z - 1.5)), pitch: -.08 });
    body.setOrder({ kind: 'hold' });
    run(1);
    const facing = { yaw: max.yaw, pitch: max.pitch };
    const zombie = statue(sim, at);
    const eye = { x: max.x, y: max.y + 1.55, z: max.z };
    assert.ok(sim.raiderLineClear(eye, { x: zombie.x, y: 1.1, z: zombie.z }), 'the enemy is in plain view at once');
    let moved = null;
    assert.ok(run(2, () => ofMax(events, 'shot').length > 0, () => {
      if (moved === null && (max.yaw !== facing.yaw || max.pitch !== facing.pitch)) moved = sim.time - TICK;
    }));
    assert.ok(moved !== null, 'it turned to the enemy');
    delays.push(ofMax(events, 'shot')[0].time - moved);
  }
  // The contract's human reaction, 0.3-0.45 s (not read back from AIM).
  assert.ok(Math.min(...delays) >= .3 - 1e-9, `fastest ${Math.min(...delays).toFixed(3)} s`);
  assert.ok(Math.max(...delays) < .45 + .35, `slowest ${Math.max(...delays).toFixed(3)} s`);
  t.diagnostic(`first shots ${delays.map(delay => delay.toFixed(2)).join(', ')} s after its aim started to move`);
});

test('a body that finds itself outside comes back in through an open doorway, then holds', () => {
  const { sim, max, body, run } = room({ phase: 'intermission', wave: 2 });
  const west = sim.doors.find(door => door.id === 'west');
  west.boards = west.boards.map(() => 0);
  Object.assign(max, { x: -11, z: 2.5 });
  body.setOrder({ kind: 'hold' });
  assert.ok(run(8, () => inside(max) && Math.abs(max.x) < 7), 'back inside');
  run(2);
  assert.ok(Math.abs(max.x) < 7 && Math.abs(max.x) > 6, 'holds clear of the doorway');
  assert.equal(body.status, 'running');
});

test('keeps its inputs fresh, never throws, and follows the order contract', () => {
  const { sim, max, body, run } = room();
  assert.equal(body.status, 'idle'); assert.equal(body.order, null);
  assert.equal(body.tick(TICK), 'idle');
  assert.equal(max.lastInputAt, sim.time, 'setInput every tick, even idle');
  body.setOrder({ kind: 'dance' });
  assert.equal(body.tick(TICK), 'failed');
  body.setOrder({ kind: 'weapon', weapon: 'rocket' });
  assert.equal(body.tick(TICK), 'failed', 'not owned');
  // Reload: running while the magazine fills, then done.
  max.inventory.pistol.ammo = 3;
  body.setOrder({ kind: 'reload' });
  assert.equal(body.tick(TICK), 'running');
  sim.tick(TICK);
  assert.ok(run(2, () => body.status !== 'running'));
  assert.equal(body.status, 'done'); assert.equal(max.inventory.pistol.ammo, 12);
  // An empty magazine reloads by itself, whatever the order.
  max.inventory.pistol.ammo = 0;
  body.setOrder({ kind: 'hold' });
  body.tick(TICK);
  assert.ok(max.reloadUntil > sim.time);
  // The same order again keeps the one under way.
  const order = body.order;
  body.setOrder({ kind: 'hold' });
  assert.equal(body.order, order);
  // A failing simulation call never escapes tick().
  body.setOrder({ kind: 'defend', doorId: 'west' });
  sim.moveZombieTowards = () => { throw new Error('boom'); };
  assert.doesNotThrow(() => body.tick(TICK));
  assert.equal(body.status, 'failed');
  sim.players.delete('max');
  assert.doesNotThrow(() => body.tick(TICK));
});

test('switches and reloads a numbered copy without touching the other carried copies', () => {
  const { sim, max, body, run } = room();
  Object.assign(max, { weapon: 'pistol', weaponId: 'pistol', backpack: true,
    inventory: { pistol: { ammo: 12, reserve: 36 }, 'pistol#2': { ammo: 3, reserve: 9 },
      smg: { ammo: 2, reserve: 3 }, 'smg#2': { ammo: 4, reserve: 5 } } });
  const untouched = structuredClone({ pistol: max.inventory.pistol, smg: max.inventory.smg, copy: max.inventory['smg#2'] });
  body.setOrder({ kind: 'weapon', weapon: 'pistol#2' });
  assert.equal(body.tick(TICK), 'done');
  assert.equal(max.weapon, 'pistol');
  assert.equal(max.weaponId, 'pistol#2');
  body.setOrder({ kind: 'reload' });
  assert.equal(body.tick(TICK), 'running');
  sim.tick(TICK);
  assert.ok(run(2, () => body.status !== 'running'));
  assert.equal(body.status, 'done');
  assert.deepEqual(max.inventory['pistol#2'], { ammo: 12, reserve: 0 });
  assert.deepEqual({ pistol: max.inventory.pistol, smg: max.inventory.smg, copy: max.inventory['smg#2'] }, untouched);
  body.setOrder({ kind: 'weapon', weapon: 'smg#2' });
  assert.equal(body.tick(TICK), 'done');
  assert.equal(max.weapon, 'smg');
  assert.equal(max.weaponId, 'smg#2');
});

test('never drops into the stair well when an enemy blocks the head of the stairs', () => {
  for (const seed of [1, 2]) for (const x of [3.8, 4.2]) {
    const { sim, events, papa, max, body, run, trace } = room({ seed, wave: 3 });
    Object.assign(papa, { x: -6, z: 4.5 });
    Object.assign(max, { x: 6, y: LOFT.y, z: -4 });
    max.inventory.pistol.ammo = max.inventory.pistol.reserve = 0; // it cannot clear the way
    statue(sim, { x, y: stairTreadY(-1.75), z: -1.75 }, { hp: 1e6 }); // on the top tread
    body.setOrder({ kind: 'defend', doorId: 'west' }); // down the stairs, blocked: sidesteps on the loft
    run(12);
    assert.equal(events.some(event => event.event === 'hit' && event.id === 'max' && event.source === 'fall'), false, `seed ${seed}, x ${x}: no fall`);
    assert.ok(trace.fastestFall < 3, `seed ${seed}, x ${x}: falling at ${trace.fastestFall.toFixed(1)} m/s`);
    assert.equal(trace.jumped, false);
  }
});

test('with one of our intact doors behind its target, it holds its fire and the shoot order fails', () => {
  for (const weapon of ['smg', 'pistol']) {
    const { sim, events, papa, max, body, run } = room({ wave: 3 });
    Object.assign(papa, { x: 5, z: 4.5 });
    Object.assign(max, { x: 5, z: 0 });
    max.inventory = { [weapon]: { ammo: WEAPONS[weapon].magazine, reserve: 400 } }; max.weapon = weapon;
    const zombie = statue(sim, { x: -7.2, z: 0 }, { hp: 1e6 }); // right in front of the west door's planks
    body.setOrder({ kind: 'shoot', zombieId: zombie.id });
    const start = sim.time;
    assert.ok(run(9, () => body.status !== 'running'));
    assert.equal(body.status, 'failed', `${weapon}: no clear line anywhere within 6 m`);
    assert.ok(sim.time - start >= 6 && sim.time - start < 7);
    assert.deepEqual(ofMax(events, 'shot'), [], `${weapon}: not a round fired`);
    assert.deepEqual(boardDamage(events), []);
  }
});

test('a penetrating weapon never fires only misses to spare a door behind its target', () => {
  // From its west post, an enemy 5 m away lined up with the east door. Its
  // choice never depends on where its tremor points: it holds its fire, or
  // fires from a line clear of that door with its usual aim (a rare stray
  // can still reach a plank, as for a person); with no planks it just fires.
  for (const weapon of ['smg', 'assault', 'minigun']) for (const seed of [2, 3]) for (const planks of [60, 0]) {
    const { sim, events, papa, max, body, run } = room({ seed, wave: 3 });
    Object.assign(papa, { x: 5, z: 4.5 });
    sim.doors.find(door => door.id === 'east').boards.fill(planks);
    max.inventory = { [weapon]: { ammo: WEAPONS[weapon].magazine, reserve: 400 } }; max.weapon = weapon;
    body.setOrder({ kind: 'defend', doorId: 'west' });
    run(6); // at its post
    const toward = { x: 8 - max.x, z: -max.z }, length = Math.hypot(toward.x, toward.z);
    statue(sim, { x: max.x + toward.x / length * 5, z: max.z + toward.z / length * 5 }, { hp: 1e6 });
    const before = ofMax(events, 'shot').length;
    run(10);
    const shots = ofMax(events, 'shot').slice(before), hits = landedHits(events, shots);
    const label = `${weapon}, seed ${seed}, east planks ${planks}: ${hits} hits in ${shots.length} shots`;
    if (planks) assert.ok(shots.length === 0 || hits / shots.length >= .3, label);
    else assert.ok(shots.length >= 20 && hits >= 5, label);
    assert.ok(boardDamage(events).length <= shots.length * .05, `${label}, ${boardDamage(events).length} planks hit`);
  }
});

test('revives or kits a teammate just across the partition by walking round it', () => {
  for (const kind of ['revive', 'kit']) {
    const { sim, papa, max, body, run } = room({ wave: 3 });
    Object.assign(papa, { x: 0, z: -2.45 }); // north of the partition
    Object.assign(max, { x: 0, z: -1.6 }); // south of it, 0.85 m away
    if (kind === 'kit') max.reviveKit = true;
    sim.damagePlayer(papa, 1000, { id: 'test' });
    body.setOrder({ kind, playerId: 'papa' });
    assert.ok(run(12, () => body.status !== 'running'), `${kind}: over well before the bleed-out`);
    assert.equal(body.status, 'done');
    assert.equal(papa.downed, false);
  }
});

test('a kit or a revive goes to the teammate the order names, not to another one down beside them', () => {
  for (const kind of ['kit', 'revive']) {
    const { sim, events, papa, humans: [, jules], max, body, run } = room({ wave: 3, others: ['jules'] });
    Object.assign(papa, { x: 4, z: 3.5 });
    Object.assign(jules, { x: 5, z: 3.5 });
    sim.damagePlayer(papa, 1000, { id: 'test' });
    sim.damagePlayer(jules, 1000, { id: 'test' });
    if (kind === 'kit') max.reviveKit = true;
    body.setOrder({ kind, playerId: 'jules' });
    assert.ok(run(12, () => body.status !== 'running'));
    assert.equal(body.status, 'done');
    assert.equal(jules.downed, false);
    assert.equal(papa.downed, true, 'papa is still waiting for help');
    assert.deepEqual(ofMax(events, 'revive').map(event => event.targetId), ['jules']);
  }
  // A kit spent on someone else is never reported as done.
  const { sim, papa, humans: [, jules], max, body } = room({ wave: 3, others: ['jules'] });
  Object.assign(max, { x: 4, z: 2.5, reviveKit: true });
  Object.assign(papa, { x: 4, z: 3.5 });
  Object.assign(jules, { x: 5.6, z: 3.5 });
  sim.damagePlayer(papa, 1000, { id: 'test' });
  sim.damagePlayer(jules, 1000, { id: 'test' });
  const useReviveKit = sim.useReviveKit.bind(sim);
  sim.reviveTargetFor = () => jules; // the body is told jules; the kit then goes to papa
  sim.useReviveKit = id => { delete sim.reviveTargetFor; return useReviveKit(id); };
  body.setOrder({ kind: 'kit', playerId: 'jules' });
  assert.equal(body.tick(TICK), 'failed');
  assert.equal(jules.downed, true); assert.equal(papa.downed, false);
});

test('never stops halfway up or down the stairs: following and holding end on a floor', () => {
  const trips = [
    { from: { x: -2, y: 0, z: 4 }, to: { x: 1.8, y: LOFT.y, z: 0 } },
    { from: { x: -2, y: 0, z: 4 }, to: { x: 6.28, y: LOFT.y, z: -2.81 } },
    { from: { x: 6, y: LOFT.y, z: 4 }, to: { x: 1.77, y: 0, z: 2.45 } },
  ];
  for (const { from, to } of trips) {
    const { papa, max, body, run, trace } = room({ phase: 'intermission', wave: 3 });
    Object.assign(max, from);
    Object.assign(papa, to);
    body.setOrder({ kind: 'follow', playerId: 'papa' });
    run(15);
    assert.equal(onFlight(max), false, `following to (${to.x}, ${to.y}, ${to.z}): stands at (${max.x.toFixed(2)}, ${max.y.toFixed(2)}, ${max.z.toFixed(2)})`);
    assert.ok(Math.abs(max.y - papa.y) < .25 && flat(max, papa) <= 4.2, 'on his floor (the foot of the stairs at most), close by');
    assert.equal(trace.jumped, false);
  }
  // A hold given halfway up holds at the head of the stairs.
  const { papa, max, body, run } = room({ wave: 3 });
  Object.assign(papa, { x: -6, z: 4.5 });
  body.setOrder({ kind: 'loft' });
  assert.ok(run(15, () => max.y > 1.6));
  body.setOrder({ kind: 'hold' });
  run(10);
  assert.equal(onFlight(max), false, `holds at (${max.x.toFixed(2)}, ${max.y.toFixed(2)}, ${max.z.toFixed(2)})`);
  assert.ok(Math.abs(max.y - LOFT.y) < .05);
  assert.equal(body.status, 'running');
});

test('never takes a post where a teammate stands, and moves off when one steps onto it', () => {
  for (const doorId of ['west', 'east', 'north']) {
    const first = room({ wave: 3 });
    Object.assign(first.papa, { x: 6, z: 4.5 });
    first.body.setOrder({ kind: 'defend', doorId });
    first.run(10);
    const post = { x: first.max.x, z: first.max.z };
    const { papa, max, body, run } = room({ wave: 3 });
    Object.assign(papa, post); // the child stands on that post
    body.setOrder({ kind: 'defend', doorId });
    run(10);
    assert.ok(flat(max, papa) >= .6, `${doorId}: ${flat(max, papa).toFixed(2)} m from him`);
    const door = sim => sim.doors.find(item => item.id === doorId);
    assert.ok(flat(max, door(first.sim)) < 4.5, `${doorId}: still by its door`);
    Object.assign(papa, { x: max.x, z: max.z }); // and now he walks onto its new post
    run(4);
    assert.ok(flat(max, papa) >= .6, `${doorId}: moved off, ${flat(max, papa).toFixed(2)} m`);
  }
  const { papa, max, body, run } = room({ wave: 3 });
  Object.assign(papa, { x: LOFT_POST.x, y: LOFT.y, z: LOFT_POST.z });
  body.setOrder({ kind: 'loft' });
  run(15);
  assert.ok(Math.abs(max.y - LOFT.y) < .05 && flat(max, LOFT_POST) < 2 && flat(max, papa) >= .6, 'beside him at the loft post');
  // He shops at the rack it was sent to: it buys from beside him.
  const shop = room({ phase: 'intermission', wave: 2 });
  const rack = ARMORY.find(item => item.id === 'shotgun');
  Object.assign(shop.papa, { x: rack.x + Math.sin(rack.facing ?? 0) * .95, z: rack.z + Math.cos(rack.facing ?? 0) * .95 });
  shop.max.points = 500;
  shop.body.setOrder({ kind: 'buy', rackId: 'shotgun' });
  let closest = Infinity;
  assert.ok(shop.run(15, () => shop.body.status !== 'running', () => { closest = Math.min(closest, flat(shop.max, shop.papa)); }));
  assert.equal(shop.body.status, 'done');
  assert.ok(closest >= .5, `never inside him (${closest.toFixed(2)} m)`);
});

test('keeps a human hit rate at a later wave too, crowds included', t => {
  let shots = 0, hits = 0;
  for (const seed of [1, 2, 3]) {
    const { sim, events, papa, max, body } = room({ seed, phase: 'countdown' });
    sim.wave = 3; // the countdown opens wave 4
    papa.reviveShieldUntil = Infinity;
    max.inventory.pistol.reserve = 2000;
    body.setOrder({ kind: 'defend', doorId: 'west' });
    for (let index = 0; index < 30 * 150 && sim.phase !== 'intermission' && max.alive && !max.downed; index++) {
      sim.setInput('papa', { forward: 0, strafe: 0, yaw: 0, pitch: 0 });
      body.tick(TICK); sim.tick(TICK);
    }
    assert.equal(sim.wave, 4);
    const fired = ofMax(events, 'shot');
    shots += fired.length; hits += landedHits(events, fired);
  }
  const rate = hits / shots;
  assert.ok(shots >= 60);
  assert.ok(rate >= .25 && rate <= .85, `hit rate ${(rate * 100).toFixed(0)} %`);
  t.diagnostic(`wave 4: ${shots} shots, hit rate ${(rate * 100).toFixed(0)} %`);
});

// The owner's cheat sheet (13 October): back off while shooting, aim for the head.
test('backs away from a zombie closing in while still shooting it, and aims for the head well inside', () => {
  const { sim, events, papa, max, body, run } = room({ seed: 11 });
  Object.assign(papa, { x: 6, z: 4 });
  Object.assign(max, { x: -4.5, y: 0, z: .6, yaw: 0 }); // the open living room, the sofa behind
  sim.zombies.clear();
  const walker = Object.assign(sim.spawnZombie(), { x: -4.5, y: 0, z: -1.6, speed: 1.1, entered: true, hp: 2000, maxHp: 2000 });
  body.setOrder({ kind: 'hold' });
  const start = { x: max.x, z: max.z };
  let closest = Infinity;
  run(2.5, () => false, () => { closest = Math.min(closest, flat(max, walker)); });
  assert.ok(flat(max, start) > .8, `stepped back (${flat(max, start).toFixed(2)} m)`);
  assert.ok(ofMax(events, 'shot').length > 0, 'kept shooting while backing off');
  assert.ok(events.some(event => event.event === 'hit' && event.headshot === true && event.id === 'max')
    || ofMax(events, 'bullet-impact').some(event => event.stop === 'zombie' && event.headshot === true)
    || ofMax(events, 'shot').some(event => event.headshots > 0), 'head hits on a zombie well inside');
  assert.ok(closest > .9, `never let it bite (${closest.toFixed(2)} m)`);
});

test('backs off toward open floor rather than into a corner', () => {
  const { sim, papa, max, body, run } = room({ seed: 12 });
  Object.assign(papa, { x: 6, z: -4 });
  Object.assign(max, { x: -6.4, y: 0, z: 4.6, yaw: 0 }); // near the south-west corner
  sim.zombies.clear();
  Object.assign(sim.spawnZombie(), { x: -4.9, y: 0, z: 4.4, speed: 1.1, entered: true, hp: 5000, maxHp: 5000 }); // coming from the east
  body.setOrder({ kind: 'hold' });
  let cornered = 0;
  run(4, () => false, () => { if (max.x < -7 && max.z > 5) cornered++; });
  assert.ok(cornered < 15, `not pinned in the corner (${cornered} ticks)`);
});

test('a grenade order aims the throw at the pack and blows it up', () => {
  const { sim, events, papa, max, body, run } = room({ seed: 13 });
  Object.assign(papa, { x: 6, z: 4 });
  Object.assign(max, { x: -4.5, y: 0, z: 1.2, yaw: 0, grenades: 2 });
  sim.zombies.clear();
  const pack = [[0, 0], [.7, .3], [-.6, .4]].map(([dx, dz]) => statue(sim, { x: -4.5 + dx, z: -4.6 + dz, entered: true }));
  body.setOrder({ kind: 'grenade', zombieId: pack[0].id });
  let status;
  run(4, () => false, () => { status = body.status; });
  assert.equal(ofMax(events, 'grenade-thrown').length, 1, 'one throw');
  assert.equal(max.grenades, 1);
  const hurt = pack.filter(zombie => !sim.zombies.has(zombie.id) || zombie.hp < zombie.maxHp).length;
  assert.ok(hurt >= 2, `the blast caught the pack (${hurt}/3)`);
});

// Trips outside (owner, 13 October: "il ne faut pas leur interdire d'aller dehors").
const ammoBox = (sim, id, point) => sim.pickups.set(id, { id, kind: 'ammo', y: 0, ...point, amount: 1, special: false, expiresAt: sim.time + 90, charge: 780 });
const rainHits = events => events.filter(event => event.event === 'hit' && event.id === 'max' && event.source === 'outside');
const umbrellaMoves = events => events.filter(event => event.event === 'umbrella' && event.id === 'max').map(event => event.open);
// Where it crossed the outer walls, in the frame of a door: [normal, tangent].
const crossings = (sim, max, run, seconds, until) => {
  const points = [];
  let wasOut = !inside(max), wetDry = 0;
  run(seconds, until, () => {
    const out = !inside(max);
    if (out !== wasOut) points.push({ x: max.x, z: max.z });
    wasOut = out;
    if (sim.rainExposed(max) && !max.umbrella.open) wetDry++;
  });
  return { points, wetDry };
};
const throughDoor = (door, point) => Math.abs((point.x - door.x) * door.outX + (point.z - door.z) * door.outZ) < 1
  && Math.abs((point.x - door.x) * door.outZ - (point.z - door.z) * door.outX) < 1.3;

test('steps out through a broken door for an ammo box, umbrella open in the rain, and comes straight back in', () => {
  const trips = [
    { doorId: 'west', boards: [0, 0, 0, 0, 0], box: { x: -14, z: 3 }, from: { x: -3, z: 1 } },
    { doorId: 'north', boards: [0, 0, 0, 0, 60], box: { x: 3, z: -13 }, from: { x: -4, z: 1 } }, // the top board stays: still a way through
    { doorId: 'east', boards: [0, 0, 0, 0, 0], box: { x: 11, z: 9 }, from: { x: 5, y: LOFT.y, z: 3 } }, // from the loft, round to the south-east
  ];
  for (const { doorId, boards, box, from } of trips) {
    const { sim, events, papa, max, body, run, trace } = room({ wave: 3 });
    Object.assign(papa, { x: 5, z: 4 });
    const door = sim.doors.find(item => item.id === doorId);
    door.boards = [...boards];
    Object.assign(max, from);
    max.inventory.pistol.reserve = 2;
    ammoBox(sim, 'box', box);
    body.setOrder({ kind: 'collect', pickupId: 'box' });
    const { points, wetDry } = crossings(sim, max, run, 20, () => body.status !== 'running');
    assert.equal(body.status, 'done', doorId);
    assert.ok(trace.left, `${doorId}: it went outside`);
    assert.ok(events.some(event => event.event === 'pickup' && event.id === 'max' && event.pickupId === 'box'), `${doorId}: took the box`);
    assert.ok(max.inventory.pistol.reserve > 2);
    assert.equal(points.length, 2, `${doorId}: out once, in once`);
    for (const point of points) assert.ok(throughDoor(door, point), `${doorId}: through its doorway (${point.x.toFixed(2)}, ${point.z.toFixed(2)})`);
    assert.ok(inside(max) && Math.abs(max.x) < 7 && Math.abs(max.z) < 5, `${doorId}: well inside again`);
    assert.equal(wetDry, 0, `${doorId}: the umbrella was open whenever it stood in the rain`);
    assert.deepEqual(rainHits(events), [], `${doorId}: not a drop of rain damage`);
    assert.deepEqual(umbrellaMoves(events), [true, false], `${doorId}: opened outside, folded back inside`);
    assert.equal(max.umbrella.open, false);
    assert.ok(max.umbrella.remaining < 100 && max.umbrella.remaining > 90, `${doorId}: ${max.umbrella.remaining.toFixed(1)} s of umbrella left`);
    assert.equal(max.collectTargetId, null);
    assert.equal(trace.jumped, false);
  }
});

// A trip out of the broken west door to a box at (-19, 1), with a zombie
// about. → what it did in the rain: ticks stood still, and for each fold of
// the umbrella there, whether a shot went with it.
function tripPast(zombieAt, { seed, speed = 0, gun = 'loaded', until = body => body.status !== 'running' }) {
  const scene = room({ seed, wave: 3 });
  const { sim, events, papa, max, body, run } = scene;
  Object.assign(papa, { x: 5, z: 4 });
  sim.doors.find(door => door.id === 'west').boards.fill(0);
  Object.assign(max, { x: -3, z: 1 });
  max.inventory.pistol.reserve = 2;
  if (gun === 'empty') max.inventory.pistol.ammo = max.inventory.pistol.reserve = 0;
  ammoBox(sim, 'box', { x: -19, z: 1 });
  const zombie = statue(sim, zombieAt, { hp: 30, maxHp: 30, speed, ...(gun === 'empty' ? { attackAfter: Infinity } : {}) });
  body.setOrder({ kind: 'collect', pickupId: 'box' });
  let last = null, still = 0, seen = 0;
  const folds = [];
  assert.ok(run(20, () => until(body, events), () => {
    const wet = sim.rainExposed(max), mine = events.slice(seen).filter(event => event.id === 'max');
    seen = events.length;
    if (wet && last && flat(max, last) < 1e-4) still++;
    last = { x: max.x, z: max.z };
    for (const event of mine) if (event.event === 'umbrella' && !event.open && wet) folds.push(mine.some(other => other.event === 'shot'));
  }));
  return { ...scene, zombie, still, folds };
}

test('outside it never stands still to fight, and folds its umbrella only for its shots', () => {
  // Once it stood up to 1.5 s on every new target in the rain, a zombie
  // biting it or not: in real waves that got it downed out there.
  for (const seed of [1, 3, 7]) {
    const { body, still, folds } = tripPast({ x: -12, z: 2.6 }, { seed }); // 2.6 m off the way, never moving
    assert.equal(body.status, 'done', `seed ${seed}`);
    assert.ok(still <= 3, `seed ${seed}: ${still} ticks standing in the rain (the box takes two)`);
    assert.ok(folds.every(Boolean), `seed ${seed}: folded in the rain only to shoot (${folds})`);
  }
  // One that comes for it is shot on the way: open, folded for the shots,
  // open again, folded back under the roof.
  for (const seed of [1, 3]) {
    const { sim, events, max, body, zombie, still, folds } = tripPast({ x: -16, z: -3 }, { seed, speed: 1.3 });
    assert.equal(body.status, 'done', `seed ${seed}`);
    assert.ok(!sim.zombies.has(zombie.id) && ofMax(events, 'kill').some(event => event.zombieId === zombie.id), `seed ${seed}: shot it`);
    assert.ok(still <= 3, `seed ${seed}: ${still} ticks standing in the rain`);
    assert.ok(folds.length >= 1 && folds.every(Boolean), `seed ${seed}: folded in the rain only to shoot (${folds})`);
    assert.deepEqual(umbrellaMoves(events), [true, false, true, false], `seed ${seed}`);
    assert.ok(rainHits(events).length <= 3, `seed ${seed}: ${rainHits(events).length} s of rain while fighting`);
    assert.ok(inside(max));
  }
});

test('with an empty gun it walks on past a zombie under its open umbrella', () => {
  // Out of ammo is what a trip is for: once it folded the umbrella and stood
  // in the rain for a fight it could not fire.
  for (const seed of [1, 3, 7]) {
    const got = (body, events) => events.some(event => event.event === 'pickup' && event.id === 'max');
    const { events, max, body, run, still, folds } = tripPast({ x: -12, z: 2.6 }, { seed, gun: 'empty', until: got });
    assert.deepEqual(folds, [], `seed ${seed}: never folded on the way out`);
    assert.equal(still, 0, `seed ${seed}: never stood still on the way out`);
    assert.ok(run(20, () => body.status !== 'running'));
    assert.equal(body.status, 'done', `seed ${seed}`);
    assert.deepEqual(rainHits(events), [], `seed ${seed}: not a drop of rain damage`);
    assert.deepEqual(umbrellaMoves(events), [true, false], `seed ${seed}: opened outside, folded back inside`);
    assert.ok(inside(max) && max.inventory.pistol.ammo + max.inventory.pistol.reserve > 0, `seed ${seed}: back in with the ammo`);
  }
});

test('with a worn umbrella the rain takes only what the umbrella no longer blocks', () => {
  const { sim, events, papa, max, body, run } = room({ wave: 3 });
  Object.assign(papa, { x: 5, z: 4 });
  sim.doors.find(door => door.id === 'west').boards.fill(0);
  Object.assign(max, { x: -3, z: 1, umbrella: { open: false, remaining: 1.5 } });
  max.inventory.pistol.reserve = 2;
  ammoBox(sim, 'box', { x: -19, z: 1 });
  body.setOrder({ kind: 'collect', pickupId: 'box' });
  let exposed = 0;
  assert.ok(run(20, () => body.status !== 'running', () => { if (sim.rainExposed(max)) exposed += TICK; }));
  assert.equal(body.status, 'done');
  assert.equal(events.filter(event => event.event === 'umbrella-broken' && event.id === 'max').length, 1);
  const burnt = rainHits(events).length;
  assert.ok(burnt >= 1 && burnt <= Math.floor(exposed - 1.5 + 1e-6), `${burnt} rain hits for ${exposed.toFixed(2)} s outside with 1.5 s of umbrella`);
  assert.equal(max.hp, 100 - burnt * 3);
});

test('never through intact boards or a sealed door; boarded up or blocked on the way, the trip fails inside', () => {
  const scene = (seed = 7) => {
    const scene = room({ seed, wave: 3 });
    Object.assign(scene.papa, { x: 5, z: 4 });
    Object.assign(scene.max, { x: -3, z: 1 });
    scene.max.inventory.pistol.reserve = 2;
    ammoBox(scene.sim, 'box', { x: -14, z: 2 });
    return { ...scene, west: scene.sim.doors.find(door => door.id === 'west') };
  };
  // Intact, its lower boards still up, or sealed: failed at once, inside.
  for (const [label, set] of [['intact', () => {}], ['lower boards', west => { west.boards = [60, 60, 0, 0, 0]; }],
    ['sealed', west => { west.boards.fill(0); west.sealed = true; }], ['being sealed', west => { west.boards.fill(0); west.sealPending = true; }]]) {
    const { events, max, body, west } = scene();
    set(west);
    body.setOrder({ kind: 'collect', pickupId: 'box' });
    assert.equal(body.tick(TICK), 'failed', label);
    assert.equal(max.collectTargetId, null, label);
    assert.deepEqual(umbrellaMoves(events), [], label);
  }
  // Boarded up while it walks to the door: it fails and stays inside.
  {
    const { events, max, body, run, trace, west } = scene();
    west.boards.fill(0);
    body.setOrder({ kind: 'collect', pickupId: 'box' });
    run(1.2);
    assert.equal(body.status, 'running');
    west.boards.fill(60);
    assert.ok(run(1, () => body.status !== 'running'));
    assert.equal(body.status, 'failed');
    assert.equal(trace.left, false);
    assert.deepEqual(umbrellaMoves(events), []);
    assert.ok(inside(max));
  }
  // A zombie stands in the doorway (it never bites, cannot be killed, and the
  // body has no ammo): it gives up after 15 s, and is never caught in the doorway.
  {
    const { sim, max, body, run, trace, west } = scene();
    west.boards.fill(0);
    statue(sim, { x: -8, z: 0 }, { hp: 1e6, maxHp: 1e6, attackAfter: Infinity });
    max.inventory.pistol.ammo = max.inventory.pistol.reserve = 0;
    body.setOrder({ kind: 'collect', pickupId: 'box' });
    const start = sim.time;
    assert.ok(run(17, () => body.status !== 'running'));
    assert.equal(body.status, 'failed');
    assert.ok(sim.time - start <= 15.5, `${(sim.time - start).toFixed(1)} s`);
    body.setOrder({ kind: 'hold' });
    run(3);
    assert.ok(Math.abs(max.x) < 7.45 && Math.abs(max.z) < 5.45, `holds inside, out of the doorway (${max.x.toFixed(2)}, ${max.z.toFixed(2)})`);
    assert.equal(trace.left, false);
  }
});

test('a trip cut short outside comes back in first, umbrella open, then carries out the new order', () => {
  const { sim, events, papa, max, body, run } = room({ wave: 3 });
  Object.assign(papa, { x: 5, z: 4 });
  sim.doors.find(door => door.id === 'west').boards.fill(0);
  Object.assign(max, { x: -3, z: 1 });
  max.inventory.pistol.reserve = 2;
  ammoBox(sim, 'box', { x: -19, z: 1 });
  body.setOrder({ kind: 'collect', pickupId: 'box' });
  assert.ok(run(10, () => max.x < -11));
  assert.equal(max.umbrella.open, true);
  body.setOrder({ kind: 'hold' });
  let wetDry = 0;
  run(6, () => false, () => { if (sim.rainExposed(max) && !max.umbrella.open) wetDry++; });
  assert.equal(wetDry, 0);
  assert.ok(inside(max) && Math.abs(max.x) < 7, `held inside (${max.x.toFixed(2)}, ${max.z.toFixed(2)})`);
  assert.equal(body.status, 'running');
  assert.equal(max.umbrella.open, false);
  assert.ok(sim.pickups.has('box'), 'the box stays where it was');
  assert.deepEqual(rainHits(events), []);
});

test('a companion never boards up the doorway a teammate outside needs to come back in', () => {
  // Once one repair (25 HP on the lowest plank) shut Max out in the rain.
  const { sim, events, papa, max, body, run } = room({ wave: 3, mates: ['lea'] });
  const lea = sim.players.get('lea'), helper = createCompanionBody(sim, 'lea', { random: seededRandom(42) });
  Object.assign(papa, { x: 5, z: 4 }); Object.assign(lea, { x: -3, z: -1.5 });
  const west = sim.doors.find(door => door.id === 'west');
  west.boards.fill(0);
  Object.assign(max, { x: -3, z: 1 });
  max.inventory.pistol.reserve = 2;
  ammoBox(sim, 'box', { x: -18, z: 2 });
  body.setOrder({ kind: 'collect', pickupId: 'box' });
  assert.ok(run(10, () => max.x < -10, () => helper.tick(TICK)));
  helper.setOrder({ kind: 'repair', doorId: 'west' });
  let whileOut = 0, ready = 0, seen = events.length;
  assert.ok(run(20, () => body.status !== 'running', () => {
    if (!inside(max)) whileOut += events.slice(seen).filter(event => event.event === 'repair' && event.id === 'lea').length;
    if (!inside(max) && flat(lea, west) < 2.1) ready++;
    seen = events.length;
    helper.tick(TICK);
  }));
  assert.equal(body.status, 'done');
  assert.ok(ready > 15, `Léa stood at the door, in reach, while Max was out (${ready} ticks)`);
  assert.equal(whileOut, 0, 'not a plank while Max was out');
  assert.ok(events.some(event => event.event === 'pickup' && event.id === 'max'));
  assert.ok(inside(max) && !max.downed);
  // Back in: Léa boards it up.
  assert.ok(run(20, () => helper.status !== 'running', () => helper.tick(TICK)));
  assert.equal(helper.status, 'done');
  assert.equal(west.hp, west.maxHp);
  assert.deepEqual(rainHits(events), []);
});

test('shut out by a human boarding the doorway behind it, it shoots out the planks in the way and comes back in', () => {
  for (const presses of [1, 4]) {
    const { sim, events, papa, max, body, run } = room({ wave: 3 });
    Object.assign(papa, { x: -6.4, z: -1.2 });
    const west = sim.doors.find(door => door.id === 'west');
    west.boards.fill(0);
    Object.assign(max, { x: -3, z: 1 });
    max.inventory.pistol.reserve = 2;
    ammoBox(sim, 'box', { x: -14, z: 3 });
    body.setOrder({ kind: 'collect', pickupId: 'box' });
    assert.ok(run(10, () => max.x < -11.5));
    for (let press = 0; press < presses; press++) { assert.equal(sim.repairDoor('papa', 'west'), true); papa.interactAfter = 0; }
    assert.equal(sim.doorPassable(west, 0, 1.75), false, `${presses}: boarded up (${west.boards})`);
    assert.ok(run(20, () => inside(max) && Math.abs(max.x) < 7), `${presses}: back inside (${max.x.toFixed(2)}, ${max.z.toFixed(2)})`);
    assert.equal(max.downed, false);
    assert.ok(events.some(event => event.event === 'pickup' && event.id === 'max'), `${presses}: with the box`);
    const planks = ofMax(events, 'board');
    // A 25-HP repair can now break in one nearby pistol hit (25.16 HP at
    // the muzzle). The lower bound follows the actual repaired HP budget.
    assert.ok(planks.length >= Math.ceil(25 * presses / WEAPONS.pistol.damage) && planks.every(event => event.doorId === 'west' && event.boardIndex <= 3), `${presses}: ${planks.length} shots into the planks in the way`);
    assert.equal(west.boards[4], 0, 'never the top plank');
    assert.ok(rainHits(events).length <= 2, `${presses}: ${rainHits(events).length} s of rain`);
    assert.equal(max.umbrella.open, false);
  }
});

// The owner's waves: the west door broken, zombies coming through it, a box
// 3 to 10 m out, then hold. Standing to fight in the rain got it downed.
function tripInWave(seed, duo) {
  const { sim, events, papa, max, body, run } = room({ seed, phase: 'countdown' });
  if (duo) sim.participantWeight = () => 1;
  sim.wave = 3;
  papa.reviveShieldUntil = Infinity;
  Object.assign(papa, { x: 4, z: 3 });
  assert.ok(run(8, () => sim.phase === 'wave'));
  run(6);
  sim.doors.find(door => door.id === 'west').boards.fill(0);
  Object.assign(max, { x: -4, z: 1, hp: 100 });
  max.inventory.pistol.reserve = 4;
  const random = seededRandom(seed + 99);
  ammoBox(sim, 'box', { x: -10 - 7 * random(), z: -4 + 8 * random() });
  body.setOrder({ kind: 'collect', pickupId: 'box' });
  run(30, () => body.status !== 'running');
  const status = body.status;
  body.setOrder({ kind: 'hold' });
  run(15, () => max.downed || (inside(max) && Math.abs(max.x) < 7));
  return { status, downed: max.downed, back: !max.downed && inside(max), at: max, got: events.some(event => event.event === 'pickup' && event.id === 'max') };
}

test('trips outside in a real wave do not get it downed out there', () => {
  // The duo wave these trials were tuned on (three doors): every one.
  for (let seed = 1; seed <= 8; seed++) {
    const trip = tripInWave(seed, true);
    assert.equal(trip.status, 'done', `seed ${seed}`);
    assert.ok(trip.back, `seed ${seed}: ${trip.downed ? 'down' : 'up'} at (${trip.at.x.toFixed(1)}, ${trip.at.z.toFixed(1)})`);
    assert.ok(trip.got, `seed ${seed}`);
  }
  // Papa and Max for real (1.5: the solo two doors, so half the zombies come
  // west): a few go wrong (seeds 1-24 on 13 October: 3 downed out there and
  // 2 trips given up; with three doors 2 and 1). Never much worse.
  const trips = Array.from({ length: 24 }, (_, index) => tripInWave(index + 1, false));
  const downed = trips.filter(trip => trip.downed).length, fetched = trips.filter(trip => trip.got && trip.back).length;
  assert.ok(downed <= 4, `${downed} of 24 downed out there`);
  assert.ok(fetched >= 18, `${fetched} of 24 brought a box back in`);
});

test('a revive is finished under attack: backing off never restarts it', () => {
  const { sim, events, papa, max, body, run } = room({ seed: 14 });
  Object.assign(max, { x: -4.5, y: 0, z: .5, yaw: 0 });
  Object.assign(papa, { x: -4.5, y: 0, z: 1.6 });
  sim.damagePlayer(papa, 1000, { id: 'test' });
  sim.zombies.clear();
  statue(sim, { x: -3.2, z: .2, entered: true, hp: 5000, maxHp: 5000 }); // 1.3 m from Max, never moving
  body.setOrder({ kind: 'revive', playerId: 'papa' });
  run(8, () => !papa.downed);
  assert.equal(papa.downed, false, 'revived');
  assert.equal(events.filter(event => event.event === 'revive-start' && event.id === 'max').length, 1, 'one revive, never restarted');
});

// A claim order (owner, 16 October): the body walks itself out to the crate,
// claims at arm's length and comes straight back in, like any trip outside.
test('claims its bonus from the supply crate outside and comes straight back in', () => {
  const { sim, events, max, body, run } = room({ phase: 'quiet', wave: 4 });
  sim.beginSupplyWave();
  assert.ok(sim.supplyCrate, 'wave 4 stands a crate');
  Object.assign(max, { x: -3, y: 0, z: 1 });
  sim.doors.find(door => door.id === 'west').boards.fill(0);
  body.setOrder({ kind: 'claim', bonus: 'extended' });
  assert.ok(run(30, () => body.status === 'done'), 'claims and returns');
  assert.equal(sim.supplyCrate.claimed.has('max'), true);
  assert.deepEqual(max.bonus, { extended: 1 });
  assert.equal(ofMax(events, 'supply-claimed').length, 1);
  assert.ok(inside(max), 'back inside');
  // Claimed once: the same order is over at once.
  body.setOrder({ kind: 'claim', bonus: 'radar' });
  run(1);
  assert.equal(body.status, 'done');
  assert.deepEqual(max.bonus, { extended: 1 }, 'one bonus per crate');
});

// A supply order: to the station inside, buySupply at arm's length.
test('walks to the supply station and buys a revive kit between waves', () => {
  const { sim, events, max, body, run } = room({ phase: 'intermission', wave: 5 });
  max.points = 1300; // from its spawn: the walk across the cabin is the point
  body.setOrder({ kind: 'supply', service: 'revive' });
  assert.ok(run(15, () => body.status === 'done'), 'walks to the station and buys');
  assert.equal(max.reviveKit, true);
  assert.equal(max.points, 100);
  assert.deepEqual(ofMax(events, 'supply-purchased').map(event => event.service), ['revive']);
});
