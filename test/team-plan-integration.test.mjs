import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { RoomSimulation } from '../simulation.mjs';
import { FLAMETHROWER } from '../public/rules.js';
import { CompanionDirector, COMPANION_TIMING } from '../companions/director.mjs';
import { CompanionHub } from '../companions/hub.mjs';
import { createCompanionBody } from '../companions/body.mjs';
import { describeSituation } from '../companions/situation.mjs';
import { describeTeamPlan, normalizeTeamPlan, planningWave, planSignature, assignmentFor, teamIntent, crateRunner, PLAN_TIMING } from '../companions/team-plan.mjs';

// Cross-layer acceptance: real room state, shared strategic questions and the
// production director/body. All brains are deferred fakes: no API spend and no
// active server, timer or user game is involved.
const TICK = 1 / 30;
const flush = () => new Promise(resolve => setImmediate(resolve));
function fakeHub() {
  const hub = { connected: true, brain: { version: 2, capabilities: ['team-plan-v1'] }, plans: [], tactics: [] };
  const request = (queue, payload) => {
    const item = { payload, cancelled: 0, resolved: false };
    const promise = new Promise(resolve => { item.resolve = answer => { item.resolved = true; resolve(answer); }; });
    promise.cancel = () => { item.cancelled++; item.resolve({ error: 'cancelled' }); };
    queue.push(item);
    return promise;
  };
  hub.request = payload => request(hub.tactics, payload);
  hub.requestPlan = payload => request(hub.plans, payload);
  return hub;
}
function fakeBody() {
  return { orders: [], ticks: 0, order: null, status: 'idle',
    setOrder(order) { this.order = order; this.orders.push(order); this.status = order ? 'running' : 'idle'; },
    tick() { this.ticks++; return this.status; } };
}
const fallbackSituation = {
  text: 'The room is quiet.',
  actions: [{ value: 'hold', description: 'Hold here.' }, { value: 'defend:west', description: 'Guard west.' }],
  orders: { hold: { kind: 'hold' }, 'defend:west': { kind: 'defend', doorId: 'west' } },
};
function room({ companions = 2, realBody = false, describe = () => fallbackSituation } = {}) {
  const events = [], bodies = [], hub = fakeHub();
  let director;
  const sim = new RoomSimulation('PLAN01', { random: () => .5, onEvent: message => { events.push(message); director?.onEvent(message); } });
  const human = sim.addPlayer('human', 'Papa');
  director = new CompanionDirector(sim, hub, { random: () => .5, describe,
    createBody: (simulation, id, options) => { const body = realBody ? createCompanionBody(simulation, id, options) : fakeBody(); bodies.push(body); return body; } });
  assert.equal(director.setCount(companions, human.id), true);
  sim.start(human.id);
  const ids = [...director.entries.keys()];
  return { sim, human, director, hub, bodies, events, ids };
}
function advance(fixture, seconds, { physics = false } = {}) {
  for (let index = 0; index < Math.round(seconds / TICK); index++) {
    fixture.director.step(TICK);
    if (physics) {
      fixture.sim.setInput(fixture.human.id, { forward: 0, strafe: 0, yaw: 0, pitch: 0 });
      fixture.sim.tick(TICK);
    } else fixture.sim.time += TICK;
  }
}
function choicesFor(request, overrides = {}) {
  const choices = Object.fromEntries(request.questions.map(question => [question.name, question.choices[0].value]));
  return { choices: { ...choices, ...overrides } };
}
async function answerPlan(fixture, overrides = {}, index = fixture.hub.plans.length - 1) {
  const item = fixture.hub.plans[index];
  assert.ok(item, 'the director requested a shared plan');
  item.resolve(choicesFor(item.payload, overrides));
  await flush();
  return fixture.sim.companionTeamPlan;
}

test('the shared snapshot includes every survivor and inventory, future unlocks and closed questions', () => {
  const { sim, human, ids } = room();
  Object.assign(sim, { phase: 'intermission', wave: 3 });
  human.points = 1421; human.bonus = { reinforced: 3, radar: 1 };
  human.inventory['pistol-copy'] = { weapon: 'pistol', ammo: 7, reserve: 19 };
  const request = describeTeamPlan(sim);
  assert.equal(request.wave, 4);
  assert.deepEqual(request.companions, ids);
  assert.equal(request.questions.length, ids.length * 5 + 1, 'one shared multi-question call, not one call per member');
  assert.equal(new Set(request.questions.map(question => question.name)).size, request.questions.length);
  for (const question of request.questions) {
    assert.ok(question.choices.length > 0);
    assert.equal(new Set(question.choices.map(choice => choice.value)).size, question.choices.length);
  }
  assert.match(request.situation, /"name":"Papa"/);
  assert.match(request.situation, /"coins":1421/);
  assert.match(request.situation, /"id":"pistol-copy"/);
  assert.match(request.situation, /"reinforced":3/);
  assert.match(request.situation, /SUPPLY WAVES/);
  assert.match(request.situation, /"weapon":"flamethrower"/);
  const flame = JSON.parse(request.situation.split('\n').find(line => line.startsWith('ARMORY ')).slice(7))
    .find(item => item.weapon === 'flamethrower');
  assert.equal(flame.burnDps, FLAMETHROWER.burnDps, 'strategy sees the continuing burn, not just one contact tick');
  assert.equal(flame.contactDps, FLAMETHROWER.contactDps);
  assert.match(request.situation, /"unlockWave"/);
  assert.ok(request.situation.length <= 16000);
  assert.ok(request.questions.filter(question => question.name.endsWith('_goalWeapon')).every(question => !question.choices.some(choice => choice.value === 'magnum')));
});

test('an affordable planned upgrade becomes actionable without making saving or alternative builds illegal', () => {
  const { sim, ids } = room();
  Object.assign(sim, { phase: 'intermission', wave: 5 });
  const max = sim.players.get(ids[0]);
  max.points = 1065;
  max.inventory.shotgun = { ammo: 8, reserve: 24 };
  const request = describeTeamPlan(sim);
  const plan = normalizeTeamPlan(sim, request, choicesFor(request, { bot0_goalWeapon: 'smg', bot0_keepWeapon: 'shotgun' }));
  assert.ok(plan);
  sim.companionTeamPlan = plan;
  assert.match(teamIntent(sim, max.id), /Affordable and unlocked NOW/);
  assert.match(teamIntent(sim, max.id), /safe opportunity/);
  assert.match(teamIntent(sim, max.id), /Rescue, immediate danger/);
  max.points = 899;
  assert.match(teamIntent(sim, max.id), /Save toward it/);
  assert.doesNotMatch(teamIntent(sim, max.id), /Affordable and unlocked NOW/);
  const another = describeTeamPlan(sim);
  assert.ok(normalizeTeamPlan(sim, another, choicesFor(another, { bot0_goalWeapon: 'rifle', bot0_keepWeapon: 'shotgun' })), 'a future alternative remains a legal savings goal');
  assert.ok(normalizeTeamPlan(sim, another, choicesFor(another, { bot0_goalWeapon: 'none', bot0_keepWeapon: 'none' })), 'there is no forced milestone or reserved slot');
});

test('the complete strategic context survives a full team with four independent weapon instances each', () => {
  const { sim } = room({ companions: 3 });
  Object.assign(sim, { phase: 'intermission', wave: 11 });
  for (const player of sim.players.values()) {
    player.name = 'Long survivor name '.repeat(4);
    player.backpack = true;
    player.inventory = Object.fromEntries(['pistol','smg','shotgun','smg-copy-1234567890'].map(id => [id, { ...(id.startsWith('smg-copy') ? {weapon:'smg'} : {}), ammo:10,reserve:24 }]));
    player.bonus = { stone:8,reinforced:8,perforating:8,extended:8,radar:1 };
  }
  const initial = describeTeamPlan(sim);
  sim.companionTeamPlan = normalizeTeamPlan(sim, initial, choicesFor(initial));
  const request = describeTeamPlan(sim);
  assert.ok(request.situation.length <= 16000);
  assert.match(request.situation, /PREVIOUS INTENTIONS .*\]$/);
  assert.equal(JSON.parse(request.situation.split('\n').find(line=>line.startsWith('ARMORY ')).slice(7)).length, 13);
  assert.match(request.situation, /owner playtesting/);
  assert.match(request.situation, /not mandatory purchases/);
});

test('plan installation is atomic, validates the current team and never retains model prose', () => {
  const { sim, ids } = room();
  const request = describeTeamPlan(sim);
  const answer = choicesFor(request, { bot0_role: 'medic', bot0_goalWeapon: 'flamethrower', bot0_keepWeapon: 'pistol', tripLead: ids[1] });
  answer.explanation = 'MODEL FREE TEXT MUST NEVER ENTER GAME STATE';
  const plan = normalizeTeamPlan(sim, request, answer, 7);
  assert.ok(plan);
  assert.equal(plan.revision, 7);
  assert.equal(plan.assignments[0].role, 'medic');
  assert.deepEqual(plan.tripOrder, [ids[1], ids[0]]);
  assert.ok(Object.isFrozen(plan) && Object.isFrozen(plan.assignments) && Object.isFrozen(plan.assignments[0]));
  assert.doesNotMatch(JSON.stringify(plan), /MODEL FREE TEXT/);
  for (const invalid of [
    { choices: { ...answer.choices, bot0_role: 'invented-role' } },
    { choices: { ...answer.choices, unknown: 'hold' } },
    { choices: Object.fromEntries(Object.entries(answer.choices).filter(([key]) => key !== 'bot0_bonus')) },
    { ...answer, error: 'budget' }, { choices: [] }, {},
  ]) assert.equal(normalizeTeamPlan(sim, request, invalid), null);
  sim.players.get(ids[0]).inventory.shotgun = { ammo: 8, reserve: 24 };
  assert.equal(normalizeTeamPlan(sim, request, answer), null, 'equipment changed while the plan was pending');
  delete sim.players.get(ids[0]).inventory.shotgun;
  sim.wave = 4;
  assert.equal(normalizeTeamPlan(sim, request, answer), null, 'an old wave cannot install a fresh plan');
  assert.equal(sim.companionTeamPlan, null, 'normalization alone never mutates the room');
});

test('one strategic request serves the whole team, while body ticks and tactics continue independently', async () => {
  const fixture = room();
  advance(fixture, .1);
  assert.equal(fixture.hub.plans.length, 1);
  assert.equal(fixture.hub.tactics.length, 2, 'a pending strategy never blocks either tactical request');
  advance(fixture, 1);
  assert.equal(fixture.hub.plans.length, 1, 'never duplicate an in-flight strategy');
  assert.ok(fixture.bodies.every(body => body.ticks >= 30));
  for (const item of fixture.hub.tactics) item.resolve({ action: 'defend:west', confidence: 1 });
  await flush();
  assert.ok(fixture.bodies.every(body => body.order?.kind === 'defend'), 'tactical orders apply without a strategy result');
  const plan = await answerPlan(fixture, { bot0_role: 'close', bot0_goalWeapon: 'flamethrower', bot1_role: 'marksman', bot1_goalWeapon: 'sniper' });
  assert.ok(plan);
  assert.equal(assignmentFor(fixture.sim, fixture.ids[0]).goalWeapon, 'flamethrower');
  assert.equal(assignmentFor(fixture.sim, fixture.ids[1]).goalWeapon, 'sniper');
  assert.match(teamIntent(fixture.sim, fixture.ids[0]), /marksman/);
  assert.match(teamIntent(fixture.sim, fixture.ids[0]), /sniper/);
  assert.equal(fixture.sim.companionOrders.get(fixture.ids[0]).kind, 'defend');
  advance(fixture, 3);
  assert.equal(fixture.hub.plans.length, 1, 'ordinary combat polling does not cause strategic polling');
});

test('a strategy prepared between waves persists when that wave starts', async () => {
  const fixture = room();
  Object.assign(fixture.sim, { phase: 'intermission', wave: 4 });
  advance(fixture, .1);
  const plan = await answerPlan(fixture);
  assert.equal(plan.wave, 5);
  Object.assign(fixture.sim, { phase: 'wave', wave: 5 });
  fixture.sim.event('wave', { wave: 5 });
  advance(fixture, PLAN_TIMING.revise + 1);
  assert.equal(fixture.hub.plans.length, 1, 'the pause and wave are one strategic horizon');
  assert.equal(fixture.sim.companionTeamPlan, plan);
  fixture.sim.phase = 'intermission';
  advance(fixture, PLAN_TIMING.revise + 1);
  assert.equal(fixture.hub.plans.length, 2, 'the next pause prepares the next wave');
  assert.equal(fixture.hub.plans[1].payload.wave, 6);
});

test('transient damage, ammunition and coin changes do not trigger another strategic call', async () => {
  const fixture = room();
  advance(fixture, .1); await answerPlan(fixture);
  const signature = planSignature(fixture.sim), player = fixture.sim.players.get(fixture.ids[0]);
  player.points += 300; player.inventory.pistol.ammo--; player.hp -= 3;
  assert.equal(planSignature(fixture.sim), signature);
  advance(fixture, PLAN_TIMING.revise + 1);
  assert.equal(fixture.hub.plans.length, 1);
  player.inventory.shotgun = { ammo: 8, reserve: 24 };
  advance(fixture, PLAN_TIMING.revise + 1);
  assert.equal(fixture.hub.plans.length, 2, 'a new loadout can revise the team division of labour');
});

test('a pending strategy from the previous night cannot attach to a restarted identical wave', async () => {
  const fixture = room();
  advance(fixture, .1);
  const old = fixture.hub.plans[0], before = fixture.director.generation;
  fixture.sim.phase = 'gameover';
  assert.equal(fixture.sim.start(fixture.human.id), true);
  assert.ok(fixture.director.generation > before, 'countdown starts a distinct room generation');
  old.resolve(choicesFor(old.payload)); await flush();
  assert.equal(fixture.sim.companionTeamPlan, null, 'same wave and phase do not resurrect the old plan');
  advance(fixture, .4);
  assert.equal(fixture.hub.plans.length, 2, 'the new night gets its own question');
});

test('a human taking a seat invalidates an in-flight team plan instead of applying assignments for a removed bot', async () => {
  const fixture = room({ companions: 3 });
  advance(fixture, .1);
  const old = fixture.hub.plans[0], removed = fixture.ids.at(-1);
  assert.equal(fixture.director.makeRoomForHuman(), true);
  fixture.sim.addPlayer('guest', 'Jules', undefined, { defer: true });
  old.resolve(choicesFor(old.payload)); await flush();
  assert.equal(fixture.sim.companionTeamPlan, null);
  assert.equal(fixture.sim.players.has(removed), false);
  advance(fixture, PLAN_TIMING.retry + 1);
  assert.equal(fixture.hub.plans.length, 2);
  const leadOptions = fixture.hub.plans[1].payload.questions.find(question => question.name === 'tripLead').choices;
  assert.equal(leadOptions.length, 2);
  assert.ok(!leadOptions.some(choice => choice.value === removed));
});

test('a teammate going down cancels the pending ordinary decision and permits rescue before it returns', async () => {
  const fixture = room({ companions: 1, describe: describeSituation });
  advance(fixture, .1);
  const old = fixture.hub.tactics[0], bot = fixture.sim.players.get(fixture.ids[0]);
  Object.assign(fixture.human, { x: bot.x + 1, y: bot.y, z: bot.z, hp: 0, downed: true, bleedOutAt: fixture.sim.time + 25 });
  fixture.sim.event('down', { id: fixture.human.id });
  advance(fixture, COMPANION_TIMING.trigger + .1);
  assert.ok(old.cancelled >= 1, 'the old HTTP wait cannot occupy this bot until timeout');
  assert.equal(fixture.hub.tactics.length, 2);
  const rescue = fixture.hub.tactics[1];
  assert.ok(rescue.payload.actions.some(action => action.value === `revive:${fixture.human.id}`));
  rescue.resolve({ action: `revive:${fixture.human.id}`, confidence: 1 }); await flush();
  assert.deepEqual(fixture.bodies[0].order, { kind: 'revive', playerId: fixture.human.id });
  old.resolve({ action: 'defend:west', confidence: 1 }); await flush();
  assert.equal(fixture.bodies[0].order.kind, 'revive', 'late pre-emergency orders cannot replace the rescue');
  assert.equal(fixture.hub.plans.length, 1, 'the rescue also proceeds while strategy remains pending');
});

test('a serious hit invalidates an older tactical answer without replacing the persistent team intention', async () => {
  const fixture = room({ companions: 1 });
  advance(fixture, .1);
  const plan = await answerPlan(fixture);
  const old = fixture.hub.tactics.at(-1), bot = fixture.sim.players.get(fixture.ids[0]);
  bot.hp = 20;
  fixture.sim.event('hit', { id: bot.id, amount: 80 });
  advance(fixture, COMPANION_TIMING.trigger + .1);
  assert.ok(old.cancelled >= 1);
  const newest = fixture.hub.tactics.at(-1);
  assert.notEqual(newest, old);
  newest.resolve({ action: 'hold', confidence: 1 }); await flush();
  old.resolve({ action: 'defend:west', confidence: 1 }); await flush();
  assert.equal(fixture.bodies[0].order.kind, 'hold');
  assert.equal(fixture.sim.companionTeamPlan, plan, 'urgent tactics may override intentions without deleting long-term memory');
});

test('repeated low-health hits do not keep cancelling the fresh tactical request already informed of danger', async () => {
  const fixture = room({ companions: 1 });
  advance(fixture, .1);
  const bot = fixture.sim.players.get(fixture.ids[0]);
  bot.hp = 30;
  fixture.sim.event('hit', { id: bot.id, amount: 70 });
  advance(fixture, COMPANION_TIMING.trigger + .1);
  const urgent = fixture.hub.tactics.at(-1);
  assert.notEqual(urgent, fixture.hub.tactics[0]);
  for (let index = 0; index < 2; index++) {
    bot.hp -= 1;
    fixture.sim.event('hit', { id: bot.id, amount: 1 });
    advance(fixture, .4);
  }
  assert.equal(urgent.cancelled, 0, 'an already-informed decision is allowed to finish under repeated minor hits');
  urgent.resolve({ action: 'hold', confidence: 1 }); await flush();
  assert.equal(fixture.bodies[0].order?.kind, 'hold');
});

test('a refused strategy keeps the last accepted plan and retries slowly while tactics remain available', async () => {
  const fixture = room();
  advance(fixture, .1);
  const plan = await answerPlan(fixture);
  fixture.sim.players.get(fixture.ids[0]).inventory.shotgun = { ammo: 8, reserve: 24 };
  advance(fixture, PLAN_TIMING.revise + 1);
  fixture.hub.plans.at(-1).resolve({ error: 'refusal' }); await flush();
  assert.equal(fixture.sim.companionTeamPlan, plan);
  const count = fixture.hub.plans.length;
  advance(fixture, PLAN_TIMING.retry / 2);
  assert.equal(fixture.hub.plans.length, count, 'failure cannot cause one expensive request each tick');
  advance(fixture, PLAN_TIMING.retry);
  assert.equal(fixture.hub.plans.length, count + 1);
  assert.ok(fixture.bodies.every(body => body.ticks > 30));
});

test('crate turns follow live eligibility and keep an outside runner covered until back inside', () => {
  const { sim, ids } = room();
  const request = describeTeamPlan(sim);
  sim.companionTeamPlan = normalizeTeamPlan(sim, request, choicesFor(request));
  sim.companionOrders = new Map();
  sim.supplyCrate = { claimed: new Set(), x: 10, y: 0, z: 0 };
  const [first, second] = ids;
  assert.equal(crateRunner(sim), first);
  sim.players.get(first).downed = true;
  assert.equal(crateRunner(sim), second, 'a downed runner never reserves the next trip');
  sim.players.get(first).downed = false;
  sim.supplyCrate.claimed.add(first);
  Object.assign(sim.players.get(first), { x: 10, z: 0 });
  sim.companionOrders.set(first, { kind: 'claim', bonus: 'extended' });
  assert.equal(crateRunner(sim), first, 'coverage persists during the return leg after claiming');
  sim.players.get(first).x = 7;
  assert.equal(crateRunner(sim), second);
});

test('the production body still fires real projectiles while the shared strategy and tactics await answers', () => {
  const fixture = room({ companions: 1, realBody: true, describe: describeSituation });
  Object.assign(fixture.sim, { phase: 'wave', wave: 4, toSpawn: 1, spawnTimer: 1e9 });
  const bot = fixture.sim.players.get(fixture.ids[0]), entry = fixture.director.entries.get(bot.id);
  Object.assign(bot, { x: -5, y: 0, z: 3, hp: 100, reviveShieldUntil: Infinity });
  Object.assign(fixture.human, { x: 6, y: 0, z: 4, reviveShieldUntil: Infinity });
  const zombie = Object.assign(fixture.sim.spawnZombie(), { x: -5, y: 0, z: -1, speed: 0, hp: 10000, maxHp: 10000, attackAfter: Infinity, entered: true });
  const order = { kind: 'hold' };
  entry.body.setOrder(order); entry.order = order; entry.value = 'hold'; entry.orderSince = fixture.sim.time;
  advance(fixture, 4, { physics: true });
  assert.equal(fixture.hub.plans.length, 1);
  assert.equal(fixture.hub.tactics.length, 1);
  const shots = fixture.events.filter(event => event.event === 'shot' && event.id === bot.id);
  const impacts = fixture.events.filter(event => event.event === 'bullet-impact' && event.id === bot.id && event.stop === 'zombie');
  assert.ok(shots.length >= 2, `body fired ${shots.length} shots during the pending plan`);
  assert.ok(impacts.length > 0, 'real finite-speed bullets reached the enemy');
  assert.ok(zombie.hp < zombie.maxHp);
  assert.equal(fixture.bodies[0].status, 'running');
});

function socket() {
  return Object.assign(new EventEmitter(), { sent: [],
    send(data) { this.sent.push(JSON.parse(data)); }, close() {} });
}
const receive = (target, message) => target.emit('message', Buffer.from(JSON.stringify(message)));

test('the hub keeps strategic and tactical replies separate even when their identifiers are forged across kinds', async t => {
  const hub = new CompanionHub({ timeout: 1000 }), brain = socket();
  t.after(() => hub.close());
  hub.attach(brain);
  receive(brain, { type: 'brain-hello', version: 2, capabilities: ['team-plan-v1'] });
  const plan = hub.requestPlan({ room: 'P', situation: 'Shared snapshot', questions: [] });
  const planMessage = brain.sent.at(-1);
  const tactic = hub.request({ room: 'P', actions: [{ value: 'hold' }] });
  const tacticMessage = brain.sent.at(-1);
  assert.equal(planMessage.type, 'plan'); assert.equal(tacticMessage.type, 'decide');
  assert.notEqual(planMessage.id, tacticMessage.id);
  receive(brain, { type: 'decision', id: planMessage.id, action: 'hold' });
  receive(brain, { type: 'team-plan', id: tacticMessage.id, choices: {} });
  assert.equal(hub.pending.size, 2, 'a reply for another kind cannot fulfill either request');
  receive(brain, { type: 'team-plan', id: planMessage.id, choices: { tripLead: 'max' } });
  receive(brain, { type: 'decision', id: tacticMessage.id, action: 'hold' });
  assert.deepEqual((await plan).choices, { tripLead: 'max' });
  assert.equal((await tactic).action, 'hold');
  assert.equal(hub.pending.size, 0);
});

test('cancelling a tactical wait releases only that request and a later brain replacement releases the shared plan', async t => {
  const hub = new CompanionHub({ timeout: 1000 }), first = socket(), second = socket();
  t.after(() => hub.close());
  hub.attach(first); receive(first, { type: 'brain-hello', version: 2, capabilities: ['team-plan-v1'] });
  const plan = hub.requestPlan({ room: 'P', questions: [] }), planId = first.sent.at(-1).id;
  const tactic = hub.request({ room: 'P', actions: [] }), tacticId = first.sent.at(-1).id;
  tactic.cancel();
  assert.equal((await tactic).error, 'cancelled');
  assert.deepEqual(first.sent.at(-1), { type: 'cancel', id: tacticId });
  assert.equal(hub.pending.size, 1); assert.ok(hub.pending.has(planId));
  receive(first, { type: 'decision', id: tacticId, action: 'hold' });
  assert.equal(hub.pending.size, 1, 'late cancelled answers do not settle another question');
  hub.attach(second); receive(second, { type: 'brain-hello', version: 2, capabilities: ['team-plan-v1'] });
  assert.equal((await plan).error, 'replaced');
  assert.equal(hub.pending.size, 0);
  assert.equal(hub.connected, true, 'brain handover does not drop the room');
});
