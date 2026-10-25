import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createLanGateway, lanRoute, brainAllowed, LAN_MAPS } from '../lan-gateway.mjs';
import { localNetworkUrls } from '../network-urls.mjs';

// The home Wi-Fi gateway: one public port, one always-on map worker per decor
// (cabin at '/', the others under /maps/<id>/). Everything listens on port 0.
process.env.OPENAI_API_KEY = '';
const assertSafePort = port => {
  assert.ok(Number.isInteger(port) && port > 0, `port ${port}`);
  assert.ok((port < 3000 || port > 3099) && ![3013, 3104, 3105].includes(port), `port ${port} belongs to a live or shared server`);
};
const ROOTS = { cabin: '/', supermarket: '/maps/supermarket/', hospital: '/maps/hospital/', funfair: '/maps/funfair/' };
// A funfair code: F and five base-36 characters, never hex digits only (a cabin's).
const FUNFAIR_CODE = /^F(?![0-9A-F]{5}$)[0-9A-Z]{5}$/;

class Peer {
  constructor(url, options = {}) {
    this.socket = new WebSocket(url, options); this.messages = []; this.waiters = new Set();
    this.socket.on('error', () => {});
    this.socket.on('message', raw => {
      const message = JSON.parse(raw.toString()); this.messages.push(message);
      for (const waiter of [...this.waiters]) if (waiter.predicate(message)) waiter.finish(message);
    });
    this.closed = new Promise(resolve => this.socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() })));
  }
  async open() { await once(this.socket, 'open'); return this; }
  send(message) { const mark = this.messages.length; this.socket.send(JSON.stringify(message)); return mark; }
  wait(predicate, mark = 0, timeout = 6000) {
    const found = this.messages.slice(mark).find(predicate);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiters.delete(waiter); reject(Error('LAN gateway response timed out; last ' + JSON.stringify(this.messages.at(-1))?.slice(0, 200))); }, timeout);
      const waiter = { predicate, finish: message => { clearTimeout(timer); this.waiters.delete(waiter); resolve(message); } };
      this.waiters.add(waiter);
    });
  }
  async join(build, extra = {}) {
    const mark = this.send({ type: 'join', protocol: 1, build, name: 'Jules', ...extra });
    return this.wait(message => ['welcome', 'error', 'outdated'].includes(message.type), mark);
  }
  state(predicate = () => true, mark = 0) { return this.wait(message => message.type === 'state' && predicate(message), mark); }
  close() { if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve(); this.socket.terminate(); return this.closed; }
}

async function fixture(t, options = {}) {
  const logs = [];
  const gateway = await createLanGateway({ port: 0, host: '127.0.0.1', log: line => logs.push(line), ...options });
  const address = await gateway.listen(); assertSafePort(address.port);
  for (const entry of gateway.workers.values()) assertSafePort(entry.port);
  const url = `http://127.0.0.1:${address.port}`, peers = [];
  t.after(async () => { await Promise.all(peers.map(peer => peer.close())); await gateway.close(); });
  const peer = async (map = 'cabin', options = {}) => {
    const created = await new Peer(url.replace('http:', 'ws:') + ROOTS[map] + 'ws', options).open(); peers.push(created); return created;
  };
  const brain = async (map = 'cabin', capabilities = ['team-plan-v1', 'map-guide-v1']) => {
    const created = await new Peer(url.replace('http:', 'ws:') + ROOTS[map] + 'companions').open(); peers.push(created);
    const mark = created.send({ type: 'brain-hello', name: 'test-brain', version: 1, capabilities });
    return { brain: created, welcome: await created.wait(message => message.type === 'brain-welcome', mark) };
  };
  const build = map => gateway.workers.get(map).build;
  return { gateway, url, port: address.port, peer, brain, build, logs };
}
async function until(read, predicate) {
  let last;
  for (let index = 0; index < 100; index++) { last = await read(); if (predicate(last)) return last; await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.fail('LAN gateway state did not settle: ' + JSON.stringify(last));
}
const health = async url => { const response = await fetch(url + '/health'); return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() }; };
const refusal = async (url, options = {}) => {
  const socket = new WebSocket(url, options); socket.on('error', () => {});
  const [, response] = await once(socket, 'unexpected-response'); response.resume(); socket.terminate(); return response.statusCode;
};

test('routes: cabin at the root, other maps under their prefix, everything else refused', () => {
  assert.deepEqual(LAN_MAPS.map(map => map.id), ['cabin', 'supermarket', 'hospital', 'funfair']);
  assert.deepEqual(LAN_MAPS.map(map => map.root), ['/', '/maps/supermarket/', '/maps/hospital/', '/maps/funfair/']);
  assert.ok(Object.isFrozen(LAN_MAPS) && LAN_MAPS.every(Object.isFrozen));
  assert.deepEqual(lanRoute('/'), { id: 'cabin', path: '/', pathname: '/' });
  assert.deepEqual(lanRoute('/?room=AB12CD'), { id: 'cabin', path: '/?room=AB12CD', pathname: '/' });
  assert.deepEqual(lanRoute('/levels/hospital.glb'), { id: 'cabin', path: '/levels/hospital.glb', pathname: '/levels/hospital.glb' });
  assert.deepEqual(lanRoute('/maps/hospital/'), { id: 'hospital', path: '/', pathname: '/' });
  assert.deepEqual(lanRoute('/maps/hospital/ws?x=1'), { id: 'hospital', path: '/ws?x=1', pathname: '/ws' });
  assert.deepEqual(lanRoute('/maps/supermarket/client.js'), { id: 'supermarket', path: '/client.js', pathname: '/client.js' });
  assert.deepEqual(lanRoute('/maps/hospital?room=X'), { redirect: '/maps/hospital/?room=X' });
  assert.deepEqual(lanRoute('/maps/supermarket'), { redirect: '/maps/supermarket/' });
  assert.deepEqual(lanRoute('/maps/funfair/'), { id: 'funfair', path: '/', pathname: '/' });
  assert.deepEqual(lanRoute('/maps/funfair/ws'), { id: 'funfair', path: '/ws', pathname: '/ws' });
  assert.deepEqual(lanRoute('/maps/funfair?room=F1G2H3'), { redirect: '/maps/funfair/?room=F1G2H3' });
  assert.deepEqual(lanRoute('/levels/funfair.glb'), { id: 'cabin', path: '/levels/funfair.glb', pathname: '/levels/funfair.glb' });
  for (const raw of ['/maps/nope/', '/maps/', '/maps/hospitalx/', '/maps/funfairx/', '/..%5cserver.mjs', '/a%5Cb', '/maps/hospital/%00', '/%00', '/maps%2Fhospital/', '/%E0%A4%A']) {
    assert.equal(lanRoute(raw), null, raw);
  }
  assert.equal(lanRoute('http://[bad'), null);
});

test('only this computer without a browser Origin may connect a companion brain', () => {
  const request = (remoteAddress, origin) => ({ socket: { remoteAddress }, headers: origin === undefined ? {} : { origin } });
  assert.equal(brainAllowed(request('192.168.1.5')), false);
  assert.equal(brainAllowed(request('192.168.1.20')), false);
  assert.equal(brainAllowed(request('127.0.0.1', 'http://localhost:3002')), false);
  assert.equal(brainAllowed(request('127.0.0.1', '')), false);
  for (const local of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(brainAllowed(request(local)), true, local);
});

test('the gateway starts all or nothing: a worker that reports another map stops the whole gateway', async () => {
  await assert.rejects(createLanGateway({ port: 0, host: '127.0.0.1', log: () => {}, maps: [{ id: 'cabin', root: '/' }, { id: 'attic', root: '/maps/attic/' }] }),
    /Map worker .*: attic$/);
});

let shared;
before(async () => {
  const holder = { cleanups: [] };
  shared = await fixture({ after: cleanup => holder.cleanups.push(cleanup) });
  shared.cleanups = holder.cleanups;
});
after(async () => { for (const cleanup of shared?.cleanups ?? []) await cleanup(); });

test('health sums every map; each map has its own build', async () => {
  const { url, peer, build, gateway } = shared;
  const idle = await health(url);
  assert.equal(idle.status, 200); assert.equal(idle.cache, 'no-store');
  assert.equal(idle.body.ok, true); assert.equal(idle.body.mode, 'lan'); assert.equal(idle.body.multiMap, true); assert.equal(idle.body.defaultMap, 'cabin');
  assert.deepEqual(idle.body.maps.map(map => [map.id, map.root, map.ready]), [['cabin', '/', true], ['supermarket', '/maps/supermarket/', true], ['hospital', '/maps/hospital/', true], ['funfair', '/maps/funfair/', true]]);
  const builds = idle.body.maps.map(map => map.build);
  assert.equal(new Set(builds).size, 4, 'builds differ pairwise');
  for (const map of idle.body.maps) { assert.equal(map.build, gateway.workers.get(map.id).build); assert.match(map.build, /^[0-9a-f]{12}$/); }
  const cabin = await peer('cabin'), hospital = await peer('hospital');
  assert.equal((await cabin.join(build('cabin'))).type, 'welcome');
  assert.equal((await hospital.join(build('hospital'))).type, 'welcome');
  const busy = await until(() => health(url), state => state.body.rooms >= 2);
  const byId = Object.fromEntries(busy.body.maps.map(map => [map.id, map]));
  assert.ok(byId.cabin.rooms >= 1 && byId.hospital.rooms >= 1 && byId.cabin.players >= 1 && byId.hospital.players >= 1);
  assert.equal(busy.body.rooms, busy.body.maps.reduce((sum, map) => sum + map.rooms, 0));
  assert.equal(busy.body.players, busy.body.maps.reduce((sum, map) => sum + map.players, 0));
  await cabin.close(); await hospital.close();
});

test('every map root serves its tagged page, its level id and its version', async () => {
  const { url, gateway } = shared;
  for (const [id, path] of [['cabin', '/'], ['supermarket', '/maps/supermarket/'], ['hospital', '/maps/hospital/'], ['hospital', '/maps/hospital/?room=H12345'],
    ['funfair', '/maps/funfair/'], ['funfair', '/maps/funfair/?room=F1G2H3']]) {
    const root = ROOTS[id], response = await fetch(url + path), html = await response.text();
    assert.equal(response.status, 200, path);
    assert.ok(html.includes('<meta name="deadwood-multi-map" content="true">'), path);
    assert.ok(html.includes('<meta name="deadwood-maps" content="cabin,supermarket,hospital,funfair">'), path);
    assert.ok(html.includes(`from '${root}i18n.js'`) && html.includes(`import('${root}client.js')`), path);
    assert.equal(await (await fetch(url + root + 'level-id.js')).text(), `export const LEVEL_ID = ${JSON.stringify(id)};\n`);
    assert.deepEqual(await (await fetch(url + root + 'version.json')).json(), { build: gateway.workers.get(id).build, mapId: id });
    assert.equal((await (await fetch(url + root + 'world.json')).json()).mapId, id);
  }
});

test('redirects, unknown maps, forbidden paths and methods', async () => {
  const { url, port } = shared;
  const redirect = await fetch(url + '/maps/hospital?room=X', { redirect: 'manual' });
  assert.equal(redirect.status, 308); assert.equal(redirect.headers.get('location'), '/maps/hospital/?room=X');
  assert.equal((await fetch(url + '/maps/nope/')).status, 404);
  assert.equal((await fetch(url + '/..%5cserver.mjs')).status, 404);
  assert.equal((await fetch(url + '/maps/hospital/..%5c..%5cserver.mjs')).status, 404);
  assert.equal((await fetch(url + '/%00')).status, 404);
  assert.equal((await fetch(url + '/', { method: 'POST', body: 'x' })).status, 405);
  assert.equal((await fetch(url + '/maps/hospital/', { method: 'PUT', body: 'x' })).status, 405);
  // A raw request line with a backslash never reaches a worker.
  const raw = await new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: '/..\\server.mjs' }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end();
  });
  assert.ok([400, 403, 404].includes(raw), String(raw));
});

test('shared media come from the cabin worker, whole', async () => {
  const { url } = shared;
  for (const level of ['hospital', 'supermarket', 'funfair']) {
    const head = await fetch(url + `/levels/${level}.glb`, { method: 'HEAD' });
    assert.equal(head.status, 200, level); assert.equal(head.headers.get('content-type'), 'model/gltf-binary');
  }
  const size = statSync(new URL('../public/levels/supermarket.glb', import.meta.url)).size;
  const bytes = (await (await fetch(url + '/levels/supermarket.glb')).arrayBuffer()).byteLength;
  assert.equal(bytes, size, 'the whole 27 MB level arrives');
});

test('the invitation addresses always name the gateway port, whatever the map', async () => {
  const { url, port } = shared;
  for (const path of ['/network.json', '/maps/hospital/network.json', '/maps/supermarket/network.json', '/maps/funfair/network.json']) {
    const response = await fetch(url + path), body = await response.json();
    assert.equal(response.status, 200, path); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(body, { urls: localNetworkUrls(port) }, path);
    for (const address of body.urls) assert.ok(address.endsWith(':' + port), address);
  }
});

test('room codes name their map, and each map only knows its own rooms and build', async () => {
  const { peer, build } = shared;
  const cabin = await peer('cabin'), market = await peer('supermarket'), hospital = await peer('hospital'), funfair = await peer('funfair');
  const cabinRoom = await cabin.join(build('cabin')), marketRoom = await market.join(build('supermarket')), hospitalRoom = await hospital.join(build('hospital'));
  const funfairRoom = await funfair.join(build('funfair'));
  assert.match(cabinRoom.room, /^[0-9A-F]{6}$/); assert.match(marketRoom.room, /^S[0-9A-Z]{5}$/); assert.match(hospitalRoom.room, /^H[0-9A-Z]{5}$/);
  assert.match(funfairRoom.room, FUNFAIR_CODE);
  const wrong = await peer('cabin'), wrongJoin = await wrong.join(build('cabin'), { room: hospitalRoom.room });
  assert.equal(wrongJoin.type, 'error'); assert.match(wrongJoin.message, /Salle introuvable/);
  const astray = await peer('cabin'), astrayJoin = await astray.join(build('cabin'), { room: funfairRoom.room });
  assert.equal(astrayJoin.type, 'error'); assert.match(astrayJoin.message, /Salle introuvable/);
  const guest = await peer('hospital'), guestJoin = await guest.join(build('hospital'), { room: hospitalRoom.room });
  assert.equal(guestJoin.type, 'welcome'); assert.equal(guestJoin.room, hospitalRoom.room);
  const rider = await peer('funfair'), riderJoin = await rider.join(build('funfair'), { room: funfairRoom.room.toLowerCase() });
  assert.equal(riderJoin.type, 'welcome'); assert.equal(riderJoin.room, funfairRoom.room);
  const stale = await peer('hospital');
  assert.equal((await stale.join(build('cabin'))).type, 'outdated');
  for (const socket of [cabin, market, hospital, funfair, wrong, astray, guest, rider, stale]) await socket.close();
});

test('a hospital save is refused by the cabin, and a hospital pause leaves a cabin night alone', async () => {
  const { peer, build } = shared;
  const host = await peer('hospital'); assert.equal((await host.join(build('hospital'))).type, 'welcome');
  const cabin = await peer('cabin'); assert.equal((await cabin.join(build('cabin'))).type, 'welcome');
  let mark = cabin.send({ type: 'start' });
  await cabin.state(state => state.phase === 'countdown', mark);
  mark = host.send({ type: 'start' });
  await host.state(state => state.phase === 'countdown', mark);
  mark = host.send({ type: 'pause', paused: true });
  await host.state(state => state.paused === true, mark);
  const cabinMark = cabin.messages.length;
  mark = host.send({ type: 'save-game' });
  const save = (await host.wait(message => message.type === 'save-game', mark)).save;
  assert.equal(save.mapId, 'hospital');
  const later = await cabin.state(() => true, cabinMark);
  assert.equal(later.paused, false, 'the cabin night keeps running'); assert.notEqual(later.phase, 'lobby');
  const loader = await peer('cabin'); assert.equal((await loader.join(build('cabin'))).type, 'welcome');
  const text = JSON.stringify(save);
  const { splitSaveText } = await import('../public/save-game.js');
  const chunks = splitSaveText(text);
  mark = loader.send({ type: 'load-begin', chunks: chunks.length, size: text.length });
  for (const [index, data] of chunks.entries()) loader.send({ type: 'load-chunk', index, data });
  assert.deepEqual(await loader.wait(message => message.type === 'load-result', mark), { type: 'load-result', ok: false, reason: 'map' });
  for (const socket of [host, cabin, loader]) await socket.close();
});

test('a brain reaches a map only from this computer, and only that map gets companions', async () => {
  const { url, peer, brain, build } = shared;
  for (const root of ['/', '/maps/hospital/']) assert.equal(await refusal(url.replace('http:', 'ws:') + root + 'companions', { origin: url }), 403, root);
  assert.equal(await refusal(url.replace('http:', 'ws:') + '/maps/hospital/elsewhere'), 404);
  const cabin = await peer('cabin'); assert.equal((await cabin.join(build('cabin'))).type, 'welcome');
  const { welcome } = await brain('hospital');
  assert.equal(welcome.type, 'brain-welcome');
  // Lots 1 and 4 together: the hospital worker's hub names its map and every
  // map of the menu, so one brain opens its other links from this welcome.
  assert.equal(welcome.mapId, 'hospital');
  assert.deepEqual(welcome.maps, [{ id: 'cabin', root: '/' }, { id: 'supermarket', root: '/maps/supermarket/' }, { id: 'hospital', root: '/maps/hospital/' },
    { id: 'funfair', root: '/maps/funfair/' }]);
  const hospital = await peer('hospital'); assert.equal((await hospital.join(build('hospital'))).type, 'welcome');
  assert.equal((await hospital.state()).companionsAvailable, true);
  const cabinState = await cabin.state(() => true, cabin.messages.length);
  assert.equal(cabinState.companionsAvailable, false);
  const state = await until(() => health(url), current => current.body.maps.find(map => map.id === 'hospital').companions === true);
  assert.deepEqual(state.body.maps.map(map => [map.id, map.companions]), [['cabin', false], ['supermarket', false], ['hospital', true], ['funfair', false]]);
  await cabin.close(); await hospital.close();
});

test('a brain without the map guide is closed with 4002 and never unseats the brain in place', async () => {
  const { url, brain } = shared;
  const outdated = async root => {
    const old = await new Peer(url.replace('http:', 'ws:') + root + 'companions').open();
    old.send({ type: 'brain-hello', name: 'old-brain', version: 1, capabilities: ['team-plan-v1'] });
    const closed = await old.closed;
    assert.equal(closed.code, 4002, root); assert.match(closed.reason, /relance companions\.cmd/, root);
    assert.ok(!old.messages.some(message => message.type === 'brain-welcome'), root);
  };
  await outdated('/');
  const { brain: seated, welcome } = await brain('supermarket');
  assert.equal(welcome.mapId, 'supermarket');
  await outdated('/maps/supermarket/');
  const state = await until(() => health(url), current => current.body.maps.find(map => map.id === 'supermarket').companions === true);
  assert.equal(state.body.maps.find(map => map.id === 'cabin').companions, false);
  assert.equal(seated.socket.readyState, WebSocket.OPEN, 'the up-to-date brain keeps its seat');
});

test('a download the reader stalls is never cut by the upstream idle timeout', { timeout: 60000 }, async t => {
  const { url } = await fixture(t, { upstreamTimeoutMs: 200 });
  const size = statSync(new URL('../public/levels/supermarket.glb', import.meta.url)).size;
  const received = await new Promise((resolve, reject) => {
    const request = http.get(url + '/levels/supermarket.glb', response => {
      let bytes = 0, stalled = false;
      // A cut stream must show up as missing bytes, never as a hung test.
      const timer = setTimeout(() => { request.destroy(); resolve(bytes); }, 20000);
      response.on('data', chunk => {
        bytes += chunk.length;
        if (!stalled && bytes > 1024 * 1024) { stalled = true; response.pause(); setTimeout(() => response.resume(), 1500); }
      });
      response.on('error', () => {}); response.on('close', () => { clearTimeout(timer); resolve(bytes); });
    });
    request.on('error', reject);
  });
  assert.equal(received, size, 'the stalled 27 MB level still arrives whole');
});

test('closing the gateway drops a brain without a "replaced" code, stops every worker and frees the port', async t => {
  const { gateway, brain, port } = await fixture(t);
  const { brain: connected } = await brain('hospital');
  const first = gateway.close(), second = gateway.close();
  assert.equal(first, second, 'close is idempotent');
  await first;
  const { code } = await connected.closed;
  assert.notEqual(code, 1000); assert.notEqual(code, 4001);
  for (const entry of gateway.workers.values()) assert.equal(entry.exited, true, entry.id);
  const again = http.createServer();
  await new Promise((resolve, reject) => { again.once('error', reject); again.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => again.close(resolve));
});

test('a stopped map answers 503 without ever falling back to the cabin', async t => {
  const { gateway, url, peer, build, logs } = await fixture(t);
  await gateway.workers.get('hospital').worker.terminate();
  assert.equal(gateway.workers.get('hospital').ready, false);
  const page = await fetch(url + '/maps/hospital/');
  assert.equal(page.status, 503); assert.deepEqual(await page.json(), { ok: false, error: 'map-unavailable', mapId: 'hospital' });
  assert.equal((await fetch(url + '/maps/hospital/world.json')).status, 503);
  assert.equal(await refusal(url.replace('http:', 'ws:') + '/maps/hospital/ws'), 503);
  assert.equal((await fetch(url + '/')).status, 200);
  const cabin = await peer('cabin'); assert.equal((await cabin.join(build('cabin'))).type, 'welcome');
  const state = await health(url);
  assert.equal(state.status, 503); assert.equal(state.body.ok, false);
  assert.equal(state.body.maps.find(map => map.id === 'hospital').ready, false);
  assert.equal(state.body.maps.find(map => map.id === 'cabin').ready, true);
  assert.ok(logs.some(line => /\[hospital\] décor arrêté \(code \d+\) : relance la passerelle\./.test(line)), logs.join('\n'));
});

// The command the family runs (play.cmd → npm run start:lan): its banner, a
// port typo and a port another application holds.
function command(args, env = {}) {
  const child = spawn(process.execPath, ['lan-gateway.mjs', ...args], { cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...process.env, OPENAI_API_KEY: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
  return { child, exited, output: () => output,
    async stop() { if (child.exitCode === null && child.signalCode === null) { child.kill(); await exited; } } };
}

test('the command prints the four-decor banner with the address the launchers read', { timeout: 60000 }, async t => {
  const run = command(['0'], { PORT: '3002' }); t.after(() => run.stop());
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('No banner: ' + run.output())), 30000);
    const check = () => { const match = run.output().match(/Sur cet ordinateur : http:\/\/localhost:(\d+)\r?\n/); if (match) { clearTimeout(timer); resolve(Number(match[1])); } };
    run.child.stdout.on('data', check); run.exited.then(code => { clearTimeout(timer); reject(Error(`exited ${code}: ${run.output()}`)); });
  });
  assertSafePort(port);
  await until(async () => run.output(), text => text.includes('companions.cmd'));
  const lines = run.output().split(/\r?\n/);
  assert.ok(lines.includes('  DEADWOOD — LAST LIGHT · quatre décors au choix dans le menu'), run.output());
  assert.ok(lines.includes(`  Sur cet ordinateur : http://localhost:${port}`));
  for (const url of localNetworkUrls(port)) assert.ok(lines.includes(`  Réseau local       : ${url}`), url);
  assert.ok(lines.includes("  Même Wi-Fi : ouvre cette adresse ; La cabane par défaut, Le Dernier Panier, L'Hôpital des Pins et La Fête Foraine dans DÉCOR"));
  assert.ok(lines.includes('  Compagnons IA (facultatif, sur cet ordinateur) : companions.cmd, un seul cerveau pour les quatre décors'));
  const state = await health(`http://127.0.0.1:${port}`);
  assert.equal(state.status, 200); assert.equal(state.body.maps.length, 4);
});

test('the command refuses a port typo and names a port another application holds', { timeout: 60000 }, async t => {
  for (const typo of ['abc', '70000', '-1', '30 02']) {
    const run = command([typo]); t.after(() => run.stop());
    assert.equal(await run.exited, 2, typo); assert.match(run.output(), /Port invalide/, typo);
  }
  const occupant = http.createServer();
  await new Promise((resolve, reject) => { occupant.once('error', reject); occupant.listen(0, '0.0.0.0', resolve); });
  t.after(() => new Promise(resolve => occupant.close(resolve)));
  const taken = occupant.address().port; assertSafePort(taken);
  const run = command([String(taken)]); t.after(() => run.stop());
  assert.equal(await run.exited, 1, run.output());
  assert.ok(run.output().includes(`Le port ${taken} est déjà utilisé par une autre application.`), run.output());
});
