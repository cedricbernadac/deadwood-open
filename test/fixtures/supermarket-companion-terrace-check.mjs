import assert from 'node:assert/strict';
import { RoomSimulation } from '../../simulation.mjs';
import { createCompanionBody } from '../../companions/body.mjs';
import { describeSituation } from '../../companions/situation.mjs';
import { describeTeamPlan } from '../../companions/team-plan.mjs';
import { rainCost, wayOut, sheltered } from '../../companions/outdoors.mjs';
import { IS_SUPERMARKET } from '../../public/level-config.js';
import { spaceFlightAt, spaceInRect, SPACE } from '../../public/level-space.js';
import { seededRandom } from '../../validation/balance-report.mjs';
const DT = 1 / 30, flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
assert.equal(IS_SUPERMARKET, true, 'fixture runs the supermarket level');

// The open-air terrace is inside the walls but under the acid rain: the east
// door opens from it, and a companion must never treat it as shelter.
function room({ bot = { x: 1, y: 0, z: 0 }, papa = { x: -12, y: 0, z: -5 }, unseal = false } = {}) {
  const sim = new RoomSimulation('TERRACE', { random: seededRandom(18), raids: false });
  const human = sim.addPlayer('papa', 'Papa'), max = sim.addPlayer('bot', 'Max', undefined, { companion: true });
  sim.start(human.id); Object.assign(sim, { phase: 'wave', wave: 16, toSpawn: 1, spawnTimer: 1e9 });
  sim.zombies.clear();
  if (unseal) for (const door of sim.doors) Object.assign(door, { sealed: false, sealPending: false });
  Object.assign(human, papa, { grounded: true, vy: 0 });
  Object.assign(max, bot, { grounded: true, vy: 0 });
  max.points = 50000;
  let rainHp = 0, shots = 0;
  const damage = sim.damagePlayer.bind(sim);
  sim.damagePlayer = (player, amount, source = {}) => { if (player?.id === max.id && source?.source === 'outside') rainHp += amount; return damage(player, amount, source); };
  const body = createCompanionBody(sim, max.id, { random: seededRandom(88) });
  const ammo = () => Object.values(max.inventory).reduce((sum, stock) => sum + (stock.ammo ?? 0), 0);
  const run = (seconds, until = () => false) => {
    for (let tick = 0; tick < seconds * 30; tick++) {
      if (human.alive && !human.downed) sim.setInput(human.id, { forward: 0, strafe: 0, yaw: 0, pitch: 0 });
      const before = ammo(); body.tick(DT); sim.spawnTimer = 1e9; sim.tick(DT); shots += Math.max(0, before - ammo());
      if (until()) return true;
    }
    return false;
  };
  const zombie = (at, extra = {}) => Object.assign(sim.spawnZombie(), { ...at, hp: 30, maxHp: 30, speed: 0, attackAfter: Infinity, entered: true }, extra);
  return { sim, human, max, body, run, zombie, get rainHp() { return rainHp; }, get shots() { return shots; } };
}
const door = (sim, id) => sim.doors.find(item => item.id === id);
const dry = player => sheltered(player);

// defend:east stands under the roof, sees the door side of the terrace and
// shoots a walker there; 150 s on post cost no rain at all.
{
  const c = room({ unseal: true });
  c.body.setOrder({ kind: 'defend', doorId: 'east' });
  c.run(12);
  assert.ok(dry(c.max), `the east door is guarded from shelter (${c.max.x.toFixed(2)},${c.max.z.toFixed(2)})`);
  assert.ok(c.max.x < 8.2, 'the east post is in the roofed passage');
  // Off the door's axis: like at every door, a target right in front of our
  // intact planks is spared.
  const walker = c.zombie({ x: 11.5, y: 0, z: -3 });
  assert.ok(flat(c.max, walker) > 4.5 && flat(c.max, walker) < 7, `walker ${flat(c.max, walker).toFixed(2)} m from the post`);
  assert.ok(c.run(8, () => !(walker.hp > 0)), 'a walker on the terrace by the east door is shot from the passage within 8 s');
  c.sim.zombies.clear();
  c.run(150, () => c.max.downed);
  assert.equal(c.max.downed, false, 'never downed on the east post');
  assert.equal(c.rainHp, 0, 'no rain damage on the east post');
  assert.ok(c.max.umbrella.remaining > 99, `umbrella untouched on the post (${c.max.umbrella.remaining})`);
}

// A trip out through the east door ends under the roof, then stays dry.
{
  const c = room({ unseal: true });
  door(c.sim, 'east').boards.fill(0);
  for (const stock of Object.values(c.max.inventory)) stock.reserve = 0;
  c.sim.pickups.set('p', { id: 'p', kind: 'ammo', x: 16.4, y: 0, z: 0, amount: 1, special: false, expiresAt: 999, charge: 780 });
  c.body.setOrder({ kind: 'collect', pickupId: 'p' });
  c.run(25, () => c.body.status !== 'running');
  assert.equal(c.body.status, 'done', 'the east trip succeeds');
  assert.ok(dry(c.max), `the east trip ends under the roof (${c.max.x.toFixed(2)},${c.max.z.toFixed(2)})`);
  const left = c.max.umbrella.remaining;
  c.run(60);
  assert.ok(dry(c.max) && c.max.umbrella.remaining >= left - .01, 'idle after the trip: it stays dry');
}
// The trip's rain estimate counts the terrace between the roof and the east door.
{
  const c = room({ unseal: true });
  door(c.sim, 'east').boards.fill(0); door(c.sim, 'west').boards.fill(0);
  const east = wayOut(c.sim, { x: 16.4, y: 0, z: 0 }), west = wayOut(c.sim, { x: -16.4, y: 0, z: 0 });
  assert.equal(east.door.id, 'east'); assert.equal(west.door.id, 'west');
  assert.ok(rainCost(c.sim, c.max, east.distance, east).seconds >= rainCost(c.sim, c.max, west.distance, west).seconds + 3,
    'the east trip promises more rain than the same trip west');
}

// hold on the terrace walks under the roof; so does an idle body.
for (const order of [{ kind: 'hold' }, { kind: 'wait' }]) {
  const c = room({ bot: { x: 11, y: 0, z: -5 } });
  const text = describeSituation(c.sim, 'bot').actions.find(action => action.value === 'hold')?.description ?? '';
  if (order.kind === 'hold') assert.match(text, /acid rain/, 'the hold text warns of the rain');
  c.body.setOrder(order);
  assert.ok(c.run(10, () => dry(c.max)), `${order.kind} on the terrace reaches shelter within 10 s`);
  c.run(30);
  assert.ok(dry(c.max), `${order.kind}: still dry 30 s later`);
}

// follow a human standing on the terrace: covered from the passage while in sight.
{
  const c = room({ papa: { x: 11.5, y: 0, z: -.5 } });
  c.body.setOrder({ kind: 'follow', playerId: 'papa' });
  c.run(20);
  assert.ok(dry(c.max), `following Papa on the terrace from shelter (${c.max.x.toFixed(2)},${c.max.z.toFixed(2)})`);
  assert.ok(c.sim.raiderLineClear({ x: c.max.x, y: 1.55, z: c.max.z }, { x: c.human.x, y: 1.55, z: c.human.z }), 'and it still sees him');
  assert.ok(c.max.umbrella.remaining > 99, 'no umbrella spent following him');
}

// Explicit combat orders on the terrace fold the umbrella and act.
{
  const c = room({ bot: { x: 11, y: 0, z: -5 } });
  const walker = c.zombie({ x: 11, y: 0, z: 1.1 }); // 6.1 m, clear of the exterior stairwell
  c.body.setOrder({ kind: 'shoot', zombieId: walker.id });
  assert.ok(c.run(8, () => !(walker.hp > 0)), 'a shoot order at 6 m on the terrace kills');
}
{
  const c = room({ bot: { x: 11, y: 0, z: -5 } });
  c.max.grenades = 2;
  const pack = [[11, 1.1], [11.6, .9], [10.4, .9]].map(([x, z]) => c.zombie({ x, y: 0, z }, { hp: 200, maxHp: 200 }));
  c.body.setOrder({ kind: 'grenade', zombieId: pack[0].id });
  c.run(4, () => c.body.status !== 'running');
  assert.equal(c.body.status, 'done', 'a grenade on the terrace is thrown');
  assert.equal(c.max.grenades, 1, 'one grenade gone');
}

// What the brain reads.
{
  const c = room({ unseal: true });
  const actions = describeSituation(c.sim, 'bot').actions;
  assert.match(actions.find(action => action.value === 'defend:east').description, /roofed terrace passage/);
  assert.doesNotMatch(actions.find(action => action.value === 'defend:west').description, /terrace/);
  // Shortened to fit the 170-character cap (review, 24 October); the guide
  // and the place names say the exterior stairs are in the acid rain.
  assert.match(actions.find(action => action.value === 'loft').description, /second exit: exterior stairs\.$/);
  const plan = describeTeamPlan(c.sim);
  assert.match(plan.situation, /"id":"east"[^}]*"terrace":true,"rain":true/);
  assert.match(plan.situation, /east door opens from that terrace/);
  const post = plan.questions.find(question => question.name.endsWith('_post'));
  assert.match(post.choices.find(item => item.value === 'east').description, /roofed terrace passage/);
}
console.log('supermarket terrace verified: dry east post, dry trips, dry hold/idle/follow, combat orders in the rain, brain texts');
