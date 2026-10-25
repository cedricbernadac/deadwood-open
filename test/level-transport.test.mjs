import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
import { splitSaveText, saveSummary, keepSave, readSaves } from '../public/save-game.js';

// Both map servers can run side by side. Exercise the actual browser module,
// build guard and save upload boundaries through HTTP and WebSockets.
class Peer {
  constructor(origin) {
    this.socket = new WebSocket(origin.replace(/^http/, 'ws') + '/ws');
    this.messages = []; this.waiters = new Set();
    this.socket.on('error', () => {});
    this.socket.on('message', raw => {
      const message = JSON.parse(raw.toString()); this.messages.push(message);
      for (const waiter of [...this.waiters]) if (waiter.predicate(message)) waiter.finish(message);
    });
  }
  async open() { await once(this.socket, 'open'); return this; }
  send(message) { const mark = this.messages.length; this.socket.send(JSON.stringify(message)); return mark; }
  wait(predicate, mark = 0) {
    const existing = this.messages.slice(mark).find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiters.delete(waiter); reject(Error('Level test WebSocket response timed out.')); }, 6000);
      const waiter = { predicate, finish: message => { clearTimeout(timer); this.waiters.delete(waiter); resolve(message); } };
      this.waiters.add(waiter);
    });
  }
  async upload(save) {
    const text = JSON.stringify(save), chunks = splitSaveText(text), mark = this.messages.length;
    this.send({ type: 'load-begin', chunks: chunks.length, size: text.length });
    for (const [index, data] of chunks.entries()) this.send({ type: 'load-chunk', index, data });
    return this.wait(message => message.type === 'load-result', mark);
  }
  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    const ended = once(this.socket, 'close'); this.socket.close(); await ended;
  }
}

async function fixture(t, mode, mapId) {
  const peers = [];
  const launcher = mode === 'lan' ? { supermarket: 'start-supermarket.mjs', hospital: 'start-hospital.mjs' }[mapId] : undefined;
  const useLauncher = launcher !== undefined;
  const args = mode === 'online' ? ['online-server.mjs'] : useLauncher ? [launcher, '0'] : ['server.mjs'];
  const child = spawn(process.execPath, args, {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...process.env, PORT: '0', DEADWOOD_LEVEL: useLauncher ? 'cabin' : mapId },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  t.after(async () => {
    await Promise.all(peers.map(peer => peer.close()));
    if (child.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; }
  });
  let output = '';
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(output || 'Level server did not start.')), 15000);
    const collect = chunk => {
      output += chunk; const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) {
        clearTimeout(timer);
        const port = Number(match[1]);
        if ((port >= 3000 && port <= 3099) || port === 3013 || port === 3104) reject(Error(`Level server took the shared port ${port}.`));
        else resolve(`http://127.0.0.1:${port}`);
      }
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.once('exit', code => { clearTimeout(timer); reject(Error(`Level server exited ${code}: ${output}`)); });
  });
  const version = await (await fetch(origin + '/version.json')).json();
  async function connect(build = version.build) {
    const peer = await new Peer(origin).open(); peers.push(peer);
    const mark = peer.send({ type: 'join', protocol: 1, build, name: 'Jules' });
    const result = await peer.wait(message => ['welcome', 'outdated', 'error'].includes(message.type), mark);
    return { peer, result };
  }
  async function pausedSave() {
    const { peer, result } = await connect(); assert.equal(result.type, 'welcome');
    let mark = peer.send({ type: 'start' });
    await peer.wait(message => message.type === 'state' && message.phase === 'countdown', mark);
    mark = peer.send({ type: 'pause', paused: true });
    await peer.wait(message => message.type === 'state' && message.paused, mark);
    mark = peer.send({ type: 'save-game' });
    return (await peer.wait(message => message.type === 'save-game', mark)).save;
  }
  return { origin, version, connect, pausedSave };
}

for (const mode of ['lan', 'online']) {
  test(`${mode}: map identity, vendor modules, builds and saved nights stay isolated`, { timeout: 60000 }, async t => {
    const cabin = await fixture(t, mode, 'cabin'), supermarket = await fixture(t, mode, 'supermarket');
    assert.notEqual(cabin.version.build, supermarket.version.build, 'same source with another map has another build');
    for (const [mapId, server] of [['cabin', cabin], ['supermarket', supermarket]]) {
      assert.equal(server.version.mapId, mapId);
      const worldResponse = await fetch(server.origin + '/world.json'), world = await worldResponse.json();
      assert.equal(world.mapId, mapId);
      assert.equal(worldResponse.headers.get('cache-control'), 'no-store');
      const health = await (await fetch(server.origin + '/health')).json();
      if (mapId === 'supermarket' || mode === 'online') assert.equal(health.mapId, mapId);
      else assert.deepEqual(health, { ok: true, rooms: 0, players: 0 });
      const module = await fetch(server.origin + '/level-id.js');
      assert.equal(module.headers.get('cache-control'), 'no-store');
      assert.equal(await module.text(), `export const LEVEL_ID = ${JSON.stringify(mapId)};\n`);
      const head = await fetch(server.origin + '/level-id.js', { method: 'HEAD' });
      assert.equal(await head.text(), ''); assert.ok(Number(head.headers.get('content-length')) > 0);
      for (const path of ['/vendor/GLTFLoader.js', '/vendor/BufferGeometryUtils.js']) {
        const response = await fetch(server.origin + path), source = await response.text();
        assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /javascript/);
        assert.match(source, /from '\/vendor\/three\.module\.js'/);
        assert.doesNotMatch(source, /from ['"]three['"]/);
        if (path.includes('GLTFLoader')) {
          assert.match(source, /from '\/vendor\/BufferGeometryUtils\.js'/);
          assert.doesNotMatch(source, /from ['"]\.\.\/utils\/BufferGeometryUtils\.js['"]/);
        }
      }
    }
    assert.equal((await supermarket.connect(cabin.version.build)).result.type, 'outdated');
    assert.equal((await cabin.connect(supermarket.version.build)).result.type, 'outdated');
    const cabinSave = await cabin.pausedSave(), supermarketSave = await supermarket.pausedSave();
    assert.equal(cabinSave.mapId, 'cabin'); assert.equal(supermarketSave.mapId, 'supermarket');
    for (const [server, save] of [[cabin, supermarketSave], [supermarket, cabinSave]]) {
      const { peer, result } = await server.connect(); assert.equal(result.type, 'welcome');
      assert.deepEqual(await peer.upload(save), { type: 'load-result', ok: false, reason: 'map' });
      assert.equal(peer.messages.findLast(message => message.type === 'state').phase, 'lobby', 'a wrong map leaves its room unchanged');
    }
    const { peer: restored } = await supermarket.connect();
    assert.equal((await restored.upload(supermarketSave)).ok, true);
    const restoredState = restored.messages.findLast(message => message.type === 'state');
    assert.equal(restoredState.mapId, 'supermarket'); assert.equal(restoredState.paused, true);
    const legacySave = { ...cabinSave }; delete legacySave.mapId;
    const { peer: oldCabin } = await cabin.connect(); assert.equal((await oldCabin.upload(legacySave)).ok, true);
    const { peer: wrongLegacy } = await supermarket.connect(); assert.equal((await wrongLegacy.upload(legacySave)).reason, 'map');
    const { peer: invalidId } = await cabin.connect(); assert.equal((await invalidId.upload({ ...cabinSave, mapId: null })).reason, 'map');
  });
}

// A standalone room code names its map too, so a code read out from any of
// the three home servers can be joined from the home menu.
test('lan: standalone room codes are S… for the supermarket, H… for the hospital and hex for the cabin', { timeout: 60000 }, async t => {
  for (const [mapId, pattern] of [['cabin', /^[0-9A-F]{6}$/], ['supermarket', /^S[0-9A-Z]{5}$/], ['hospital', /^H[0-9A-Z]{5}$/]]) {
    const server = await fixture(t, 'lan', mapId);
    assert.equal(server.version.mapId, mapId);
    const { result: host } = await server.connect();
    assert.equal(host.type, 'welcome'); assert.match(host.room, pattern, mapId);
    const guest = await new Peer(server.origin).open(); t.after(() => guest.close());
    const mark = guest.send({ type: 'join', protocol: 1, build: server.version.build, name: 'Lou', room: host.room.toLowerCase() });
    const joined = await guest.wait(message => ['welcome', 'error'].includes(message.type), mark);
    assert.equal(joined.type, 'welcome', mapId); assert.equal(joined.room, host.room);
  }
});

test('save summaries and browser copies retain an explicit level while legacy copies remain readable', () => {
  const save = { format: 'deadwood-save', version: 1, wave: 2, players: [{ name: 'Jules' }], mapId: 'supermarket' };
  assert.equal(saveSummary(save).mapId, 'supermarket');
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(keepSave(storage, save), true); assert.equal(readSaves(storage)[0].mapId, 'supermarket');
  const legacy = { ...save }; delete legacy.mapId;
  assert.ok(saveSummary(legacy)); assert.equal(keepSave(storage, legacy, { id: 'legacy' }), true);
});

test('the companion launcher chooses level 2 explicitly and forwards dry mode or a custom server', () => {
  const launcher = readFileSync(new URL('../companions-supermarket.cmd', import.meta.url), 'utf8');
  assert.match(launcher, /set "DEADWOOD_LEVEL=supermarket"/);
  assert.match(launcher, /set "PORT=3013"/);
  assert.match(launcher, /call companions\.cmd %\*/);
  assert.doesNotMatch(launcher, /taskkill|Stop-Process|start /i);
});
