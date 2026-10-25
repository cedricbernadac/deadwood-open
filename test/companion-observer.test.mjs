import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
import { RoomSimulation, TICK_RATE } from '../simulation.mjs';
import { COMPANION_SHARE } from '../public/rules.js';
import { startCompanionObserver } from '../validation/companion-observer.mjs';

// A real HTTP/WebSocket observer on port 0, without a brain, API credential,
// production server, file mutation or simulation tick loop.
async function fixture(t) {
  const sim = new RoomSimulation('VIEWQA', { random: () => .5 });
  sim.addPlayer('bot-max', 'Max', undefined, { companion: true });
  sim.addPlayer('bot-lea', 'Léa', undefined, { companion: true });
  let status = { state: 'waiting', message: 'Prêt.' };
  const observer = await startCompanionObserver({ simulation: sim, port: 0, getStatus: () => status });
  t.after(() => observer.close());
  return { sim, observer, setStatus(value) { status = value; } };
}

class Viewer {
  constructor(url) {
    this.socket = new WebSocket(url.replace(/^http/, 'ws') + 'ws');
    this.messages = []; this.waiters = new Set();
    this.socket.on('error', () => {});
    this.socket.on('message', data => {
      const message = JSON.parse(String(data));
      this.messages.push(message);
      for (const waiter of [...this.waiters]) if (waiter.predicate(message)) waiter.finish(message);
    });
  }
  async open() {
    if (this.socket.readyState === WebSocket.OPEN) return this;
    await once(this.socket, 'open');
    return this;
  }
  send(message) { this.socket.send(JSON.stringify(message)); }
  waitFor(predicate, timeout = 1500) {
    const existing = this.messages.findLast(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, finish: message => { clearTimeout(timer); this.waiters.delete(waiter); resolve(message); } };
      const timer = setTimeout(() => { this.waiters.delete(waiter); reject(new Error('Observer message timed out.')); }, timeout);
      this.waiters.add(waiter);
    });
  }
  async join() {
    await this.open(); this.send({ type: 'join', name: 'Observer' });
    const welcome = await this.waitFor(message => message.type === 'welcome');
    const state = await this.waitFor(message => message.type === 'state');
    return { welcome, state };
  }
}

function rawGet(url, path) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ hostname: target.hostname, port: target.port, method: 'GET', path }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', data => { body += data; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    req.on('error', reject); req.end();
  });
}

test('the observer serves the production renderer with camera controls and blocks traversal outside public assets', async t => {
  const { observer } = await fixture(t);
  const original = readFileSync(new URL('../public/client.js', import.meta.url), 'utf8');
  const urls = ['', 'client.js', 'world.json', 'version.json', 'network.json', 'vendor/three.module.js', 'vendor/three.core.js', 'rules.js'];
  const replies = await Promise.all(urls.map(path => fetch(observer.url + path)));
  const [html, client, world, version, network, threeModule, threeCore, rules] = await Promise.all(replies.map(response => response.text()));
  replies.forEach((response, index) => assert.equal(response.status, 200, urls[index] || '/'));
  assert.match(html, /id="observer-panel"/);
  assert.match(html, /id="observer-start"/);
  assert.match(html, /id="observer-sound"/);
  assert.match(html, /id="observer-cameras"/);
  assert.match(client, /if \(snapshot\?\.observerView\) \{\s+observerFrame\(delta\)/);
  assert.match(client, /observerCamera = 'overview'/);
  assert.match(client, /follow\.pitch\|\|0,follow\.yaw\|\|0/);
  assert.match(client, /message\?\.type === 'observe-start'/);
  assert.match(client, /send\(\{type:'observe-start'\}\)/);
  assert.match(client, /observerSoundOn = false/);
  assert.equal(JSON.parse(world).tickRate, TICK_RATE);
  assert.ok(JSON.parse(world).weapons.pistol && JSON.parse(world).ballistics);
  assert.equal(JSON.parse(version).build, 'isolated-companion-observer-v1');
  assert.deepEqual(JSON.parse(network).urls, [observer.url]);
  assert.ok(threeModule.length > 1000 && threeCore.length > 1000 && rules.length > 1000);
  assert.match(replies[1].headers.get('content-type'), /javascript/);
  assert.equal(readFileSync(new URL('../public/client.js', import.meta.url), 'utf8'), original, 'camera adaptation is served from memory');
  assert.equal((await fetch(observer.url + 'client.js', { method: 'HEAD' })).status, 200);
  assert.equal(await (await fetch(observer.url + 'client.js', { method: 'HEAD' })).text(), '');
  assert.equal((await fetch(observer.url, { method: 'POST' })).status, 405);
  assert.equal((await fetch(observer.url + 'missing-observer-asset')).status, 404);
  for (const path of ['/%2e%2e%2fREPRISE.md', '/%2e%2e%5cREPRISE.md', '/%00blocked', '/folder%5cblocked']) {
    assert.equal((await rawGet(observer.url, path)).status, 403, path);
  }
});

test('viewers are waiting proxies only and gameplay packets cannot change either authoritative bot', async t => {
  const { observer, sim } = await fixture(t);
  const first = new Viewer(observer.url), second = new Viewer(observer.url);
  const [{ welcome, state }, other] = await Promise.all([first.join(), second.join()]);
  assert.notEqual(welcome.id, other.welcome.id);
  assert.equal(sim.players.size, 2);
  assert.equal(sim.hostId, null);
  assert.equal(sim.participantCount(), COMPANION_SHARE * 2);
  assert.ok([...sim.players.values()].every(player => player.companion === true));
  assert.ok(!sim.players.has(welcome.id) && !sim.players.has(other.welcome.id));
  assert.equal(state.players.filter(player => player.companion === true).length, 2);
  const proxy = state.players.find(player => player.id === welcome.id);
  assert.equal(proxy.waiting, true); assert.equal(proxy.ready, false);
  assert.equal(proxy.weapon, null); assert.deepEqual(proxy.weapons, []);
  assert.equal(state.observerView.readOnly, true);
  assert.equal(state.observerView.started, false);
  const before = sim.snapshot();
  const packets = [
    { type: 'input', forward: 1, strafe: 1, yaw: 1, pitch: 1, sprint: true, id: 'bot-max' },
    { type: 'shoot', id: 'bot-max', weapon: 'pistol' }, { type: 'buy', id: 'bot-max', weapon: 'shotgun' },
    { type: 'dual-wield', id: 'bot-max', enabled: true, secondaryWeaponId: 'pistol#2' },
    { type: 'shoot', id: 'bot-max', hand: 'secondary' }, { type: 'reload', id: 'bot-max', hand: 'secondary' },
    { type: 'minigun-spin', id: 'bot-max', hand: 'secondary', spinning: true },
    { type: 'interact' }, { type: 'ready', ready: true }, { type: 'pause', paused: true },
    { type: 'restart' }, { type: 'start' }, { type: 'companions', count: 3 },
    { type: 'join', name: 'Intruder' }, { type: 'leave' }, { type: 'weapon', weapon: 'shotgun' },
  ];
  for (const message of packets) first.send(message);
  first.send({ type: 'ping' }); await first.waitFor(message => message.type === 'pong');
  assert.deepEqual(sim.snapshot(), before, 'all ordinary game controls are ignored, even with a forged bot id');
  assert.equal((await (await fetch(observer.url + 'health')).json()).viewers, 2);
  first.send({ type: 'observe-start' });
  assert.equal(await observer.waitForStart(), true);
  const started = await second.waitFor(message => message.type === 'state' && message.observerView.started);
  assert.equal(started.observerView.started, true);
  assert.deepEqual(sim.snapshot(), before, 'the permitted click only releases the harness start gate');
  assert.equal(sim.start(sim.hostId), true, 'only the harness starts the authoritative countdown');
  assert.equal(sim.players.size, 2); assert.equal(sim.phase, 'countdown');
});

test('the completed game remains observable to new viewers and close terminates joined and unjoined sockets', async t => {
  const { observer, sim, setStatus } = await fixture(t);
  const first = new Viewer(observer.url);
  await first.join(); first.send({ type: 'observe-start' });
  assert.equal(await observer.waitForStart(), true);
  sim.start(sim.hostId); sim.endGame();
  setStatus({ state: 'finished', message: 'Défaite observée.' });
  observer.publish({ type: 'event', event: 'gameover', wave: sim.wave }); observer.publishState();
  await first.waitFor(message => message.type === 'event' && message.event === 'gameover');
  const completed = await first.waitFor(message => message.type === 'state' && message.phase === 'gameover');
  assert.equal(completed.observerView.status.state, 'finished');
  const late = new Viewer(observer.url), unjoined = new Viewer(observer.url);
  const [{ state: lateState }] = await Promise.all([late.join(), unjoined.open()]);
  assert.equal(lateState.phase, 'gameover');
  assert.equal(lateState.observerView.started, true);
  assert.equal(lateState.players.filter(player => player.companion === true).length, 2);
  const before = sim.snapshot();
  late.send({ type: 'restart' }); late.send({ type: 'observe-start' }); late.send({ type: 'ping' });
  await late.waitFor(message => message.type === 'pong');
  assert.deepEqual(sim.snapshot(), before);
  const closed = [first, late, unjoined].map(viewer => once(viewer.socket, 'close'));
  await observer.close(); await Promise.all(closed);
  assert.ok([first, late, unjoined].every(viewer => viewer.socket.readyState === WebSocket.CLOSED));
  assert.equal(sim.players.size, 2, 'closing the observer never removes authoritative survivors');
  assert.equal(sim.phase, 'gameover');
  await assert.rejects(fetch(observer.url + 'health'), 'the HTTP listener is closed too');
  await observer.close();
});

test('closing an observer before a start click releases its gate without starting the game', async t => {
  const { observer, sim } = await fixture(t);
  const before = sim.snapshot(), wait = observer.waitForStart();
  await observer.close();
  assert.equal(await wait, false);
  assert.deepEqual(sim.snapshot(), before);
});
