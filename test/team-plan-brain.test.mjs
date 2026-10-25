import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { GUIDE, PLAN_GUIDE, TACTICAL_GUIDE, buildInput, buildPlanInput } from '../companion-brain/guide.mjs';
import { costOf } from '../companion-brain/budget.mjs';
import { askTeamPlan, decisionBody, estimatePlanTokens, estimateTokens, planBody, planReservationTokens, reservationTokens } from '../companion-brain/openai.mjs';
import { cleanPlanQuestions, connectBrain, createBrain } from '../companion-brain/service.mjs';

const KEY = 'sk-test-DO-NOT-LOG-TEAM-KEY';
const clock = () => new Date(2026, 9, 17, 13);
const questions = [
  { name: 'role_Max', instructions: 'Coordinate Max with Lea.', choices: [
    { value: 'cover', description: 'Cover the north door.' }, { value: 'rescue', description: 'Stay ready to rescue.' }] },
  { name: 'weapon_Lea', instructions: 'Prepare an affordable future weapon.', choices: [
    { value: 'smg', description: 'Keep the SMG.' }, { value: 'flamethrower', description: 'Save for the flamethrower.' }] },
];
const planMessage = extra => ({ type: 'plan', id: 'p1', room: 'TEAM01', wave: 4, situation: 'Max has a shotgun. Lea has an SMG. North needs coverage.', questions, ...extra });
const actions = [{ value: 'keep', description: 'Keep covering north.' }, { value: 'revive:human', description: 'Rescue Jules immediately.' }];
const tactical = extra => ({ type: 'decide', id: 'd1', room: 'TEAM01', companion: { id: 'c1', name: 'Max' }, current: 'defend:north',
  mode: 'tactical', teamIntent: 'Cover north; save for flamethrower; Lea gathers her bonus.', situation: 'Jules is downed nearby.', actions, ...extra });
const ok = body => ({ ok: true, status: 200, json: async () => body });
const answer = (name, choice, confidence = .9) => ({ type: 'choice', name, choice, confidence });
const planResponse = (extra = {}) => ok({ answers: [answer('weapon_Lea', 'flamethrower', .8), answer('role_Max', 'cover', .92)], usage: { input_tokens: 950 }, ...extra });
const tacticalResponse = () => ok({ answers: [answer('action', 'revive:human')], usage: { input_tokens: 500 } });
const productionQuestions = count => [
  ...Array.from({ length: count }, (_, index) => [
    { name: `bot${index}_role`, instructions: `${['Max', 'Lea', 'Sam'][index]}: select a complementary role.`,
      choices: ['support', 'close', 'marksman', 'medic'].map(value => ({ value, description: value })) },
    { name: `bot${index}_goalWeapon`, instructions: 'Next weapon.', choices: ['flamethrower', 'smg'].map(value => ({ value, description: value })) },
    { name: `bot${index}_keepWeapon`, instructions: 'Keep one.', choices: [{ value: 'smg', description: 'Keep SMG.' }] },
    { name: `bot${index}_bonus`, instructions: 'Bonus.', choices: ['extended', 'reinforced'].map(value => ({ value, description: value })) },
    { name: `bot${index}_post`, instructions: 'Post.', choices: ['north', 'loft'].map(value => ({ value, description: value })) },
  ]).flat(),
  { name: 'tripLead', instructions: 'First crate trip.', choices: Array.from({ length: count }, (_, index) => ({ value: `c${index}`, description: `Companion ${index}` })) },
];
const bodyResponse = (body, tokens = 700, confidence = .9) => ok({ answers: body.questions.map(question => answer(question.name, question.choices[0].value, confidence)), usage: { input_tokens: tokens } });
function setup(t, fetch, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'deadwood-team-brain-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const strictFetch = (url, init) => {
    const body = JSON.parse(init.body);
    assert.ok(body.questions.length > 0, 'API never receives an empty questions array');
    for (const question of body.questions) assert.ok(question.choices.length >= 2, `API requires two choices for ${question.name}`);
    return fetch(url, init);
  };
  return { dir, brain: createBrain({ key: KEY, dir, clock, fetch: strictFetch, ...options }) };
}
const lines = dir => readFileSync(join(dir, 'decisions-2026-10-17.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, what) {
  const deadline = Date.now() + 3000;
  while (!predicate()) { if (Date.now() > deadline) assert.fail(`timeout: ${what}`); await sleep(5); }
}

test('a whole team plan is one multi-question API call, reordered answers are valid and minimum confidence is returned', async t => {
  const calls = [];
  const { dir, brain } = setup(t, async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return planResponse(); });
  const result = await brain.plan(planMessage());
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body.questions, questions.map(question => ({ type: 'choice', ...question })));
  assert.ok(calls[0].body.input.startsWith(PLAN_GUIDE));
  assert.deepEqual(result.choices, { weapon_Lea: 'flamethrower', role_Max: 'cover' });
  assert.equal(result.type, 'team-plan'); assert.equal(result.id, 'p1'); assert.equal(result.confidence, .8);
  assert.equal(result.inputTokens, 950); assert.ok(result.latencyMs >= 0);
  assert.equal(brain.budget.session.requests, 1);
  const [entry] = lines(dir);
  assert.equal(entry.kind, 'plan'); assert.equal(entry.questions, 2); assert.equal(entry.choices, 4);
  assert.equal(entry.inputTokens, 950); assert.equal(entry.costUsd, costOf(950));
  for (const field of ['situation', 'teamIntent', 'selected', 'action', 'instructions']) assert.equal(Object.hasOwn(entry, field), false);
});

test('production roles are one coherent allocation among 4, 12 or 24 choices, followed by parameters conditioned on known roles', async t => {
  for (const count of [1, 2, 3]) {
    const calls = [], q = productionQuestions(count);
    const { dir, brain } = setup(t, async (url, init) => {
      const body = JSON.parse(init.body); calls.push(body);
      return bodyResponse(body, calls.length === 1 ? 800 : 1100, calls.length === 1 ? .81 : .95);
    });
    const result = await brain.plan(planMessage({ questions: q }));
    assert.equal(calls.length, 2); assert.equal(calls[0].questions.length, 1);
    const [allocation] = calls[0].questions;
    assert.equal(allocation.name, 'roleAllocation'); assert.equal(allocation.choices.length, [0, 4, 12, 24][count]);
    assert.equal(new Set(allocation.choices.map(choice => choice.description)).size, allocation.choices.length);
    for (const choice of allocation.choices) {
      assert.match(choice.value, /^allocation\d+$/);
      const roles = [...choice.description.matchAll(/: (support|close|marksman|medic)/g)].map(match => match[1]);
      assert.equal(roles.length, count); assert.equal(new Set(roles).size, count);
      assert.ok(choice.description.includes('bot0_role (Max)'));
    }
    const second = calls[1];
    assert.ok(second.input.startsWith('CONFIRMED TEAM ROLE ALLOCATION\n'));
    for (let index = 0; index < count; index += 1) {
      const name = `bot${index}_role`, role = ['support', 'close', 'marksman'][index];
      assert.equal(second.questions.some(question => question.name === name), false, 'fixed role is not sent as an API question');
      assert.equal(result.choices[name], role);
      assert.ok(second.input.includes(`${name}=${role}`));
      assert.equal(result.choices[`bot${index}_keepWeapon`], 'smg', 'fixed equipment choice is merged locally too');
      assert.equal(result.choices[`bot${index}_goalWeapon`], 'flamethrower', 'complementary roles still permit several flamethrowers');
    }
    assert.equal(Object.keys(result.choices).length, q.length, 'all original fields are present in the final atomic answer');
    assert.ok(second.questions.every(question => question.choices.length >= 2));
    assert.equal(result.inputTokens, 1900); assert.equal(result.confidence, .81);
    assert.equal(brain.budget.session.requests, 2); assert.equal(brain.budget.session.inputTokens, 1900);
    assert.equal(lines(dir)[0].calls, 2);
    const input = buildPlanInput(planMessage());
    assert.ok(planReservationTokens(input, q) >= calls.reduce((sum, body) => sum + reservationTokens(body), 0));
  }
});

test('both production phases are reserved before the first request starts', async t => {
  const q = productionQuestions(3), p = planMessage({ questions: q }), input = buildPlanInput(p);
  const full = planReservationTokens(input, q);
  assert.ok(full > reservationTokens(planBody(input, q)));
  const { brain } = setup(t, () => assert.fail('not enough money to reserve the whole plan'), { sessionBudget: costOf(full - 1) });
  assert.equal((await brain.plan(p)).error, 'budget'); assert.equal(brain.budget.session.requests, 0);
});

test('mixed generic questions omit fixed choices from the API and merge them into the complete answer', async t => {
  const fixed = { name: 'keepWeapon_Max', instructions: 'Currently unarmed.', choices: [{ value: 'none', description: 'No weapon to retain.' }] };
  const q = [...questions, fixed], calls = [];
  const { brain } = setup(t, async (url, init) => { const body = JSON.parse(init.body); calls.push(body); return bodyResponse(body); });
  const result = await brain.plan(planMessage({ questions: q }));
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].questions.map(question => question.name), questions.map(question => question.name));
  assert.deepEqual(result.choices, { keepWeapon_Max: 'none', role_Max: 'cover', weapon_Lea: 'smg' });
  assert.equal(planReservationTokens(buildPlanInput(planMessage()), q), reservationTokens(calls[0]));
  assert.equal(estimatePlanTokens(calls[0].input, q), estimatePlanTokens(calls[0].input, questions));
});

test('all-fixed plans need zero API calls even through the direct generic and production helpers', async () => {
  const input = buildPlanInput(planMessage()), fetch = () => assert.fail('all values are already fixed');
  const generic = questions.map(question => ({ ...question, choices: [question.choices[0]] }));
  const result = await askTeamPlan({ key: KEY, input, questions: generic, fetch });
  assert.deepEqual(result.choices, { role_Max: 'cover', weapon_Lea: 'smg' });
  assert.equal(result.calls, 0); assert.equal(result.inputTokens, 0); assert.equal(planReservationTokens(input, generic), 0);
  const production = productionQuestions(3).map(question => ({ ...question, choices: [question.choices[question.name.endsWith('_role') ? Number(question.name[3]) : 0]] }));
  const assigned = await askTeamPlan({ key: KEY, input, questions: production, fetch });
  assert.equal(assigned.calls, 0); assert.equal(Object.keys(assigned.choices).length, 16); assert.equal(planReservationTokens(input, production), 0);
});

test('unknown allocation cannot launch phase two and follow-up answers cannot alter locked roles', async t => {
  const q = productionQuestions(2);
  let calls = 0;
  const { brain } = setup(t, async () => {
    calls += 1;
    return ok({ answers: [answer('roleAllocation', 'allocation999')], usage: { input_tokens: 600 } });
  });
  assert.equal((await brain.plan(planMessage({ questions: q }))).error, 'api'); assert.equal(calls, 1);
  const { brain: changed } = setup(t, async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.questions[0].name === 'roleAllocation') return bodyResponse(body, 600);
    const answers = body.questions.map(question => answer(question.name, question.choices[0].value));
    answers.push(answer('bot1_role', 'support'));
    return ok({ answers, usage: { input_tokens: 800 } });
  });
  assert.equal((await changed.plan(planMessage({ questions: q }))).error, 'api');
  assert.equal(changed.budget.session.inputTokens, 1400); assert.equal(changed.budget.session.requests, 2);
});

test('failure after allocation retains first-phase spending and records all sent calls without applying a partial plan', async t => {
  const q = productionQuestions(2);
  for (const error of ['refusal', 'api', 'timeout', 'cancelled']) {
    const calls = [];
    const { brain, dir } = setup(t, async (url, init) => {
      const body = JSON.parse(init.body); calls.push(body);
      if (calls.length === 1) return bodyResponse(body, 750);
      if (error === 'refusal') return ok({ answers: [{ type: 'refusal', name: 'bot0_role' }], usage: { input_tokens: 900 } });
      if (error === 'api') return { ok: false, status: 503 };
      return new Promise(() => {});
    }, { planTimeoutMs: 40 });
    const pending = brain.plan(planMessage({ questions: q }));
    await until(() => calls.length === 2, 'conditioned second phase');
    if (error === 'cancelled') assert.equal(brain.cancel('p1'), true);
    assert.deepEqual(await pending, { type: 'team-plan', id: 'p1', error });
    const expected = 750 + (error === 'refusal' ? 900 : error === 'api' ? 0 : estimatePlanTokens(calls[1].input, calls[1].questions.map(({ type, ...question }) => question)));
    assert.equal(brain.budget.session.inputTokens, expected);
    assert.equal(brain.budget.session.requests, 2); assert.equal(lines(dir)[0].calls, 2);
    assert.equal(brain.pendingRequests, 0); assert.equal(brain.reservedTokens, 0);
  }
});

test('the two-phase deadline covers allocation time too and cancellation between phases cannot launch another call', async () => {
  const q = productionQuestions(2), input = buildPlanInput(planMessage());
  let calls = 0, elapsed = 0;
  const fetch = async (url, init) => {
    calls += 1;
    return { ok: true, json: async () => {
      elapsed = 70;
      return { answers: JSON.parse(init.body).questions.map(question => answer(question.name, question.choices[0].value)), usage: { input_tokens: 600 } };
    } };
  };
  await assert.rejects(askTeamPlan({ fetch, key: KEY, input, questions: q, timeoutMs: 60, now: () => elapsed }),
    error => error.kind === 'timeout' && error.calls === 1 && error.inputTokens === 600 && error.latencyMs === 70);
  assert.equal(calls, 1, 'allocation consumed the whole deadline');
  const controller = new AbortController(); calls = 0;
  await assert.rejects(askTeamPlan({ key: KEY, input, questions: q, signal: controller.signal, fetch: async (url, init) => {
    calls += 1;
    const body = JSON.parse(init.body);
    // Abort after parsing the allocation but before its caller can continue.
    return { ok: true, json: async () => { queueMicrotask(() => controller.abort()); return { answers: body.questions.map(question => answer(question.name, question.choices[0].value)), usage: { input_tokens: 600 } }; } };
  } }), error => error.kind === 'cancelled' && error.calls === 1);
  assert.equal(calls, 1, 'cancelled dependency never starts phase two');
});

test('a malformed, partial, extra, duplicate or illegal plan is rejected atomically and its usage still counts', async t => {
  const cases = [
    [], [answer('role_Max', 'cover')],
    [answer('role_Max', 'cover'), answer('role_Max', 'rescue')],
    [answer('role_Max', 'cover'), answer('unknown', 'smg')],
    [answer('role_Max', 'cover'), answer('weapon_Lea', 'magnum')],
    [answer('role_Max', 'cover'), answer('weapon_Lea', 'smg'), answer('extra', KEY)],
    [answer('role_Max', 'cover'), { type: 'text', name: 'weapon_Lea', text: KEY }],
  ];
  for (const answers of cases) {
    const { brain } = setup(t, async () => ok({ answers, usage: { input_tokens: 870 } }));
    assert.deepEqual(await brain.plan(planMessage()), { type: 'team-plan', id: 'p1', error: 'api' });
    assert.equal(brain.budget.session.inputTokens, 870);
    assert.equal(brain.pendingRequests, 0); assert.equal(brain.reservedTokens, 0);
  }
});

test('logs and reports never include plan prose or selected values, even if they contain a secret-like string', async t => {
  const reports = [], q = [{ name: 'role_Max', instructions: KEY, choices: [{ value: KEY, description: KEY }, { value: 'cover', description: 'Cover.' }] }];
  const { brain, dir } = setup(t, async () => ok({ answers: [answer('role_Max', KEY)], usage: { input_tokens: 500 } }), { report: entry => reports.push(entry) });
  assert.equal((await brain.plan(planMessage({ questions: q, situation: KEY }))).choices.role_Max, KEY);
  assert.ok(!JSON.stringify(reports).includes(KEY));
  for (const file of readdirSync(dir)) assert.ok(!readFileSync(join(dir, file), 'utf8').includes(KEY), file);
});

test('missing, zero and nonfinite plan usage all settle to a finite estimate', async t => {
  for (const input_tokens of [undefined, 0, Infinity, NaN, -5]) {
    const { brain } = setup(t, async () => planResponse({ usage: { input_tokens } }));
    const result = await brain.plan(planMessage());
    assert.equal(result.inputTokens, estimatePlanTokens(buildPlanInput(planMessage()), questions));
    assert.equal(Number.isFinite(brain.budget.session.costUsd), true);
  }
});

test('refusal, timeout, HTTP error and unreadable JSON fail the entire plan and keep conservative billing', async t => {
  const scenarios = [
    { fetch: async () => ok({ answers: [answer('role_Max', 'cover'), { type: 'refusal', name: 'weapon_Lea' }], usage: { input_tokens: 900 } }), error: 'refusal', tokens: 900 },
    { fetch: async () => new Promise(() => {}), error: 'timeout', estimated: true },
    { fetch: async () => ({ ok: false, status: 401, json: () => assert.fail('error body must not be read') }), error: 'api', tokens: 0 },
    { fetch: async () => ({ ok: true, json: async () => { throw new Error(KEY); } }), error: 'api', estimated: true },
  ];
  for (const scenario of scenarios) {
    const { dir, brain } = setup(t, scenario.fetch, { timeoutMs: 30 });
    assert.equal((await brain.plan(planMessage())).error, scenario.error);
    const expected = scenario.estimated ? estimatePlanTokens(buildPlanInput(planMessage()), questions) : scenario.tokens;
    assert.equal(brain.budget.session.inputTokens, expected);
    assert.equal(lines(dir)[0].estimated, scenario.estimated);
    assert.equal(brain.reservedTokens, 0);
    for (const file of readdirSync(dir)) assert.ok(!readFileSync(join(dir, file), 'utf8').includes(KEY), file);
  }
});

test('every question is bounded and validated before any API request', async t => {
  const invalid = [null, [], Array.from({ length: 21 }, (_, i) => ({ ...questions[0], name: `q${i}` })),
    [questions[0], questions[0]], [{ ...questions[0], name: '__proto__' }], [{ ...questions[0], name: 'role:Max' }],
    [{ ...questions[0], instructions: 'x'.repeat(1001) }], [{ ...questions[0], choices: [] }],
    [{ ...questions[0], choices: Array.from({ length: 25 }, (_, i) => ({ value: `v${i}` })) }],
    [{ ...questions[0], choices: [{ value: 'same' }, { value: 'same' }] }],
    [{ ...questions[0], choices: [{ value: 'x'.repeat(81) }] }]];
  const { brain } = setup(t, () => assert.fail('malformed plan never reaches API'));
  for (const choices of invalid) {
    assert.equal(cleanPlanQuestions(choices), null);
    assert.equal((await brain.plan(planMessage({ questions: choices }))).error, 'api');
  }
  const boundary = Array.from({ length: 20 }, (_, i) => ({ name: `q${i}`, instructions: '', choices: Array.from({ length: 24 }, (_, j) => ({ value: `v${j}` })) }));
  assert.equal(cleanPlanQuestions(boundary).length, 20);
  const captured = [];
  const { brain: bounded } = setup(t, async (url, init) => { captured.push(JSON.parse(init.body)); return planResponse(); });
  await bounded.plan(planMessage({ situation: 'x'.repeat(30000) }));
  assert.equal(captured[0].input, `${PLAN_GUIDE}\n\nTEAM SITUATION\n${'x'.repeat(16000)}`);
});

test('dry or completely forced plans cost nothing and still return every assignment', async t => {
  for (const dry of [false, true]) {
    const { brain } = setup(t, () => assert.fail('no call needed'), { dry });
    const forced = dry ? questions : questions.map(question => ({ ...question, choices: [question.choices[0]] }));
    const result = await brain.plan(planMessage({ questions: forced }));
    assert.deepEqual(result.choices, { role_Max: 'cover', weapon_Lea: 'smg' });
    assert.equal(result.inputTokens, 0); assert.equal(brain.budget.session.requests, 0);
  }
});

test('tactical input is lighter, retains urgent local rules and bounds the team assignment; legacy remains a fallback', async t => {
  assert.ok(TACTICAL_GUIDE.split(/\s+/).length >= 250 && TACTICAL_GUIDE.split(/\s+/).length <= 350);
  for (const fact of ['immediately override', 'rescue', 'escape danger', 'children', '25 s', 'loft', 'boards stop bullets', 'raiders', 'Reload', 'Acid rain', 'umbrella', 'forbids shooting'])
    assert.ok(TACTICAL_GUIDE.includes(fact), fact);
  const input = buildInput(tactical({ teamIntent: 'A'.repeat(1200) }));
  assert.ok(input.startsWith(TACTICAL_GUIDE)); assert.ok(input.includes('A'.repeat(900))); assert.ok(!input.includes('A'.repeat(901)));
  assert.ok(estimateTokens(input, actions) < estimateTokens(buildInput({ ...tactical(), mode: 'legacy' }), actions) * .7);
  assert.ok(buildInput(tactical({ teamIntent: '' })).startsWith(GUIDE));
  assert.ok(buildInput(tactical({ mode: undefined })).startsWith(GUIDE));
  const shared = 'TEAM PLAN r3: cover north, keep the SMG, save for the flamethrower.';
  const embedded = buildInput(tactical({ teamIntent: shared, situation: `${shared}\nJules needs revival.` }));
  assert.equal(embedded.split(shared).length - 1, 1, 'assignment appears only once when the situation already carries it');
  assert.ok(buildInput(tactical({ teamIntent: '', situation: shared })).startsWith(TACTICAL_GUIDE), 'embedded assignments also enable the short guide');
  const { dir, brain } = setup(t, async () => tacticalResponse());
  assert.equal((await brain.decide(tactical())).action, 'revive:human');
  assert.equal(lines(dir)[0].kind, 'tactical');
});

test('in-flight plan and tactics share conservative reservations without blocking each other', async t => {
  const pending = [];
  const p = planMessage(), d = tactical();
  const pReserve = reservationTokens(planBody(buildPlanInput(p), questions));
  const dReserve = reservationTokens(decisionBody(buildInput(d), actions));
  const { brain } = setup(t, (url, init) => new Promise(resolve => pending.push({ resolve, body: JSON.parse(init.body) })),
    { sessionBudget: costOf(pReserve + dReserve + 500) });
  const planning = brain.plan(p), deciding = brain.decide(d);
  assert.equal(pending.length, 2, 'a slow strategy does not serialize the urgent tactic');
  assert.equal(brain.pendingRequests, 2); assert.equal(brain.reservedTokens, pReserve + dReserve);
  assert.equal((await brain.decide(tactical({ id: 'd2' }))).error, 'budget');
  assert.equal(pending.length, 2, 'a third request cannot exceed the shared ceiling');
  pending[1].resolve(tacticalResponse());
  assert.equal((await deciding).action, 'revive:human');
  assert.equal(brain.reservedTokens, pReserve);
  const next = brain.decide(tactical({ id: 'd3' }));
  assert.equal(pending.length, 3, 'settlement releases unused reserved cost');
  pending[2].resolve(tacticalResponse()); pending[0].resolve(planResponse());
  assert.equal((await next).action, 'revive:human'); assert.ok((await planning).choices);
  assert.equal(brain.pendingRequests, 0); assert.equal(brain.reservedTokens, 0);
  assert.equal(brain.budget.session.inputTokens, 1950);
});

test('completed plan spending closes the tactical budget and completed tactics close the planning budget', async t => {
  const p = planMessage({ situation: 'Team inventory. '.repeat(700) });
  const pReserve = reservationTokens(planBody(buildPlanInput(p), questions));
  const dReserve = reservationTokens(decisionBody(buildInput(tactical()), actions));
  const { brain } = setup(t, async () => planResponse({ usage: { input_tokens: pReserve - dReserve + 1 } }), { sessionBudget: costOf(pReserve) });
  assert.ok((await brain.plan(p)).choices);
  assert.equal((await brain.decide(tactical())).error, 'budget');
  const { brain: reverse } = setup(t, async () => tacticalResponse(), { dailyBudget: costOf(pReserve) });
  assert.equal((await reverse.decide(tactical())).action, 'revive:human');
  assert.equal((await reverse.plan(p)).error, 'budget');
  assert.equal(reverse.budget.session.requests, 1);
});

test('cancelling a sent plan aborts transport, bills its estimate and frees the pending reservation promptly', async t => {
  let signal;
  const { brain } = setup(t, (url, init) => { signal = init.signal; return new Promise(() => {}); });
  const request = brain.plan(planMessage());
  assert.equal(brain.cancel('p1'), true); assert.equal(signal.aborted, true);
  assert.deepEqual(await request, { type: 'team-plan', id: 'p1', error: 'cancelled' });
  assert.equal(brain.pendingRequests, 0); assert.equal(brain.reservedTokens, 0);
  assert.equal(brain.budget.session.inputTokens, estimatePlanTokens(buildPlanInput(planMessage()), questions));
  assert.equal(brain.cancel('p1'), false);
  const controller = new AbortController(); controller.abort();
  assert.equal((await brain.decide(tactical(), { signal: controller.signal })).error, 'cancelled');
  assert.equal(brain.budget.session.requests, 1, 'a pre-cancelled request was never billed');
});

test('a duplicate in-flight request id cannot replace or cancel the original request', async t => {
  let complete;
  const { brain } = setup(t, async () => new Promise(resolve => { complete = resolve; }));
  const original = brain.plan(planMessage());
  assert.equal((await brain.plan(planMessage())).error, 'api');
  assert.equal(brain.pendingRequests, 1);
  complete(planResponse());
  assert.ok((await original).choices);
  assert.equal(brain.budget.session.requests, 1);
});

test('the websocket handles plan, tactical and cancel concurrently and replacement cancels remaining work', async t => {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(wss, 'listening');
  t.after(async () => { for (const client of wss.clients) client.terminate(); await new Promise(resolve => wss.close(resolve)); });
  const pending = [], messages = [], states = [];
  const { brain } = setup(t, (url, init) => new Promise(resolve => pending.push({ resolve, signal: init.signal, body: JSON.parse(init.body) })));
  const connection = once(wss, 'connection');
  const link = connectBrain({ url: `ws://127.0.0.1:${wss.address().port}`, brain, reconnectMs: 20, onStatus: state => states.push(state) });
  t.after(() => link.close());
  const [socket] = await connection;
  socket.on('message', raw => messages.push(JSON.parse(String(raw))));
  await until(() => messages.length, 'hello');
  assert.equal(messages[0].version, 2); assert.deepEqual(messages[0].capabilities, ['team-plan-v1', 'map-guide-v1']);
  socket.send(JSON.stringify({ type: 'brain-welcome' }));
  socket.send(JSON.stringify(planMessage())); socket.send(JSON.stringify(tactical()));
  await until(() => pending.length === 2, 'parallel requests');
  pending[1].resolve(tacticalResponse());
  await until(() => messages.some(message => message.type === 'decision'), 'urgent tactical reply');
  socket.send(JSON.stringify({ type: 'cancel', id: 'p1' }));
  await until(() => brain.pendingRequests === 0, 'cancelled plan');
  assert.equal(pending[0].signal.aborted, true);
  pending[0].resolve(planResponse());
  await sleep(20);
  assert.equal(messages.some(message => message.type === 'team-plan'), false, 'cancelled answer is discarded');
  socket.send(JSON.stringify(planMessage({ id: 'p2' })));
  await until(() => pending.length === 3, 'next plan');
  socket.close(1000, 'replaced');
  await until(() => states.includes('replaced') && brain.pendingRequests === 0, 'handover cleanup');
  assert.equal(pending[2].signal.aborted, true); assert.equal(brain.reservedTokens, 0);
  await sleep(60);
  assert.equal(wss.clients.size, 0, 'the replaced brain does not reclaim the seat');
});
