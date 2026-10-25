import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createOnlineServer } from '../online-server.mjs';

// The friendly fire choice (rules.js FRIENDLY_FIRE) on real sockets and
// ephemeral ports: the host alone sets it in the lobby, every peer sees it in
// the room's snapshots, and it is locked once the night runs. Wi-Fi on both
// maps, and online.
const root = fileURLToPath(new URL('../', import.meta.url));

class Peer {
  constructor(url) {
    this.socket = new WebSocket(url); this.messages = []; this.waiters = new Set();
    this.socket.on('error', () => {});
    this.socket.on('message', raw => {
      const message = JSON.parse(raw); this.messages.push(message);
      for (const waiter of [...this.waiters]) if (waiter.predicate(message)) waiter.finish(message);
    });
  }
  async open() { await once(this.socket, 'open'); return this; }
  send(message) { const mark = this.messages.length; this.socket.send(JSON.stringify(message)); return mark; }
  wait(predicate, mark = 0, timeout = 5000) {
    const found = this.messages.slice(mark).find(predicate); if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiters.delete(waiter); reject(Error(`Friendly fire socket timeout; last ${JSON.stringify(this.messages.at(-1))?.slice(0, 300)}`)); }, timeout);
      const waiter = { predicate, finish: message => { clearTimeout(timer); this.waiters.delete(waiter); resolve(message); } };
      this.waiters.add(waiter);
    });
  }
  // The Wi-Fi server answers without the nonce: the first pong after it, then.
  async ping(nonce) { const mark = this.send({ type: 'ping', nonce }); await this.wait(message => message.type === 'pong' && (message.nonce ?? nonce) === nonce, mark); }
  async close() { if (this.socket.readyState === WebSocket.CLOSED) return; const closed = once(this.socket, 'close'); this.socket.close(); await closed; }
}
const state = (peer, predicate, mark = 0) => peer.wait(message => message.type === 'state' && predicate(message), mark);

// The same exchange on either server; `step` lets the online test tick by hand.
async function exchange(host, guest, step = () => {}) {
  const first = await state(host, message => message.players?.length === 2);
  assert.equal(first.friendlyFire, 'off', 'off by default');
  guest.send({ type: 'friendly-fire', level: 'full' });
  await guest.ping('guest-try'); step();
  let mark = host.messages.length;
  host.send({ type: 'friendly-fire', level: 'reduced' }); step();
  const seen = await state(guest, message => message.friendlyFire === 'reduced', mark);
  assert.equal(seen.hostId !== undefined, true);
  assert.ok(!guest.messages.some(message => message.type === 'state' && message.friendlyFire === 'full'), 'a guest cannot choose it');
  host.send({ type: 'start' }); step();
  await state(host, message => message.phase === 'countdown');
  host.send({ type: 'friendly-fire', level: 'off' });
  await host.ping('locked'); step(); step();
  mark = host.messages.length; step();
  const later = await state(host, message => message.phase !== 'lobby', mark);
  assert.equal(later.friendlyFire, 'reduced', 'locked once the night has begun');
}

test('online: the host sets friendly fire in the lobby and every peer sees it', async t => {
  const app = createOnlineServer({ port: 0, host: '127.0.0.1', autoTick: false });
  t.after(() => app.close());
  const address = await app.listen(), url = `ws://127.0.0.1:${address.port}/ws`;
  const host = await new Peer(url).open(), guest = await new Peer(url).open();
  t.after(() => Promise.all([host, guest].map(peer => peer.close())));
  host.send({ type: 'join', protocol: 1, build: app.build, name: 'Host' });
  const welcome = await host.wait(message => message.type === 'welcome');
  guest.send({ type: 'join', protocol: 1, build: app.build, name: 'Guest', room: welcome.room });
  await guest.wait(message => message.type === 'welcome');
  app.step(); app.step();
  await exchange(host, guest, () => app.step());
  assert.equal(app.rooms.get(welcome.room).simulation.friendlyFire, 'reduced');
});

async function launchLanServer(level) {
  const env = { ...process.env, PORT: '0' };
  if (level === 'supermarket') env.DEADWOOD_LEVEL = 'supermarket'; else delete env.DEADWOOD_LEVEL;
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  const address = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 10000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited with ${code}: ${output}`)); });
    const collect = chunk => {
      output += chunk.toString();
      const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timeout); resolve(`127.0.0.1:${match[1]}`); }
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
  });
  return { address, async close() { if (child.exitCode !== null) return; const exited = once(child, 'exit'); child.kill(); await exited; } };
}

for (const level of ['cabin', 'supermarket']) {
  test(`Wi-Fi (${level}): the host sets friendly fire in the lobby and every peer sees it`, { timeout: 60000 }, async t => {
    const server = await launchLanServer(level);
    t.after(() => server.close());
    const host = await new Peer(`ws://${server.address}/ws`).open(), guest = await new Peer(`ws://${server.address}/ws`).open();
    t.after(() => Promise.all([host.close(), guest.close()]));
    host.send({ type: 'join', name: 'Host', weapon: 'pistol' });
    const welcome = await host.wait(message => message.type === 'welcome');
    guest.send({ type: 'join', name: 'Guest', weapon: 'pistol', room: welcome.room });
    await guest.wait(message => message.type === 'welcome');
    const lobby = await state(host, message => message.players?.length === 2);
    if (level === 'supermarket') assert.equal(lobby.mapId, 'supermarket'); else assert.equal(lobby.mapId, undefined);
    await exchange(host, guest);
  });
}
