import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createOnlineServer } from '../online-server.mjs';

// Impact numbers over real WebSockets (owner, 18 October): each survivor
// receives their own and nobody else's, on the LAN and the online server;
// with numbers off, nothing is added.
class Peer {
  constructor(url) {
    this.socket = new WebSocket(url.replace(/^http/, 'ws') + '/ws'); this.messages = []; this.waiters = new Set();
    this.socket.on('message', raw => {
      const message = JSON.parse(raw.toString()); this.messages.push(message);
      for (const waiter of [...this.waiters]) if (waiter.predicate(message)) waiter.finish(message);
    });
    this.socket.on('error', () => {});
  }
  async open() { await once(this.socket, 'open'); return this; }
  send(message) { const mark = this.messages.length; this.socket.send(JSON.stringify(message)); return mark; }
  wait(predicate, since = 0, label = 'Impact numbers WebSocket response') {
    const found = this.messages.slice(since).find(predicate); if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiters.delete(waiter); reject(new Error(`${label} timed out`)); }, 5000);
      const waiter = { predicate, finish: message => { clearTimeout(timer); this.waiters.delete(waiter); resolve(message); } };
      this.waiters.add(waiter);
    });
  }
  async toggle(enabled) { const mark = this.send({ type: 'impact-numbers', enabled }); return this.wait(message => message.type === 'impact-numbers' && message.enabled === enabled, mark); }
  async join(fields = {}) { const mark = this.send({ type: 'join', name: 'Test', ...fields }); return this.wait(message => message.type === 'welcome', mark); }
  impacts(since = 0) { return this.messages.slice(since).filter(message => message.type === 'impacts'); }
  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    const closed = once(this.socket, 'close'); this.socket.close(); await closed;
  }
}

async function lan(t) {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  t.after(async () => { if (child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done; } });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`LAN fixture did not start: ${output}`)), 15000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`LAN fixture exited ${code}: ${output}`)); });
    const collect = chunk => {
      output += chunk.toString(); const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
  });
  const peers = []; t.after(async () => { for (const peer of peers) await peer.close(); });
  return { peer: async () => { const peer = await new Peer(url).open(); peers.push(peer); return peer; } };
}

const valid = message => Array.isArray(message.impacts) && message.impacts.length > 0 && message.impacts.every(record =>
  Array.isArray(record) && record.length === 6 && typeof record[0] === 'string' && record.slice(1, 5).every(Number.isFinite) && Number.isInteger(record[5]));

test('LAN: the toggle is strict and answered privately; numbers reach only the attacker; off adds nothing', async t => {
  const { peer } = await lan(t), a = await peer(), b = await peer();
  a.send({ type: 'impact-numbers', enabled: true }); // Before join: ignored.
  const first = await a.join({ practice: true }); await b.join({ room: first.room });
  for (const invalid of [null, 1, 'true', [], {}]) a.send({ type: 'impact-numbers', enabled: invalid });
  const barrier = a.send({ type: 'ping' }); await a.wait(message => message.type === 'pong', barrier);
  assert.equal(a.messages.slice(barrier).some(message => message.type === 'impact-numbers'), false, 'invalid toggles get no answer');
  const bOn = b.messages.length; await a.toggle(true); await b.toggle(true);
  assert.equal(b.messages.slice(bOn).filter(message => message.type === 'impact-numbers').length, 1, 'b only hears its own toggle');
  a.send({ type: 'practice', action: 'weapon', weapon: 'flamethrower' });
  await a.wait(message => message.type === 'state' && message.players.some(player => player.id === first.id && player.weapon === 'flamethrower' && player.hands.primary.fireReadyLeft === 0));
  const shotAt = a.send({ type: 'shoot' }), bAt = b.messages.length;
  const shot = await a.wait(message => message.event === 'shot', shotAt);
  assert.ok(shot.hits > 0); assert.equal(Object.hasOwn(shot, 'impacts'), false, 'the public shot carries no numbers');
  const numbers = await a.wait(message => message.type === 'impacts', shotAt);
  assert.ok(valid(numbers)); assert.ok(numbers.impacts.every(record => record[5] & 2), 'flame: continuous fire');
  await a.wait(message => message.type === 'impacts' && message.impacts.some(record => record[5] & 8), shotAt, 'burn batch');
  const later = await b.wait(message => message.type === 'state' && message.time > shot.time + .5, bAt);
  assert.ok(later); assert.equal(b.impacts(bAt).length, 0, 'b never receives a\'s numbers');
  assert.equal(b.messages.slice(bAt).some(message => message.event === 'burn-damage'), false);
  await a.toggle(false); const off = a.messages.length;
  const offShot = a.send({ type: 'shoot' }), second = await a.wait(message => message.event === 'shot', offShot);
  assert.ok(second.hits > 0);
  await a.wait(message => message.type === 'state' && message.time > second.time + .6, offShot);
  assert.equal(a.impacts(off).length, 0, 'off: no numbers at all, not even the burns still under way');
});

test('online: numbers reach only their shooter, stop on disconnect and come back with the resume', async t => {
  const server = createOnlineServer({ port: 0, host: '127.0.0.1', autoTick: false });
  const address = await server.listen(), url = `http://127.0.0.1:${address.port}`;
  t.after(() => server.close());
  const peers = []; t.after(async () => { for (const peer of peers) await peer.close(); });
  const peer = async () => { const p = await new Peer(url).open(); peers.push(p); return p; };
  const a = await peer(), b = await peer(), fields = { protocol: 1, build: server.build };
  const first = await a.join({ ...fields, practice: true }); await b.join({ ...fields, room: first.room });
  const room = server.rooms.get(first.room), sim = room.simulation;
  for (const invalid of [undefined, null, 1, 'true', {}, []]) a.send({ type: 'impact-numbers', enabled: invalid });
  await a.toggle(true); await b.toggle(true);
  assert.deepEqual([...sim.impactObservers].sort(), [first.id, [...sim.players.keys()].find(id => id !== first.id)].sort());
  const practice = a.send({ type: 'practice', action: 'weapon', weapon: 'flamethrower' });
  await a.wait(message => message.event === 'practice' && message.action === 'weapon', practice);
  for (let step = 0; step < 15; step++) server.step();
  const shotAt = a.send({ type: 'shoot', shotId: 1 }), bAt = b.messages.length;
  const ack = await a.wait(message => message.type === 'shot-ack', shotAt);
  assert.equal(ack.accepted, true);
  const numbers = await a.wait(message => message.type === 'impacts', shotAt);
  assert.ok(valid(numbers));
  for (let step = 0; step < 20; step++) server.step();
  await a.wait(message => message.type === 'impacts' && message.impacts.some(record => record[5] & 8), shotAt, 'online burn batch');
  const barrier = b.send({ type: 'ping' }); await b.wait(message => message.type === 'pong', barrier);
  assert.equal(b.impacts(bAt).length, 0, 'b never receives a\'s numbers');
  // A lost connection stops a's numbers at once; the resume restores them.
  await a.close();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(sim.impactObservers.has(first.id), false);
  const resumed = await peer(), resumeAt = resumed.send({ type: 'resume', ...fields, token: first.resumeToken });
  const welcome = await resumed.wait(message => message.type === 'welcome', resumeAt);
  assert.equal(welcome.resumed, true);
  assert.equal(sim.impactObservers.has(first.id), true, 'the peer keeps its choice across the resume');
  await resumed.toggle(false);
  assert.equal(sim.impactObservers.has(first.id), false);
  const leaveAt = b.messages.length; b.send({ type: 'leave' }); await b.wait(message => message.type === 'left', leaveAt);
  assert.equal(sim.impactObservers.size, 0);
});
