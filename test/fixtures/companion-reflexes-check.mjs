import assert from 'node:assert/strict';
// Lot 4 (KIMI): the umbrella refill order and the pinned-teammate sidestep,
// on the level DEADWOOD_LEVEL selects (the parent test runs it twice, cabin
// and supermarket). A real RoomSimulation at 30 Hz, bodies ticked before
// sim.tick() as the director does; no server, no model API.
import { RoomSimulation } from '../../simulation.mjs';
import { createCompanionBody } from '../../companions/body.mjs';
import { describeSituation } from '../../companions/situation.mjs';
import { seededRandom } from '../../validation/balance-report.mjs';
import { GENERATOR, UMBRELLA } from '../../public/expedition.js';
import { IS_SUPERMARKET, LEVEL } from '../../public/level-config.js';

const TICK = 1 / 30, map = LEVEL.id;

// A calm wave that never spawns nor ends, one human and one companion.
function calmRoom(seed) {
  const sim = new RoomSimulation('REFLEX', { random: seededRandom(seed), raids: false });
  const papa = sim.addPlayer('papa', 'Papa');
  const max = sim.addPlayer('max', 'Max', undefined, { companion: true });
  sim.start('papa');
  Object.assign(sim, { phase: 'wave', wave: 4, toSpawn: 1, spawnTimer: 1e9 });
  sim.zombies.clear();
  Object.assign(papa, { x: 5, y: 0, z: 4, grounded: true });
  Object.assign(max, { x: GENERATOR.x + 4, y: 0, z: GENERATOR.z + 3, grounded: true });
  return { sim, papa, max };
}

// ---- The umbrella order: offered low and calm, executed to the maximum.
{
  const { sim, max } = calmRoom(11);
  max.umbrella = { open: false, remaining: 20 };
  const view = describeSituation(sim, 'max');
  const action = view.actions.find(item => item.value === 'umbrella');
  assert.ok(action, `${map}: 20 s left in a calm moment: the umbrella action is offered`);
  assert.ok(action.description.length <= 170, 'within the action character limit');
  assert.ok(action.description.includes('20 s'), `it says the seconds left: ${action.description}`);
  assert.deepEqual(view.orders.umbrella, { kind: 'umbrella' });
  const body = createCompanionBody(sim, 'max', { random: seededRandom(12) });
  body.setOrder(view.orders.umbrella);
  let seconds = 0;
  while (body.status === 'running' && seconds < 20) {
    body.tick(TICK); sim.spawnTimer = 1e9; sim.tick(TICK); seconds += TICK;
  }
  assert.equal(body.status, 'done', `${map}: the walk to the generator and the refill (${seconds.toFixed(1)} s)`);
  assert.equal(max.umbrella.remaining, UMBRELLA.max, 'the umbrella is back to the maximum');
  console.log(`${map} umbrella: 20 s -> ${max.umbrella.remaining} s in ${seconds.toFixed(1)} s`);
}
// Not offered with an enemy near (not calm), nor with 80 s left.
{
  const { sim, max } = calmRoom(13);
  max.umbrella = { open: false, remaining: 20 };
  Object.assign(sim.spawnZombie(), { x: max.x + 3, y: 0, z: max.z, hp: 40, maxHp: 40, speed: 0, attackAfter: Infinity, entered: true });
  assert.ok(!describeSituation(sim, 'max').actions.some(item => item.value === 'umbrella'), `${map}: an enemy 3 m away takes the offer away`);
}
{
  const { sim, max } = calmRoom(14);
  max.umbrella = { open: false, remaining: 80 };
  assert.ok(!describeSituation(sim, 'max').actions.some(item => item.value === 'umbrella'), `${map}: 80 s left: not offered`);
}

// ---- A walker biting the human from the far side: two bots 3.5 m behind him
// (hold, or follow). The biter must die within 5 s, and with friendly fire
// full not one shot may hit the human (every hit on him is a bite).
for (const order of ['hold', 'follow']) {
  const events = [];
  const sim = new RoomSimulation('PINNED', { random: seededRandom(18), raids: false, onEvent: event => events.push(event) });
  const papa = sim.addPlayer('papa', 'Papa'), b1 = sim.addPlayer('b1', 'Max', undefined, { companion: true }), b2 = sim.addPlayer('b2', 'Lea', undefined, { companion: true });
  sim.start(papa.id);
  Object.assign(sim, { phase: 'wave', wave: 4, toSpawn: 1, spawnTimer: 1e9 });
  sim.zombies.clear();
  sim.friendlyFire = 'full';
  const H = IS_SUPERMARKET ? { x: -3.5, z: 1.4 } : { x: -3.7, z: 1.7 };
  Object.assign(papa, { ...H, y: 0, grounded: true, hp: 1e6, maxHp: 1e6 });
  Object.assign(b1, { x: H.x + 3.5, y: 0, z: H.z, grounded: true });
  Object.assign(b2, { x: H.x + 3.4, y: 0, z: H.z + .25, grounded: true });
  const bodies = [b1, b2].map((bot, index) => createCompanionBody(sim, bot.id, { random: seededRandom(80 + index) }));
  bodies.forEach(body => body.setOrder(order === 'hold' ? { kind: 'hold' } : { kind: 'follow', playerId: 'papa' }));
  const zombie = sim.spawnZombie();
  Object.assign(zombie, { x: H.x - .9, y: 0, z: H.z, hp: 60, maxHp: 60, speed: 0, entered: true });
  let killedAt = null, seconds = 0;
  const hp0 = papa.hp;
  for (let tick = 0; tick < 30 * 15; tick++) {
    sim.setInput(papa.id, { forward: 0, strafe: 0, yaw: Math.PI / 2, pitch: 0 });
    bodies.forEach(body => body.tick(TICK));
    sim.spawnTimer = 1e9;
    sim.tick(TICK);
    seconds += TICK;
    if (!(zombie.hp > 0)) { killedAt = +seconds.toFixed(2); break; }
  }
  const hits = events.filter(event => event.event === 'hit' && event.id === 'papa');
  const friendly = hits.filter(event => event.source === 'friendly').length;
  assert.ok(killedAt !== null, `${map} ${order}: the biter is killed (15 s cap)`);
  assert.ok(killedAt <= 5, `${map} ${order}: killed within 5 s (${killedAt} s)`);
  assert.equal(friendly, 0, `${map} ${order}: no friendly hit on the pinned human`);
  assert.ok(hits.length - friendly >= 0 && papa.hp < hp0, `${map} ${order}: the human was really being bitten`);
  console.log(`${map} ${order}: biter killed at ${killedAt} s, ${hits.length} bites, ${friendly} friendly hits, HP lost ${Math.round(hp0 - papa.hp)}`);
}

console.log(`${map} companion reflexes verified`);
