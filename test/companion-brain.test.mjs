import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { GUIDE, buildInput } from '../companion-brain/guide.mjs';
import { DECISIONS_URL, MODEL, decisionBody, estimateTokens, reservationTokens } from '../companion-brain/openai.mjs';
import { companionsDir, costOf, dayOf } from '../companion-brain/budget.mjs';
import { BRAIN_NAME, REPLACED_CODE, cleanActions, connectBrain, createBrain, defaultServers, main, parseArgs } from '../companion-brain/service.mjs';

// The brain service of companions/DESIGN.md, with a fake fetch and a local
// WebSocket server on an ephemeral port: no real API call, no fixed port.
const root = fileURLToPath(new URL('../', import.meta.url));
const KEY = 'sk-test-NEVER-LOG-THIS-0123456789';
const clock = () => new Date(2026, 9, 13, 21, 30);
const TODAY = '2026-10-13';
const ACTIONS = [
  { value: 'keep', description: 'Keep defending the north door (4 s)' },
  { value: 'revive:jules', description: 'Revive Jules: downed, 14 s left, 6 m north-east' },
  { value: 'repair:west', description: 'Repair the west door: 2/5 boards, no zombie there' },
];
const SITUATION = 'Wave 4, 12 zombies left. Jules is downed 6 m north-east, no zombie near him.';
const decideMessage = (extra = {}) => ({ type: 'decide', id: 'r1', room: 'ABC123', companion: { id: 'c1', name: 'Max' },
  situation: SITUATION, actions: ACTIONS, current: 'defend:north', ...extra });

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'deadwood-brain-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function fakeFetch(reply) {
  const calls = [];
  const fetch = async (url, init) => { const call = { url, init, body: JSON.parse(init.body) }; calls.push(call); return reply(call); };
  return { fetch, calls };
}
const okJson = body => ({ ok: true, status: 200, json: async () => body });
const chose = (value, { tokens = 850, confidence = .87 } = {}) => okJson({ model: MODEL,
  answers: [{ type: 'choice', name: 'action', choice: value, probabilities: [{ value, probability: .91 }], confidence }],
  usage: { input_tokens: tokens } });
const refused = (tokens = 840) => okJson({ model: MODEL, answers: [{ type: 'refusal', name: 'action' }], usage: { input_tokens: tokens } });
const brainFor = (t, fetch, options = {}) => createBrain({ key: KEY, fetch, dir: options.dir ?? scratch(t), clock, ...options });
const logLines = dir => readFileSync(join(dir, `decisions-${TODAY}.jsonl`), 'utf8').trim().split('\n').map(line => JSON.parse(line));
const usageOf = dir => JSON.parse(readFileSync(join(dir, 'usage.json'), 'utf8'));

async function gameServer(port = 0) {
  const wss = new WebSocketServer({ host: '127.0.0.1', port, path: '/companions' });
  await once(wss, 'listening');
  const inbox = [], waiters = new Set();
  wss.on('connection', socket => socket.on('message', raw => {
    inbox.push({ socket, message: JSON.parse(String(raw)) });
    for (const waiter of [...waiters]) waiter();
  }));
  const next = (predicate, timeout = 5000) => new Promise((resolve, reject) => {
    const check = () => {
      const index = inbox.findIndex(entry => predicate(entry.message));
      if (index < 0) return false;
      clearTimeout(timer); waiters.delete(check); resolve(inbox.splice(index, 1)[0]); return true;
    };
    const timer = setTimeout(() => { waiters.delete(check); reject(new Error(`no message: ${JSON.stringify(inbox.map(entry => entry.message))}`)); }, timeout);
    if (!check()) waiters.add(check);
  });
  const address = wss.address().port;
  return { wss, port: address, url: `ws://127.0.0.1:${address}/companions`, next, inbox,
    async close() { for (const client of wss.clients) client.terminate(); await new Promise(resolve => wss.close(resolve)); } };
}
const hello = message => message.type === 'brain-hello';
const decisionFor = id => message => message.type === 'decision' && message.id === id;
const send = (socket, message) => socket.send(JSON.stringify(message));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, what, timeout = 5000) {
  const end = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > end) assert.fail(`timed out waiting for ${what}`); await delay(5); }
}

test('the game guide is constant, concise and carries the rules a teammate needs', () => {
  const words = GUIDE.split(/\s+/).length;
  assert.ok(words >= 300 && words <= 1100, `about 400-1,400 tokens (${words} words)`);
  for (const fact of ['loft', 'Doors north, south, east, west', 'Repair', 'revive takes 5 s', '25 s', 'ignore downed',
    'Raiders (waves 5, 10, 15)', 'windows', 'half their coins', 'wall racks', 'Ammo boxes', 'medkits', 'revive kit', 'young child',
    'Humans first', 'surrounded', 'chokepoints', 'no zombie is at the boards', 'Reload', 'better gun', 'stay inside', 'kids',
    'Headshots do 2.2x', 'machine gun 3', 'pistol pierces none', 'Line them up', 'lined up behind',
    'SMG (900, wave 4) and above all the machine gun', 'flamethrower', 'Grenades: throw one at a pack', 'Fall back to the loft', 'Taking hits', 'Out of ammo',
    'Stepping outside is allowed for an ammo box, a medkit or your crate bonus', 'through a broken door, umbrella open in the rain; come straight back', 'forbids shooting',
    // Crates and station (owner, 16 October): claiming is free and per player.
    'fixed supply crate stands outside', 'activates every wave 2-18', 'Each survivor claims ONE independent bonus per wave', 'taking nothing from humans',
    'The supply station (inside) opens in stages', 'revive kit 1200', 'Claim your crate bonus while it stands unclaimed',
    // Coins (owner, 13 October): one short rule in the family's words.
    'Coins buy guns. When nothing is within 8 m, pick up the coins near you', 'a human already has a better gun than you', 'buy the best gun you can afford when the shop is open'])
    assert.ok(GUIDE.includes(fact), fact);
  assert.doesNotMatch(GUIDE, /give a human time to grab them/, 'the coins outside a door are its to grab now');
  // Sent with every decision: the crate and station rules grew it (5,008 characters before, owner, 16 October).
  assert.ok(GUIDE.length <= 5700, `${GUIDE.length} characters`);
  const one = buildInput({ situation: SITUATION, companion: { name: 'Max' }, current: 'defend:north' });
  const two = buildInput({ situation: 'Intermission, 9 s left.', companion: { name: 'Léa' } });
  assert.ok(one.startsWith(GUIDE) && two.startsWith(GUIDE), 'every request shares the same guide prefix');
  assert.ok(one.endsWith(SITUATION) && one.includes('Max') && one.includes('CURRENT ACTION: defend:north'));
  assert.ok(two.includes('CURRENT ACTION: none'));
});

test('the brain says hello and is welcomed', async t => {
  const game = await gameServer(); t.after(() => game.close());
  const states = [];
  const link = connectBrain({ url: game.url, brain: { decide: async () => assert.fail('no decide yet') }, onStatus: state => states.push(state) });
  t.after(() => link.close());
  const { socket, message } = await game.next(hello);
  assert.deepEqual(message, { type: 'brain-hello', name: BRAIN_NAME, version: 2, capabilities: ['team-plan-v1', 'map-guide-v1'] });
  assert.equal(link.connected, false, 'not welcomed yet');
  send(socket, { type: 'brain-welcome' });
  await until(() => states.includes('welcome'), 'the welcome');
  assert.equal(link.connected, true);
});

test('a decide becomes one Decisions request and one decision', async t => {
  const game = await gameServer(); t.after(() => game.close());
  const api = fakeFetch(() => chose('revive:jules'));
  const link = connectBrain({ url: game.url, brain: brainFor(t, api.fetch) }); t.after(() => link.close());
  const { socket } = await game.next(hello);
  send(socket, { type: 'brain-welcome' });
  send(socket, decideMessage());
  const { message } = await game.next(decisionFor('r1'));
  assert.equal(api.calls.length, 1, 'exactly one HTTP request');
  const [{ url, init, body }] = api.calls;
  assert.equal(url, DECISIONS_URL); assert.equal(url, 'https://api.openai.com/v1/decisions');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.ok(init.signal instanceof AbortSignal);
  assert.equal(body.model, 'gpt-6-luna');
  assert.ok(body.input.startsWith(GUIDE) && body.input.includes(SITUATION), 'input = guide + situation');
  assert.equal(body.questions.length, 1);
  const [question] = body.questions;
  assert.equal(question.type, 'choice'); assert.equal(question.name, 'action');
  assert.equal(typeof question.instructions, 'string'); assert.ok(question.instructions.length > 20);
  assert.deepEqual(question.choices, ACTIONS);
  assert.deepEqual(Object.keys(message).sort(), ['action', 'confidence', 'id', 'inputTokens', 'latencyMs', 'type']);
  assert.equal(message.action, 'revive:jules'); assert.equal(message.confidence, .87); assert.equal(message.inputTokens, 850);
  assert.ok(Number.isInteger(message.latencyMs) && message.latencyMs >= 0);
});

test('confidence falls back to the chosen value’s probability', async t => {
  const api = fakeFetch(() => okJson({ answers: [{ type: 'choice', name: 'action', choice: 'keep',
    probabilities: [{ value: 'repair:west', probability: .1 }, { value: 'keep', probability: .7345 }] }], usage: { input_tokens: 800 } }));
  const decision = await brainFor(t, api.fetch).decide(decideMessage());
  assert.equal(decision.action, 'keep'); assert.equal(decision.confidence, .735);
});

test('a refusal answers error refusal and still counts its tokens', async t => {
  const dir = scratch(t);
  const api = fakeFetch(() => refused(840));
  const brain = brainFor(t, api.fetch, { dir });
  assert.deepEqual(await brain.decide(decideMessage({ id: 'r9' })), { type: 'decision', id: 'r9', error: 'refusal' });
  assert.equal(brain.budget.session.inputTokens, 840);
  assert.equal(logLines(dir)[0].error, 'refusal');
});

test('a slow API answers error timeout', async t => {
  let aborted = false;
  const deaf = createBrain({ key: KEY, dir: scratch(t), clock, timeoutMs: 60, fetch: (url, init) => {
    init.signal.addEventListener('abort', () => { aborted = true; });
    return new Promise(() => {});
  } });
  const started = performance.now();
  assert.deepEqual(await deaf.decide(decideMessage()), { type: 'decision', id: 'r1', error: 'timeout' });
  assert.ok(performance.now() - started < 1500, 'it does not wait for a fetch that ignores its signal');
  assert.equal(aborted, true, 'the request is aborted');
  const polite = createBrain({ key: KEY, dir: scratch(t), clock, timeoutMs: 60, fetch: (url, init) => new Promise((resolve, reject) =>
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))) });
  assert.equal((await polite.decide(decideMessage())).error, 'timeout');
});

test('an HTTP error, a broken answer or an unknown choice answers error api', async t => {
  const cases = [
    () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) }),
    () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } }),
    () => chose('shoot:z99'),
    () => okJson({ answers: [] }),
    () => { throw new TypeError('fetch failed'); },
  ];
  for (const reply of cases) {
    const api = fakeFetch(reply);
    assert.equal((await brainFor(t, api.fetch).decide(decideMessage())).error, 'api');
    assert.equal(api.calls.length, 1);
  }
  const api = fakeFetch(() => chose('keep'));
  assert.equal((await brainFor(t, api.fetch).decide(decideMessage({ actions: [] }))).error, 'api');
  assert.equal(api.calls.length, 0, 'no legal action, no request');
});

test('a single legal action and --dry need no request', async t => {
  const never = () => assert.fail('no HTTP call');
  const downed = await brainFor(t, never).decide(decideMessage({ actions: [{ value: 'wait', description: 'Wait for a revive' }] }));
  assert.equal(downed.action, 'wait'); assert.equal(downed.inputTokens, 0);
  const dir = scratch(t);
  const dry = createBrain({ dir, clock, dry: true, fetch: never });
  const decision = await dry.decide(decideMessage());
  assert.deepEqual(decision, { type: 'decision', id: 'r1', action: 'keep', confidence: 1, latencyMs: 0, inputTokens: 0 });
  assert.equal(dry.budget.session.requests, 0);
  assert.equal(existsSync(join(dir, 'usage.json')), false, 'nothing spent');
  assert.equal(logLines(dir)[0].dry, true);
});

test('over budget, the brain answers error budget without calling the API', async t => {
  const ceiling = reservationTokens(decisionBody(buildInput(decideMessage()), ACTIONS));
  const api = fakeFetch(() => chose('keep', { tokens: ceiling }));
  const session = brainFor(t, api.fetch, { sessionBudget: costOf(ceiling) });
  assert.equal((await session.decide(decideMessage())).action, 'keep');
  assert.deepEqual(await session.decide(decideMessage({ id: 'r2' })), { type: 'decision', id: 'r2', error: 'budget' });
  assert.equal(api.calls.length, 1, 'the second decide made no request');
  assert.equal(session.budget.exhausted(), 'session');

  const dir = scratch(t);
  writeFileSync(join(dir, 'usage.json'), JSON.stringify({ version: 1, days: { [TODAY]: { requests: 9, inputTokens: 50_000_000 } } }));
  const daily = brainFor(t, api.fetch, { dir, dailyBudget: 5 });
  assert.equal((await daily.decide(decideMessage())).error, 'budget');
  assert.equal(api.calls.length, 1);
  assert.equal(daily.budget.exhausted(), 'daily');
  assert.equal(logLines(dir)[0].error, 'budget');
  const tomorrow = createBrain({ key: KEY, dir, fetch: api.fetch, dailyBudget: 5, clock: () => new Date(2026, 9, 14, 9) });
  assert.equal((await tomorrow.decide(decideMessage())).action, 'keep', 'a new day has a new budget');
});

test('usage is persisted per day and summed across runs; each decision is logged', async t => {
  const dir = scratch(t);
  const first = brainFor(t, fakeFetch(() => chose('repair:west')).fetch, { dir });
  await first.decide(decideMessage()); await first.decide(decideMessage({ id: 'r2' }));
  const second = brainFor(t, fakeFetch(() => chose('keep', { tokens: 1000 })).fetch, { dir });
  assert.equal(second.budget.today.inputTokens, 1700, 'the second run starts from today’s spending');
  await second.decide(decideMessage({ id: 'r3', companion: { id: 'c2', name: 'Léa' } }));
  assert.deepEqual(second.budget.session, { requests: 1, inputTokens: 1000, costUsd: costOf(1000) });
  const usage = usageOf(dir);
  assert.deepEqual(usage.days[TODAY], { requests: 3, inputTokens: 2700, costUsd: costOf(2700) });
  assert.equal(usage.total.inputTokens, 2700);
  assert.equal(costOf(1_000_000), .1, '$0.10 per million input tokens');
  const lines = logLines(dir);
  assert.equal(lines.length, 3);
  for (const field of ['time', 'room', 'companion', 'latencyMs', 'inputTokens', 'costUsd', 'action', 'confidence', 'error'])
    assert.ok(Object.hasOwn(lines[0], field), field);
  assert.equal(lines[0].room, 'ABC123'); assert.equal(lines[0].companion, 'Max'); assert.equal(lines[0].action, 'repair:west');
  assert.equal(lines[0].costUsd, costOf(850)); assert.equal(lines[2].companion, 'Léa');
  assert.equal(dayOf(clock()), TODAY);
  assert.equal(companionsDir({ DEADWOOD_COMPANIONS_DIR: dir }), dir);
  assert.equal(companionsDir({ LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' }), join('C:\\Users\\x\\AppData\\Local', 'deadwood-companions'));
});

test('the key never appears in the log files', async t => {
  const dir = scratch(t);
  const reports = [];
  const replies = [
    () => chose('keep'),
    () => refused(),
    () => ({ ok: false, status: 401, json: async () => ({ error: { message: `Incorrect API key provided: ${KEY}` } }) }),
    () => { throw new Error(`connect failed with ${KEY}`); },
    () => okJson({ answers: [{ type: 'choice', name: 'action', choice: KEY }], usage: { input_tokens: 5 } }),
    () => new Promise(() => {}),
  ];
  let turn = 0;
  const brain = createBrain({ key: KEY, dir, clock, timeoutMs: 40, report: entry => reports.push(entry),
    fetch: async (url, init) => replies[turn++](init) });
  for (let index = 0; index < replies.length; index += 1) await brain.decide(decideMessage({ id: `r${index}` }));
  assert.deepEqual(reports.map(entry => entry.error), [null, 'refusal', 'api', 'api', 'api', 'timeout']);
  const files = readdirSync(dir);
  assert.ok(files.includes('usage.json') && files.includes(`decisions-${TODAY}.jsonl`));
  // Not even a fragment: 'NEVER' is part of the key and nothing else.
  const leaks = content => content.includes(KEY) || content.includes('NEVER') || content.includes('sk-test');
  for (const file of files) assert.ok(!leaks(readFileSync(join(dir, file), 'utf8')), file);
  assert.ok(!leaks(JSON.stringify(reports)));
});

test('the brain reconnects when the game server goes away and comes back', async t => {
  const first = await gameServer();
  const states = [];
  const link = connectBrain({ url: first.url, reconnectMs: 50, brain: brainFor(t, fakeFetch(() => chose('keep')).fetch),
    onStatus: state => states.push(state) });
  t.after(() => link.close());
  await first.next(hello);
  await first.close();
  await until(() => states.filter(state => state === 'closed').length >= 3, 'two failed reconnections');
  assert.equal(link.connected, false);
  const second = await gameServer(first.port); t.after(() => second.close());
  const { socket } = await second.next(hello);
  send(socket, { type: 'brain-welcome' });
  send(socket, decideMessage({ id: 'again' }));
  assert.equal((await second.next(decisionFor('again'))).message.action, 'keep');
  assert.equal(link.connected, true);
  link.close();
  await once(socket, 'close');
  await delay(150);
  assert.equal(second.inbox.length, 0, 'a closed link stays closed');
});

test('a brain replaced by another one stops instead of fighting back', async t => {
  const game = await gameServer(); t.after(() => game.close());
  const states = [];
  const link = connectBrain({ url: game.url, reconnectMs: 30, brain: { decide: async () => ({}) }, onStatus: state => states.push(state) });
  t.after(() => link.close());
  const { socket } = await game.next(hello);
  send(socket, { type: 'brain-welcome' });
  await until(() => link.connected, 'the welcome');
  socket.close(REPLACED_CODE, 'replaced');
  await until(() => states.includes('replaced'), 'the replaced close');
  await delay(150);
  assert.equal(game.inbox.length, 0, 'no new hello');
});

// Like companions/hub.mjs: a new brain takes the seat and the old socket is
// closed normally (1000).
async function hubServer() {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0, path: '/companions' });
  await once(wss, 'listening');
  const hub = { seat: null, hellos: 0, connections: 0 };
  wss.on('connection', socket => {
    hub.connections += 1;
    if (hub.seat) hub.seat.close(1000, 'Un autre cerveau a pris la place.');
    hub.seat = socket;
    socket.on('message', raw => {
      if (JSON.parse(String(raw)).type !== 'brain-hello' || hub.seat !== socket) return;
      hub.hellos += 1; send(socket, { type: 'brain-welcome' });
    });
  });
  return Object.assign(hub, { url: `ws://127.0.0.1:${wss.address().port}/companions`,
    async close() { for (const client of wss.clients) client.terminate(); await new Promise(resolve => wss.close(resolve)); } });
}

test('two brains on the hub’s normal close settle on the newer one instead of swapping', async t => {
  const hub = await hubServer(); t.after(() => hub.close());
  const statesA = [], statesB = [];
  const a = connectBrain({ url: hub.url, reconnectMs: 20, brain: { decide: async () => ({}) }, onStatus: state => statesA.push(state) });
  t.after(() => a.close());
  await until(() => a.connected, 'the first brain');
  const b = connectBrain({ url: hub.url, reconnectMs: 20, brain: { decide: async () => ({}) }, onStatus: state => statesB.push(state) });
  t.after(() => b.close());
  await until(() => statesA.includes('replaced'), 'the first brain replaced');
  await delay(300);
  assert.equal(hub.connections, 2, 'the replaced brain never came back');
  assert.equal(hub.hellos, 2);
  assert.equal(b.connected, true); assert.equal(a.connected, false);
  assert.deepEqual(statesB, ['open', 'welcome'], 'the newer brain kept its seat');
  assert.ok(!statesA.includes('closed'));
});

test('a normal close before any welcome is not a replacement: the brain tries again', async t => {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0, path: '/companions' });
  await once(wss, 'listening');
  t.after(() => new Promise(resolve => { for (const client of wss.clients) client.terminate(); wss.close(resolve); }));
  let connections = 0;
  wss.on('connection', socket => {
    connections += 1;
    if (connections === 1) { socket.close(1000); return; }
    socket.on('message', () => send(socket, { type: 'brain-welcome' }));
  });
  const states = [];
  const link = connectBrain({ url: `ws://127.0.0.1:${wss.address().port}/companions`, reconnectMs: 20, brain: { decide: async () => ({}) },
    onStatus: state => states.push(state) });
  t.after(() => link.close());
  await until(() => link.connected, 'the second try');
  assert.equal(connections, 2); assert.ok(!states.includes('replaced'));
});

test('the brain tries each game address in turn and starts from the one that welcomed it', async t => {
  const gone = await gameServer(); const goneUrl = gone.url; await gone.close();
  const deaf = await gameServer(); t.after(() => deaf.close());
  const game = await gameServer(); t.after(() => game.close());
  const link = connectBrain({ urls: [goneUrl, deaf.url, game.url], reconnectMs: 20, welcomeMs: 80, brain: { decide: async () => ({}) } });
  t.after(() => link.close());
  await deaf.next(hello);
  const { socket } = await game.next(hello);
  send(socket, { type: 'brain-welcome' });
  await until(() => link.connected, 'the welcome');
  socket.terminate();
  const again = await game.next(hello);
  send(again.socket, { type: 'brain-welcome' });
  await until(() => link.connected, 'the welcome again');
  await delay(150);
  assert.equal(deaf.inbox.length, 0, 'the address that never welcomed is not tried first again');
});

test('a malformed game address is reported instead of thrown', async t => {
  const game = await gameServer(); t.after(() => game.close());
  const states = [];
  let link;
  assert.doesNotThrow(() => { link = connectBrain({ url: `ws://127.0.0.1:${game.port} /companions`, brain: {}, reconnectMs: 20,
    onStatus: (state, detail) => states.push([state, detail]) }); });
  t.after(() => link?.close());
  await delay(100);
  assert.equal(states.length, 1); assert.equal(states[0][0], 'invalid');
  assert.equal(link.connected, false); assert.equal(game.inbox.length, 0);
});

test('command line options and the npm script', () => {
  // Without PORT: 3002 (this PC, while 3000 is busy) then 3000 (play.cmd, npm start).
  assert.deepEqual(parseArgs([], {}), { servers: ['ws://127.0.0.1:3002/companions', 'ws://127.0.0.1:3000/companions'],
    sessionBudget: 2, dailyBudget: 5, dry: false, quiet: false, help: false });
  assert.deepEqual(defaultServers({ PORT: '' }), defaultServers({}));
  assert.deepEqual(parseArgs([], { PORT: '3005' }).servers, ['ws://127.0.0.1:3005/companions']);
  assert.deepEqual(parseArgs([], { PORT: '3002 ' }).servers, ['ws://127.0.0.1:3002/companions'], 'cmd: set PORT=3002 && ...');
  assert.throws(() => parseArgs([], { PORT: 'abc' }), /PORT doit être le port du jeu/);
  const options = parseArgs(['--server', 'ws://127.0.0.1:4000/companions', '--session-budget', '0.5', '--daily-budget=3', '--dry'], { PORT: 'abc' });
  assert.deepEqual(options, { servers: ['ws://127.0.0.1:4000/companions'], sessionBudget: .5, dailyBudget: 3, dry: true, quiet: false, help: false });
  assert.throws(() => parseArgs(['--session-budget', 'beaucoup'], {}), /montant/);
  for (const bad of ['http://x', 'ws://', 'ws://127.0.0.1:99999/companions', 'ws://127.0.0.1:3002 /companions', 'ws://127.0.0.1:3002/companions#x'])
    assert.throws(() => parseArgs(['--server', bad], {}), /--server attend une adresse ws:\/\/ valide/, bad);
  for (const remote of ['wss://example.com/companions', 'ws://192.168.1.50:3002/companions', 'ws://127.0.0.1.example.com/companions', 'ws://localhost.example.com/x'])
    assert.throws(() => parseArgs(['--server', remote], {}), /cet ordinateur/, remote);
  for (const local of ['ws://localhost:3002/companions', 'ws://[::1]:3002/companions', 'ws://127.0.0.1:3002', 'wss://127.0.0.1:3002/companions'])
    assert.deepEqual(parseArgs(['--server', local], {}).servers, [local]);
  assert.throws(() => parseArgs(['--loud'], {}), /inconnue/);
  assert.deepEqual(cleanActions([{ value: 'hold' }, { value: 'hold', description: 'twice' }, { description: 'no value' }]), [{ value: 'hold', description: 'hold' }]);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.companions, 'node companion-brain/brain.mjs');
  const launcher = readFileSync(join(root, 'companions.cmd'), 'utf8');
  assert.match(launcher, /call npm run companions -- %\*\r?\n/);
  assert.ok(!/set "PORT=|--server/.test(launcher), 'the brain finds the game port itself, as the game reads PORT');
  assert.match(launcher, /\)\r?\npause\r?\nendlocal\s*$/, 'the window stays open whenever the brain stops');
  assert.ok(!/OPENAI_API_KEY=|sk-/.test(launcher), 'the launcher holds no key');
});

test('a bad address or PORT gets a French message and exit code 2, not a stack trace', () => {
  for (const [argv, env, pattern] of [
    [['--server', 'ws://127.0.0.1:99999/companions'], {}, /--server attend une adresse ws:\/\/ valide/],
    [['--server', 'ws://'], {}, /--server attend/],
    [['--server', 'ws://192.168.1.50:3002/companions'], {}, /cet ordinateur/],
    [[], { PORT: 'abc' }, /PORT doit être le port du jeu/],
  ]) {
    const lines = [];
    const out = { log: line => lines.push(line), error: line => lines.push(line) };
    assert.equal(main(argv, { env, out }), 2, argv.join(' '));
    assert.match(lines.join('\n'), pattern);
  }
});

// A test brain always names its game (--server or a test PORT) and never
// inherits PORT: on its own it would look for the real game on 3002 and 3000.
function runBrain(t, args, dir, extra = {}) {
  assert.ok(args.includes('--server') || extra.PORT, 'a test brain names its game');
  const env = { ...process.env, OPENAI_API_KEY: '', DEADWOOD_COMPANIONS_DIR: dir, ...extra };
  if (!extra.PORT) delete env.PORT;
  const child = spawn(process.execPath, ['companion-brain/brain.mjs', ...args], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
  return { child, output: () => output };
}

test('without OPENAI_API_KEY the brain exits with a clear message', async t => {
  const dir = join(scratch(t), 'data');
  const { child, output } = runBrain(t, ['--server', 'ws://127.0.0.1:9/companions'], dir);
  await until(() => child.exitCode !== null, 'the exit', 10000);
  assert.equal(child.exitCode, 1, output());
  assert.match(output(), /OPENAI_API_KEY est introuvable/);
  assert.match(output(), /--dry/);
  assert.equal(existsSync(dir), false, 'nothing written');
});

test('--dry runs the real command line without a key and answers the first action', async t => {
  const game = await gameServer(); t.after(() => game.close());
  const dir = scratch(t);
  const { output } = runBrain(t, ['--dry', '--server', game.url], dir);
  const { socket } = await game.next(hello, 10000).catch(error => assert.fail(`${error.message}\n${output()}`));
  send(socket, { type: 'brain-welcome' });
  send(socket, decideMessage({ id: 'dry-1', actions: ACTIONS.slice(1) }));
  const { message } = await game.next(decisionFor('dry-1'), 10000);
  assert.deepEqual(message, { type: 'decision', id: 'dry-1', action: 'revive:jules', confidence: 1, latencyMs: 0, inputTokens: 0 });
  await until(() => output().includes('revive:jules'), 'the decision line');
  assert.match(output(), /essai sans API/);
  assert.equal(existsSync(join(dir, 'usage.json')), false);
});

test('PORT with a trailing space (cmd: set PORT=3002 && ...) still finds the game', async t => {
  const game = await gameServer(); t.after(() => game.close());
  const { child, output } = runBrain(t, ['--dry'], scratch(t), { PORT: `${game.port} ` });
  const { socket } = await game.next(hello, 10000).catch(error => assert.fail(`${error.message}\n${output()}`));
  send(socket, { type: 'brain-welcome' });
  await until(() => output().includes('Connecté au jeu'), 'the welcome line');
  assert.equal(child.exitCode, null, output());
  assert.ok(!/SyntaxError|at open/.test(output()), output());
});

test('a replaced brain says so, prints what the session cost and exits cleanly', async t => {
  const game = await gameServer(); t.after(() => game.close());
  const { child, output } = runBrain(t, ['--dry', '--server', game.url], scratch(t));
  const { socket } = await game.next(hello, 10000).catch(error => assert.fail(`${error.message}\n${output()}`));
  send(socket, { type: 'brain-welcome' });
  await until(() => output().includes('Connecté au jeu'), 'the welcome line');
  socket.close(1000, 'Un autre cerveau a pris la place.');
  await until(() => child.exitCode !== null, 'the exit', 10000);
  assert.equal(child.exitCode, 0, output());
  assert.match(output(), /Un autre cerveau a pris la place/);
  assert.match(output(), /Session : 0 requêtes, 0 jetons/);
  assert.equal(game.inbox.length, 0, 'it did not come back');
});

test('without usage in the answer, tokens are estimated so the budgets still close', async t => {
  // The answer shape of the Decisions guide, with no usage field.
  const bare = (value = 'keep') => okJson({ answers: [{ type: 'choice', name: 'action', choice: value,
    probabilities: [{ value, probability: .8 }], confidence: .8 }] });
  const situation = `Wave 6. ${'Zombies at the north door. '.repeat(100)}`;
  const expected = estimateTokens(buildInput({ situation, companion: { name: 'Max' }, current: 'defend:north' }), ACTIONS);
  const reservation = reservationTokens(decisionBody(buildInput({ situation, companion: { name: 'Max' }, current: 'defend:north' }), ACTIONS));
  const limit = costOf(reservation + expected - 1);
  assert.ok(expected > 1000 && expected > situation.length / 4, `${expected} tokens`);
  const dir = scratch(t);
  const api = fakeFetch(() => bare());
  const session = brainFor(t, api.fetch, { dir, sessionBudget: limit });
  const first = await session.decide(decideMessage({ situation }));
  assert.equal(first.action, 'keep'); assert.equal(first.inputTokens, expected);
  assert.equal(session.budget.session.inputTokens, expected);
  assert.equal(usageOf(dir).days[TODAY].inputTokens, expected);
  assert.equal(logLines(dir)[0].estimated, true); assert.equal(logLines(dir)[0].costUsd, costOf(expected));
  assert.deepEqual(await session.decide(decideMessage({ id: 'r2', situation })), { type: 'decision', id: 'r2', error: 'budget' });
  assert.equal(api.calls.length, 1, 'no request once the session budget is spent');

  const daily = brainFor(t, fakeFetch(() => okJson({ answers: [{ type: 'refusal', name: 'action' }], usage: { input_tokens: 0 } })).fetch,
    { dailyBudget: limit });
  assert.equal((await daily.decide(decideMessage({ situation }))).error, 'refusal');
  assert.equal(daily.budget.session.inputTokens, expected, 'a refusal with zero usage counts the estimate');
  assert.equal((await daily.decide(decideMessage({ id: 'r3', situation }))).error, 'budget');
  assert.equal(daily.budget.exhausted(), null, 'remaining money cannot cover the conservative next reservation');

  const countedDir = scratch(t);
  const counted = brainFor(t, fakeFetch(() => chose('keep', { tokens: 850 })).fetch, { dir: countedDir });
  assert.equal((await counted.decide(decideMessage({ situation }))).inputTokens, 850, 'reported usage wins over the estimate');
  assert.equal(logLines(countedDir)[0].estimated, undefined);
});
