import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation } from '../simulation.mjs';
import { seededRandom } from '../validation/balance-report.mjs';
import { createCompanionBody } from '../companions/body.mjs';
import { describeSituation, TEXT_LIMIT, MAX_ACTIONS } from '../companions/situation.mjs';
import { describeTeamPlan, normalizeTeamPlan } from '../companions/team-plan.mjs';
import { nextCrateWave, NEXT_CRATE_LEAD } from '../companions/crate-opportunity.mjs';
import { GUIDE } from '../companion-brain/guide.mjs';

// The next crate (owner, 18 October): late in a break, a bot whose claim is
// spent waits inside at the exit for the next wave's crate rather than walk
// out to this one and back. A real RoomSimulation at 30 Hz, the body ticked
// before sim.tick() as the director does; no brain, the order is forced.
const TICK = 1 / 30;
const inside = player => Math.abs(player.x) < 7.9 && Math.abs(player.z) < 5.9;
const claimValues = result => result.actions.map(action => action.value).filter(value => value.startsWith('claim:'));
const crateLine = result => result.text.split('\n').find(line => line.startsWith('SUPPLY CRATE'));

// A quiet wave (it never spawns nor ends by itself), its crate, the west door
// open; `claimed`: Max already holds this wave's bonus. `left`: the break's
// seconds after finishWave(), or null to stay in the wave.
function room({ wave = 4, claimed = true, left = 6, pos = { x: -3, z: 1 } } = {}) {
  const events = [];
  const sim = new RoomSimulation('NEXTCR', { random: seededRandom(7), onEvent: event => events.push(event) });
  const papa = sim.addPlayer('papa', 'Papa');
  const max = sim.addPlayer('max', 'Max', undefined, { companion: true });
  sim.start('papa');
  Object.assign(sim, { phase: 'wave', wave, toSpawn: 1, spawnTimer: 1e9 });
  sim.zombies.clear(); sim.spawnWarnings.clear(); sim.beginSupplyWave();
  sim.doors.find(door => door.id === 'west').boards.fill(0);
  if (claimed && sim.supplyCrate.active) {
    Object.assign(max, { x: -15, y: 0, z: 9.2 }); // at arm's length, as a trip would
    assert.equal(sim.claimSupply('max', 'extended', sim.supplyCrate.id), true);
  }
  Object.assign(max, { y: 0, ...pos });
  if (left !== null) { sim.finishWave(); sim.timeLeft = left; }
  const body = createCompanionBody(sim, 'max', { random: seededRandom(1007) });
  const run = (seconds, each = () => {}) => {
    for (let index = 0; index < Math.round(seconds * 30); index++) {
      sim.setInput('papa', { forward: 0, strafe: 0, yaw: 0, pitch: 0 });
      const status = body.tick(TICK);
      if (sim.phase === 'wave') sim.spawnTimer = 1e9; // the new wave stays quiet too
      sim.tick(TICK);
      each(status);
      if (status !== 'running') return status;
    }
    return 'running';
  };
  return { sim, events, papa, max, body, run };
}
const ofMax = (events, name) => events.filter(event => event.event === name && event.id === 'max');

test('the next crate is offered only late in a break, with this claim spent and a crate wave next', () => {
  const { sim, max } = room({ left: 6 });
  assert.equal(nextCrateWave(sim, max), 5);
  let result = describeSituation(sim, 'max');
  const values = claimValues(result);
  assert.ok(values.includes('claim:extended') && values.length > 3, values.join());
  const extended = result.actions.find(action => action.value === 'claim:extended').description;
  assert.match(extended, /^Next crate \(wave 5 starts in ~6s\): wait inside at the west exit, then claim extended as soon as it opens, ~\d+s rain; free, per player; 1->2: /);
  assert.deepEqual(result.orders['claim:extended'], { kind: 'claim', bonus: 'extended' });
  assert.ok(result.actions.length <= MAX_ACTIONS && result.text.length <= TEXT_LIMIT);
  // The line is truthful: the crate lasts through the break, the next claim opens with the wave.
  assert.match(crateLine(result), /renewed as each wave 2-18 starts, claimable through the break after/);
  assert.match(crateLine(result), /you have claimed yours; next claim as wave 5 starts/);
  assert.doesNotMatch(result.text, /until this wave ends/);
  assert.doesNotMatch(GUIDE, /gone with the wave/);
  // A pre-staged order is a legal one to keep, and described as such.
  result = describeSituation(sim, 'max', { order: { kind: 'claim', bonus: 'extended' }, orderSince: sim.time - 2 });
  assert.match(result.actions.find(action => action.value === 'keep').description, /claim extended from the next supply crate/);
  // Too early in the break: the break's first seconds go to repairs and shopping.
  sim.timeLeft = NEXT_CRATE_LEAD + .5;
  assert.deepEqual(claimValues(describeSituation(sim, 'max')), []);
  sim.timeLeft = NEXT_CRATE_LEAD;
  assert.ok(claimValues(describeSituation(sim, 'max')).length);
  // No way out (the west door rebuilt): nothing to wait for.
  sim.doors.find(door => door.id === 'west').boards.fill(60);
  assert.deepEqual(claimValues(describeSituation(sim, 'max')), []);
});

test('never mid-wave, never while this crate is unclaimed, never before an inactive crate', () => {
  // Mid-wave, claimed: nothing (the next crate is a whole wave away).
  let { sim, max } = room({ left: null });
  sim.timeLeft = 0;
  assert.equal(nextCrateWave(sim, max), 0);
  assert.deepEqual(claimValues(describeSituation(sim, 'max')), []);
  // Unclaimed in the break: the ordinary claim of this crate, still standing.
  ({ sim, max } = room({ claimed: false, left: 6 }));
  assert.equal(nextCrateWave(sim, max), 0);
  const result = describeSituation(sim, 'max');
  assert.ok(claimValues(result).length);
  assert.ok(result.actions.filter(action => action.value.startsWith('claim:')).every(action => action.description.startsWith('Claim ')));
  // After wave 18 the next crate (19) is inactive: nothing to wait for.
  ({ sim, max } = room({ wave: 18, left: 6 }));
  assert.equal(nextCrateWave(sim, max), 0);
  assert.deepEqual(claimValues(describeSituation(sim, 'max')), []);
  assert.doesNotMatch(crateLine(describeSituation(sim, 'max')), /next claim/);
  // The countdown before wave 1 (crate 0, inactive) leads to wave 1, inactive too.
  ({ sim, max } = room({ wave: 0, claimed: false, left: null }));
  Object.assign(sim, { phase: 'countdown', timeLeft: 3 });
  assert.equal(nextCrateWave(sim, max), 0);
  assert.deepEqual(claimValues(describeSituation(sim, 'max')), []);
  // The break after wave 1: its crate inactive, wave 2's the first to claim.
  ({ sim, max } = room({ wave: 1, claimed: false, left: 5 }));
  assert.equal(sim.supplyCrate.active, false);
  assert.equal(nextCrateWave(sim, max), 2);
  assert.match(describeSituation(sim, 'max').actions.find(action => action.value === 'claim:extended').description, /^Next crate \(wave 2 starts in ~5s\)/);
  assert.match(crateLine(describeSituation(sim, 'max')), /inactive; .*; next claim as wave 2 starts\.$/);
  // The crate's rules are untouched, for humans as for bots: an inactive one refuses.
  assert.equal(sim.claimSupply('papa', 'extended', sim.supplyCrate.id), false);
});

test('the planned bonus comes first among the next-crate choices', () => {
  const { sim } = room({ left: 6 });
  const request = describeTeamPlan(sim);
  const choices = Object.fromEntries(request.questions.map(question => [question.name, question.choices[0].value]));
  choices.bot0_bonus = 'radar';
  sim.companionTeamPlan = normalizeTeamPlan(sim, request, { choices });
  assert.ok(sim.companionTeamPlan);
  const result = describeSituation(sim, 'max');
  const first = result.actions.find(action => action.value.startsWith('claim:'));
  assert.equal(first.value, 'claim:radar');
  assert.match(first.description, /^Planned bonus\. Next crate \(wave 5 starts in ~6s\)/);
});

test('the body waits inside at the exit, never in the rain, then claims the new crate as the wave starts', () => {
  // From the far east of the cabin, with 10 s left: longer, wait included,
  // than a trip's 15 s, so the trip's own clock must start with the new crate.
  const { sim, events, max, body, run } = room({ left: 10, pos: { x: 6.5, z: -4 } });
  body.setOrder({ kind: 'claim', bonus: 'extended' });
  let reached = false, rained = false, out = false;
  const status = run(40, () => {
    if (sim.phase !== 'intermission') return;
    if (!inside(max)) out = true;
    if (sim.rainExposed(max)) rained = true;
    if (Math.hypot(max.x + 6.6, max.z) < .6) reached = true;
  });
  assert.equal(status, 'done');
  assert.equal(out, false, 'never steps out before the wave');
  assert.equal(rained, false, 'never in the rain while waiting');
  assert.equal(reached, true, 'waits on the inside step of the west door');
  assert.equal(sim.wave, 5);
  assert.equal(sim.supplyCrate.id, 'supply-5');
  assert.equal(sim.supplyCrate.claimed.has('max'), true);
  assert.deepEqual(max.bonus, { extended: 2 });
  const claims = ofMax(events, 'supply-claimed'), wave = events.findIndex(event => event.event === 'wave' && event.wave === 5);
  assert.equal(claims.length, 2, 'wave 4 then wave 5');
  assert.ok(events.indexOf(claims[1]) > wave, 'claimed only once the new crate stands');
  assert.ok(inside(max), 'back inside');
});

test('a wait that stalls times out inside; a night that ends stops it; no wait after wave 18', () => {
  // The break never ends: the wait gives up after its limit, inside, empty-handed.
  let { sim, max, body, run } = room({ left: 1e9 });
  body.setOrder({ kind: 'claim', bonus: 'extended' });
  let out = false;
  assert.equal(run(30, () => { if (!inside(max)) out = true; }), 'failed');
  assert.ok(sim.time > 14 && sim.time < 17, String(sim.time));
  assert.equal(out, false);
  assert.deepEqual(max.bonus, { extended: 1 });
  // The night ends during the wait.
  ({ sim, max, body, run } = room({ left: 1e9 }));
  body.setOrder({ kind: 'claim', bonus: 'extended' });
  assert.equal(run(2), 'running');
  sim.phase = 'gameover';
  assert.equal(body.tick(TICK), 'failed');
  // After wave 18 there is no next crate: claimed, the order is over at once.
  ({ sim, max, body, run } = room({ wave: 18, left: 6 }));
  body.setOrder({ kind: 'claim', bonus: 'extended' });
  const start = { x: max.x, z: max.z };
  assert.equal(run(1), 'done');
  assert.ok(Math.hypot(max.x - start.x, max.z - start.z) < .3, 'it never walks off');
});

test('a claim trip the wave 19 renewal leaves empty-handed fails rather than reporting done', () => {
  // Unclaimed in the break after wave 18 with too little time: the crate goes
  // inactive mid-trip and the body comes back without a bonus.
  const { sim, events, max, body, run } = room({ wave: 18, claimed: false, left: 3 });
  body.setOrder({ kind: 'claim', bonus: 'extended' });
  assert.equal(run(30), 'failed');
  assert.equal(sim.wave, 19);
  assert.equal(ofMax(events, 'supply-claimed').length, 0);
  assert.equal(max.bonus, null);
  run(10);
  assert.ok(inside(max), 'still walked back in');
});

test('a claim made just as the next wave renews the crate takes the new one too, a step away', () => {
  const { sim, events, max, body, run } = room({ claimed: false, left: 1e9 });
  body.setOrder({ kind: 'claim', bonus: 'extended' });
  // The break ends on the very tick of the claim.
  const status = run(30, () => { if (sim.phase === 'intermission' && sim.supplyCrate.claimed.has('max')) sim.timeLeft = 0; });
  assert.equal(status, 'done');
  assert.equal(sim.wave, 5);
  assert.equal(sim.supplyCrate.claimed.has('max'), true);
  assert.deepEqual(ofMax(events, 'supply-claimed').map(event => event.level), [1, 2]);
  assert.ok(inside(max));
});
