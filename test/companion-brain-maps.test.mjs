import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket, { WebSocketServer } from 'ws';
import { CompanionHub } from '../companions/hub.mjs';
import { GUIDE, TACTICAL_GUIDE, buildInput, guidesFor } from '../companion-brain/guide.mjs';
import { MODEL } from '../companion-brain/openai.mjs';
import { LEVEL_ID } from '../public/level-id.js';
import { BRAIN_CAPABILITIES, MAP_LABELS, connectGame, createBrain, siblingServers } from '../companion-brain/service.mjs';

// One brain for the four maps of the LAN menu: one guide per map, one link
// per map found from the root welcome, request ids scoped per link and one
// shared budget. Fake fetch or --dry only (no OpenAI call), a temporary
// DEADWOOD_COMPANIONS_DIR, servers on ephemeral ports only.
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
// What a CompanionDirector hands its hub (the hub adds type, id and mapId).
const PAYLOAD = { room: 'ABC123', companion: { id: 'c1', name: 'Max' }, situation: SITUATION, actions: ACTIONS, current: 'defend:north' };
const decideMessage = (extra = {}) => ({ type: 'decide', id: 'r1', ...PAYLOAD, ...extra });
// Each map's guides as each server process built them on main 633f091,
// before the per-map refactor (DEADWOOD_LEVEL=cabin, supermarket, hospital),
// and the funfair's as its own process built it on claude/funfair-polish
// d3504fa (DEADWOOD_LEVEL=funfair), then with the weapon and reload lines
// the other three maps use (its draft had shortened them). The open edition
// words the family neutrally, which gives these fingerprints.
const FINGERPRINTS = {
  cabin: { guide: 'f314f3b97d05de43565a4d4999ee316422bcdd70fb4d7fdd2880c0cba529c452',
    tactical: 'b9655f119b4b9dfb83fbdb14112d62f3da497ce0b87a5beaf02366a4cbeadb23' },
  supermarket: { guide: '16a83558327b6af0a2fe911e865f2051efad8ed6efbc7b7bce4d9fdbd0c883da',
    tactical: 'af9c5de55f5e562baf95e4cd3cc1b5b1e1e7d74587034ab87953505322fe27bb' },
  hospital: { guide: '27da7efde67d5792b5bb55fcd35cd1351432397f88b9ad415f3d10951a620827',
    tactical: 'bf82f4e6212d1881eafa5263a84a1ebabaab97b904f0bc802ddac2c384a1a7a2' },
  funfair: { guide: '73715741338453e4b36a5b7a8d69063f1b6a969ce3eb07d8653d595c01583171',
    tactical: 'a535b85969449213e75ab94f563a2084c7b27dd6463fcc6668fba502910dbf3e' },
};
const MAP_IDS = Object.keys(FINGERPRINTS);
const sha = text => createHash('sha256').update(text).digest('hex');

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'deadwood-brain-maps-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const okJson = body => ({ ok: true, status: 200, json: async () => body });
const chose = (value, { tokens = 850 } = {}) => okJson({ model: MODEL,
  answers: [{ type: 'choice', name: 'action', choice: value, probabilities: [{ value, probability: .91 }], confidence: .87 }],
  usage: { input_tokens: tokens } });
function fakeFetch(reply) {
  const calls = [];
  const fetch = async (url, init) => { const call = { url, init, body: JSON.parse(init.body) }; calls.push(call); return reply(call); };
  return { fetch, calls };
}
const mapOfInput = input => MAP_IDS.find(id => input.startsWith(guidesFor(id).guide));
const logLines = dir => readFileSync(join(dir, `decisions-${TODAY}.jsonl`), 'utf8').trim().split('\n').map(line => JSON.parse(line));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, what, timeout = 5000) {
  const end = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > end) assert.fail(`timed out waiting for ${what}`); await delay(5); }
}
const offFamilyPorts = port => assert.ok((port < 3000 || port > 3099) && ![3013, 3104, 3105].includes(port), `ephemeral port ${port} stays off 3000-3099, 3013, 3104 and 3105`);

// The LAN gateway as the brain sees it: one HTTP server on an ephemeral port,
// a real CompanionHub per map under its root, each requiring map-guide-v1.
const ROOTS = [{ id: 'cabin', root: '/' }, { id: 'supermarket', root: '/maps/supermarket/' }, { id: 'hospital', root: '/maps/hospital/' }, { id: 'funfair', root: '/maps/funfair/' }];
async function lanGame(t, { timeout = 3000 } = {}) {
  const server = createServer((request, response) => { response.writeHead(404); response.end(); });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const hubs = {}, paths = new Map(), upgrades = [];
  for (const { id, root: mapRoot } of ROOTS) {
    hubs[id] = new CompanionHub({ timeout, mapId: id, maps: ROOTS.map(map => ({ ...map, port: 1 })), requireCapability: 'map-guide-v1' });
    paths.set(`${mapRoot}companions`, hubs[id]);
  }
  server.on('upgrade', (request, socket, head) => {
    upgrades.push(request.url);
    const hub = paths.get(request.url);
    if (!hub) { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, ws => hub.attach(ws));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  offFamilyPorts(port);
  t.after(async () => {
    for (const hub of Object.values(hubs)) hub.close();
    for (const client of wss.clients) client.terminate();
    await new Promise(resolve => server.close(resolve));
  });
  const origin = `ws://127.0.0.1:${port}`;
  return { port, hubs, upgrades, origin, url: `${origin}/companions`,
    urls: { cabin: `${origin}/companions`, supermarket: `${origin}/maps/supermarket/companions`, hospital: `${origin}/maps/hospital/companions`,
      funfair: `${origin}/maps/funfair/companions` } };
}
const allSeated = game => () => MAP_IDS.every(id => game.hubs[id].connected);

// Another up-to-date brain taking one map's seat.
async function otherBrain(t, url) {
  const socket = new WebSocket(url);
  t.after(() => socket.terminate());
  await once(socket, 'open');
  socket.send(JSON.stringify({ type: 'brain-hello', name: 'other-brain', version: 2, capabilities: ['team-plan-v1', 'map-guide-v1'] }));
  const [raw] = await once(socket, 'message');
  assert.equal(JSON.parse(String(raw)).type, 'brain-welcome');
  return socket;
}

// A test brain always names its game (--server) and never inherits PORT or
// DEADWOOD_LEVEL: on its own it would look for the real game on 3002 and 3000.
function runBrain(t, args, dir) {
  assert.ok(args.includes('--server'), 'a test brain names its game');
  const env = { ...process.env, OPENAI_API_KEY: '', DEADWOOD_COMPANIONS_DIR: dir };
  delete env.PORT; delete env.DEADWOOD_LEVEL;
  const child = spawn(process.execPath, ['companion-brain/brain.mjs', ...args], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
  return { child, output: () => output };
}
const count = (text, pattern) => (text.match(pattern) ?? []).length;

test('each map keeps the exact guides its own server process had before one brain served them all', () => {
  for (const [id, expected] of Object.entries(FINGERPRINTS)) {
    const guides = guidesFor(id);
    assert.equal(sha(guides.guide), expected.guide, `${id} guide`);
    assert.equal(sha(guides.tactical), expected.tactical, `${id} tactical guide`);
    assert.equal(guidesFor(id), guides, `${id} guides are built once`);
  }
  assert.equal(GUIDE, guidesFor(LEVEL_ID).guide); assert.equal(TACTICAL_GUIDE, guidesFor(LEVEL_ID).tactical);
  for (const unknown of [undefined, null, '', 'mars', 'Hospital', '__proto__']) assert.equal(guidesFor(unknown), guidesFor(LEVEL_ID), String(unknown));
  // GUIDE and TACTICAL_GUIDE are still each server process's own map.
  const script = "import { createHash } from 'node:crypto'; import { GUIDE, TACTICAL_GUIDE } from './companion-brain/guide.mjs';"
    + " const h = text => createHash('sha256').update(text).digest('hex'); console.log(JSON.stringify({ guide: h(GUIDE), tactical: h(TACTICAL_GUIDE) }));";
  for (const level of MAP_IDS) {
    const line = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, encoding: 'utf8', windowsHide: true,
      env: { ...process.env, DEADWOOD_LEVEL: level } });
    assert.deepEqual(JSON.parse(line), FINGERPRINTS[level], level);
  }
});

test('the input starts with the guide of the map the request names, else with this process’s guide', () => {
  const companion = { name: 'Max' };
  const hospital = buildInput({ situation: SITUATION, companion, current: 'defend:north', mapId: 'hospital' });
  assert.ok(hospital.startsWith(guidesFor('hospital').guide) && hospital.endsWith(SITUATION));
  assert.ok(!hospital.startsWith(guidesFor('cabin').guide), 'not the cabin guide');
  assert.match(hospital, /L'Hôpital des Pins/); assert.doesNotMatch(hospital, /wooden cabin/);
  const funfair = buildInput({ situation: SITUATION, companion, current: 'defend:north', mapId: 'funfair' });
  assert.ok(funfair.startsWith(guidesFor('funfair').guide) && funfair.endsWith(SITUATION));
  assert.match(funfair, /La Fête Foraine: Grand Palais des Jeux/); assert.doesNotMatch(funfair, /L'Hôpital des Pins|wooden cabin/);
  assert.ok(buildInput({ situation: SITUATION, companion, mode: 'tactical', teamIntent: 'Hold the cellar stair.', mapId: 'funfair' }).startsWith(guidesFor('funfair').tactical));
  const tactical = buildInput({ situation: SITUATION, companion, mode: 'tactical', teamIntent: 'Hold the cellar stair.', mapId: 'supermarket' });
  assert.ok(tactical.startsWith(guidesFor('supermarket').tactical) && tactical.includes('YOUR TEAM ASSIGNMENT'));
  const own = buildInput({ situation: SITUATION, companion });
  assert.ok(own.startsWith(GUIDE));
  for (const mapId of ['mars', null, undefined, 42]) assert.equal(buildInput({ situation: SITUATION, companion, mapId }), own, String(mapId));
});

test('the brain asks with the guide of the request’s map and logs which map it played', async t => {
  const dir = scratch(t), reports = [];
  const api = fakeFetch(call => chose(call.body.input.startsWith(guidesFor('hospital').guide) ? 'revive:jules' : 'keep'));
  const brain = createBrain({ key: KEY, fetch: api.fetch, dir, clock, report: entry => reports.push(entry) });
  assert.equal((await brain.decide(decideMessage({ mapId: 'hospital' }))).action, 'revive:jules');
  assert.equal(mapOfInput(api.calls[0].body.input), 'hospital');
  assert.equal(reports[0].map, 'hospital'); assert.equal(logLines(dir)[0].map, 'hospital');
  await brain.decide(decideMessage({ id: 'r2', mapId: 'mars' }));
  await brain.decide(decideMessage({ id: 'r3' }));
  for (const index of [1, 2]) { assert.ok(api.calls[index].body.input.startsWith(GUIDE)); assert.equal(reports[index].map, LEVEL_ID); }
  await brain.decide(decideMessage({ id: 'r4', mapId: 'supermarket', mode: 'tactical', teamIntent: 'Hold the cellar stair.' }));
  assert.ok(api.calls[3].body.input.startsWith(guidesFor('supermarket').tactical));
  assert.equal(reports[3].map, 'supermarket');
  const dry = createBrain({ dir: scratch(t), dry: true, clock, report: entry => reports.push(entry) });
  const plan = await dry.plan({ type: 'plan', id: 'p1', room: 'H1A2B', wave: 3, mapId: 'hospital',
    questions: [{ name: 'bot1_role', instructions: 'Role for Max', choices: [{ value: 'medic' }, { value: 'support' }] }] });
  assert.deepEqual(plan.choices, { bot1_role: 'medic' });
  assert.equal(reports.at(-1).kind, 'plan'); assert.equal(reports.at(-1).map, 'hospital');
  await dry.plan({ type: 'plan', id: 'p2', mapId: { toString: () => 'hospital' }, questions: [{ name: 'q', instructions: '', choices: [{ value: 'a' }] }] });
  assert.equal(reports.at(-1).map, LEVEL_ID, 'only a known map name is logged');
  const lines = logLines(dir);
  assert.deepEqual(lines.map(line => line.map), ['hospital', LEVEL_ID, LEVEL_ID, 'supermarket']);
  assert.ok(lines.every(line => !JSON.stringify(line).includes('Hôpital') && !JSON.stringify(line).includes('NEVER')), 'no guide or key text in the log');
});

test('one brain opens a link per map from the root welcome and answers the same request id on all four', async t => {
  const game = await lanGame(t);
  const calls = [];
  let release;
  const together = new Promise(resolve => { release = resolve; });
  const ANSWERS = { cabin: 'keep', supermarket: 'repair:west', hospital: 'revive:jules', funfair: 'repair:west' };
  // Every answer waits until all four questions are in flight at once.
  const fetch = async (url, init) => {
    const map = mapOfInput(JSON.parse(init.body).input);
    calls.push(map);
    if (calls.length === MAP_IDS.length) release();
    await together;
    return chose(ANSWERS[map]);
  };
  const reports = [], states = [];
  const brain = createBrain({ key: KEY, fetch, dir: scratch(t), clock, report: entry => reports.push(entry) });
  const link = connectGame({ urls: [game.url], brain, reconnectMs: 50, onStatus: (state, detail, info) => states.push({ state, detail, ...info }) });
  t.after(() => link.close());
  await until(allSeated(game), 'a link per map');
  await until(() => states.filter(entry => entry.state === 'welcome').length === MAP_IDS.length, 'four welcomes');
  const welcomes = states.filter(entry => entry.state === 'welcome');
  assert.deepEqual(welcomes[0].detail, game.url, 'the root first');
  assert.deepEqual(welcomes.map(entry => [entry.mapId, entry.detail]).sort(), MAP_IDS.map(id => [id, game.urls[id]]).sort(), 'each welcomed with its mapId');
  assert.deepEqual([...game.upgrades].sort(), ['/companions', '/maps/funfair/companions', '/maps/hospital/companions', '/maps/supermarket/companions'], 'exactly one link per map');
  assert.equal(link.connected, true); assert.equal(link.size, 4);
  const answers = await Promise.all(MAP_IDS.map(id => game.hubs[id].request(PAYLOAD)));
  assert.deepEqual(answers.map(answer => [answer.id, answer.error ?? null, answer.action]),
    [['d1', null, 'keep'], ['d1', null, 'repair:west'], ['d1', null, 'revive:jules'], ['d1', null, 'repair:west']], 'each map got its own answer to its own d1');
  assert.deepEqual([...calls].sort(), [...MAP_IDS].sort());
  assert.deepEqual(reports.map(entry => entry.map).sort(), [...MAP_IDS].sort());
  assert.ok(reports.every(entry => entry.error === null), JSON.stringify(reports.map(entry => entry.detail)));
  assert.equal(brain.pendingRequests, 0); assert.equal(brain.reservedTokens, 0);
  await delay(100);
  assert.equal(game.upgrades.length, 4, 'the siblings’ own welcomes open no further link');
});

test('a cancel on one map stops only that map’s request', async t => {
  const game = await lanGame(t);
  const calls = [];
  const fetch = (url, init) => new Promise((resolve, reject) => {
    calls.push({ map: mapOfInput(JSON.parse(init.body).input), signal: init.signal, resolve });
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  });
  const reports = [];
  const brain = createBrain({ key: KEY, fetch, dir: scratch(t), clock, report: entry => reports.push(entry) });
  const link = connectGame({ urls: [game.url], brain, reconnectMs: 50 });
  t.after(() => link.close());
  await until(allSeated(game), 'a link per map');
  const supermarket = game.hubs.supermarket.request(PAYLOAD), hospital = game.hubs.hospital.request(PAYLOAD);
  await until(() => calls.length === 2 && brain.pendingRequests === 2, 'both questions in flight');
  const call = map => calls.find(entry => entry.map === map);
  hospital.cancel();
  assert.equal((await hospital).error, 'cancelled');
  await until(() => call('hospital').signal.aborted && brain.pendingRequests === 1, 'the hospital request aborted');
  assert.equal(call('supermarket').signal.aborted, false, 'the supermarket’s d1 is untouched');
  call('supermarket').resolve(chose('repair:west'));
  const answer = await supermarket;
  assert.equal(answer.id, 'd1'); assert.equal(answer.action, 'repair:west'); assert.equal(answer.error, undefined);
  await until(() => brain.pendingRequests === 0, 'nothing left in flight');
  assert.deepEqual(reports.map(entry => [entry.map, entry.error]).sort(), [['hospital', 'cancelled'], ['supermarket', null]]);
});

test('the links share one session budget', async t => {
  const game = await lanGame(t);
  const api = fakeFetch(() => chose('keep', { tokens: 1_000_000 }));
  const brain = createBrain({ key: KEY, fetch: api.fetch, dir: scratch(t), clock, sessionBudget: .01 });
  const link = connectGame({ urls: [game.url], brain, reconnectMs: 50 });
  t.after(() => link.close());
  await until(allSeated(game), 'a link per map');
  assert.equal((await game.hubs.cabin.request(PAYLOAD)).action, 'keep', 'the first, paid decision');
  assert.deepEqual(await game.hubs.hospital.request(PAYLOAD), { type: 'decision', id: 'd1', error: 'budget' });
  assert.deepEqual(await game.hubs.supermarket.request(PAYLOAD), { type: 'decision', id: 'd1', error: 'budget' });
  assert.equal(api.calls.length, 1, 'no other map spends past the session budget');
  assert.equal(brain.budget.exhausted(), 'session');
});

test('a brain replaced on one map keeps answering the others', async t => {
  const game = await lanGame(t);
  const states = [];
  const brain = createBrain({ dir: scratch(t), dry: true, clock });
  const link = connectGame({ urls: [game.url], brain, reconnectMs: 30, onStatus: (state, detail, info) => states.push({ state, detail, ...info }) });
  t.after(() => link.close());
  await until(allSeated(game), 'a link per map');
  await otherBrain(t, game.urls.hospital);
  await until(() => states.some(entry => entry.state === 'replaced'), 'the hospital link replaced');
  const replaced = states.filter(entry => entry.state === 'replaced');
  assert.deepEqual(replaced.map(entry => [entry.address, entry.mapId]), [[game.urls.hospital, 'hospital']]);
  await delay(150);
  assert.equal(game.upgrades.length, 5, 'the replaced link does not take the seat back');
  assert.ok(!states.some(entry => entry.state === 'stopped'), 'the brain itself goes on');
  for (const id of ['cabin', 'supermarket', 'funfair']) assert.equal((await game.hubs[id].request(PAYLOAD)).action, 'keep', id);
  assert.equal(link.connected, true);
});

test('the --dry command line serves all four maps from the root and exits once every link is replaced', async t => {
  const game = await lanGame(t);
  const { child, output } = runBrain(t, ['--dry', '--server', game.url], scratch(t));
  await until(allSeated(game), 'a link per map', 10000).catch(error => assert.fail(`${error.message}\n${output()}`));
  await until(() => count(output(), /Connecté au jeu \(/g) === 4, 'four welcome lines');
  for (const id of MAP_IDS)
    assert.ok(output().includes(`  Connecté au jeu (${game.urls[id]}) : décor ${MAP_LABELS[id]}, les compagnons peuvent rejoindre la partie.`), `${id}\n${output()}`);
  assert.deepEqual(MAP_LABELS, { cabin: 'La cabane', supermarket: 'Le Dernier Panier', hospital: "L'Hôpital des Pins", funfair: 'La Fête Foraine' });
  for (const id of MAP_IDS) assert.equal((await game.hubs[id].request(PAYLOAD)).action, 'keep', id);
  assert.equal(count(output(), /Jeu introuvable/g), 0, output());
  assert.ok(output().includes(`  Jeu : ${game.url}`), output());
  await otherBrain(t, game.urls.supermarket);
  await otherBrain(t, game.urls.cabin);
  await otherBrain(t, game.urls.funfair);
  await delay(100);
  assert.equal(child.exitCode, null, 'one map left: the brain goes on');
  assert.equal(count(output(), /Un autre cerveau a pris la place/g), 0, output());
  await otherBrain(t, game.urls.hospital);
  await until(() => child.exitCode !== null, 'the exit', 10000).catch(error => assert.fail(`${error.message}\n${output()}`));
  assert.equal(child.exitCode, 0, output());
  assert.equal(count(output(), /Un autre cerveau a pris la place : celui-ci s’arrête\./g), 1, output());
  assert.equal(count(output(), /Session : /g), 1, output());
  assert.match(output(), /Session : 0 requêtes, 0 jetons/);
  assert.equal(game.upgrades.length, 8, 'it did not come back on any map');
});

test('a welcome whose maps leave the game’s own roots opens no other link', async t => {
  const BAD = [{ id: 'hospital', root: '//evil.example/' }, { id: 'supermarket', root: '/../' }, { id: 'cabin', root: 'maps' },
    { id: 'hospital', root: '/maps/hospital' }, { id: 'hospital', root: 'ws://evil.example/' }, { id: 'hospital', root: '/maps/../' },
    { id: 'hospital', root: '/maps/Hospital/' }, { id: 'mars', root: '/maps/mars/' }, { id: 'hospital' }, { root: '/maps/hospital/' }, null, 'x',
    { id: 'funfair', root: '/maps/Funfair/' }, { id: 'funfair', root: '//evil.example/maps/funfair/' }, { id: 'Funfair', root: '/maps/funfair/' }];
  const home = 'ws://127.0.0.1:3002/companions';
  assert.deepEqual(siblingServers(home, BAD), []);
  for (const maps of [undefined, null, 'maps', { 0: ROOTS[1] }]) assert.deepEqual(siblingServers(home, maps), [], String(maps));
  assert.deepEqual(siblingServers(home, ROOTS), [{ id: 'cabin', url: home }, { id: 'supermarket', url: 'ws://127.0.0.1:3002/maps/supermarket/companions' },
    { id: 'hospital', url: 'ws://127.0.0.1:3002/maps/hospital/companions' }, { id: 'funfair', url: 'ws://127.0.0.1:3002/maps/funfair/companions' }]);
  assert.deepEqual(siblingServers('ws://[::1]:3002/maps/hospital/companions', ROOTS.slice(1, 2)), [{ id: 'supermarket', url: 'ws://[::1]:3002/maps/supermarket/companions' }],
    'always the welcomed address’s own origin');

  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(wss, 'listening');
  offFamilyPorts(wss.address().port);
  t.after(() => new Promise(resolve => { for (const client of wss.clients) client.terminate(); wss.close(resolve); }));
  const paths = [];
  wss.on('connection', (socket, request) => {
    paths.push(request.url);
    socket.on('message', raw => {
      if (JSON.parse(String(raw)).type === 'brain-hello') socket.send(JSON.stringify({ type: 'brain-welcome', mapId: 'cabin', maps: BAD }));
    });
  });
  const link = connectGame({ urls: [`ws://127.0.0.1:${wss.address().port}/companions`], brain: createBrain({ dir: scratch(t), dry: true, clock }), reconnectMs: 30 });
  t.after(() => link.close());
  await until(() => link.connected, 'the welcome');
  await delay(200);
  assert.deepEqual(paths, ['/companions']); assert.equal(link.size, 1);
});

test('the brain says it knows one guide per map', () => {
  assert.deepEqual(BRAIN_CAPABILITIES, ['team-plan-v1', 'map-guide-v1']);
});
